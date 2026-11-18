/**
 * ============================================================================
 * COMPONENTE FRONTEND: COTIZADOR DE NODOS BARRIALES Y ABM MARCA BLANCA (ETAPAS 1 Y 2)
 * Integrado a los 6 Flujos de la Pizarra Inteligente LAMDA (pizarra-simulacion.html)
 * ============================================================================
 */
(function () {
    const ESTADO_NODOS = {
        inicializado: false,
        cargando: false,
        subTabActiva: 'abm_nodos', // 'abm_nodos' | 'catalogo' | 'cotizador'
        nodos: [],
        catalogo: [],
        propuestas: [],
        propuestas_combos: [],
        ofertas_gestor: [],
        presentaciones_planta_disponibles: [],
        fuentes: {
            ingredientes_por_flujo: [],
            articulos_flujo_1: [],
            envases: [],
            tarifas_mano_obra: [],
            cuentas_bancarias: [],
            clientes_bunker: []
        },
        filtroFlujoCatalogo: 0,
        filtroNodoOfertas: 0,
        busquedaCatalogo: '',
        busquedaPlantaDisponible: '',
        filtroPesoPlantaDisponible: 'SUB_1KG',
        busquedaFuentes: '',
        busquedaClienteAbm: '',
        clienteMadreSeleccionadoId: null,
        flujoSeleccionadoMesa: 2,
        unidadTiempoMesa: 'seg',
        propuestaActivaId: null,
        catalogoEditandoId: null,
        omitirAutoOrigenInicial: false,
        anatomiaActualMesa: null,
        diccionarioBunkerActual: null,
        casoBSeleccion: {
            familia_id: null,
            incluir_familia: true,
            modo_display_familia: 'ABREVIATURA',
            articulo_principal_id: null,
            silencioso_principal: false,
            modo_display_principal: 'COMPLETO',
            posiciones: {},
            rubro: '',
            sub_rubro: ''
        },
        nodoEditandoId: null,
        modoCreacionNuevo: false,
        modoLaboratorio: false,
        mostrarArchivadosAbm: false,
        ultimoPreviewEtiqueta: null,
        logoZplConfigActual: null,
        temaVisualEditando: {},
        slugHistoricoActual: ''
    };

    const FLUJO_META = {
        1: { corto: 'Flujo 1 · Directo', nombre: 'Flujo 1: Bulto Cerrado / Unidad Directa', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.14)' },
        2: { corto: 'Flujo 2 · Puro Fraccionado', nombre: 'Flujo 2: Fraccionado Puro (100% Ingrediente Único)', color: '#34d399', bg: 'rgba(52, 211, 153, 0.14)' },
        3: { corto: 'Flujo 3 · Mixes', nombre: 'Flujo 3: Mezcla Interna (Carro Mix) a Fracción', color: '#a78bfa', bg: 'rgba(167, 139, 250, 0.14)' },
        4: { corto: 'Flujo 4 · Tostaderos', nombre: 'Flujo 4: Unidad Productiva Externa (Tostadero)', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.14)' },
        5: { corto: 'Flujo 5 · Barritas', nombre: 'Flujo 5: Pre-Mezcla + Elaboración Barritas', color: '#f87171', bg: 'rgba(248, 113, 113, 0.14)' },
        6: { corto: 'Flujo 6 · Granolas', nombre: 'Flujo 6: Doble Mezcla + Horneado + Agregado Seco', color: '#fb923c', bg: 'rgba(251, 146, 60, 0.14)' },
        8: { corto: 'LDN 8 · Combos', nombre: 'LDN 8: Combo / Pack Compuesto Multi-SKU', color: '#c4b5fd', bg: 'rgba(168, 85, 247, 0.18)' }
    };

    function fmtMoneda(val, decimales = 0) {
        const num = Number(val) || 0;
        return '$' + num.toLocaleString('es-AR', {
            minimumFractionDigits: decimales,
            maximumFractionDigits: decimales
        });
    }

    function escaparHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function cumpleBusquedaUniversalLamda(bolsaTexto, query) {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return true;
        const haystack = String(bolsaTexto || '').toLowerCase();
        const terminos = q.split(/\s+/).filter(Boolean);
        return terminos.every(t => haystack.includes(t));
    }

    function obtenerCostoVivoIngredientePizarra(ingId, fallbackCosto = 0) {
        const idNum = Number(ingId);
        if (window.pizarraSimulacionMaster && Array.isArray(window.pizarraSimulacionMaster.ingredientes)) {
            const encontrado = window.pizarraSimulacionMaster.ingredientes.find(i => Number(i.id) === idNum);
            if (encontrado && Number(encontrado.costo_patron) > 0) {
                return Number(encontrado.costo_patron);
            }
        }
        const enFuentes = ESTADO_NODOS.fuentes.ingredientes_por_flujo.find(i => Number(i.id) === idNum);
        if (enFuentes && Number(enFuentes.costo_kg) > 0) {
            return Number(enFuentes.costo_kg);
        }
        return Number(fallbackCosto) || 0;
    }

    async function cargarDatosNodosBarriales(forzar = false) {
        if (ESTADO_NODOS.cargando) return;
        if (ESTADO_NODOS.inicializado && !forzar) {
            actualizarBadgePropuestasPendientes();
            renderizarVistaNodosCompleta();
            return;
        }

        ESTADO_NODOS.cargando = true;
        try {
            const resp = await fetch('/api/produccion/nodos/inicializar');
            const data = await resp.json();
            if (!resp.ok || !data.ok) {
                throw new Error(data.error || 'No se pudo inicializar el módulo de Nodos');
            }

            ESTADO_NODOS.nodos = data.nodos || [];
            ESTADO_NODOS.catalogo = data.catalogo || [];
            ESTADO_NODOS.propuestas = data.propuestas || [];
            ESTADO_NODOS.propuestas_combos = data.propuestas_combos || [];
            ESTADO_NODOS.ofertas_gestor = data.ofertas_gestor || [];
            ESTADO_NODOS.presentaciones_planta_disponibles = data.presentaciones_planta_disponibles || [];
            ESTADO_NODOS.fuentes = data.fuentes || ESTADO_NODOS.fuentes;
            ESTADO_NODOS.modoLaboratorio = Boolean(data.modo_laboratorio);
            ESTADO_NODOS.inicializado = true;

            if (data.combos_estado && window.CombosPizarra && typeof window.CombosPizarra.aplicarDatosEstado === 'function') {
                window.CombosPizarra.aplicarDatosEstado(data.combos_estado);
            }

            actualizarBadgePropuestasPendientes();
            renderizarVistaNodosCompleta();
        } catch (err) {
            console.error('❌ [NodosCotizador] Error cargando datos:', err);
            const container = document.getElementById('nodos-cotizador-container');
            if (container) {
                container.innerHTML = `
                    <div style="padding: 28px; background: #1e293b; border: 1px solid #ef4444; border-radius: 12px; color: #fecaca;">
                        <h3 style="margin-top:0;">⚠️ Error al conectar con el módulo de Nodos</h3>
                        <p>${escaparHtml(err.message)}</p>
                        <button class="btn btn-primary" onclick="window.recargarModuloNodosBarriales()">🔄 Reintentar</button>
                    </div>
                `;
            }
        } finally {
            ESTADO_NODOS.cargando = false;
        }
    }

    function actualizarBadgePropuestasPendientes() {
        if (window.CombosPizarra && typeof window.CombosPizarra.sincronizarBadgesPendientesGlobal === 'function') {
            window.CombosPizarra.sincronizarBadgesPendientesGlobal();
        }
        const badge = document.getElementById('ldn-badge-7');
        if (!badge) return;
        const pendFracc = (ESTADO_NODOS.propuestas || []).filter(p => p.estado === 'PENDIENTE_COTIZACION').length;
        const pendCombos = (ESTADO_NODOS.propuestas_combos || []).filter(p => p.estado === 'PENDIENTE_COTIZACION').length;
        const pendientes = pendFracc + pendCombos;
        if (pendientes > 0) {
            badge.style.display = 'inline-flex';
            badge.textContent = `${pendientes} prop.`;
            badge.style.background = 'rgba(245, 158, 11, 0.22)';
            badge.style.color = '#fbbf24';
            badge.style.border = '1px solid rgba(245, 158, 11, 0.45)';
        } else {
            badge.style.display = 'none';
        }
    }

    function cambiarSubTabNodos(subTab) {
        ESTADO_NODOS.subTabActiva = subTab;
        renderizarVistaNodosCompleta();
        if (subTab === 'combos') {
            if (window.CombosPizarra && typeof window.CombosPizarra.inicializar === 'function') {
                window.CombosPizarra.inicializar('nodos-combos-subtab-mount');
            }
        } else if (subTab === 'cotizador') {
            recalcularMesaCotizacionEnVivo();
        } else if (subTab === 'abm_nodos') {
            if (ESTADO_NODOS.modoCreacionNuevo) {
                resetearPreviewLogoAbm({ inicialesDefault: '' });
                regenerarLogoZplEnVivo();
            } else {
                const nodoInicial = ESTADO_NODOS.nodoEditandoId
                    ? ESTADO_NODOS.nodos.find(n => Number(n.id) === Number(ESTADO_NODOS.nodoEditandoId))
                    : ESTADO_NODOS.nodos[0];
                if (nodoInicial) {
                    cargarNodoEnFormularioAbm(nodoInicial.id);
                } else {
                    regenerarLogoZplEnVivo();
                }
            }
            asegurarGoogleMapsSdkAbm().then(ok => {
                if (ok) vincularAutocompletePlacesAbm();
            });
        }
    }

    function renderizarVistaNodosCompleta() {
        const container = document.getElementById('nodos-cotizador-container');
        if (!container) return;

        const pendientesCount = ESTADO_NODOS.propuestas.filter(p => p.estado === 'PENDIENTE_COTIZACION').length;
        const catalogoCount = ESTADO_NODOS.catalogo.length;
        const nodosActivosCount = ESTADO_NODOS.nodos.filter(n => n.activo).length;

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:14px; padding: 4px 2px 30px 2px;">
                <!-- CABECERA EJECUTIVA Y SUB-NAVEGACIÓN DE NODOS BARRIALES -->
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; background: linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.92)); border: 1px solid rgba(52,211,153,0.3); border-radius: 12px; padding: 12px 18px;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div style="width:42px; height:42px; border-radius:10px; background:rgba(16,185,129,0.18); border:1px solid rgba(16,185,129,0.4); display:flex; align-items:center; justify-content:center; font-size:1.35rem;">🏘️</div>
                        <div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <h2 style="margin:0; font-size:1.08rem; color:#f8fafc; font-weight:700;">Nodos (Marca Blanca)</h2>
                                <span style="background:rgba(16,185,129,0.18); color:#34d399; border:1px solid rgba(16,185,129,0.35); font-size:0.72rem; padding:2px 8px; border-radius:999px; font-weight:700;">1. Alta de Nodos, Catálogo y Cotizador</span>
                            </div>
                            <div style="font-size:0.78rem; color:#94a3b8; margin-top:2px;">
                                Alta de Nodos vinculados al padrón LAMDA, publicación de catálogo por gestor y cotización de fracciones familiares.
                            </div>
                        </div>
                    </div>

                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <button onclick="window.NodosPizarra.cambiarSubTab('abm_nodos')"
                            style="padding:8px 14px; border-radius:8px; font-weight:700; font-size:0.82rem; cursor:pointer; border:1px solid ${ESTADO_NODOS.subTabActiva === 'abm_nodos' ? '#a78bfa' : '#334155'}; background:${ESTADO_NODOS.subTabActiva === 'abm_nodos' ? 'rgba(167,139,250,0.22)' : '#0f172a'}; color:${ESTADO_NODOS.subTabActiva === 'abm_nodos' ? '#ddd6fe' : '#cbd5e1'}; display:flex; align-items:center; gap:6px;">
                            🏷️ 1. Alta de Nodos y Etiqueta Térmica
                            <span style="background:rgba(255,255,255,0.12); color:#e2e8f0; padding:1px 7px; border-radius:999px; font-size:0.72rem;">${nodosActivosCount} activos</span>
                        </button>

                        <button onclick="window.NodosPizarra.cambiarSubTab('catalogo')"
                            style="padding:8px 14px; border-radius:8px; font-weight:700; font-size:0.82rem; cursor:pointer; border:1px solid ${ESTADO_NODOS.subTabActiva === 'catalogo' ? '#38bdf8' : '#334155'}; background:${ESTADO_NODOS.subTabActiva === 'catalogo' ? 'rgba(56,189,248,0.2)' : '#0f172a'}; color:${ESTADO_NODOS.subTabActiva === 'catalogo' ? '#bae6fd' : '#cbd5e1'}; display:flex; align-items:center; gap:6px;">
                            📦 2. Catálogo y Márgenes por Nodo
                            <span style="background:rgba(255,255,255,0.12); color:#e2e8f0; padding:1px 7px; border-radius:999px; font-size:0.72rem;">${catalogoCount} productos</span>
                        </button>

                        <button onclick="window.NodosPizarra.cambiarSubTab('cotizador')"
                            style="padding:8px 14px; border-radius:8px; font-weight:700; font-size:0.82rem; cursor:pointer; border:1px solid ${ESTADO_NODOS.subTabActiva === 'cotizador' ? '#10b981' : '#334155'}; background:${ESTADO_NODOS.subTabActiva === 'cotizador' ? 'rgba(16,185,129,0.22)' : '#0f172a'}; color:${ESTADO_NODOS.subTabActiva === 'cotizador' ? '#6ee7b7' : '#cbd5e1'}; display:flex; align-items:center; gap:6px;">
                            🧮 3. Cotizador de Fracciones
                            ${pendientesCount > 0 ? `<span style="background:#f59e0b; color:#0f172a; padding:1px 7px; border-radius:999px; font-size:0.72rem; font-weight:800;">${pendientesCount} pend.</span>` : ''}
                        </button>

                        <button id="nodos-subtab-btn-combos" onclick="window.NodosPizarra.cambiarSubTab('combos')"
                            style="padding:8px 14px; border-radius:8px; font-weight:700; font-size:0.82rem; cursor:pointer; border:1px solid ${ESTADO_NODOS.subTabActiva === 'combos' ? '#a855f7' : '#334155'}; background:${ESTADO_NODOS.subTabActiva === 'combos' ? 'rgba(168,85,247,0.22)' : '#0f172a'}; color:${ESTADO_NODOS.subTabActiva === 'combos' ? '#e9d5ff' : '#cbd5e1'}; display:flex; align-items:center; gap:6px;">
                            🎁 4. Combos y Packs
                            <span id="nodos-subtab-combos-badge" style="display:${(ESTADO_NODOS.propuestas_combos || []).filter(p => p.estado === 'PENDIENTE_COTIZACION').length > 0 ? 'inline-block' : 'none'}; background:#f59e0b; color:#0f172a; padding:1px 7px; border-radius:999px; font-size:0.72rem; font-weight:800;">
                                ${(ESTADO_NODOS.propuestas_combos || []).filter(p => p.estado === 'PENDIENTE_COTIZACION').length} pend.
                            </span>
                        </button>

                        <a href="/deposito-nodos" target="_blank"
                            style="text-decoration:none; padding:8px 12px; border-radius:8px; font-weight:700; font-size:0.8rem; border:1px solid rgba(167,139,250,0.5); background:rgba(167,139,250,0.16); color:#ddd6fe; display:inline-flex; align-items:center; gap:5px;"
                            title="Abrir Mesa de Armado de Nodos y Canastos (Estación Nodos)">
                            📦 Mesa de Armado ↗
                        </a>

                        <a href="/liquidacion-nodos" target="_blank"
                            style="text-decoration:none; padding:8px 12px; border-radius:8px; font-weight:700; font-size:0.8rem; border:1px solid rgba(245,158,11,0.5); background:rgba(245,158,11,0.16); color:#fcd34d; display:inline-flex; align-items:center; gap:5px;"
                            title="Abrir Conciliación de Cobros y Liquidación de Cuenta Corriente">
                            💳 Cobros y Liquidación ↗
                        </a>

                        <button onclick="window.NodosPizarra.sincronizarCascadaSeisFlujos()"
                            title="Actualizar todos los precios base tomando los costos vigentes de la Pizarra"
                            style="padding:8px 12px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer; border:1px solid rgba(245,158,11,0.45); background:rgba(245,158,11,0.14); color:#fcd34d;">
                            ⚡ Actualizar Costos
                        </button>

                        <button onclick="window.NodosPizarra.ponerACeroPruebas()"
                            title="Limpiar todos los Nodos, pedidos, canastos y clientes de prueba para iniciar desde cero"
                            style="padding:8px 12px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer; border:1px solid rgba(244,63,94,0.5); background:rgba(244,63,94,0.16); color:#fda4af;">
                            🧹 Puesta a Cero Pruebas
                        </button>
                    </div>
                </div>

                <!-- CONTENIDO DINÁMICO DE LA SUB-PESTAÑA ACTIVA -->
                <div id="nodos-subtab-body">
                    ${ESTADO_NODOS.subTabActiva === 'combos'
                        ? `<div id="nodos-combos-subtab-mount"></div>`
                        : ESTADO_NODOS.subTabActiva === 'cotizador'
                            ? renderizarSubTabCotizador()
                            : ESTADO_NODOS.subTabActiva === 'catalogo'
                                ? renderizarSubTabCatalogo()
                                : renderizarSubTabAbmNodos()}
                </div>
            </div>
        `;

        if (ESTADO_NODOS.subTabActiva === 'combos') {
            if (window.CombosPizarra && typeof window.CombosPizarra.inicializar === 'function') {
                window.CombosPizarra.inicializar('nodos-combos-subtab-mount');
            }
            return;
        }

        if (ESTADO_NODOS.subTabActiva === 'cotizador') {
            if (!ESTADO_NODOS.propuestaActivaId && !ESTADO_NODOS.catalogoEditandoId && !ESTADO_NODOS.omitirAutoOrigenInicial) {
                alCambiarOrigenSelect();
            } else {
                recalcularMesaCotizacionEnVivo();
            }
        } else if (ESTADO_NODOS.subTabActiva === 'abm_nodos') {
            if (ESTADO_NODOS.modoCreacionNuevo) {
                resetearPreviewLogoAbm({ inicialesDefault: '' });
                regenerarLogoZplEnVivo();
                actualizarEncabezadoFormularioAbm(null);
            } else {
                const nodoTarget = ESTADO_NODOS.nodoEditandoId
                    ? ESTADO_NODOS.nodos.find(n => Number(n.id) === Number(ESTADO_NODOS.nodoEditandoId))
                    : (ESTADO_NODOS.nodos.find(n => n.activo !== false) || ESTADO_NODOS.nodos[0]);
                if (nodoTarget) {
                    cargarNodoEnFormularioAbm(nodoTarget.id);
                } else {
                    if (!ESTADO_NODOS.clienteMadreSeleccionadoId) {
                        regenerarLogoZplEnVivo();
                    }
                    actualizarEncabezadoFormularioAbm(null);
                }
            }
            vincularAutocompleteGeoAbm();
        }
    }

    // =========================================================================
    // SUB-PESTAÑA 1: MESA COTIZADORA DE FRACCIONES CONECTADA A LOS 6 FLUJOS
    // =========================================================================
    function renderizarSubTabCotizador() {
        const flujoActual = Number(ESTADO_NODOS.flujoSeleccionadoMesa || 2);
        const envasesOpts = ESTADO_NODOS.fuentes.envases.map(e => {
            const labelEnv = e.label_oficial || `#${e.id} [${e.codigo || e.id}] ${e.nombre}`;
            return `<option value="${e.id}" data-costo="${e.costo_unitario}" ${e.id === 180 ? 'selected' : ''}>${escaparHtml(labelEnv)} (${fmtMoneda(e.costo_unitario, 2)})</option>`;
        }).join('');

        const tarifasOpts = ESTADO_NODOS.fuentes.tarifas_mano_obra.map(t =>
            `<option value="${t.id}" data-valor-hora="${t.valor_hora}">${escaparHtml(t.nombre_completo)} (${fmtMoneda(t.valor_hora)}/hora)</option>`
        ).join('');

        const opcionesInsumoFlujo = construirOpcionesSelectorFuentePorFlujo(flujoActual);

        const propuestasHtml = ESTADO_NODOS.propuestas.map(prop => {
            const esPendiente = prop.estado === 'PENDIENTE_COTIZACION';
            const metaFlujo = FLUJO_META[prop.flujo_sugerido] || FLUJO_META[2];
            const activa = Number(ESTADO_NODOS.propuestaActivaId) === Number(prop.id);
            const skuBunkerExistente = prop.articulo_bunker_sugerido_codigo ? String(prop.articulo_bunker_sugerido_codigo).trim() : '';
            const gramosProp = Math.round(Number(prop.kilos_sugeridos || 0.25) * 1000);
            const etPesoProp = gramosProp >= 1000 && gramosProp % 1000 === 0 ? `${gramosProp / 1000}kg` : `${gramosProp}g`;
            const tituloDeterminista = prop.ingrediente_label_oficial
                ? `${prop.ingrediente_label_oficial} x ${etPesoProp}`
                : prop.nombre_sugerido;

            return `
                <div style="padding:11px 13px; border-radius:10px; background:${activa ? 'rgba(16,185,129,0.14)' : 'rgba(15,23,42,0.75)'}; border:1px solid ${activa ? '#10b981' : esPendiente ? 'rgba(245,158,11,0.4)' : '#334155'}; display:flex; flex-direction:column; gap:6px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                        <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                            <span style="font-size:0.7rem; font-weight:800; padding:2px 6px; border-radius:4px; background:${esPendiente ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)'}; color:${esPendiente ? '#fbbf24' : '#34d399'};">
                                ${esPendiente ? '⏳ PENDIENTE COTIZAR' : '✅ APROBADA'}
                            </span>
                            <span style="font-size:0.68rem; font-weight:800; padding:2px 6px; border-radius:4px; background:${skuBunkerExistente ? 'rgba(56,189,248,0.18)' : 'rgba(167,139,250,0.18)'}; color:${skuBunkerExistente ? '#7dd3fc' : '#ddd6fe'}; border:1px solid ${skuBunkerExistente ? 'rgba(56,189,248,0.4)' : 'rgba(167,139,250,0.4)'};">
                                ${skuBunkerExistente ? `🏭 HABILITAR EXISTENTE (${escaparHtml(skuBunkerExistente)})` : '✨ NUEVA FRACCIÓN'}
                            </span>
                            <span style="font-size:0.72rem; color:#94a3b8;">${escaparHtml(prop.codigo_propuesta)} · Nodo: <strong style="color:#e2e8f0;">${escaparHtml(prop.nodo_solicitante_nombre || 'General')}</strong></span>
                        </div>
                        <span style="font-size:0.7rem; padding:2px 7px; border-radius:999px; background:${metaFlujo.bg}; color:${metaFlujo.color}; font-weight:700;">
                            ${metaFlujo.corto}
                        </span>
                    </div>

                    <div style="font-weight:800; font-size:0.88rem; color:#f8fafc; font-family:inherit;">
                        ${escaparHtml(tituloDeterminista)}
                    </div>

                    <div style="font-size:0.76rem; color:#cbd5e1; display:flex; gap:10px; flex-wrap:wrap;">
                        <span>⚖️ Fracción: <strong>${gramosProp}g</strong> (${Number(prop.kilos_sugeridos || 0.25)} kg)</span>
                        ${(prop.ingrediente_label_oficial || prop.ingrediente_sugerido_nombre) ? `<span>🌾 Ingrediente FK #${Number(prop.ingrediente_sugerido_id || 0)}: <strong>${escaparHtml(prop.ingrediente_label_oficial || prop.ingrediente_sugerido_nombre)}</strong> (${fmtMoneda(prop.ingrediente_sugerido_costo_kg)}/kg)</span>` : ''}
                        ${prop.ingrediente_articulo_vinculado ? `<span>🔗 Puente: <code style="color:#7dd3fc;">${escaparHtml(prop.ingrediente_articulo_vinculado)}</code></span>` : ''}
                        ${prop.precio_objetivo_vecino ? `<span>🎯 Ref. vecino: <strong style="color:#38bdf8;">${fmtMoneda(prop.precio_objetivo_vecino)}</strong></span>` : ''}
                    </div>

                    ${prop.alias_vidriera_sugerido ? `<div style="font-size:0.74rem; color:#fcd34d; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.3); padding:4px 8px; border-radius:6px;">🏪 Alias pensado por el Nodo p/ su vidriera: <strong>"${escaparHtml(prop.alias_vidriera_sugerido)}"</strong> <span style="color:#94a3b8;">(solo aplica a su vidriera B2C)</span></div>` : ''}
                    ${prop.comentario_gestor ? `<div style="font-size:0.75rem; color:#94a3b8; font-style:italic; background:rgba(0,0,0,0.25); padding:5px 8px; border-radius:6px;">"${escaparHtml(prop.comentario_gestor)}"</div>` : ''}

                    <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:2px; flex-wrap:wrap;">
                        ${esPendiente ? `
                            <button onclick="window.NodosPizarra.descartarPropuestaAdmin(${prop.id})"
                                title="Descartar esta solicitud pendiente"
                                style="padding:5px 10px; border-radius:6px; font-size:0.75rem; font-weight:700; cursor:pointer; border:1px solid rgba(244,63,94,0.45); background:rgba(244,63,94,0.12); color:#fda4af;">
                                ✕ Descartar
                            </button>
                        ` : ''}
                        <button onclick="window.NodosPizarra.cargarPropuestaEnMesa(${prop.id})"
                            style="padding:5px 11px; border-radius:6px; font-size:0.76rem; font-weight:700; cursor:pointer; border:1px solid #10b981; background:rgba(16,185,129,0.2); color:#6ee7b7;">
                            ⚡ Cargar en Mesa de Cotización
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div style="display:grid; grid-template-columns: 42% 57%; gap:16px; align-items:start;">
                <!-- COLUMNA IZQUIERDA: BANDEJA DE PROPUESTAS DEL GESTOR Y EXPLORADOR DE LOS 6 FLUJOS -->
                <div style="display:flex; flex-direction:column; gap:14px;">
                    <div class="card" style="padding:14px; background:#151e2e; border:1px solid #2e3c51; border-radius:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                            <div>
                                <div style="font-weight:700; font-size:0.94rem; color:#f8fafc;">📥 Solicitudes de Nuevas Fracciones (Gestores → LAMDA)</div>
                                <div style="font-size:0.75rem; color:#94a3b8;">Atadas por FK determinista a <code>public.ingredientes</code> y al Diccionario Oficial Búnker</div>
                            </div>
                            <button onclick="window.NodosPizarra.abrirModalNuevaPropuesta()"
                                style="padding:6px 11px; border-radius:7px; font-size:0.76rem; font-weight:700; cursor:pointer; border:1px solid #38bdf8; background:rgba(56,189,248,0.16); color:#bae6fd;">
                                ➕ Nueva Solicitud
                            </button>
                        </div>

                        <div style="display:flex; flex-direction:column; gap:9px; max-height:390px; overflow-y:auto; padding-right:4px;">
                            ${propuestasHtml || '<div style="color:#64748b; font-size:0.82rem; padding:12px;">No hay solicitudes registradas.</div>'}
                        </div>
                    </div>

                    <!-- EXPLORADOR DIRECTO DE INSUMOS / RECETAS POR FLUJO (1 AL 6) -->
                    <div class="card" style="padding:14px; background:#151e2e; border:1px solid #2e3c51; border-radius:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px;">
                            <div style="font-weight:700; font-size:0.9rem; color:#f8fafc;">🧭 Ingredientes y Puentes Oficiales LAMDA</div>
                            <input type="text" id="nodos-search-fuentes" placeholder="🔍 Buscar código, ID, ingrediente, puente..."
                                value="${escaparHtml(ESTADO_NODOS.busquedaFuentes)}"
                                oninput="window.NodosPizarra.filtrarFuentesRapidas(this.value)"
                                style="padding:5px 10px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.78rem; width:230px;">
                        </div>
                        <div id="nodos-lista-fuentes-rapidas" style="display:flex; flex-direction:column; gap:6px; max-height:290px; overflow-y:auto; padding-right:4px;">
                            ${renderizarListaFuentesRapidasHtml()}
                        </div>
                    </div>
                </div>

                <!-- COLUMNA DERECHA: MESA DE COTIZACIÓN DETERMINISTA POR CÓDIGO Y DICCIONARIO BÚNKER -->
                <div class="card" style="padding:16px 18px; background:#151e2e; border:1px solid rgba(16,185,129,0.4); border-radius:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #2e3c51; padding-bottom:10px; margin-bottom:14px;">
                        <div>
                            <div style="font-size:1rem; font-weight:800; color:#f8fafc;" id="mesa-cotizacion-titulo">
                                🧮 Cotizador Determinista de Fracciones (Idioma Oficial LAMDA)
                            </div>
                            <div style="font-size:0.76rem; color:#94a3b8;" id="mesa-cotizacion-subtitulo">
                                Ingrediente FK + Envase Real + Nomenclatura Oficial derivada del Diccionario Búnker.
                            </div>
                        </div>
                        <button onclick="window.NodosPizarra.limpiarMesaCotizacion()"
                            style="padding:5px 10px; border-radius:6px; font-size:0.75rem; border:1px solid #475569; background:#0f172a; color:#cbd5e1; cursor:pointer;">
                            🧹 Limpiar / Nueva Fracción
                        </button>
                    </div>

                    <!-- SELECTOR DE LOS 6 FLUJOS DE LA PIZARRA -->
                    <div style="margin-bottom:12px;">
                        <label style="display:block; font-size:0.74rem; color:#94a3b8; font-weight:700; margin-bottom:6px; text-transform:uppercase;">
                            1. Línea / Flujo Productivo de Origen
                        </label>
                        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:6px;">
                            ${[1, 2, 3, 4, 5, 6].map(num => {
                                const m = FLUJO_META[num];
                                const act = flujoActual === num;
                                return `
                                    <button type="button" onclick="window.NodosPizarra.seleccionarFlujoMesa(${num})"
                                        style="padding:7px 9px; border-radius:8px; text-align:left; cursor:pointer; border:1px solid ${act ? m.color : '#334155'}; background:${act ? m.bg : '#0f172a'}; color:${act ? '#ffffff' : '#94a3b8'}; font-size:0.76rem; font-weight:700;">
                                        <div style="color:${m.color}; font-weight:800;">${m.corto}</div>
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    </div>

                    <!-- DATOS DE ORIGEN, COSTO VIVO Y PESO DE FRACCIÓN -->
                    <div style="display:grid; grid-template-columns: 1.6fr 0.95fr 0.85fr; gap:10px; margin-bottom:8px;">
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Ingrediente / Insumo Oficial LAMDA (${FLUJO_META[flujoActual].corto})</label>
                            <select id="cot-origen-select" onchange="window.NodosPizarra.alCambiarOrigenSelect()"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.81rem;">
                                ${opcionesInsumoFlujo}
                            </select>
                        </div>
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Costo por Kilo ($ / Kg)</label>
                            <input type="number" id="cot-costo-kg" step="0.01" value="18109.43" oninput="window.NodosPizarra.recalcularEnVivo()"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #38bdf8; background:#0f172a; color:#38bdf8; font-weight:800; font-size:0.86rem; box-sizing:border-box;">
                        </div>
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Peso Fracción (Kg)</label>
                            <input type="number" id="cot-kilos-unidad" step="0.01" min="0.01" value="0.25"
                                oninput="window.NodosPizarra.recalcularEnVivo()"
                                onchange="window.NodosPizarra.alCambiarKilosUnidadMesa()"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #10b981; background:#0f172a; color:#6ee7b7; font-weight:800; font-size:0.86rem; box-sizing:border-box;">
                        </div>
                    </div>

                    <!-- CADENA RELACIONAL DETERMINISTA (INGREDIENTE SIMPLE -> ARTÍCULO PUENTE -> RECETA MADRE MIX) -->
                    <div id="cot-cadena-relacional-box" style="margin-bottom:10px; padding:8px 11px; border-radius:8px; background:#0f172a; border:1px solid #334155; font-size:0.75rem; color:#cbd5e1; line-height:1.45;">
                    </div>

                    <!-- ATAJOS RÁPIDOS DE GRAMAJE FAMILIAR -->
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:10px; flex-wrap:wrap;">
                        <span style="font-size:0.73rem; color:#94a3b8;">Presentación rápida:</span>
                        ${[
                            { label: '100g', kg: 0.10 },
                            { label: '150g', kg: 0.15 },
                            { label: '200g', kg: 0.20 },
                            { label: '250g', kg: 0.25 },
                            { label: '300g', kg: 0.30 },
                            { label: '400g', kg: 0.40 },
                            { label: '500g', kg: 0.50 },
                            { label: '1 Kg', kg: 1.00 }
                        ].map(p => `
                            <button type="button" onclick="window.NodosPizarra.fijarGramajeRapido(${p.kg})"
                                style="padding:3px 8px; border-radius:5px; font-size:0.73rem; font-weight:700; border:1px solid #334155; background:#0f172a; color:#e2e8f0; cursor:pointer;">
                                ${p.label}
                            </button>
                        `).join('')}
                    </div>

                    <!-- CONEXIÓN EN VIVO CON DICCIONARIO OFICIAL BÚNKER / RECETA -->
                    <div id="cot-bunker-receta-badge" style="display:none; margin-bottom:10px; padding:8px 11px; border-radius:8px; font-size:0.76rem; font-weight:700; line-height:1.45;"></div>

                    <!-- PANEL RELACIONAL DICCIONARIO BÚNKER (CASO B: SIN HERMANO PREVIO EN BÚNKER) -->
                    <div id="cot-caso-b-diccionario-panel" style="display:none; margin-bottom:12px; padding:11px 12px; border-radius:9px; background:rgba(30,41,59,0.85); border:1px solid rgba(56,189,248,0.45);">
                    </div>

                    <!-- IDENTIDAD TÉCNICA DETERMINISTA (DICCIONARIO OFICIAL BÚNKER — SOLO LECTURA) -->
                    <div style="display:grid; grid-template-columns: 0.95fr 1.65fr; gap:10px; margin-bottom:10px;">
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#7dd3fc; font-weight:700; margin-bottom:4px;">Código SKU Oficial (Búnker + Nodo)</label>
                            <input type="text" id="cot-sku-nodo" placeholder="Automático (ej: MFSPx500)"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #0284c7; background:#0f172a; color:#f8fafc; font-family:monospace; font-weight:800; font-size:0.84rem; box-sizing:border-box;">
                        </div>
                        <div>
                            <label style="display:flex; justify-content:space-between; align-items:center; font-size:0.74rem; color:#38bdf8; font-weight:700; margin-bottom:4px;">
                                <span>🏛️ Nomenclatura Oficial Búnker (Diccionario — Solo Lectura)</span>
                                <span style="font-size:0.66rem; color:#94a3b8;">Idioma oficial LAMDA ↔ Nodo</span>
                            </label>
                            <input type="text" id="cot-bunker-nomenclatura" readonly placeholder="Derivada automáticamente del Diccionario Búnker"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #0284c7; background:#0b1120; color:#bae6fd; font-weight:800; font-size:0.84rem; box-sizing:border-box; cursor:not-allowed;">
                        </div>
                    </div>

                    <div id="cot-alias-vidriera-wrap" style="display:${ESTADO_NODOS.propuestaActivaId ? 'block' : 'none'}; margin-bottom:10px;">
                        <label style="display:flex; justify-content:space-between; align-items:center; font-size:0.73rem; color:#6ee7b7; font-weight:700; margin-bottom:4px;">
                            <span>🏪 Nombre en Vidriera Pública del Nodo Solicitante (Opcional — solo en su tienda)</span>
                            <span style="font-size:0.66rem; color:#94a3b8;">Vacío = usa Nomenclatura Oficial LAMDA</span>
                        </label>
                        <input type="text" id="cot-alias-vidriera-nodo" placeholder="Ej: Mix premium por 500 gramos (solo aplica a la vidriera de este Nodo)"
                            style="width:100%; padding:8px; border-radius:7px; border:1px solid rgba(16,185,129,0.5); background:#0f172a; color:#f8fafc; font-size:0.82rem; box-sizing:border-box;">
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1.35fr; gap:10px; margin-bottom:12px;">
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Familia / Rubro Oficial LAMDA</label>
                            <input type="text" id="cot-categoria" readonly value="Frutos Secos"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0b1120; color:#cbd5e1; font-size:0.81rem; box-sizing:border-box; cursor:not-allowed;">
                        </div>
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Disponibilidad en Listas del Búnker</label>
                            <select id="cot-compartido-mayorista"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#e2e8f0; font-size:0.8rem; font-weight:700;">
                                <option value="false">🏘️ Exclusivo Nodos (0/6 en Mayorista)</option>
                                <option value="true">🔄 Compartido: Nodos + Mayorista (Dietética y Cons. Final)</option>
                            </select>
                        </div>
                    </div>

                    <!-- ENVASE REAL DETERMINISTA, TIEMPO DE FRACCIONADO Y TARIFA HORARIA -->
                    <div style="display:grid; grid-template-columns: 1.35fr 0.95fr 1.1fr; gap:10px; margin-bottom:12px;">
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Envase / Bolsa Oficial (<code>public.ingredientes</code>)</label>
                            <select id="cot-envase-select" onchange="window.NodosPizarra.recalcularEnVivo()"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.8rem;">
                                ${envasesOpts}
                            </select>
                        </div>
                        <div>
                            <label style="display:flex; justify-content:space-between; align-items:center; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">
                                <span>Tiempo de Armado</span>
                                <span id="cot-tiempo-equiv-label" style="font-size:0.68rem; color:#38bdf8; font-weight:700;"></span>
                            </label>
                            <div style="display:flex; gap:5px; align-items:stretch;">
                                <input type="text" inputmode="decimal" autocomplete="off" id="cot-segundos-mo"
                                    value="${ESTADO_NODOS.unidadTiempoMesa === 'min' ? '0.58' : '35'}"
                                    oninput="window.NodosPizarra.recalcularEnVivo()"
                                    style="flex:1; min-width:0; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.83rem;">
                                <select id="cot-unidad-tiempo-mo" onchange="window.NodosPizarra.alCambiarUnidadTiempoMesa(this.value)"
                                    style="width:74px; padding:8px 6px; border-radius:7px; border:1px solid #334155; background:#1e293b; color:#e2e8f0; font-size:0.78rem; font-weight:700; cursor:pointer;">
                                    <option value="seg" ${ESTADO_NODOS.unidadTiempoMesa === 'seg' ? 'selected' : ''}>Seg</option>
                                    <option value="min" ${ESTADO_NODOS.unidadTiempoMesa === 'min' ? 'selected' : ''}>Min</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Operario / Valor Hora</label>
                            <select id="cot-tarifa-select" onchange="window.NodosPizarra.recalcularEnVivo()"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.81rem;">
                                ${tarifasOpts}
                            </select>
                        </div>
                    </div>

                    <!-- MÁRGENES E IMPUESTOS (LAMDA + IMPUESTOS + SIMULACIÓN GESTOR) -->
                    <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin-bottom:14px;">
                        <div>
                            <label style="display:block; font-size:0.73rem; color:#34d399; font-weight:700; margin-bottom:4px;">Margen LAMDA (%)</label>
                            <input type="number" id="cot-margen-lamda" step="0.5" value="22" oninput="window.NodosPizarra.recalcularEnVivo()"
                                style="width:100%; padding:7px; border-radius:7px; border:1px solid #10b981; background:#0f172a; color:#34d399; font-weight:800;">
                        </div>
                        <div>
                            <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:4px;">IVA (%)</label>
                            <select id="cot-iva-pct" onchange="window.NodosPizarra.recalcularEnVivo()"
                                style="width:100%; padding:7px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc;">
                                <option value="21" selected>21.0% (General)</option>
                                <option value="10.5">10.5% (Reducido)</option>
                                <option value="0">0.0% (Exento)</option>
                            </select>
                        </div>
                        <div>
                            <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:4px;">Retención IIBB (%)</label>
                            <input type="number" id="cot-iibb-pct" step="0.1" value="4" oninput="window.NodosPizarra.recalcularEnVivo()"
                                style="width:100%; padding:7px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc;">
                        </div>
                        <div>
                            <label style="display:block; font-size:0.73rem; color:#38bdf8; font-weight:700; margin-bottom:4px;">Margen Sugerido Nodo (%)</label>
                            <input type="number" id="cot-margen-gestor" step="0.5" value="28" oninput="window.NodosPizarra.recalcularEnVivo()"
                                style="width:100%; padding:7px; border-radius:7px; border:1px solid #38bdf8; background:#0f172a; color:#38bdf8; font-weight:800;">
                        </div>
                    </div>

                    <!-- RADIOGRAFÍA DE COSTOS EN CASCADA (EN VIVO) -->
                    <div id="cot-radiografia-box" style="background:rgba(15,23,42,0.9); border:1px solid #334155; border-radius:10px; padding:12px 14px; margin-bottom:14px;">
                    </div>

                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                        <input type="text" id="cot-notas-tecnicas" placeholder="Observación técnica interna o nota para el gestor del Nodo..."
                            style="flex:1; padding:9px 12px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#e2e8f0; font-size:0.8rem;">
                        <button type="button" onclick="window.NodosPizarra.aprobarYPublicarEnPadronNodos()"
                            style="padding:10px 18px; border-radius:8px; font-weight:800; font-size:0.86rem; cursor:pointer; border:none; background:linear-gradient(135deg, #10b981, #059669); color:#ffffff; box-shadow: 0 4px 12px rgba(16,185,129,0.28);">
                            🚀 Aprobar Precio Base y Habilitar en Nodos
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    function construirOpcionesSelectorFuentePorFlujo(flujo) {
        const num = Number(flujo || 2);
        if (num === 1) {
            return ESTADO_NODOS.fuentes.articulos_flujo_1.map(a =>
                `<option value="ART:${escaparHtml(a.articulo_id)}" data-costo="${a.costo_kg}" data-nombre="${escaparHtml(a.nombre)}">[${escaparHtml(a.articulo_id)}] ${escaparHtml(a.nombre)} (${fmtMoneda(a.costo_kg)}/kg)</option>`
            ).join('');
        }

        const listaFlujo = ESTADO_NODOS.fuentes.ingredientes_por_flujo.filter(i => Number(i.flujo) === num);
        const lista = listaFlujo.length > 0 ? listaFlujo : ESTADO_NODOS.fuentes.ingredientes_por_flujo;

        return lista.map(i => {
            const costoVivo = obtenerCostoVivoIngredientePizarra(i.id, i.costo_kg);
            const labelOficial = i.label_oficial || `[${i.codigo || i.id}] ${i.nombre}`;
            const puenteTxt = i.articulo_vinculado_numero ? ` · Puente: ${i.articulo_vinculado_numero}` : '';
            return `<option value="${i.id}" data-costo="${costoVivo}" data-nombre="${escaparHtml(i.nombre)}" data-categoria="${escaparHtml(i.categoria_lamda || i.categoria_gestor || '')}">#${i.id} ${escaparHtml(labelOficial)}${escaparHtml(puenteTxt)} (${fmtMoneda(costoVivo)}/kg)</option>`;
        }).join('');
    }

    function renderizarListaFuentesRapidasHtml() {
        const q = ESTADO_NODOS.busquedaFuentes;
        const filtrados = ESTADO_NODOS.fuentes.ingredientes_por_flujo.filter(item => {
            const bolsa = `${item.id} ${item.codigo || ''} ${item.nombre} ${item.label_oficial || ''} ${item.categoria_lamda || item.categoria_gestor || ''} ${item.flujo_nombre} ${item.articulo_vinculado_numero || ''} ${item.mix_padre?.codigo || ''} ${item.mix_padre?.nombre || ''}`;
            return cumpleBusquedaUniversalLamda(bolsa, q);
        });

        return filtrados.slice(0, 45).map(item => {
            const meta = FLUJO_META[item.flujo] || FLUJO_META[2];
            const costoVivo = obtenerCostoVivoIngredientePizarra(item.id, item.costo_kg);
            const labelOficial = item.label_oficial || `[${item.codigo || item.id}] ${item.nombre}`;
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 10px; border-radius:7px; background:rgba(15,23,42,0.7); border:1px solid #263244;">
                    <div style="min-width:0;">
                        <div>
                            <span style="font-size:0.68rem; padding:1px 6px; border-radius:4px; background:${meta.bg}; color:${meta.color}; font-weight:700; margin-right:6px;">
                                ${meta.corto}
                            </span>
                            <strong style="font-size:0.79rem; color:#f1f5f9;">#${item.id} ${escaparHtml(labelOficial)}</strong>
                        </div>
                        <div style="font-size:0.69rem; color:#94a3b8; margin-top:2px;">
                            ${item.articulo_vinculado_numero ? `🔗 Puente: <code style="color:#7dd3fc;">${escaparHtml(item.articulo_vinculado_numero)}</code>` : 'Sin puente'}
                            ${item.mix_padre ? ` · 🥣 Receta Madre: <code style="color:#c4b5fd;">#${item.mix_padre.id} [${escaparHtml(item.mix_padre.codigo)}] ${escaparHtml(item.mix_padre.nombre)}</code>` : ''}
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                        <span style="font-size:0.8rem; color:#38bdf8; font-weight:700;">${fmtMoneda(costoVivo)}/kg</span>
                        <button type="button" onclick="window.NodosPizarra.cargarIngredienteDirectoEnMesa(${item.id})"
                            style="padding:3px 8px; border-radius:5px; font-size:0.72rem; font-weight:700; border:1px solid #38bdf8; background:rgba(56,189,248,0.15); color:#bae6fd; cursor:pointer;">
                            Cotizar →
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function elegirUnidadTiempoInicial(segundosTotales) {
        const seg = Math.max(0, Math.round(Number(segundosTotales) || 0));
        return (seg >= 60 && seg % 30 === 0) ? 'min' : 'seg';
    }

    function formatearValorTiempoMesa(segundosTotales, unidad) {
        const seg = Math.max(0, Number(segundosTotales) || 0);
        if (unidad === 'min') {
            return String(Math.round((seg / 60) * 100) / 100);
        }
        return String(Math.round(seg));
    }

    function obtenerSegundosDesdeMesa(unidadOverride) {
        const segEl = document.getElementById('cot-segundos-mo');
        if (!segEl) return 35;
        const limpio = String(segEl.value ?? '').trim().replace(',', '.');
        if (!limpio || limpio === '.') return 0;
        const num = Number(limpio);
        if (!Number.isFinite(num) || num < 0) return 0;
        const unidad = unidadOverride || document.getElementById('cot-unidad-tiempo-mo')?.value || ESTADO_NODOS.unidadTiempoMesa || 'seg';
        return unidad === 'min' ? Math.round(num * 60) : Math.round(num);
    }

    function fijarSegundosEnMesa(segundosTotales, autoUnidad = true) {
        const seg = Math.max(0, Number(segundosTotales) || 35);
        if (autoUnidad) {
            ESTADO_NODOS.unidadTiempoMesa = elegirUnidadTiempoInicial(seg);
        }
        const unidadEl = document.getElementById('cot-unidad-tiempo-mo');
        if (unidadEl) unidadEl.value = ESTADO_NODOS.unidadTiempoMesa;
        const segEl = document.getElementById('cot-segundos-mo');
        if (segEl) segEl.value = formatearValorTiempoMesa(seg, ESTADO_NODOS.unidadTiempoMesa);
    }

    function alCambiarUnidadTiempoMesa(nuevaUnidad) {
        const unidadDestino = nuevaUnidad === 'min' ? 'min' : 'seg';
        const segActuales = obtenerSegundosDesdeMesa(ESTADO_NODOS.unidadTiempoMesa);
        ESTADO_NODOS.unidadTiempoMesa = unidadDestino;
        const segEl = document.getElementById('cot-segundos-mo');
        if (segEl) {
            segEl.value = formatearValorTiempoMesa(segActuales, unidadDestino);
            segEl.focus();
            if (typeof segEl.select === 'function') segEl.select();
        }
        recalcularMesaCotizacionEnVivo();
    }

    function recalcularMesaCotizacionEnVivo() {
        const costoKgEl = document.getElementById('cot-costo-kg');
        const kilosEl = document.getElementById('cot-kilos-unidad');
        const envaseEl = document.getElementById('cot-envase-select');
        const tarifaEl = document.getElementById('cot-tarifa-select');
        const margenLamdaEl = document.getElementById('cot-margen-lamda');
        const ivaEl = document.getElementById('cot-iva-pct');
        const iibbEl = document.getElementById('cot-iibb-pct');
        const margenGestorEl = document.getElementById('cot-margen-gestor');
        const box = document.getElementById('cot-radiografia-box');
        if (!costoKgEl || !box) return;

        const costoInsumoKg = Math.max(0, Number(costoKgEl.value) || 0);
        const kilosUnidad = Math.max(0.001, Number(kilosEl.value) || 0.25);
        const envaseOpt = envaseEl?.selectedOptions?.[0];
        const costoEnvaseContenedor = Number(envaseOpt?.getAttribute('data-costo') || 45.96);
        const origenSelect = document.getElementById('cot-origen-select');
        const ingSelId = Number(origenSelect?.value || 0);
        const env181 = (ESTADO_NODOS.fuentes.envases || []).find(e => Number(e.id) === 181);
        const costoFlowpackUnit = Number(env181?.costo_unitario || 18.16);
        const packUnidades = ingSelId === 141 ? Math.max(1, Math.round(kilosUnidad / 0.05)) : 1;
        const costoEnvaseExtra = ingSelId === 141 ? (packUnidades * costoFlowpackUnit) : 0;
        const costoEnvaseUnitario = costoEnvaseContenedor + costoEnvaseExtra;
        const unidadTiempoActual = document.getElementById('cot-unidad-tiempo-mo')?.value || ESTADO_NODOS.unidadTiempoMesa || 'seg';
        ESTADO_NODOS.unidadTiempoMesa = unidadTiempoActual;
        const segundos = obtenerSegundosDesdeMesa(unidadTiempoActual);
        const equivEl = document.getElementById('cot-tiempo-equiv-label');
        if (equivEl) {
            if (unidadTiempoActual === 'min') {
                equivEl.textContent = `= ${segundos}s`;
            } else if (segundos >= 60) {
                equivEl.textContent = `= ${Math.round((segundos / 60) * 100) / 100} min`;
            } else {
                equivEl.textContent = '';
            }
        }
        const etTiempoArmado = segundos >= 60 && segundos % 30 === 0
            ? `${Math.round((segundos / 60) * 10) / 10} min / ${segundos}s`
            : `${segundos}s`;
        const tarifaOpt = tarifaEl?.selectedOptions?.[0];
        const valorHora = Number(tarifaOpt?.getAttribute('data-valor-hora') || 7000);
        const margenLamdaPct = Math.max(0, Number(margenLamdaEl.value) || 22);
        const ivaPct = Math.max(0, Number(ivaEl.value) || 21);
        const iibbPct = Math.max(0, Number(iibbEl.value) || 4);
        const margenGestorPct = Math.max(0, Number(margenGestorEl.value) || 28);

        const costoInsumoFraccion = costoInsumoKg * kilosUnidad;
        const costoMateriaYEnvase = costoInsumoFraccion + costoEnvaseUnitario;
        const costoManoObra = (segundos / 3600) * valorHora;
        const costoPuroTotal = costoMateriaYEnvase + costoManoObra;

        // Fórmula unificada 100% con BunkerService (listado-bunker.html):
        // precio_sin_iva = (costoMateriaYEnvase * (1 + margen / 100)) + costoManoObra
        // precio_final = Math.round(precio_sin_iva * (1 + iva / 100))
        // IIBB se descuenta de la utilidad neta como retención sobre precio_sin_iva
        const gananciaBrutaLamda = costoMateriaYEnvase * (margenLamdaPct / 100);
        const precioBaseNeto = costoMateriaYEnvase + gananciaBrutaLamda + costoManoObra;
        const impuestosMonto = precioBaseNeto * (ivaPct / 100);
        const retencionIibbMonto = precioBaseNeto * (iibbPct / 100);
        const gananciaLamda = Math.max(0, gananciaBrutaLamda - retencionIibbMonto);
        const precioBaseNodoFinal = Math.round(precioBaseNeto + impuestosMonto);

        const factorNetoMargen = Math.max(0.01, (1 / (1 + 21 / 100)) - (4 / 100));
        const precioSugeridoVecino = Math.round(precioBaseNodoFinal * (1 + margenGestorPct / 100));
        const gananciaGestorUnitaria = Math.round(Math.max(0, precioSugeridoVecino - precioBaseNodoFinal) * factorNetoMargen);

        const propActiva = ESTADO_NODOS.propuestas.find(p => Number(p.id) === Number(ESTADO_NODOS.propuestaActivaId));
        const targetVecino = propActiva && Number(propActiva.precio_objetivo_vecino) > 0
            ? Number(propActiva.precio_objetivo_vecino)
            : null;

        box.innerHTML = `
            <div style="font-size:0.74rem; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
                <span>📊 Desglose Unificado con Calculadora del Búnker (${Math.round(kilosUnidad * 1000)}g)</span>
                <span style="color:#6ee7b7; font-size:0.7rem;">bunker_lista_articulos + bunker_lista_insumos</span>
            </div>
            <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; margin-bottom:10px;">
                <div style="padding:8px; border-radius:7px; background:#0f172a; border:1px solid #1e293b;">
                    <div style="font-size:0.7rem; color:#94a3b8;">1. Materia Prima (${Math.round(kilosUnidad * 1000)}g)</div>
                    <div style="font-size:0.95rem; font-weight:800; color:#f8fafc;">${fmtMoneda(costoInsumoFraccion, 2)}</div>
                </div>
                <div style="padding:8px; border-radius:7px; background:#0f172a; border:1px solid #1e293b;">
                    <div style="font-size:0.7rem; color:#94a3b8;">2. Envase + Armado (${etTiempoArmado})</div>
                    <div style="font-size:0.95rem; font-weight:800; color:#f8fafc;">${fmtMoneda(costoEnvaseUnitario + costoManoObra, 2)}</div>
                    <div style="font-size:0.66rem; color:#64748b;">Bolsa ${fmtMoneda(costoEnvaseUnitario, 1)} + MO ${fmtMoneda(costoManoObra, 1)}</div>
                </div>
                <div style="padding:8px; border-radius:7px; background:#0f172a; border:1px solid #1e293b;">
                    <div style="font-size:0.7rem; color:#94a3b8;">3. Neto S/IVA (+${margenLamdaPct}%)</div>
                    <div style="font-size:0.95rem; font-weight:800; color:#34d399;">${fmtMoneda(precioBaseNeto, 2)}</div>
                    <div style="font-size:0.66rem; color:#6ee7b7;">Util. Neta (s/IIBB ${iibbPct}%): ${fmtMoneda(gananciaLamda, 0)}</div>
                </div>
                <div style="padding:8px; border-radius:7px; background:#0f172a; border:1px solid #1e293b;">
                    <div style="font-size:0.7rem; color:#94a3b8;">4. IVA (${ivaPct}%)</div>
                    <div style="font-size:0.95rem; font-weight:800; color:#fbbf24;">+${fmtMoneda(impuestosMonto, 2)}</div>
                    <div style="font-size:0.66rem; color:#94a3b8;">Ret. IIBB: -${fmtMoneda(retencionIibbMonto, 0)}</div>
                </div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; padding-top:8px; border-top:1px dashed #334155;">
                <div style="padding:10px 12px; border-radius:8px; background:rgba(16,185,129,0.14); border:1px solid rgba(16,185,129,0.45); display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-size:0.72rem; color:#6ee7b7; font-weight:800; text-transform:uppercase;">Precio Lista Base Nodos (Final c/IVA)</div>
                        <div style="font-size:0.7rem; color:#94a3b8;">Valor oficial en Búnker y Cta. Cte. del Gestor</div>
                    </div>
                    <div style="font-size:1.35rem; font-weight:900; color:#34d399;">${fmtMoneda(precioBaseNodoFinal)}</div>
                </div>

                <div style="padding:10px 12px; border-radius:8px; background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.45); display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-size:0.72rem; color:#bae6fd; font-weight:800; text-transform:uppercase;">Precio Sugerido al Vecino (+${margenGestorPct}%)</div>
                        <div style="font-size:0.7rem; color:#93c5fd;">
                            Ganancia Limpia del Gestor (s/IVA 21% + IIBB 4%): <strong>+${fmtMoneda(gananciaGestorUnitaria)}/u.</strong>
                            ${targetVecino ? ` · Pedido gestor: ${fmtMoneda(targetVecino)}` : ''}
                        </div>
                    </div>
                    <div style="font-size:1.35rem; font-weight:900; color:#38bdf8;">${fmtMoneda(precioSugeridoVecino)}</div>
                </div>
            </div>
        `;
    }

    // =========================================================================
    // SUB-PESTAÑA 2: CATÁLOGO CONECTADO AL BÚNKER Y MÁRGENES POR GESTOR
    // =========================================================================
    function renderizarFilasPresentacionesPlantaHtml() {
        const disponibles = Array.isArray(ESTADO_NODOS.presentaciones_planta_disponibles)
            ? ESTADO_NODOS.presentaciones_planta_disponibles
            : [];
        const qPlanta = ESTADO_NODOS.busquedaPlantaDisponible || '';
        const modoPeso = ESTADO_NODOS.filtroPesoPlantaDisponible || 'SUB_1KG';

        const filtradas = disponibles.filter(p => {
            const kilos = Number(p.kilos_unidad || 0);
            if (modoPeso === 'SUB_1KG' && kilos >= 0.99 && !p.es_pack) return false;
            if (modoPeso === '1KG' && (kilos < 0.99 || p.es_pack)) return false;
            const bolsa = `${p.articulo_id} ${p.descripcion_generada || ''} ${p.label_oficial || ''} ${p.ingrediente_label_oficial || ''} ${p.categoria_lamda || p.categoria_gestor || ''} ${p.etiqueta_peso || ''} flujo ${p.flujo}`;
            return cumpleBusquedaUniversalLamda(bolsa, qPlanta);
        });

        if (!filtradas.length) {
            return `
                <div style="padding:14px; text-align:center; color:#94a3b8; font-size:0.8rem; background:#0f172a; border-radius:8px; border:1px dashed #334155;">
                    No hay presentaciones de Planta sin habilitar que coincidan con el filtro actual.
                </div>
            `;
        }

        return `
            <div style="max-height:280px; overflow-y:auto; border:1px solid #263244; border-radius:8px;">
                <table style="width:100%; border-collapse:collapse; font-size:0.79rem; color:#e2e8f0;">
                    <thead>
                        <tr style="background:#0f172a; color:#94a3b8; text-align:left; position:sticky; top:0; z-index:1; border-bottom:1px solid #334155;">
                            <th style="padding:8px 10px;">SKU Búnker / Flujo</th>
                            <th style="padding:8px 10px;">Nomenclatura Oficial LAMDA (Búnker)</th>
                            <th style="padding:8px 10px;">Familia / Rubro</th>
                            <th style="padding:8px 10px;">Costo MP / Base</th>
                            <th style="padding:8px 10px;">Ref. Lista Mayorista</th>
                            <th style="padding:8px 10px; text-align:right;">Habilitar en Nodos</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filtradas.map(p => {
                            const meta = FLUJO_META[p.flujo] || FLUJO_META[2];
                            const labelArt = p.label_oficial || `[${p.articulo_id}] ${p.descripcion_generada || ''}`;
                            return `
                                <tr style="border-bottom:1px solid #1e293b; background:rgba(15,23,42,0.55);">
                                    <td style="padding:8px 10px;">
                                        <span style="font-family:monospace; font-weight:800; color:#7dd3fc;">${escaparHtml(p.articulo_id)}</span>
                                        <div style="margin-top:2px;">
                                            <span style="font-size:0.66rem; padding:1px 6px; border-radius:4px; background:${meta.bg}; color:${meta.color}; font-weight:700;">${meta.corto}</span>
                                        </div>
                                    </td>
                                    <td style="padding:8px 10px;">
                                        <strong style="color:#f8fafc;">${escaparHtml(labelArt)}</strong>
                                        <span style="margin-left:6px; background:rgba(56,189,248,0.16); color:#bae6fd; border:1px solid rgba(56,189,248,0.35); padding:1px 7px; border-radius:999px; font-size:0.72rem; font-weight:800;">
                                            ${escaparHtml(p.etiqueta_peso)}
                                        </span>
                                        ${p.ingrediente_label_oficial ? `<div style="font-size:0.71rem; color:#94a3b8; margin-top:2px; font-family:monospace;">Insumo: ${escaparHtml(p.ingrediente_label_oficial)}</div>` : ''}
                                    </td>
                                    <td style="padding:8px 10px; color:#cbd5e1;">${escaparHtml(p.categoria_lamda || p.categoria_gestor || '')}</td>
                                    <td style="padding:8px 10px;">
                                        <div style="color:#cbd5e1;">MP: <strong>${fmtMoneda(p.costo_insumo_kg)}/kg</strong></div>
                                        ${p.bunker_costo_base > 0 ? `<div style="font-size:0.71rem; color:#94a3b8;">Costo u. Búnker: ${fmtMoneda(p.bunker_costo_base, 0)}</div>` : ''}
                                    </td>
                                    <td style="padding:8px 10px;">
                                        ${p.precio_ref_mayorista
                                            ? `<span style="color:#fcd34d; font-weight:700;">${fmtMoneda(p.precio_ref_mayorista)}</span>`
                                            : `<span style="color:#64748b; font-size:0.72rem;">Solo pack mayorista · cotizar u.</span>`}
                                    </td>
                                    <td style="padding:8px 10px; text-align:right;">
                                        <button onclick="window.NodosPizarra.cargarPresentacionPlantaEnMesa(${Number(p.ingrediente_id)}, ${Number(p.kilos_unidad)})"
                                            style="padding:5px 10px; border-radius:6px; font-size:0.74rem; font-weight:800; cursor:pointer; border:1px solid #38bdf8; background:rgba(56,189,248,0.18); color:#bae6fd;">
                                            ⚡ Cotizar y Habilitar
                                        </button>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderizarSubTabCatalogo() {
        const q = ESTADO_NODOS.busquedaCatalogo;
        const fFlujo = Number(ESTADO_NODOS.filtroFlujoCatalogo || 0);
        const fNodo = Number(ESTADO_NODOS.filtroNodoOfertas || 0);
        const listaBunkerNodos = ESTADO_NODOS.fuentes.lista_bunker_nodos || { nombre_lista: 'Lista Base Nodos Barriales', canal_comercial: 'NODOS' };
        const politicasNodos = ESTADO_NODOS.fuentes.politicas_bunker_nodos || [];

        const filasCatalogo = ESTADO_NODOS.catalogo.filter(c => {
            if (fFlujo > 0 && Number(c.flujo_lamda) !== fFlujo) return false;
            const bolsa = `${c.sku_nodo} ${c.bunker_descripcion_generada || ''} ${c.bunker_familia_nombre || ''} ${c.bunker_rubro || ''} ${c.bunker_sub_rubro || ''} ${c.nombre_publico || ''} ${c.categoria_familiar || ''} ${c.presentacion_etiqueta || ''} ${c.ingrediente_label_oficial || ''} ${c.ingrediente_origen_nombre || ''} ${c.ingrediente_articulo_vinculado || ''} ${c.notas_tecnicas || ''} flujo ${c.flujo_lamda}`;
            return cumpleBusquedaUniversalLamda(bolsa, q);
        });

        return `
            <div style="display:flex; flex-direction:column; gap:14px;">
                <!-- BANNER DE ARQUITECTURA DE CASCADA: BÚNKER -> NODO -> VECINO -->
                <div class="card" style="padding:12px 16px; background:linear-gradient(135deg, rgba(6,78,59,0.32), rgba(15,23,42,0.95)); border:1px solid rgba(16,185,129,0.45); border-radius:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <span style="background:rgba(16,185,129,0.22); color:#34d399; border:1px solid rgba(16,185,129,0.45); font-size:0.74rem; font-weight:800; padding:2px 9px; border-radius:999px;">
                                🏛️ Lista Oficial Búnker: ${escaparHtml(listaBunkerNodos.nombre_lista)} (ID #${listaBunkerNodos.id || '-'})
                            </span>
                            <span style="font-size:0.75rem; color:#94a3b8;">
                                Idioma Técnico Oficial LAMDA (<code>[SKU] descripcion_generada</code>) · Cada Nodo personaliza su nombre de vidriera en su propio panel
                            </span>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:2px;">
                            <span style="font-size:0.73rem; color:#cbd5e1; font-weight:700;">📜 Políticas Comerciales y Financiación Activas:</span>
                            ${politicasNodos.map(p => `
                                <span style="font-size:0.71rem; background:rgba(56,189,248,0.14); color:#bae6fd; border:1px solid rgba(56,189,248,0.35); padding:2px 8px; border-radius:6px;" title="${escaparHtml(p.descripcion || '')}">
                                    ✅ ${escaparHtml(p.nombre)}
                                </span>
                            `).join('') || '<span style="font-size:0.72rem; color:#94a3b8;">Bonificación por Canasto (-3% / -5%) + Financiación Cta. Cte. 7 días (0%)</span>'}
                        </div>
                    </div>
                    <a href="/pages/listado-bunker.html" target="_blank"
                        style="text-decoration:none; padding:8px 13px; border-radius:8px; font-weight:800; font-size:0.78rem; background:rgba(16,185,129,0.2); border:1px solid #10b981; color:#6ee7b7; display:inline-flex; align-items:center; gap:6px;">
                        🏛️ Abrir Búnker de Artículos ↗
                    </a>
                </div>

                <div class="card" style="padding:12px 16px; background:#151e2e; border:1px solid #2e3c51; border-radius:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                    <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:280px;">
                        <input type="text" placeholder="🔍 Buscar por SKU oficial, nomenclatura Búnker, código de insumo, puente o rubro..."
                            value="${escaparHtml(ESTADO_NODOS.busquedaCatalogo)}"
                            oninput="window.NodosPizarra.filtrarCatalogo(this.value)"
                            style="flex:1; padding:8px 12px; border-radius:8px; border:1px solid #38bdf8; background:#0f172a; color:#f8fafc; font-size:0.83rem;">

                        <select onchange="window.NodosPizarra.filtrarFlujoCatalogo(this.value)"
                            style="padding:8px 10px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#e2e8f0; font-size:0.8rem;">
                            <option value="0" ${fFlujo === 0 ? 'selected' : ''}>Todos los Flujos (1 al 6)</option>
                            ${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${fFlujo === n ? 'selected' : ''}>${FLUJO_META[n].corto}</option>`).join('')}
                        </select>

                        <select onchange="window.NodosPizarra.filtrarNodoOfertas(this.value)"
                            style="padding:8px 10px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#e2e8f0; font-size:0.8rem;">
                            <option value="0" ${fNodo === 0 ? 'selected' : ''}>Todos los Nodos</option>
                            ${ESTADO_NODOS.nodos.map(n => `<option value="${n.id}" ${fNodo === Number(n.id) ? 'selected' : ''}>Nodo: ${escaparHtml(n.nombre_marca)}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <div class="card" style="padding:14px; background:#151e2e; border:1px solid #2e3c51; border-radius:12px; overflow-x:auto;">
                    <table style="width:100%; border-collapse:collapse; font-size:0.81rem; color:#e2e8f0;">
                        <thead>
                            <tr style="background:#0f172a; color:#94a3b8; text-align:left; border-bottom:1px solid #334155;">
                                <th style="padding:10px;">SKU Oficial / Flujo</th>
                                <th style="padding:10px;">Nomenclatura Oficial LAMDA (Búnker)</th>
                                <th style="padding:10px;">Insumo Base y Puente</th>
                                <th style="padding:10px;">Costo Total</th>
                                <th style="padding:10px;">Margen LAMDA</th>
                                <th style="padding:10px; color:#34d399;">Precio Lista Base Nodo</th>
                                <th style="padding:10px; color:#38bdf8;">Márgenes y Vidriera por Nodo</th>
                                <th style="padding:10px; text-align:right;">Acción</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filasCatalogo.map(cat => {
                                const meta = FLUJO_META[cat.flujo_lamda] || FLUJO_META[2];
                                const esCompartido = Boolean(cat.compartido_mayorista);
                                const nomOficial = cat.bunker_descripcion_generada || cat.nombre_publico || cat.sku_nodo;
                                const ingLabel = cat.ingrediente_label_oficial || cat.ingrediente_origen_nombre || 'Directo';
                                const ofertasItem = ESTADO_NODOS.ofertas_gestor.filter(o =>
                                    Number(o.articulo_catalogo_id) === Number(cat.id) &&
                                    (fNodo === 0 || Number(o.nodo_id) === fNodo)
                                );

                                return `
                                    <tr style="border-bottom:1px solid #1e293b;">
                                        <td style="padding:10px; vertical-align:top;">
                                            <div style="font-family:monospace; font-weight:800; color:#f8fafc;">[${escaparHtml(cat.sku_nodo)}]</div>
                                            <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px; align-items:flex-start;">
                                                <span style="font-size:0.68rem; padding:2px 6px; border-radius:4px; background:${meta.bg}; color:${meta.color}; font-weight:700;">
                                                    ${meta.corto}
                                                </span>
                                                <span style="font-size:0.66rem; padding:2px 6px; border-radius:4px; background:${esCompartido ? 'rgba(56,189,248,0.16)' : 'rgba(16,185,129,0.15)'}; color:${esCompartido ? '#38bdf8' : '#34d399'}; border:1px solid ${esCompartido ? 'rgba(56,189,248,0.35)' : 'rgba(16,185,129,0.35)'}; font-weight:700;">
                                                    ${esCompartido ? '🔄 Compartido Mayorista + Nodo' : '🏘️ Exclusivo Nodos'}
                                                </span>
                                            </div>
                                        </td>
                                        <td style="padding:10px; vertical-align:top;">
                                            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                                <span style="font-size:0.68rem; background:#1e293b; color:#38bdf8; border:1px solid #334155; padding:1px 6px; border-radius:4px; font-weight:800;">
                                                    🌳 ${escaparHtml(cat.bunker_familia_nombre || 'Familia Búnker')}
                                                </span>
                                                <strong style="color:#f8fafc; font-size:0.86rem;">${escaparHtml(nomOficial)}</strong>
                                            </div>
                                            <div style="font-size:0.73rem; color:#94a3b8; margin-top:4px;">
                                                Rubro: <strong style="color:#cbd5e1;">${escaparHtml(cat.bunker_rubro || cat.categoria_familiar || '-')}</strong>${cat.bunker_sub_rubro ? ` / ${escaparHtml(cat.bunker_sub_rubro)}` : ''} · <span style="color:#6ee7b7; font-weight:700;">${escaparHtml(cat.presentacion_etiqueta || `${Math.round(Number(cat.kilos_unidad) * 1000)}g`)}</span>
                                            </div>
                                        </td>
                                        <td style="padding:10px; vertical-align:top;">
                                            <div style="color:#cbd5e1; font-family:monospace; font-size:0.76rem;">${escaparHtml(ingLabel)}</div>
                                            ${cat.ingrediente_articulo_vinculado ? `<div style="font-size:0.7rem; color:#a78bfa; font-family:monospace;">Puente: ${escaparHtml(cat.ingrediente_articulo_vinculado)}</div>` : ''}
                                            <div style="font-size:0.75rem; color:#38bdf8; font-weight:700;">${fmtMoneda(cat.costo_insumo_kg)}/kg</div>
                                        </td>
                                        <td style="padding:10px; vertical-align:top;">
                                            <div>Puro: <strong>${fmtMoneda(cat.costo_puro_total, 2)}</strong></div>
                                            <div style="font-size:0.72rem; color:#94a3b8;">
                                                MP ${fmtMoneda(cat.costo_insumo_fraccion, 0)} + Bolsa ${fmtMoneda(cat.costo_envase_aplicado, 0)} + MO ${fmtMoneda(cat.costo_mano_obra_aplicado, 0)}
                                            </div>
                                        </td>
                                        <td style="padding:10px; vertical-align:top;">
                                            <span style="color:#34d399; font-weight:700;">+${Number(cat.margen_lamda_pct)}%</span>
                                            <div style="font-size:0.71rem; color:#94a3b8;">IVA ${Number(cat.iva_pct)}% · Ret. IIBB ${Number(cat.iibb_pct)}%</div>
                                        </td>
                                        <td style="padding:10px; vertical-align:top;">
                                            <div style="font-size:1.05rem; font-weight:900; color:#34d399;">${fmtMoneda(cat.precio_base_nodo_final)}</div>
                                            <div style="font-size:0.7rem; color:#94a3b8;">S/IVA: ${fmtMoneda(cat.precio_base_nodo_neto, 0)}</div>
                                        </td>
                                        <td style="padding:10px; vertical-align:top; min-width:320px;">
                                            <div style="display:flex; flex-direction:column; gap:6px;">
                                                ${ofertasItem.map(of => {
                                                    const aliasVidriera = String(of.nombre_vidriera_personalizado || '').trim();
                                                    return `
                                                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; background:#0f172a; border:1px solid ${of.alerta_cambio_costo ? '#f59e0b' : '#263244'}; padding:5px 8px; border-radius:6px;">
                                                        <div style="font-size:0.74rem; min-width:0;">
                                                            <strong style="color:#f8fafc;">${escaparHtml(of.nombre_marca)}</strong>
                                                            <div style="color:#6ee7b7; font-size:0.7rem;">Gana limpio: +${fmtMoneda(of.ganancia_unitaria_gestor)}/u.</div>
                                                            <div style="font-size:0.68rem; color:${aliasVidriera ? '#38bdf8' : '#64748b'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:170px;" title="${escaparHtml(aliasVidriera || nomOficial)}">
                                                                ${aliasVidriera ? `🏷️ Vidriera: "${escaparHtml(aliasVidriera)}"` : '🏛️ Vidriera: nombre oficial'}
                                                            </div>
                                                        </div>
                                                        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                                                            <label style="font-size:0.7rem; color:#94a3b8;">%</label>
                                                            <input type="number" step="0.5" value="${Number(of.margen_gestor_pct)}"
                                                                onchange="window.NodosPizarra.actualizarMargenOfertaGestor(${of.id}, this.value)"
                                                                style="width:54px; padding:3px 5px; border-radius:4px; border:1px solid #38bdf8; background:#151e2e; color:#38bdf8; font-weight:700; font-size:0.76rem;">
                                                            <span style="font-weight:800; color:#f8fafc; font-size:0.84rem; min-width:62px; text-align:right;">
                                                                ${fmtMoneda(of.precio_venta_vecino)}
                                                            </span>
                                                            <input type="checkbox" ${of.publicado_tienda ? 'checked' : ''}
                                                                onchange="window.NodosPizarra.togglePublicacionOfertaGestor(${of.id}, this.checked)"
                                                                title="Publicado en tienda vecinal del Nodo">
                                                        </div>
                                                    </div>
                                                `;}).join('')}
                                            </div>
                                        </td>
                                        <td style="padding:10px; vertical-align:top; text-align:right;">
                                            <button onclick="window.NodosPizarra.editarArticuloCatalogoEnMesa(${cat.id})"
                                                style="padding:5px 9px; border-radius:6px; font-size:0.74rem; font-weight:700; border:1px solid #334155; background:#0f172a; color:#cbd5e1; cursor:pointer;">
                                                ✏️ Editar
                                            </button>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>

                <!-- BANDEJA RÁPIDA: PRESENTACIONES ESTÁNDAR QUE LAMDA YA PRODUCE EN PLANTA (AÚN SIN PRECIO EN LISTA NODOS) -->
                <div class="card" style="padding:14px 16px; background:#151e2e; border:1px solid rgba(56,189,248,0.38); border-radius:12px; display:flex; flex-direction:column; gap:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                        <div>
                            <div style="font-weight:800; font-size:0.93rem; color:#f8fafc; display:flex; align-items:center; gap:8px;">
                                <span>🏭 Presentaciones estándar que LAMDA ya produce en Planta</span>
                                <span style="background:rgba(56,189,248,0.2); color:#bae6fd; border:1px solid rgba(56,189,248,0.4); font-size:0.72rem; padding:1px 8px; border-radius:999px;">
                                    ${(ESTADO_NODOS.presentaciones_planta_disponibles || []).length} disponibles para habilitar
                                </span>
                            </div>
                            <div style="font-size:0.76rem; color:#94a3b8; margin-top:2px;">
                                Artículos unitarios con receta activa en el Búnker que el Gestor ya ve marcados como existentes en su celular. Al cotizarlos aquí se reutiliza su SKU, receta y bolsa real sin duplicar artículos, sumándose a la Lista Base Nodos.
                            </div>
                        </div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            <button onclick="window.NodosPizarra.cambiarFiltroPesoPlantaDisponible('SUB_1KG')"
                                style="padding:5px 10px; border-radius:7px; font-size:0.75rem; font-weight:700; cursor:pointer; border:1px solid ${ESTADO_NODOS.filtroPesoPlantaDisponible === 'SUB_1KG' ? '#38bdf8' : '#334155'}; background:${ESTADO_NODOS.filtroPesoPlantaDisponible === 'SUB_1KG' ? 'rgba(56,189,248,0.2)' : '#0f172a'}; color:${ESTADO_NODOS.filtroPesoPlantaDisponible === 'SUB_1KG' ? '#bae6fd' : '#cbd5e1'};">
                                Bolsas chicas (&lt; 1 kg)
                            </button>
                            <button onclick="window.NodosPizarra.cambiarFiltroPesoPlantaDisponible('1KG')"
                                style="padding:5px 10px; border-radius:7px; font-size:0.75rem; font-weight:700; cursor:pointer; border:1px solid ${ESTADO_NODOS.filtroPesoPlantaDisponible === '1KG' ? '#38bdf8' : '#334155'}; background:${ESTADO_NODOS.filtroPesoPlantaDisponible === '1KG' ? 'rgba(56,189,248,0.2)' : '#0f172a'}; color:${ESTADO_NODOS.filtroPesoPlantaDisponible === '1KG' ? '#bae6fd' : '#cbd5e1'};">
                                Bolsas de 1 kg
                            </button>
                            <button onclick="window.NodosPizarra.cambiarFiltroPesoPlantaDisponible('TODAS')"
                                style="padding:5px 10px; border-radius:7px; font-size:0.75rem; font-weight:700; cursor:pointer; border:1px solid ${ESTADO_NODOS.filtroPesoPlantaDisponible === 'TODAS' ? '#38bdf8' : '#334155'}; background:${ESTADO_NODOS.filtroPesoPlantaDisponible === 'TODAS' ? 'rgba(56,189,248,0.2)' : '#0f172a'}; color:${ESTADO_NODOS.filtroPesoPlantaDisponible === 'TODAS' ? '#bae6fd' : '#cbd5e1'};">
                                Todas
                            </button>
                        </div>
                    </div>

                    <input type="text" id="input-buscar-planta-disponible"
                        placeholder="🔍 Filtrar presentaciones existentes de Planta por nombre, SKU (ej: GSX200G, GDFX200G, MFSX300G), categoría o gramaje..."
                        value="${escaparHtml(ESTADO_NODOS.busquedaPlantaDisponible || '')}"
                        oninput="window.NodosPizarra.filtrarBusquedaPlantaDisponible(this.value)"
                        style="width:100%; padding:8px 12px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.81rem;">

                    <div id="nodos-planta-disponibles-lista">
                        ${renderizarFilasPresentacionesPlantaHtml()}
                    </div>
                </div>
            </div>
        `;
    }

    // =========================================================================
    // SUB-PESTAÑA 1: ALTA Y GESTIÓN DE NODOS BARRIALES + ETIQUETA TÉRMICA
    // =========================================================================
    function normalizarTextoBusqueda(str) {
        return String(str ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
    }

    function obtenerBolsaBusquedaClienteBunker(c) {
        const lomasRaw = String(c.lomas_soft_id || '').trim();
        const lomasSinCeros = lomasRaw.replace(/^0+/, '');
        const bunkerRaw = String(c.codigo_bunker_cliente || '').trim();
        const bunkerNum = bunkerRaw.replace(/^CB-0*/i, '');
        const bunkerDigits = bunkerRaw.replace(/^CB-/i, '');
        return normalizarTextoBusqueda([
            bunkerRaw,
            bunkerDigits,
            bunkerNum,
            lomasRaw,
            lomasSinCeros,
            c.cliente_nombre,
            c.razon_social,
            c.email_portal_nombre,
            c.cuit_cuil,
            c.domicilio_fiscal,
            c.domicilio_entrega_direccion,
            c.domicilio_entrega_localidad,
            c.email_portal
        ].filter(Boolean).join(' '));
    }

    function extraerDatosContactoClienteBunker(c) {
        if (!c) return { gestorNombre: '', telefono: '', direccion: '', barrio: '', domiciliosAlternativos: [] };

        let telefono = '';
        let nombreContactoWa = '';
        const rawWa = String(c.whatsapp_facturas || '').trim();
        if (rawWa.startsWith('[')) {
            try {
                const arr = JSON.parse(rawWa);
                if (Array.isArray(arr) && arr.length > 0) {
                    const principal = arr.find(x => x && x.default && x.numero) || arr.find(x => x && x.numero) || arr[0];
                    if (principal) {
                        telefono = String(principal.numero || '').replace(/[^\d+]/g, '');
                        nombreContactoWa = String(principal.nombre || '').trim();
                    }
                }
            } catch (_) {}
        } else if (rawWa) {
            telefono = rawWa.replace(/[^\d+]/g, '');
        }
        if (!telefono && c.domicilio_entrega_telefono) {
            telefono = String(c.domicilio_entrega_telefono).replace(/[^\d+]/g, '');
        }

        const aTitulo = (txt) => String(txt || '')
            .toLowerCase()
            .replace(/\b\w/g, l => l.toUpperCase())
            .trim();

        let gestorNombre = '';
        if (c.email_portal_nombre && String(c.email_portal_nombre).trim()) {
            gestorNombre = String(c.email_portal_nombre).trim();
        } else if (c.razon_social && String(c.razon_social).includes(',')) {
            const partes = String(c.razon_social).split(',');
            const apellido = aTitulo(partes[0]);
            const nombres = aTitulo(partes.slice(1).join(' '));
            gestorNombre = `${nombres} ${apellido}`.trim();
        } else if (c.cliente_nombre) {
            gestorNombre = String(c.cliente_nombre).trim();
        } else if (nombreContactoWa) {
            gestorNombre = nombreContactoWa;
        } else if (c.razon_social) {
            gestorNombre = aTitulo(c.razon_social);
        }

        const domFiscal = String(c.domicilio_fiscal || '').trim();
        const domiciliosRegistrados = Array.isArray(c.domicilios_registrados) ? c.domicilios_registrados : [];
        const domiciliosAlternativos = [];

        domiciliosRegistrados.forEach(d => {
            const dirTxt = String(d.direccion || '').trim();
            if (!dirTxt || dirTxt.toUpperCase() === 'N/A') return;
            const lat = d.latitud !== null && d.latitud !== undefined && d.latitud !== '' ? Number(d.latitud) : null;
            const lng = d.longitud !== null && d.longitud !== undefined && d.longitud !== '' ? Number(d.longitud) : null;
            domiciliosAlternativos.push({
                etiqueta: d.alias ? `Entrega (${d.alias})` : 'Domicilio Entrega',
                direccion: dirTxt,
                localidad: String(d.localidad || '').trim(),
                latitud: Number.isFinite(lat) ? lat : null,
                longitud: Number.isFinite(lng) ? lng : null,
                tieneGps: Number.isFinite(lat) && Number.isFinite(lng)
            });
        });

        if (domFiscal && domFiscal.toUpperCase() !== 'N/A') {
            const yaExiste = domiciliosAlternativos.some(x => x.direccion.toLowerCase() === domFiscal.toLowerCase());
            if (!yaExiste) {
                domiciliosAlternativos.push({
                    etiqueta: 'Domicilio Fiscal',
                    direccion: domFiscal,
                    localidad: '',
                    latitud: null,
                    longitud: null,
                    tieneGps: false
                });
            }
        }

        const preferido = domiciliosAlternativos.find(d => d.tieneGps) || domiciliosAlternativos[0] || null;
        const direccionPrincipal = preferido?.direccion || '';
        const latitud = preferido?.latitud ?? null;
        const longitud = preferido?.longitud ?? null;

        let barrioZona = String(preferido?.localidad || c.domicilio_entrega_localidad || '').trim();
        if (/^buenos aires$/i.test(barrioZona)) {
            barrioZona = '';
        }

        return {
            gestorNombre,
            nombreTitular: gestorNombre,
            telefono,
            direccion: direccionPrincipal,
            direccionPrincipal,
            barrio: barrioZona,
            barrioZona,
            latitud,
            longitud,
            domiciliosAlternativos
        };
    }

    function renderizarListaClientesTitularesHtml() {
        const clientes = ESTADO_NODOS.fuentes.clientes_bunker || [];
        const query = normalizarTextoBusqueda(ESTADO_NODOS.busquedaClienteAbm || '').trim();
        const terminos = query ? query.split(/\s+/).filter(Boolean) : [];

        const filtrados = clientes.filter(c => {
            if (terminos.length === 0) return true;
            const bolsa = obtenerBolsaBusquedaClienteBunker(c);
            return terminos.every(t => bolsa.includes(t));
        });

        if (filtrados.length === 0) {
            return `
                <div style="padding:12px; text-align:center; color:#94a3b8; font-size:0.78rem;">
                    No se encontraron clientes con <strong>"${escaparHtml(ESTADO_NODOS.busquedaClienteAbm)}"</strong>.
                    <a href="http://localhost:3005/pages/listado-clientes.html" target="_blank" style="color:#38bdf8; font-weight:700; margin-left:6px; text-decoration:underline;">➕ Dar de alta en Clientes Búnker ↗</a>
                </div>
            `;
        }

        return filtrados.slice(0, 35).map(c => {
            const seleccionado = Number(ESTADO_NODOS.clienteMadreSeleccionadoId) === Number(c.id);
            const saldoNum = Number(c.saldo_cta_cte || 0);
            const saldoLabel = saldoNum < 0
                ? `Saldo a favor: ${fmtMoneda(Math.abs(saldoNum))}`
                : `Saldo CC: ${fmtMoneda(saldoNum)}`;
            const lomasTag = c.lomas_soft_id ? `Lomas #${c.lomas_soft_id}` : 'S/Lomas';
            const domPreview = c.domicilio_fiscal || c.domicilio_entrega_direccion || 'Sin domicilio registrado';
            return `
                <div onclick="window.NodosPizarra.seleccionarClienteTitularAbm(${c.id})"
                    style="padding:8px 11px; border-bottom:1px solid #1e293b; cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:10px; background:${seleccionado ? 'rgba(16,185,129,0.18)' : 'transparent'}; border-left:3px solid ${seleccionado ? '#10b981' : 'transparent'}; transition:background 0.15s;">
                    <div style="min-width:0; flex:1;">
                        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <span style="font-family:monospace; font-size:0.74rem; font-weight:800; color:#38bdf8; background:rgba(56,189,248,0.14); padding:1px 6px; border-radius:4px;">${escaparHtml(c.codigo_bunker_cliente)}</span>
                            <span style="font-family:monospace; font-size:0.72rem; font-weight:700; color:#cbd5e1; background:#1e293b; padding:1px 6px; border-radius:4px;">${escaparHtml(lomasTag)}</span>
                            <span style="font-weight:800; font-size:0.82rem; color:#f8fafc;">${escaparHtml(c.cliente_nombre || c.razon_social)}</span>
                            ${c.razon_social && c.razon_social !== c.cliente_nombre ? `<span style="font-size:0.75rem; color:#94a3b8;">— ${escaparHtml(c.razon_social)}</span>` : ''}
                        </div>
                        <div style="font-size:0.71rem; color:#64748b; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                            📍 ${escaparHtml(domPreview)}
                        </div>
                    </div>
                    <div style="text-align:right; flex-shrink:0;">
                        <div style="font-size:0.73rem; font-weight:700; color:${saldoNum <= 0 ? '#34d399' : '#fbbf24'};">${saldoLabel}</div>
                        <div style="font-size:0.68rem; color:${seleccionado ? '#6ee7b7' : '#64748b'}; font-weight:700;">${seleccionado ? '✓ Seleccionado' : 'Elegir →'}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderizarResumenClienteTitularHtml() {
        const cli = (ESTADO_NODOS.fuentes.clientes_bunker || []).find(
            c => Number(c.id) === Number(ESTADO_NODOS.clienteMadreSeleccionadoId)
        );
        if (!cli) {
            return `
                <div style="padding:8px 11px; border-radius:7px; background:rgba(15,23,42,0.85); border:1px dashed #475569; color:#94a3b8; font-size:0.76rem;">
                    👆 Busque y seleccione arriba al <strong>Cliente Titular de LAMDA</strong> para vincular su cuenta y precargar automáticamente sus datos de contacto y domicilio.
                </div>
            `;
        }
        const saldoNum = Number(cli.saldo_cta_cte || 0);
        const saldoTxt = saldoNum < 0
            ? `Saldo a favor: ${fmtMoneda(Math.abs(saldoNum))}`
            : `Saldo CC Principal: ${fmtMoneda(saldoNum)}`;
        const chkUnif = document.getElementById('abm-usar-cuenta-madre-unificada');
        const usarUnificada = Boolean(chkUnif?.checked);
        return `
            <div style="padding:8px 12px; border-radius:7px; background:rgba(16,185,129,0.14); border:1px solid rgba(16,185,129,0.45); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <div style="font-size:0.78rem; color:#ecfdf5;">
                    ✅ <strong>Cliente Titular Vinculado:</strong>
                    <code style="color:#6ee7b7; font-weight:800;">${escaparHtml(cli.codigo_bunker_cliente)}</code>
                    ${cli.lomas_soft_id ? `<span style="color:#94a3b8;">(Lomas #${escaparHtml(cli.lomas_soft_id)})</span>` : ''}
                    — <strong>${escaparHtml(cli.razon_social || cli.cliente_nombre)}</strong>
                    <span style="margin-left:6px; color:#6ee7b7; font-weight:700;">(${saldoTxt})</span>
                </div>
                <div style="font-size:0.71rem; color:${usarUnificada ? '#bae6fd' : '#a7f3d0'};">
                    ${usarUnificada
                        ? `Cuenta Unificada directo en <code>${escaparHtml(cli.codigo_bunker_cliente)}</code> (subcuenta duplicada archivada)`
                        : `Subcuenta operativa aislada <code>CB-NODO-xxx</code> + liquidación neta en <code>${escaparHtml(cli.codigo_bunker_cliente)}</code>`}
                </div>
            </div>
        `;
    }

    function renderizarSubTabAbmNodos() {
        const cfgCanal = ESTADO_NODOS.fuentes.config_cuenta_canal || {
            alias_recaudador: 'LAMDA.SER.MARTIN',
            banco_recaudador: 'Banco Galicia',
            titular_recaudador: 'Martín Ignacio Serrano',
            cbu_recaudador: '0070373230004007844141'
        };
        const aliasCompartido = cfgCanal.alias_recaudador || 'LAMDA.SER.MARTIN';
        const nodosTodos = ESTADO_NODOS.nodos || [];
        const nodosArchivadosCount = nodosTodos.filter(n => n.activo === false).length;
        const nodosVisiblesAbm = ESTADO_NODOS.mostrarArchivadosAbm
            ? nodosTodos
            : nodosTodos.filter(n => n.activo !== false);

        return `
            <div style="display:grid; grid-template-columns: 34% 65%; gap:16px; align-items:start;">
                <!-- COLUMNA IZQUIERDA: LISTADO DE NODOS BARRIALES -->
                <div class="card" style="padding:14px; background:#151e2e; border:1px solid #2e3c51; border-radius:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:6px; flex-wrap:wrap;">
                        <div>
                            <div style="font-weight:700; font-size:0.95rem; color:#f8fafc;">🏘️ Nodos</div>
                            <div style="font-size:0.74rem; color:#94a3b8;">Seleccione un Nodo para editarlo o dé de alta uno nuevo</div>
                        </div>
                        <button onclick="window.NodosPizarra.nuevoNodoFormulario()"
                            style="padding:6px 11px; border-radius:7px; font-size:0.76rem; font-weight:700; border:1px solid #10b981; background:rgba(16,185,129,0.2); color:#6ee7b7; cursor:pointer;">
                            ➕ Nuevo Nodo
                        </button>
                    </div>
                    ${(nodosArchivadosCount > 0 || ESTADO_NODOS.mostrarArchivadosAbm) ? `
                        <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.73rem; color:#cbd5e1; margin-bottom:10px; cursor:pointer; padding:4px 9px; border-radius:6px; background:#0f172a; border:1px solid #334155;">
                            <input type="checkbox" ${ESTADO_NODOS.mostrarArchivadosAbm ? 'checked' : ''}
                                onchange="window.NodosPizarra.toggleMostrarArchivadosAbm(this.checked)"
                                style="accent-color:#f59e0b; cursor:pointer;">
                            <span>Mostrar archivados (${nodosArchivadosCount})</span>
                        </label>
                    ` : ''}

                    <div style="display:flex; flex-direction:column; gap:10px;">
                        ${nodosVisiblesAbm.length === 0 ? `
                            <div style="padding:16px; border-radius:10px; background:rgba(15,23,42,0.7); border:1px dashed #475569; color:#cbd5e1; font-size:0.8rem; line-height:1.5;">
                                <div style="font-weight:800; color:#38bdf8; margin-bottom:4px;">📋 Sin Nodos activos para mostrar</div>
                                Para crear un Nodo, busque y seleccione primero al <strong>Cliente Titular en el Padrón de LAMDA</strong> en el paso <code>1️⃣</code> de la derecha. Sus datos de contacto y domicilio se precargarán automáticamente para que solo complete el nombre comercial del Nodo y guarde.
                            </div>
                        ` : ''}
                        ${nodosVisiblesAbm.map(n => {
                            const esArchivado = n.activo === false;
                            const estaEditando = Number(ESTADO_NODOS.nodoEditandoId) === Number(n.id);
                            const puedeRet = n.permitir_retiro_nodo !== false;
                            const puedeRep = Boolean(n.permitir_reparto_propio ?? n.permitir_envio_barrial ?? true);
                            const puedeEnc = Boolean(n.permitir_encomienda);
                            return `
                            <div onclick="window.NodosPizarra.cargarNodoEnFormularioAbm(${n.id})"
                                data-abm-card-id="${n.id}"
                                style="padding:12px; border-radius:10px; background:${estaEditando ? 'rgba(30,27,75,0.55)' : 'rgba(15,23,42,0.85)'}; border:${estaEditando ? '2px' : '1px'} ${esArchivado ? 'dashed' : 'solid'} ${estaEditando ? '#a78bfa' : (esArchivado ? '#b45309' : '#334155')}; opacity:${esArchivado ? '0.78' : '1'}; cursor:pointer; display:flex; flex-direction:column; gap:8px;">
                                <div style="display:flex; gap:12px; align-items:center;">
                                    <div style="width:82px; height:46px; background:#faf7f3; border-radius:6px; border:1px solid #475569; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0; padding:3px;">
                                        ${(n.tema_visual?.logos?.horizontal || n.logo_original_base64)
                                            ? `<img src="${escaparHtml(n.tema_visual?.logos?.horizontal || n.logo_original_base64)}" style="max-width:100%; max-height:100%; object-fit:contain;" alt="Logo">`
                                            : (n.logo_mono_preview_base64
                                                ? `<img src="${n.logo_mono_preview_base64}" style="max-width:100%; max-height:100%; image-rendering:pixelated;" alt="Logo">`
                                                : `<span style="color:#000; font-weight:800; font-size:0.75rem;">LOGO</span>`)}
                                    </div>
                                    <div style="flex:1; min-width:0;">
                                        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
                                            <span style="font-weight:800; color:#f8fafc; font-size:0.9rem; display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                                <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${escaparHtml(n.color_primario || '#a2553b')}; border:1px solid rgba(255,255,255,0.4);"></span>
                                                ${escaparHtml(n.nombre_marca)}
                                                ${n.bajada_marca ? `<span style="font-size:0.72rem; font-weight:600; color:#cbd5e1;">· ${escaparHtml(n.bajada_marca)}</span>` : ''}
                                                ${esArchivado ? `<span style="font-size:0.64rem; font-weight:900; padding:1px 6px; border-radius:4px; background:rgba(245,158,11,0.22); border:1px solid #f59e0b; color:#fcd34d;">ARCHIVADO</span>` : ''}
                                            </span>
                                            <span style="display:inline-flex; align-items:center; gap:5px; flex-wrap:wrap;">
                                                <span data-abm-edit-chip="${n.id}"
                                                    style="font-size:0.66rem; font-weight:800; padding:2px 7px; border-radius:999px; ${estaEditando
                                                        ? 'background:rgba(167,139,250,0.28); border:1px solid #a78bfa; color:#ede9fe;'
                                                        : 'background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.4); color:#bae6fd;'}">
                                                    ${estaEditando ? '✏️ Editando actualmente' : '✏️ Editar'}
                                                </span>
                                                <span style="font-size:0.68rem; font-family:monospace; color:#a78bfa; background:rgba(167,139,250,0.14); padding:2px 6px; border-radius:4px;">${escaparHtml(n.codigo_nodo)}</span>
                                            </span>
                                        </div>
                                        <div style="font-size:0.75rem; color:#cbd5e1; margin-top:2px;">
                                            👤 Gestor: <strong>${escaparHtml(n.gestor_nombre)}</strong> · 📍 ${escaparHtml(n.barrio_zona || n.direccion_retiro || '')}
                                        </div>
                                        <div style="font-size:0.72rem; color:#94a3b8; margin-top:3px; display:flex; gap:10px; flex-wrap:wrap;">
                                            ${n.usar_cuenta_madre_unificada && n.codigo_bunker_cliente_madre ? `
                                                <span>🔗 Cuenta Única <code>${escaparHtml(n.codigo_bunker_cliente_madre)}</code>: <strong style="color:#38bdf8;">${fmtMoneda(n.saldo_cuenta_corriente_madre)}</strong> <span style="color:#64748b;">(subcuenta ${escaparHtml(n.codigo_bunker_cliente || '')} archivada)</span></span>
                                            ` : `
                                                <span>📒 Subcuenta <code>${escaparHtml(n.codigo_bunker_cliente || 'CB-NODO')}</code>: <strong style="color:#34d399;">${fmtMoneda(n.saldo_cuenta_corriente)}</strong></span>
                                            `}
                                            <span>🏦 Alias: <strong style="color:#38bdf8;">${escaparHtml(n.alias_bancario_display || 'pago.canasto')}</strong></span>
                                            <span>🛵 Envío: <strong>${puedeRep ? fmtMoneda(n.cargo_envio_barrial) : 'Deshabilitado'}</strong></span>
                                        </div>
                                        <div style="display:flex; gap:5px; flex-wrap:wrap; margin-top:4px;">
                                            ${puedeRet ? `<span style="font-size:0.66rem; padding:1px 6px; border-radius:999px; background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.35); color:#bae6fd;">🏠 Retiro en Nodo</span>` : ''}
                                            ${puedeRep ? `<span style="font-size:0.66rem; padding:1px 6px; border-radius:999px; background:rgba(16,185,129,0.14); border:1px solid rgba(16,185,129,0.35); color:#6ee7b7;">🚗 Reparto Propio</span>` : ''}
                                            ${puedeEnc ? `<span style="font-size:0.66rem; padding:1px 6px; border-radius:999px; background:rgba(245,158,11,0.14); border:1px solid rgba(245,158,11,0.35); color:#fcd34d;">📦 Encomienda (prevista)</span>` : ''}
                                        </div>
                                        ${n.codigo_bunker_cliente_madre ? `
                                            <div style="font-size:0.71rem; color:${n.usar_cuenta_madre_unificada ? '#bae6fd' : '#6ee7b7'}; margin-top:4px; padding:3px 7px; border-radius:5px; background:${n.usar_cuenta_madre_unificada ? 'rgba(56,189,248,0.14)' : 'rgba(16,185,129,0.14)'}; border:1px solid ${n.usar_cuenta_madre_unificada ? 'rgba(56,189,248,0.4)' : 'rgba(16,185,129,0.35)'}; display:inline-block;">
                                                ${n.usar_cuenta_madre_unificada ? '🔗 Cuenta Madre Unificada:' : '🔗 Cliente Titular LAMDA:'} <strong>${escaparHtml(n.codigo_bunker_cliente_madre)}</strong> (${escaparHtml(n.cliente_madre_razon_social || n.cliente_madre_nombre || '')}) · Saldo CC: <strong>${fmtMoneda(n.saldo_cuenta_corriente_madre)}</strong>
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                                <div style="display:flex; justify-content:flex-end; gap:6px; padding-top:6px; border-top:1px solid rgba(51,65,85,0.6); flex-wrap:wrap;" onclick="event.stopPropagation();">
                                    ${esArchivado ? `
                                        <span style="font-size:0.71rem; color:#fcd34d; align-self:center; margin-right:auto;">Tienda y App bloqueadas hasta reactivar</span>
                                    ` : `
                                        <button type="button" onclick="window.NodosPizarra.enviarLinksBienvenidaNodoWa(${n.id})"
                                            style="padding:4px 9px; border-radius:6px; font-size:0.71rem; font-weight:700; background:rgba(16,185,129,0.2); border:1px solid #10b981; color:#6ee7b7; cursor:pointer;"
                                            title="Abrir modal interno de envío por motor WhatsApp (:3004) y/o Email SMTP con adjunto QR">
                                            📤 Enviar Invitación / QR (WA · Email)
                                        </button>
                                        <a href="/gestor/${escaparHtml(n.slug)}" target="_blank"
                                            style="text-decoration:none; padding:4px 9px; border-radius:6px; font-size:0.71rem; font-weight:700; background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.4); color:#bae6fd;">
                                            🎛️ App Gestor ↗
                                        </a>
                                        <a href="/tienda/${escaparHtml(n.slug)}" target="_blank"
                                            style="text-decoration:none; padding:4px 9px; border-radius:6px; font-size:0.71rem; font-weight:700; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.4); color:#6ee7b7;">
                                            🏪 Tienda Vecinos ↗
                                        </a>
                                    `}
                                </div>
                            </div>
                        `;
                        }).join('')}
                    </div>
                </div>

                <!-- COLUMNA DERECHA: FORMULARIO ABM + LOGO TÉRMICO + SIMULADOR ETIQUETA ZEBRA -->
                <div style="display:flex; flex-direction:column; gap:14px;">
                    <div class="card" style="padding:16px; background:#151e2e; border:1px solid rgba(167,139,250,0.4); border-radius:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; border-bottom:1px solid #2e3c51; padding-bottom:12px; margin-bottom:12px;">
                            <div>
                                <div style="font-size:1.05rem; font-weight:800; color:#f8fafc; display:flex; align-items:center; gap:8px; flex-wrap:wrap;" id="abm-nodo-form-title">
                                    ➕ Creando Nuevo Nodo
                                </div>
                                <div style="font-size:0.75rem; color:#94a3b8; margin-top:2px;" id="abm-nodo-form-sub">
                                    Todo Nodo parte de un Cliente Titular en LAMDA y opera sus canastos con una subcuenta aislada (<code>CB-NODO-xxx</code>).
                                </div>
                            </div>
                            <div id="abm-nodo-form-actions" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                                <button type="button" id="abm-btn-guardar-principal" onclick="window.NodosPizarra.guardarNodoAbm()"
                                    style="padding:8px 16px; border-radius:8px; font-weight:800; font-size:0.82rem; border:none; background:linear-gradient(135deg, #10b981, #059669); color:#052e16; cursor:pointer;">
                                    💾 Guardar Nuevo Nodo y Etiqueta ZPL
                                </button>
                            </div>
                        </div>

                        <input type="hidden" id="abm-nodo-id" value="">
                        <input type="hidden" id="abm-cliente-madre-id" value="${ESTADO_NODOS.clienteMadreSeleccionadoId || ''}">
                        <input type="hidden" id="abm-cliente-madre-codigo" value="">
                        <input type="hidden" id="abm-latitud" value="">
                        <input type="hidden" id="abm-longitud" value="">

                        <!-- PASO 1: BUSCADOR EN VIVO DEL CLIENTE TITULAR EN EL PADRÓN DE LAMDA -->
                        <div style="margin-bottom:12px; padding:12px; border-radius:9px; background:#0f172a; border:1px solid #334155;">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
                                <label style="font-size:0.78rem; color:#38bdf8; font-weight:800;">
                                    1️⃣ Seleccionar Cliente Titular en el Padrón General de LAMDA
                                </label>
                                <a href="http://localhost:3005/pages/listado-clientes.html" target="_blank"
                                    style="font-size:0.74rem; color:#6ee7b7; font-weight:700; text-decoration:none; padding:3px 9px; border-radius:6px; background:rgba(16,185,129,0.14); border:1px solid rgba(16,185,129,0.35);">
                                    ➕ ¿Persona nueva? Dar de alta primero en Clientes Búnker ↗
                                </a>
                            </div>

                            <input type="text" id="abm-buscador-cliente-input"
                                value="${escaparHtml(ESTADO_NODOS.busquedaClienteAbm || '')}"
                                oninput="window.NodosPizarra.filtrarClientesTitularesAbm(this.value)"
                                placeholder="🔎 Escriba N° Lomas (ej: 583 o 0583), Cód. Búnker (ej: CB-0006 o 006), Nombre, Apellido o Razón Social..."
                                autocomplete="off"
                                style="width:100%; padding:8px 11px; border-radius:7px; border:1px solid #38bdf8; background:#151e2e; color:#f8fafc; font-size:0.82rem; margin-bottom:8px; box-sizing:border-box;">

                            <div id="abm-lista-clientes-titulares"
                                style="max-height:165px; overflow-y:auto; border:1px solid #1e293b; border-radius:7px; background:#0b1120; margin-bottom:8px;">
                                ${renderizarListaClientesTitularesHtml()}
                            </div>

                            <div id="abm-cliente-titular-resumen">
                                ${renderizarResumenClienteTitularHtml()}
                            </div>

                            <label style="display:flex; gap:10px; align-items:flex-start; margin-top:10px; padding:9px 11px; border-radius:8px; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.35); cursor:pointer;">
                                <input type="checkbox" id="abm-usar-cuenta-madre-unificada"
                                    onchange="window.NodosPizarra.alCambiarModoCuentaUnificadaAbm()"
                                    style="margin-top:3px; accent-color:#38bdf8;">
                                <div>
                                    <div style="font-size:0.78rem; font-weight:800; color:#bae6fd;">
                                        🔗 Unificar Cuenta Corriente directo en el Cliente Titular Madre (sin subcuenta duplicada en Tesorería)
                                    </div>
                                    <div style="font-size:0.71rem; color:#94a3b8; margin-top:2px; line-height:1.35;">
                                        Al activarlo, retiros de canastos, remitos, transferencias, cobros y liquidaciones del Nodo imputan directo en la Cuenta Principal del Titular con la referencia operativa <code>Nodo [Marca]</code>, y su subcuenta <code>CB-NODO-xxx</code> queda archivada sin duplicidad. Desactivado = opera en subcuenta aislada.
                                    </div>
                                </div>
                            </label>
                        </div>

                        <!-- PASO 2: DATOS DE CONTACTO, PUNTO DE RETIRO Y MAPA INTERACTIVO AR (LEAFLET + GEOREF AR) -->
                        <div style="margin-bottom:12px; padding:11px 12px; border-radius:9px; background:rgba(15,23,42,0.65); border:1px solid #263244;">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
                                <div style="font-size:0.75rem; color:#cbd5e1; font-weight:800;">
                                    2️⃣ Datos de Contacto y Punto de Retiro del Nodo <span style="font-weight:500; color:#94a3b8;">(precargados del Cliente y ajustables en Mapa AR)</span>
                                </div>
                                <button type="button" onclick="window.NodosPizarra.togglePanelMapaAbm()"
                                    style="padding:4px 10px; border-radius:6px; font-size:0.73rem; font-weight:800; background:rgba(56,189,248,0.16); border:1px solid #38bdf8; color:#bae6fd; cursor:pointer;">
                                    🗺️ Ver / Ubicar en Mapa
                                </button>
                            </div>

                            <div style="display:grid; grid-template-columns: 1fr 0.85fr 0.95fr 1.4fr; gap:10px;">
                                <div>
                                    <label style="display:block; font-size:0.72rem; color:#cbd5e1; margin-bottom:3px;">Nombre del Gestor / Responsable</label>
                                    <input type="text" id="abm-gestor-nombre" placeholder="Nombre y Apellido"
                                        style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; box-sizing:border-box;">
                                </div>
                                <div>
                                    <label style="display:block; font-size:0.72rem; color:#cbd5e1; margin-bottom:3px;">WhatsApp del Gestor</label>
                                    <input type="text" id="abm-gestor-tel" placeholder="549221..."
                                        style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-family:monospace; box-sizing:border-box;">
                                </div>
                                <div>
                                    <label style="display:block; font-size:0.72rem; color:#38bdf8; font-weight:700; margin-bottom:3px;">Barrio / Localidad</label>
                                    <input type="text" id="abm-barrio" placeholder="Barrio / Localidad"
                                        style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #38bdf8; background:#0f172a; color:#f8fafc; font-weight:700; box-sizing:border-box;">
                                </div>
                                <div class="nodos-geo-suggest-wrap">
                                    <label style="display:block; font-size:0.72rem; color:#cbd5e1; margin-bottom:3px;">Domicilio del Nodo (Texto Impreso / Mapa AR)</label>
                                    <input type="text" id="abm-direccion" autocomplete="off"
                                        placeholder="Calle, altura, ciudad (ej: Pellegrini 1419, Martínez, Buenos Aires)"
                                        oninput="window.NodosPizarra.simularEtiquetaZebra('estandar_pagado')"
                                        style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; box-sizing:border-box;">
                                    <div id="abm-direccion-sugerencias" class="nodos-geo-suggest-dropdown"></div>
                                </div>
                            </div>

                            <!-- OPCIONES DE DOMICILIOS DEL CLIENTE -->
                            <div id="abm-domicilios-sugeridos" style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:8px;"></div>

                            <!-- PANEL DESPLEGABLE INTERACTIVO LEAFLET + OSM + GEOREF AR -->
                            <div id="abm-mapa-panel" style="display:none; margin-top:10px; padding:10px; border-radius:9px; background:#0b1120; border:1px solid rgba(56,189,248,0.45);">
                                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px;">
                                    <div class="nodos-geo-suggest-wrap" style="flex:1; min-width:240px;">
                                        <input type="text" id="abm-mapa-search-input" autocomplete="off"
                                            onkeydown="if(event.key==='Enter'){event.preventDefault(); window.NodosPizarra.buscarDireccionEnMapaAbm();}"
                                            placeholder="🔎 Escribí cualquier calle, ciudad o provincia de Argentina (ej: Martínez, Buenos Aires / 7 820, La Plata)..."
                                            style="width:100%; padding:6px 10px; border-radius:6px; border:1px solid #334155; background:#151e2e; color:#f8fafc; font-size:0.78rem; box-sizing:border-box;">
                                        <div id="abm-mapa-sugerencias" class="nodos-geo-suggest-dropdown"></div>
                                    </div>
                                    <button type="button" onclick="window.NodosPizarra.buscarDireccionEnMapaAbm()"
                                        style="padding:6px 12px; border-radius:6px; font-size:0.75rem; font-weight:800; background:#0284c7; border:none; color:#fff; cursor:pointer;">
                                        🔍 Buscar en Mapa
                                    </button>
                                    <button type="button" onclick="window.NodosPizarra.ubicarTextoDomicilioActualEnMapaAbm()"
                                        style="padding:6px 11px; border-radius:6px; font-size:0.74rem; font-weight:700; background:rgba(16,185,129,0.18); border:1px solid #10b981; color:#6ee7b7; cursor:pointer;">
                                        📍 Ubicar Domicilio Escrito
                                    </button>
                                </div>

                                <div id="abm-google-map-canvas" style="width:100%; height:270px; border-radius:8px; border:1px solid #334155; background:#0f172a; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:0.8rem;">
                                    ⏳ Inicializando mapa interactivo OpenStreetMap...
                                </div>

                                <div id="abm-mapa-info-bar" style="margin-top:8px; padding:8px 10px; border-radius:7px; background:#151e2e; border:1px solid #2e3c51; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; font-size:0.75rem; color:#cbd5e1;">
                                    <div>
                                        🗺️ Haga clic en cualquiera de los domicilios del cliente arriba, busque una calle/localidad o haga clic / arrastre el pin sobre el mapa para detectar el <strong>Barrio / Localidad</strong>.
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- PASO 3: IDENTIDAD DE MARCA BLANCA Y CONDICIONES DEL NODO -->
                        <div style="font-size:0.75rem; color:#cbd5e1; font-weight:800; margin-bottom:6px;">
                            3️⃣ Identidad de la Tienda Vecinal (Marca Blanca), Estética y Condiciones Operativas
                        </div>
                        <div style="display:grid; grid-template-columns: 1.15fr 1fr 1fr 1.15fr; gap:10px; margin-bottom:10px;">
                            <div>
                                <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:3px;">Nombre de la Marca del Nodo</label>
                                <input type="text" id="abm-nombre-marca" placeholder="Ej: Paraíso"
                                    oninput="window.NodosPizarra.alEditarNombreMarcaAbm(this.value)"
                                    style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-weight:700; box-sizing:border-box;">
                            </div>
                            <div>
                                <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:3px;">Bajada Oficial de Marca</label>
                                <input type="text" id="abm-bajada-marca" placeholder="Ej: Alimentos saludables"
                                    oninput="window.NodosPizarra.simularEtiquetaZebra('estandar_pagado')"
                                    style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; box-sizing:border-box;">
                            </div>
                            <div>
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
                                    <label style="font-size:0.73rem; color:#cbd5e1;">Dirección Web (Link corto)</label>
                                    <button type="button" onclick="window.NodosPizarra.sincronizarSlugDesdeNombreAbm()"
                                        title="Generar link a partir del nombre de la marca"
                                        style="padding:1px 6px; border-radius:4px; font-size:0.66rem; font-weight:700; border:1px solid #334155; background:#1e293b; color:#38bdf8; cursor:pointer;">
                                        🔄 Tomar del nombre
                                    </button>
                                </div>
                                <input type="text" id="abm-slug" placeholder="ej: paraiso"
                                    oninput="this.dataset.manual='true'"
                                    style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#38bdf8; font-family:monospace; box-sizing:border-box;">
                            </div>
                            <div>
                                <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:3px;">Subtítulo Etiqueta / Pie</label>
                                <input type="text" id="abm-subtitulo" value="Alimentos Naturales y Frutos Secos - Entrega Barrial"
                                    oninput="window.NodosPizarra.simularEtiquetaZebra('estandar_pagado')"
                                    style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; box-sizing:border-box;">
                            </div>
                        </div>

                        <!-- PALETA DE COLOR Y TEMA VISUAL MARCA BLANCA DEL NODO -->
                        <div style="display:flex; flex-direction:column; gap:8px; padding:9px 12px; border-radius:8px; background:rgba(15,23,42,0.75); border:1px solid #263244; margin-bottom:10px;">
                            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                    <span style="font-size:0.73rem; color:#cbd5e1; font-weight:800;">🎨 Color de Identidad (Apps Móviles):</span>
                                    <input type="color" id="abm-color-primario" value="#a2553b"
                                        oninput="document.getElementById('abm-color-hex-label').textContent = this.value"
                                        style="width:32px; height:28px; padding:0; border:1px solid #475569; border-radius:6px; background:transparent; cursor:pointer;">
                                    <code id="abm-color-hex-label" style="font-size:0.74rem; color:#f8fafc; background:#0f172a; padding:2px 7px; border-radius:5px; border:1px solid #334155;">#a2553b</code>
                                </div>
                                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                    <span style="font-size:0.7rem; color:#94a3b8;">Paletas sugeridas:</span>
                                    ${[
                                        { label: 'Manso Bordó', hex: '#672833' },
                                        { label: 'Paraíso Terracota', hex: '#D36344' },
                                        { label: 'Terracota Tierra', hex: '#a2553b' },
                                        { label: 'Cacao Tostado', hex: '#654B30' },
                                        { label: 'Oliva Pistacho', hex: '#9DAD5A' },
                                        { label: 'Azul Barrial', hex: '#2b5b84' }
                                    ].map(p => `
                                        <button type="button" onclick="window.NodosPizarra.fijarColorPrimarioNodoAbm('${p.hex}')"
                                            style="display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border-radius:999px; font-size:0.7rem; font-weight:700; border:1px solid #334155; background:#0f172a; color:#e2e8f0; cursor:pointer;">
                                            <span style="width:10px; height:10px; border-radius:50%; background:${p.hex}; display:inline-block;"></span>
                                            ${p.label}
                                        </button>
                                    `).join('')}
                                </div>
                            </div>
                            <div id="abm-tema-visual-preview" style="padding:7px 9px; border-radius:6px; background:#0b1220; border:1px solid #1e293b; font-size:0.71rem; color:#94a3b8;">
                                Tema visual por defecto (usa color primario + sello o logo cargado).
                            </div>
                        </div>

                        <!-- CUENTA RECAUDADORA COMPARTIDA DEL CANAL NODOS (MARCA BLANCA) Y CARGO DE ENVÍO -->
                        <div style="display:grid; grid-template-columns: 1.55fr 1fr 0.75fr 0.7fr; gap:10px; margin-bottom:12px; padding:11px 12px; border-radius:8px; background:rgba(15,23,42,0.75); border:1px solid #263244;">
                            <div>
                                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:4px;">
                                    <label style="font-size:0.72rem; color:#38bdf8; font-weight:800;">
                                        🏦 Cuenta Recaudadora del Canal Nodos (Marca Blanca)
                                    </label>
                                    <button type="button" onclick="window.NodosPizarra.abrirModalConfigCuentaCanal()"
                                        style="padding:2px 8px; border-radius:5px; font-size:0.68rem; font-weight:800; background:rgba(56,189,248,0.16); border:1px solid rgba(56,189,248,0.45); color:#bae6fd; cursor:pointer;">
                                        ⚙️ Configurar para Todos los Nodos
                                    </button>
                                </div>
                                <div style="padding:6px 9px; border-radius:6px; background:#0f172a; border:1px solid #334155; font-size:0.74rem; color:#e2e8f0;">
                                    <span style="color:#94a3b8;">Cuenta compartida:</span>
                                    <strong id="abm-canal-banco-label" style="color:#f8fafc;">${escaparHtml(cfgCanal.banco_recaudador || 'Cuenta Recaudadora Canal Nodos')}</strong>
                                    · <span style="color:#94a3b8;">Alias neutro:</span>
                                    <code id="abm-canal-alias-label" style="color:#38bdf8; font-weight:800;">${escaparHtml(aliasCompartido)}</code>
                                </div>
                                <label style="display:inline-flex; align-items:center; gap:5px; font-size:0.71rem; color:#94a3b8; margin-top:5px; cursor:pointer;">
                                    <input type="checkbox" id="abm-cuenta-compartida" checked onchange="window.NodosPizarra.alCambiarToggleCuentaCompartidaAbm(this.checked)">
                                    Usar el Alias y Cuenta Recaudadora compartida del Canal Nodos (sin mencionar LAMDA)
                                </label>
                            </div>
                            <div>
                                <label style="display:block; font-size:0.72rem; color:#38bdf8; font-weight:700; margin-bottom:3px;">Alias Visible al Vecino en Tienda</label>
                                <input type="text" id="abm-alias-display" value="${escaparHtml(aliasCompartido)}" placeholder="pago.canasto"
                                    style="width:100%; padding:7px; border-radius:6px; border:1px solid #38bdf8; background:#0f172a; color:#38bdf8; font-weight:800; font-size:0.84rem; font-family:monospace; box-sizing:border-box;">
                                <div style="font-size:0.66rem; color:#94a3b8; margin-top:2px;">Neutro (sin LAMDA ni nombre de un Nodo)</div>
                            </div>
                            <div>
                                <label style="display:block; font-size:0.72rem; color:#34d399; font-weight:700; margin-bottom:3px;">Costo Envío Barrial ($)</label>
                                <input type="number" id="abm-cargo-envio" step="100" value="1500"
                                    style="width:100%; padding:7px; border-radius:6px; border:1px solid #10b981; background:#0f172a; color:#34d399; font-weight:800; font-size:0.81rem; box-sizing:border-box;">
                                <div style="font-size:0.66rem; color:#6ee7b7; margin-top:2px;">100% para el Gestor</div>
                            </div>
                            <div>
                                <label style="display:block; font-size:0.72rem; color:#cbd5e1; margin-bottom:3px;">Margen Inicial (%)</label>
                                <input type="number" id="abm-margen-default" step="0.5" value="28"
                                    style="width:100%; padding:7px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-weight:700; font-size:0.81rem; box-sizing:border-box;">
                            </div>
                        </div>

                        <!-- CAPACIDADES MODULARES DE ENTREGA DEL NODO (B2) -->
                        <div style="margin-bottom:10px; padding:10px 12px; border-radius:8px; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.28);">
                            <div style="font-size:0.74rem; font-weight:800; color:#bae6fd; margin-bottom:7px;">
                                🚚 Modalidades de Entrega Habilitadas para este Nodo (combinables)
                            </div>
                            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap:10px;">
                                <label style="display:flex; align-items:flex-start; gap:8px; padding:7px 9px; border-radius:7px; background:#0f172a; border:1px solid #334155; cursor:pointer; font-size:0.75rem; color:#f8fafc;">
                                    <input type="checkbox" id="abm-permitir-retiro" checked style="margin-top:2px; width:15px; height:15px; accent-color:#38bdf8; cursor:pointer;">
                                    <span>
                                        <strong>🏠 Retiro por el Nodo</strong>
                                        <span style="display:block; font-size:0.68rem; color:#94a3b8;">Vecino retira gratis en el punto del gestor</span>
                                    </span>
                                </label>
                                <label style="display:flex; align-items:flex-start; gap:8px; padding:7px 9px; border-radius:7px; background:#0f172a; border:1px solid #334155; cursor:pointer; font-size:0.75rem; color:#f8fafc;">
                                    <input type="checkbox" id="abm-permitir-reparto" checked onchange="window.NodosPizarra.alCambiarToggleRepartoAbm()" style="margin-top:2px; width:15px; height:15px; accent-color:#10b981; cursor:pointer;">
                                    <span>
                                        <strong>🚗 Reparto Propio a Domicilio</strong>
                                        <span style="display:block; font-size:0.68rem; color:#94a3b8;">Habilita envío barrial + Hoja de Ruta móvil</span>
                                    </span>
                                </label>
                                <label style="display:flex; align-items:flex-start; gap:8px; padding:7px 9px; border-radius:7px; background:#0f172a; border:1px dashed #475569; cursor:pointer; font-size:0.75rem; color:#cbd5e1;">
                                    <input type="checkbox" id="abm-permitir-encomienda" style="margin-top:2px; width:15px; height:15px; accent-color:#f59e0b; cursor:pointer;">
                                    <span>
                                        <strong>📦 Encomienda Nacional</strong>
                                        <span style="display:block; font-size:0.68rem; color:#fcd34d;">Previsión futura correo/paquetería (sin checkout aún)</span>
                                    </span>
                                </label>
                            </div>
                        </div>

                        <!-- PARÁMETRO TIENDA VECINAL: BOTÓN DE CONTENIDO / INGREDIENTES EN ARTÍCULOS ELABORADOS -->
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px; padding:9px 12px; border-radius:8px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.32);">
                            <label style="display:inline-flex; align-items:center; gap:8px; font-size:0.76rem; color:#e2e8f0; font-weight:700; cursor:pointer;">
                                <input type="checkbox" id="abm-mostrar-ingredientes-tienda" checked style="width:15px; height:15px; accent-color:#10b981; cursor:pointer;">
                                <span>🥣 Mostrar botón <strong>"¿Qué contiene?"</strong> (desglose limpio de ingredientes) en Mixes, Granolas y elaborados de la tienda vecinal</span>
                            </label>
                            <span style="font-size:0.68rem; color:#6ee7b7; font-weight:700;">100% Marca Blanca · Dinámico desde Recetas</span>
                        </div>

                        <!-- LOGO DEL NODO PARA PANTALLAS MÓVILES Y ETIQUETA TÉRMICA -->
                        <div style="padding:12px; border-radius:10px; background:#0f172a; border:1px solid #334155;">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:10px;">
                                <div>
                                    <div style="font-weight:800; font-size:0.86rem; color:#f8fafc;">🖼️ Logo del Nodo (Pantallas Móviles + Etiqueta Térmica)</div>
                                    <div style="font-size:0.73rem; color:#94a3b8;">Podés subir o reemplazar el logo en cualquier momento (se aplica en color en el celular y en blanco y negro en la etiqueta Zebra).</div>
                                </div>
                                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                                    <label style="padding:6px 11px; border-radius:6px; font-size:0.75rem; font-weight:700; background:rgba(56,189,248,0.16); border:1px solid #38bdf8; color:#bae6fd; cursor:pointer;">
                                        📂 Subir / Cambiar Logo
                                        <input type="file" id="abm-logo-file-input" accept="image/*" style="display:none;" onchange="window.NodosPizarra.subirArchivoLogo(event)">
                                    </label>
                                    <button type="button" onclick="window.NodosPizarra.quitarLogoImagenAbm()"
                                        style="padding:6px 10px; border-radius:6px; font-size:0.73rem; font-weight:700; background:rgba(248,113,113,0.12); border:1px solid rgba(248,113,113,0.4); color:#fca5a5; cursor:pointer;">
                                        🗑️ Usar Sello de Siglas
                                    </button>
                                    <button type="button" onclick="window.NodosPizarra.regenerarLogoZplEnVivo()"
                                        style="padding:6px 11px; border-radius:6px; font-size:0.75rem; font-weight:700; background:rgba(16,185,129,0.16); border:1px solid #10b981; color:#6ee7b7; cursor:pointer;">
                                        ⚡ Actualizar Vista
                                    </button>
                                </div>
                            </div>

                            <div style="display:grid; grid-template-columns: 356px 1fr; gap:14px; align-items:center;">
                                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
                                    <div style="display:flex; flex-direction:column; align-items:center; gap:5px; background:#1e293b; padding:8px; border-radius:8px; border:1px solid #475569;">
                                        <div style="font-size:0.66rem; color:#cbd5e1; font-weight:700;">LOGO EN CELULAR</div>
                                        <div style="width:154px; height:60px; background:#faf7f3; display:flex; align-items:center; justify-content:center; border-radius:6px; border:1px solid #cbd5e1; padding:4px; overflow:hidden;">
                                            <img id="abm-logo-color-preview-img" src="" alt="" style="max-width:100%; max-height:52px; object-fit:contain; display:none;">
                                            <span id="abm-logo-color-empty" style="font-size:0.68rem; color:#64748b; font-weight:700;">Sello automático</span>
                                        </div>
                                    </div>
                                    <div style="display:flex; flex-direction:column; align-items:center; gap:5px; background:#1e293b; padding:8px; border-radius:8px; border:1px solid #475569;">
                                        <div style="font-size:0.66rem; color:#cbd5e1; font-weight:700;">VISTA ETIQUETA</div>
                                        <div style="width:162px; height:60px; background:#ffffff; display:flex; align-items:center; justify-content:center; border:1px solid #000; padding:3px; overflow:hidden;">
                                            <img id="abm-logo-preview-img" src="" alt="Vista previa del logo" style="max-width:100%; max-height:54px; object-fit:contain; image-rendering:pixelated;">
                                        </div>
                                    </div>
                                </div>

                                <div style="display:grid; grid-template-columns: 130px 190px 1fr; gap:10px; align-items:center;">
                                    <div>
                                        <label style="display:block; font-size:0.7rem; color:#94a3b8; margin-bottom:3px;">Siglas del Sello</label>
                                        <input type="text" id="abm-logo-iniciales" maxlength="3" placeholder="AV" oninput="window.NodosPizarra.regenerarLogoZplEnVivo()"
                                            style="width:100%; padding:6px 8px; border-radius:5px; border:1px solid #334155; background:#151e2e; color:#f8fafc; font-weight:800;">
                                    </div>
                                    <div>
                                        <label style="display:block; font-size:0.7rem; color:#94a3b8; margin-bottom:3px;">Estilo de Impresión</label>
                                        <select id="abm-logo-mode" onchange="window.NodosPizarra.regenerarLogoZplEnVivo()"
                                            style="width:100%; padding:6px; border-radius:5px; border:1px solid #334155; background:#151e2e; color:#f8fafc; font-size:0.76rem;">
                                            <option value="threshold">Trazo Nítido (Alto Contraste)</option>
                                            <option value="dither">Sombreado Suave (Degradados)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style="display:block; font-size:0.7rem; color:#94a3b8; margin-bottom:3px;">Intensidad de Tinta Térmica (<span id="abm-threshold-val">138</span>)</label>
                                        <input type="range" id="abm-logo-threshold" min="40" max="220" value="138"
                                            oninput="document.getElementById('abm-threshold-val').textContent=this.value; window.NodosPizarra.regenerarLogoZplEnVivo()"
                                            style="width:100%;">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- PREVISUALIZADOR EN PANTALLA DE LA ETIQUETA TÉRMICA -->
                    <div class="card" style="padding:16px; background:#151e2e; border:1px solid rgba(56,189,248,0.4); border-radius:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
                            <div>
                                <div style="font-weight:800; font-size:0.94rem; color:#f8fafc;">
                                    🎫 Vista Previa de Etiqueta Térmica (Portada del Vecino + Checklist de Armado)
                                </div>
                                <div style="font-size:0.74rem; color:#94a3b8;">
                                    El peso de cada producto se preserva siempre visible al final y si hay más de 6 ítems se emite automáticamente una etiqueta de continuación.
                                </div>
                            </div>
                            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                <button type="button" onclick="window.NodosPizarra.simularEtiquetaZebra('estandar_pagado')"
                                    style="padding:6px 11px; border-radius:7px; font-size:0.75rem; font-weight:700; border:1px solid #10b981; background:rgba(16,185,129,0.16); color:#6ee7b7; cursor:pointer;">
                                    🖨️ Ver Ejemplo Pedido 4 Ítems (Pagado)
                                </button>
                                <button type="button" onclick="window.NodosPizarra.simularEtiquetaZebra('largo_continuacion')"
                                    style="padding:6px 11px; border-radius:7px; font-size:0.75rem; font-weight:700; border:1px solid #f59e0b; background:rgba(245,158,11,0.18); color:#fcd34d; cursor:pointer;">
                                    📑 Ver Ejemplo Pedido Largo 9 Ítems (2 Hojas)
                                </button>
                            </div>
                        </div>

                        <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:12px; text-align:center; overflow:auto;">
                            <img id="abm-rollo-preview-img" src="" alt="Vista Previa de Etiqueta Térmica" style="max-width:100%; height:auto; border-radius:6px;">
                        </div>

                        <!-- BLOQUE COLAPSABLE OPCIONAL PARA CÓDIGO TÉCNICO ZPL -->
                        <details style="margin-top:10px; background:#0b1120; border:1px solid #1e293b; border-radius:8px; padding:8px 12px;">
                            <summary style="cursor:pointer; font-size:0.76rem; color:#64748b; font-weight:700; user-select:none;">
                                🔧 Ver código técnico ZPL de impresora (opcional)
                            </summary>
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:8px;">
                                <div>
                                    <label style="display:block; font-size:0.7rem; color:#94a3b8; margin-bottom:3px;">Gráfico de Logo (^GFA):</label>
                                    <textarea id="abm-logo-zpl-gfa" readonly rows="4"
                                        style="width:100%; padding:6px; border-radius:6px; border:1px solid #334155; background:#090d16; color:#34d399; font-family:monospace; font-size:0.68rem; resize:vertical;"></textarea>
                                </div>
                                <div>
                                    <label style="display:block; font-size:0.7rem; color:#94a3b8; margin-bottom:3px;">Comandos de Impresión de Etiqueta:</label>
                                    <textarea id="abm-rollo-zpl-code" readonly rows="4"
                                        style="width:100%; padding:6px; border-radius:6px; border:1px solid #334155; background:#090d16; color:#38bdf8; font-family:monospace; font-size:0.68rem; resize:vertical;"></textarea>
                                </div>
                            </div>
                        </details>
                    </div>
                </div>
            </div>
        `;
    }

    // =========================================================================
    // ACCIONES INTERACTIVAS DEL MÓDULO (ARQUITECTURA DETERMINISTA POR CÓDIGO)
    // =========================================================================
    function seleccionarFlujoMesa(flujo) {
        ESTADO_NODOS.flujoSeleccionadoMesa = Number(flujo);
        ESTADO_NODOS.propuestaActivaId = null;
        ESTADO_NODOS.catalogoEditandoId = null;
        ESTADO_NODOS.anatomiaActualMesa = null;
        renderizarVistaNodosCompleta();
    }

    function obtenerIngredienteSeleccionadoMesa() {
        const selectEl = document.getElementById('cot-origen-select');
        if (!selectEl) return null;
        const val = String(selectEl.value || '');
        if (!val || val.startsWith('ART:')) return null;
        const ingId = Number(val);
        if (!ingId) return null;
        return (ESTADO_NODOS.fuentes.ingredientes_por_flujo || []).find(i => Number(i.id) === ingId) || null;
    }

    function renderizarCadenaRelacionalMesa(anat = null) {
        const box = document.getElementById('cot-cadena-relacional-box');
        if (!box) return;

        const selectEl = document.getElementById('cot-origen-select');
        const val = String(selectEl?.value || '');
        if (!val) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }

        if (val.startsWith('ART:')) {
            const skuBulto = val.replace('ART:', '');
            const artObj = (ESTADO_NODOS.fuentes.articulos_bulto_flujo1 || []).find(a => String(a.id) === skuBulto);
            box.style.display = 'block';
            box.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                    <span>📦 <strong>Bulto Cerrado Directo (Flujo 1):</strong> <code style="color:#6ee7b7; font-weight:800;">${escaparHtml(artObj?.label_oficial || `[${skuBulto}]`)}</code></span>
                    <span style="color:#38bdf8; font-weight:800;">Costo base: ${fmtMoneda(artObj?.costo_kg || 0)}/kg</span>
                </div>
            `;
            return;
        }

        const ing = obtenerIngredienteSeleccionadoMesa();
        const ingId = ing?.id || anat?.ingrediente_comercial_id || anat?.ingrediente_id || Number(val);
        const ingCodigo = anat?.ingrediente_comercial_codigo || anat?.ingrediente_codigo || ing?.codigo || ingId;
        const ingNombre = anat?.ingrediente_comercial_nombre || anat?.ingrediente_nombre || ing?.nombre_oficial || ing?.nombre || '';
        const puente = anat?.articulo_vinculado_numero || anat?.articulo_puente_numero || ing?.articulo_vinculado_numero || '';
        const costoVivo = Number(document.getElementById('cot-costo-kg')?.value || ing?.costo_kg || 0);
        const mixPadre = anat?.mix_padre || ing?.mix_padre || null;

        box.style.display = 'block';
        box.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:4px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                    <span>
                        🧬 <strong>Insumo Base Granel:</strong>
                        <code style="color:#38bdf8; font-weight:800;">#${escaparHtml(ingId)} [${escaparHtml(ingCodigo)}] ${escaparHtml(ingNombre)}</code>
                    </span>
                    <span style="display:inline-flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        ${puente
                            ? `<span style="background:rgba(167,139,250,0.18); border:1px solid rgba(167,139,250,0.45); color:#ddd6fe; padding:1px 7px; border-radius:4px; font-family:monospace; font-weight:800; font-size:0.71rem;">🔗 Puente: ${escaparHtml(puente)}</span>`
                            : `<span style="color:#94a3b8; font-size:0.7rem;">Sin puente granel</span>`}
                        <strong style="color:#34d399;">${fmtMoneda(costoVivo)}/kg vivo</strong>
                    </span>
                </div>
                ${mixPadre ? `
                    <div style="padding-top:4px; border-top:1px dashed rgba(56,189,248,0.28); color:#bae6fd; display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                        <span>
                            🥣 <strong>Receta Padre Flujo 3 (vía puente <code>${escaparHtml(puente)}</code>):</strong>
                            <code style="color:#fcd34d; font-weight:800;">${escaparHtml(mixPadre.label_oficial || `#${mixPadre.ingrediente_mix_id} [${mixPadre.ingrediente_mix_codigo}] ${mixPadre.ingrediente_mix_nombre}`)}</code>
                        </span>
                        <span style="font-size:0.7rem; color:#94a3b8;">Receta #${escaparHtml(mixPadre.receta_id)} · Rendimiento: ${Number(mixPadre.receta_rendimiento_kg || 0)} kg</span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    async function cargarDiccionarioBunkerCasoB(familiaId = null, articuloPrincipalId = null) {
        const famTarget = familiaId || ESTADO_NODOS.casoBSeleccion.familia_id || 1;
        const princTarget = articuloPrincipalId !== undefined
            ? articuloPrincipalId
            : ESTADO_NODOS.casoBSeleccion.articulo_principal_id;

        const qs = new URLSearchParams();
        if (famTarget) qs.set('familia_id', String(famTarget));
        if (princTarget) qs.set('articulo_principal_id', String(princTarget));

        const resp = await fetch(`/api/produccion/nodos/diccionario-bunker?${qs.toString()}`);
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
            throw new Error(data.error || 'No se pudo cargar el Diccionario Oficial Búnker');
        }
        ESTADO_NODOS.diccionarioBunkerActual = data;
        ESTADO_NODOS.casoBSeleccion.familia_id = Number(data.familia_activa_id || famTarget);
        ESTADO_NODOS.casoBSeleccion.articulo_principal_id = data.articulo_principal_activo_id ? Number(data.articulo_principal_activo_id) : null;
        if (!ESTADO_NODOS.casoBSeleccion.rubro && Array.isArray(data.rubros) && data.rubros.length > 0) {
            ESTADO_NODOS.casoBSeleccion.rubro = data.rubros[0].rubro || data.rubros[0].nombre || '';
        }
        return data;
    }

    function esModoCasoBAnatomia(anat) {
        return Boolean(
            anat && (
                anat.modo_resolucion === 'CASO_B_DICCIONARIO' ||
                anat.modo_resolucion === 'CASO_B_PENDIENTE' ||
                anat.requiere_diccionario_bunker ||
                (!anat.tiene_hermano_bunker && !anat.existe_en_bunker)
            )
        );
    }

    function construirPosicionesSeleccionadasCasoB() {
        const posMap = ESTADO_NODOS.casoBSeleccion?.posiciones || {};
        return Object.values(posMap)
            .filter(v => v && Number(v.categoria_id) > 0 && Number(v.termino_id) > 0)
            .map(v => ({
                categoria_id: Number(v.categoria_id),
                termino_id: Number(v.termino_id),
                modo_display: v.modo_display || 'COMPLETO',
                silencioso: Boolean(v.silencioso)
            }));
    }

    function renderizarPanelDiccionarioCasoB(anat = null) {
        const panel = document.getElementById('cot-caso-b-diccionario-panel');
        if (!panel) return;

        if (!esModoCasoBAnatomia(anat)) {
            panel.style.display = 'none';
            panel.innerHTML = '';
            return;
        }

        const dic = ESTADO_NODOS.diccionarioBunkerActual;
        if (!dic) {
            panel.style.display = 'block';
            panel.innerHTML = `<div style="font-size:0.75rem; color:#fcd34d;">⏳ Cargando selectores relacionales del Diccionario Oficial Búnker...</div>`;
            return;
        }

        const sel = ESTADO_NODOS.casoBSeleccion;
        const kilos = Math.max(0.001, Number(document.getElementById('cot-kilos-unidad')?.value || 0.25));
        const etiquetaPeso = kilos >= 1
            ? `${kilos.toFixed(kilos % 1 === 0 ? 0 : 2).replace(/\.00$/, '')}kg`
            : `${Math.round(kilos * 1000)}g`;

        const familiasOpts = (dic.familias || []).map(f =>
            `<option value="${f.id}" ${Number(sel.familia_id) === Number(f.id) ? 'selected' : ''}>#${f.id} ${escaparHtml(f.nombre)}${f.abreviatura ? ` (${escaparHtml(f.abreviatura)})` : ''}</option>`
        ).join('');

        const listaPrincipales = dic.articulos_principales || dic.principales || [];
        const principalesOpts = [
            `<option value="">— Seleccionar Sustantivo Ancla (bunker_diccionario) —</option>`,
            ...listaPrincipales.map(p =>
                `<option value="${p.id}" ${Number(sel.articulo_principal_id) === Number(p.id) ? 'selected' : ''}>#${p.id} ${escaparHtml(p.termino)}${p.abreviatura ? ` [${escaparHtml(p.abreviatura)}]` : ''}</option>`
            )
        ].join('');

        const categoriasHtml = (dic.categorias_familia || []).map(cat => {
            const ordenNum = Number(cat.orden_posicional || cat.orden_posicion || 1);
            const slotKey = `pos_${ordenNum}`;
            const nombreCat = String(cat.categoria || cat.nombre_categoria || '').trim();
            const esSlotPeso = /GRAMAJE|PRESENTAC|PESO|FRACCION|ENVASE|UNIDAD/i.test(nombreCat);
            const terminosCat = Array.isArray(cat.terminos) ? cat.terminos : [];
            const valorActual = sel.posiciones?.[slotKey]?.termino_id || '';

            const optsTerminos = [
                esSlotPeso
                    ? `<option value="">⚡ Automático por peso cotizado (x ${escaparHtml(etiquetaPeso)})</option>`
                    : `<option value="">— Sin atributo en pos_${ordenNum} —</option>`,
                ...terminosCat.map(t =>
                    `<option value="${t.id}" ${Number(valorActual) === Number(t.id) ? 'selected' : ''}>#${t.id} ${escaparHtml(t.termino)}${t.abreviatura ? ` [${escaparHtml(t.abreviatura)}]` : ''}</option>`
                )
            ].join('');

            return `
                <div>
                    <label style="display:block; font-size:0.69rem; color:#fcd34d; font-weight:700; margin-bottom:2px;">
                        Pos ${ordenNum} · ${escaparHtml(nombreCat)}:
                    </label>
                    <select onchange="window.NodosPizarra.alCambiarSelectorDiccionarioCasoB('${slotKey}', this.value, ${Number(cat.id)})"
                        style="width:100%; padding:5px 7px; border-radius:6px; border:1px solid rgba(245,158,11,0.45); background:#0f172a; color:#f8fafc; font-size:0.75rem;">
                        ${optsTerminos}
                    </select>
                </div>
            `;
        }).join('');

        const rubrosOpts = [
            `<option value="">— Seleccionar Rubro Oficial —</option>`,
            ...(dic.rubros || []).map(r => {
                const nomRubro = r.rubro || r.nombre || '';
                return `<option value="${escaparHtml(nomRubro)}" ${String(sel.rubro || '').toUpperCase() === String(nomRubro).toUpperCase() ? 'selected' : ''}>${escaparHtml(nomRubro)}</option>`;
            })
        ].join('');

        const rubroObjActivo = (dic.rubros || []).find(r => String(r.rubro || r.nombre || '').toUpperCase() === String(sel.rubro || '').toUpperCase());
        const subrubrosLista = Array.isArray(rubroObjActivo?.subrubros) ? rubroObjActivo.subrubros : [];
        const subrubrosOpts = [
            `<option value="">— Sin Sub-Rubro / Opcional —</option>`,
            ...subrubrosLista.map(sr => {
                const nomSub = typeof sr === 'string' ? sr : (sr.nombre || '');
                return `<option value="${escaparHtml(nomSub)}" ${String(sel.sub_rubro || '').toUpperCase() === String(nomSub).toUpperCase() ? 'selected' : ''}>${escaparHtml(nomSub)}</option>`;
            })
        ].join('');

        panel.style.display = 'block';
        panel.innerHTML = `
            <div style="font-size:0.76rem; font-weight:800; color:#fcd34d; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                <span>🧬 Caso B (Sin hermano previo en Búnker): Construcción Relacional Obligatoria por Diccionario Oficial</span>
                <span style="font-size:0.68rem; color:#fde68a; font-weight:600;">Cero texto libre · IDs primarios Búnker</span>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:8px;">
                <div>
                    <label style="display:block; font-size:0.69rem; color:#cbd5e1; margin-bottom:2px;">1. Familia Búnker (<code>bunker_familias</code>):</label>
                    <select onchange="window.NodosPizarra.alCambiarSelectorDiccionarioCasoB('familia_id', this.value)"
                        style="width:100%; padding:5px 7px; border-radius:6px; border:1px solid #f59e0b; background:#0f172a; color:#fff; font-size:0.76rem;">
                        ${familiasOpts}
                    </select>
                    <label style="display:inline-flex; align-items:center; gap:5px; font-size:0.68rem; color:#cbd5e1; margin-top:4px; cursor:pointer;">
                        <input type="checkbox" ${sel.incluir_familia ? 'checked' : ''}
                            onchange="window.NodosPizarra.alCambiarSelectorDiccionarioCasoB('incluir_familia', this.checked)">
                        Incluir abreviatura de familia en descripción
                    </label>
                </div>
                <div>
                    <label style="display:block; font-size:0.69rem; color:#cbd5e1; margin-bottom:2px;">2. Sustantivo Ancla (<code>articulo_principal_id</code>):</label>
                    <select onchange="window.NodosPizarra.alCambiarSelectorDiccionarioCasoB('articulo_principal_id', this.value)"
                        style="width:100%; padding:5px 7px; border-radius:6px; border:1px solid #f59e0b; background:#0f172a; color:#fff; font-size:0.76rem;">
                        ${principalesOpts}
                    </select>
                    <label style="display:inline-flex; align-items:center; gap:5px; font-size:0.68rem; color:#cbd5e1; margin-top:4px; cursor:pointer;">
                        <input type="checkbox" ${sel.silencioso_principal ? 'checked' : ''}
                            onchange="window.NodosPizarra.alCambiarSelectorDiccionarioCasoB('silencioso_principal', this.checked)">
                        Sustantivo silencioso
                    </label>
                </div>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap:8px; margin-bottom:8px;">
                ${categoriasHtml}
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
                <div>
                    <label style="display:block; font-size:0.69rem; color:#cbd5e1; margin-bottom:2px;">Rubro Oficial (<code>bunker_rubros</code>):</label>
                    <select onchange="window.NodosPizarra.alCambiarSelectorDiccionarioCasoB('rubro', this.value)"
                        style="width:100%; padding:5px 7px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#fff; font-size:0.76rem;">
                        ${rubrosOpts}
                    </select>
                </div>
                <div>
                    <label style="display:block; font-size:0.69rem; color:#cbd5e1; margin-bottom:2px;">Sub-Rubro Oficial (<code>bunker_subrubros</code>):</label>
                    <select onchange="window.NodosPizarra.alCambiarSelectorDiccionarioCasoB('sub_rubro', this.value)"
                        style="width:100%; padding:5px 7px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#fff; font-size:0.76rem;">
                        ${subrubrosOpts}
                    </select>
                </div>
            </div>
        `;
    }

    async function alCambiarSelectorDiccionarioCasoB(campo, valor, categoriaId = null) {
        const sel = ESTADO_NODOS.casoBSeleccion;
        if (campo === 'familia_id') {
            sel.familia_id = Number(valor) || 1;
            sel.posiciones = {};
            await cargarDiccionarioBunkerCasoB(sel.familia_id, sel.articulo_principal_id);
        } else if (campo === 'articulo_principal_id') {
            sel.articulo_principal_id = valor ? Number(valor) : null;
            sel.posiciones = {};
            await cargarDiccionarioBunkerCasoB(sel.familia_id, sel.articulo_principal_id);
        } else if (campo === 'incluir_familia') {
            sel.incluir_familia = Boolean(valor);
        } else if (campo === 'silencioso_principal') {
            sel.silencioso_principal = Boolean(valor);
        } else if (campo === 'rubro') {
            sel.rubro = String(valor || '');
            sel.sub_rubro = '';
        } else if (campo === 'sub_rubro') {
            sel.sub_rubro = String(valor || '');
        } else if (campo.startsWith('pos_')) {
            if (!sel.posiciones) sel.posiciones = {};
            if (valor) {
                sel.posiciones[campo] = {
                    categoria_id: Number(categoriaId || 0),
                    termino_id: Number(valor),
                    modo_display: 'COMPLETO'
                };
            } else {
                delete sel.posiciones[campo];
            }
        }
        await sincronizarAnatomiaMesaConBackend({ desdeCasoB: true });
    }

    async function sincronizarAnatomiaMesaConBackend(opciones = {}) {
        const selectEl = document.getElementById('cot-origen-select');
        const kilosEl = document.getElementById('cot-kilos-unidad');
        renderizarCadenaRelacionalMesa(ESTADO_NODOS.anatomiaActualMesa);

        if (!selectEl || String(selectEl.value || '').startsWith('ART:')) {
            ESTADO_NODOS.anatomiaActualMesa = null;
            renderizarPanelDiccionarioCasoB(null);
            return;
        }

        const ingId = Number(selectEl.value || 0);
        if (!ingId) return;
        const kilos = Math.max(0.001, Number(kilosEl?.value) || 0.25);

        try {
            const selCasoB = ESTADO_NODOS.casoBSeleccion || {};
            const bodyReq = {
                ingrediente_origen_id: ingId,
                kilos_unidad: kilos,
                flujo_lamda: ESTADO_NODOS.flujoSeleccionadoMesa
            };
            if (opciones.desdeCasoB || esModoCasoBAnatomia(ESTADO_NODOS.anatomiaActualMesa)) {
                if (selCasoB.familia_id) {
                    bodyReq.familia_bunker_id = selCasoB.familia_id;
                    bodyReq.familia_id = selCasoB.familia_id;
                }
                bodyReq.incluir_familia = Boolean(selCasoB.incluir_familia);
                bodyReq.modo_display_familia = selCasoB.modo_display_familia || 'ABREVIADO';
                if (selCasoB.articulo_principal_id) bodyReq.articulo_principal_id = selCasoB.articulo_principal_id;
                bodyReq.silencioso_principal = Boolean(selCasoB.silencioso_principal);
                bodyReq.modo_display_principal = selCasoB.modo_display_principal || 'COMPLETO';
                bodyReq.posiciones_seleccionadas = construirPosicionesSeleccionadasCasoB();
                bodyReq.posiciones = selCasoB.posiciones || {};
                if (selCasoB.rubro) {
                    bodyReq.rubro_bunker = selCasoB.rubro;
                    bodyReq.rubro = selCasoB.rubro;
                }
                if (selCasoB.sub_rubro) {
                    bodyReq.sub_rubro_bunker = selCasoB.sub_rubro;
                    bodyReq.sub_rubro = selCasoB.sub_rubro;
                }
            }

            const resp = await fetch('/api/produccion/nodos/previsualizar-anatomia', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyReq)
            });
            const data = await resp.json();
            if (!resp.ok || !data.ok || !data.anatomia) return;
            const anat = data.anatomia;
            ESTADO_NODOS.anatomiaActualMesa = anat;

            renderizarCadenaRelacionalMesa(anat);

            if (esModoCasoBAnatomia(anat)) {
                if (!ESTADO_NODOS.diccionarioBunkerActual) {
                    await cargarDiccionarioBunkerCasoB(anat.familia_id || 1, anat.articulo_principal_id || null);
                }
                renderizarPanelDiccionarioCasoB(anat);
            } else {
                renderizarPanelDiccionarioCasoB(null);
            }

            const skuEl = document.getElementById('cot-sku-nodo');
            const bunkerNomEl = document.getElementById('cot-bunker-nomenclatura');
            const catEl = document.getElementById('cot-categoria');
            const envEl = document.getElementById('cot-envase-select');
            const badgeEl = document.getElementById('cot-bunker-receta-badge');

            if (skuEl && anat.sku_nativo && !ESTADO_NODOS.catalogoEditandoId) {
                skuEl.value = anat.sku_nativo;
            }
            if (bunkerNomEl) {
                bunkerNomEl.value = anat.nomenclatura_bunker || '';
            }
            if (catEl) {
                const rubroTxt = anat.rubro ? `${anat.rubro}${anat.sub_rubro ? ` / ${anat.sub_rubro}` : ''}` : (anat.familia_nombre || 'Frutos Secos');
                catEl.value = rubroTxt;
            }
            if (envEl && anat.insumo_envase_id && !ESTADO_NODOS.catalogoEditandoId && !opciones.desdeCasoB) {
                envEl.value = String(anat.insumo_envase_id);
            }
            if (anat.segundos_nativos && !ESTADO_NODOS.catalogoEditandoId && !opciones.desdeCasoB) {
                fijarSegundosEnMesa(anat.segundos_nativos, true);
            }
            if (badgeEl) {
                const envIdActivo = Number(envEl?.value || anat.insumo_envase_id || 0);
                const envObj = (ESTADO_NODOS.fuentes.envases || []).find(e => Number(e.id) === envIdActivo);
                const nombreBolsa = envObj ? (envObj.label_oficial || `#${envObj.id} [${envObj.codigo}] ${envObj.nombre}`) : `Envase #${envIdActivo || ''}`;
                badgeEl.style.display = 'block';
                if (anat.existe_en_bunker) {
                    badgeEl.style.background = 'rgba(16,185,129,0.14)';
                    badgeEl.style.border = '1px solid rgba(16,185,129,0.45)';
                    badgeEl.style.color = '#6ee7b7';
                    badgeEl.innerHTML = `✅ <strong>Caso 0 (Artículo y Receta existentes en Búnker):</strong> <code>[${escaparHtml(anat.sku_nativo)}] ${escaparHtml(anat.nomenclatura_bunker)}</code> · Envase real: <strong>${escaparHtml(nombreBolsa)}</strong>`;
                } else if (anat.modo_resolucion === 'CASO_A_HERMANO') {
                    badgeEl.style.background = 'rgba(56,189,248,0.12)';
                    badgeEl.style.border = '1px solid rgba(56,189,248,0.40)';
                    badgeEl.style.color = '#bae6fd';
                    badgeEl.innerHTML = `🧬 <strong>Caso A (Clonado determinista de hermano Búnker <code>${escaparHtml(anat.hermano_origen_sku || '')}</code>):</strong> <code>[${escaparHtml(anat.sku_nativo)}] ${escaparHtml(anat.nomenclatura_bunker)}</code> · Familia <strong>${escaparHtml(anat.familia_nombre || '')}</strong> (${escaparHtml(anat.rubro || '')}${anat.sub_rubro ? `/${escaparHtml(anat.sub_rubro)}` : ''}) · Bolsa: <strong>${escaparHtml(nombreBolsa)}</strong>`;
                } else {
                    badgeEl.style.background = 'rgba(245,158,11,0.14)';
                    badgeEl.style.border = '1px solid rgba(245,158,11,0.45)';
                    badgeEl.style.color = '#fde68a';
                    badgeEl.innerHTML = anat.nomenclatura_bunker
                        ? `🏛️ <strong>Caso B (Ensamblado por Diccionario Búnker):</strong> <code>[${escaparHtml(anat.sku_nativo)}] ${escaparHtml(anat.nomenclatura_bunker)}</code> · Bolsa: <strong>${escaparHtml(nombreBolsa)}</strong>`
                        : `⚠️ <strong>Caso B:</strong> Seleccione el Sustantivo Ancla y atributos del Diccionario Oficial Búnker arriba para construir el SKU y la descripción oficial.`;
                }
            }

            recalcularMesaCotizacionEnVivo();
        } catch (err) {
            console.warn('[NodosPizarra] No se pudo previsualizar anatomía:', err);
        }
    }

    function alCambiarKilosUnidadMesa() {
        const kilos = Number(document.getElementById('cot-kilos-unidad')?.value || 0.25);
        if (kilos > 0) {
            sincronizarAnatomiaMesaConBackend();
        }
        recalcularMesaCotizacionEnVivo();
    }

    function alCambiarOrigenSelect() {
        const selectEl = document.getElementById('cot-origen-select');
        const costoEl = document.getElementById('cot-costo-kg');
        const bunkerNomEl = document.getElementById('cot-bunker-nomenclatura');
        const skuEl = document.getElementById('cot-sku-nodo');
        const catEl = document.getElementById('cot-categoria');
        if (!selectEl || !costoEl) return;

        ESTADO_NODOS.anatomiaActualMesa = null;
        const opt = selectEl.selectedOptions?.[0];
        if (opt) {
            const costo = Number(opt.getAttribute('data-costo') || 0);
            const catSugerida = opt.getAttribute('data-categoria') || '';
            costoEl.value = costo.toFixed(2);
            if (catEl && catSugerida) {
                catEl.value = catSugerida;
            }
            if (String(selectEl.value || '').startsWith('ART:')) {
                const skuBulto = String(selectEl.value).replace('ART:', '');
                const artObj = (ESTADO_NODOS.fuentes.articulos_bulto_flujo1 || []).find(a => String(a.id) === skuBulto);
                if (skuEl && !ESTADO_NODOS.catalogoEditandoId) skuEl.value = skuBulto;
                if (bunkerNomEl) bunkerNomEl.value = artObj?.nombre || opt.getAttribute('data-nombre') || skuBulto;
                renderizarCadenaRelacionalMesa(null);
                renderizarPanelDiccionarioCasoB(null);
            } else {
                sincronizarAnatomiaMesaConBackend();
            }
        }
        recalcularMesaCotizacionEnVivo();
    }

    function fijarGramajeRapido(kilos) {
        const kilosEl = document.getElementById('cot-kilos-unidad');
        if (kilosEl) {
            kilosEl.value = Number(kilos).toFixed(2);
        }
        sincronizarAnatomiaMesaConBackend();
        recalcularMesaCotizacionEnVivo();
    }

    function cargarIngredienteDirectoEnMesa(ingId) {
        const item = ESTADO_NODOS.fuentes.ingredientes_por_flujo.find(i => Number(i.id) === Number(ingId));
        if (!item) return;

        ESTADO_NODOS.subTabActiva = 'cotizador';
        ESTADO_NODOS.propuestaActivaId = null;
        ESTADO_NODOS.catalogoEditandoId = null;
        ESTADO_NODOS.anatomiaActualMesa = null;
        ESTADO_NODOS.flujoSeleccionadoMesa = Number(item.flujo || 2);
        ESTADO_NODOS.omitirAutoOrigenInicial = true;
        renderizarVistaNodosCompleta();
        ESTADO_NODOS.omitirAutoOrigenInicial = false;

        const selectEl = document.getElementById('cot-origen-select');
        const costoEl = document.getElementById('cot-costo-kg');
        const catEl = document.getElementById('cot-categoria');

        if (selectEl) selectEl.value = String(item.id);
        const costoVivo = obtenerCostoVivoIngredientePizarra(item.id, item.costo_kg);
        if (costoEl) costoEl.value = costoVivo.toFixed(2);
        if (catEl && (item.categoria_lamda || item.categoria_gestor)) {
            catEl.value = item.categoria_lamda || item.categoria_gestor;
        }
        sincronizarAnatomiaMesaConBackend();
        recalcularMesaCotizacionEnVivo();
    }

    async function cargarPresentacionPlantaEnMesa(ingId, kilosUnidad) {
        const item = ESTADO_NODOS.fuentes.ingredientes_por_flujo.find(i => Number(i.id) === Number(ingId));
        const pres = (ESTADO_NODOS.presentaciones_planta_disponibles || []).find(
            p => Number(p.ingrediente_id) === Number(ingId) && Math.abs(Number(p.kilos_unidad) - Number(kilosUnidad)) < 0.002
        );
        const flujoTarget = Number(item?.flujo || pres?.flujo || 2);
        const kilosNum = Number(kilosUnidad) || 0.25;

        ESTADO_NODOS.subTabActiva = 'cotizador';
        ESTADO_NODOS.propuestaActivaId = null;
        ESTADO_NODOS.catalogoEditandoId = null;
        ESTADO_NODOS.anatomiaActualMesa = null;
        ESTADO_NODOS.flujoSeleccionadoMesa = flujoTarget;
        ESTADO_NODOS.omitirAutoOrigenInicial = true;
        renderizarVistaNodosCompleta();
        ESTADO_NODOS.omitirAutoOrigenInicial = false;

        const selectEl = document.getElementById('cot-origen-select');
        const costoEl = document.getElementById('cot-costo-kg');
        const kilosEl = document.getElementById('cot-kilos-unidad');
        const bunkerNomEl = document.getElementById('cot-bunker-nomenclatura');
        const skuEl = document.getElementById('cot-sku-nodo');
        const catEl = document.getElementById('cot-categoria');
        const compMayEl = document.getElementById('cot-compartido-mayorista');
        const titEl = document.getElementById('mesa-cotizacion-titulo');
        const subEl = document.getElementById('mesa-cotizacion-subtitulo');

        if (selectEl) selectEl.value = String(ingId);
        const costoVivo = obtenerCostoVivoIngredientePizarra(ingId, item?.costo_kg || pres?.costo_insumo_kg || 0);
        if (costoEl) costoEl.value = costoVivo.toFixed(2);
        if (kilosEl) kilosEl.value = kilosNum.toFixed(2);
        if (bunkerNomEl && pres?.descripcion_generada) bunkerNomEl.value = pres.descripcion_generada;
        if (skuEl && pres?.articulo_id) skuEl.value = pres.articulo_id;
        if (catEl && (pres?.categoria_lamda || pres?.categoria_gestor || item?.categoria_lamda)) {
            catEl.value = pres?.categoria_lamda || pres?.categoria_gestor || item?.categoria_lamda;
        }
        if (compMayEl) compMayEl.value = 'true';

        if (titEl && pres) {
            titEl.innerHTML = `🏭 Habilitando Presentación Existente de Planta (<code>[${escaparHtml(pres.articulo_id)}]</code>)`;
        }
        if (subEl && pres) {
            subEl.innerHTML = `Reutiliza artículo y receta oficial del Búnker: <strong style="color:#f8fafc;">[${escaparHtml(pres.articulo_id)}] ${escaparHtml(pres.descripcion_generada)}</strong>${pres.precio_ref_mayorista ? ` · Ref. Mayorista: <strong style="color:#fcd34d;">${fmtMoneda(pres.precio_ref_mayorista)}</strong>` : ''}`;
        }

        recalcularMesaCotizacionEnVivo();
        await sincronizarAnatomiaMesaConBackend();
    }

    async function cargarPropuestaEnMesa(propuestaId) {
        const prop = ESTADO_NODOS.propuestas.find(p => Number(p.id) === Number(propuestaId));
        if (!prop) return;

        const itemIng = prop.ingrediente_sugerido_id
            ? ESTADO_NODOS.fuentes.ingredientes_por_flujo.find(i => Number(i.id) === Number(prop.ingrediente_sugerido_id))
            : null;

        ESTADO_NODOS.subTabActiva = 'cotizador';
        ESTADO_NODOS.propuestaActivaId = Number(prop.id);
        ESTADO_NODOS.catalogoEditandoId = prop.articulo_catalogo_id ? Number(prop.articulo_catalogo_id) : null;
        ESTADO_NODOS.anatomiaActualMesa = null;
        ESTADO_NODOS.flujoSeleccionadoMesa = Number(itemIng?.flujo || prop.flujo_sugerido || 2);
        ESTADO_NODOS.omitirAutoOrigenInicial = true;

        renderizarVistaNodosCompleta();
        ESTADO_NODOS.omitirAutoOrigenInicial = false;

        const selectEl = document.getElementById('cot-origen-select');
        const costoEl = document.getElementById('cot-costo-kg');
        const kilosEl = document.getElementById('cot-kilos-unidad');
        const catEl = document.getElementById('cot-categoria');
        const envEl = document.getElementById('cot-envase-select');
        const aliasVidEl = document.getElementById('cot-alias-vidriera-nodo');
        const titEl = document.getElementById('mesa-cotizacion-titulo');
        const subEl = document.getElementById('mesa-cotizacion-subtitulo');

        const ingLabelProp = prop.ingrediente_label_oficial || (itemIng ? itemIng.label_oficial : prop.nombre_sugerido);
        const aliasInfo = prop.alias_vidriera_sugerido
            ? ` · Alias vidriera del Nodo (informativo): <span style="color:#38bdf8;">"${escaparHtml(prop.alias_vidriera_sugerido)}"</span>`
            : '';

        if (titEl) titEl.innerHTML = `🧮 Cotizando Solicitud ${escaparHtml(prop.codigo_propuesta)} (${escaparHtml(prop.nodo_solicitante_nombre || 'Nodo')})`;
        if (subEl) subEl.innerHTML = `Insumo LAMDA solicitado: <strong style="color:#f8fafc;">${escaparHtml(ingLabelProp)}</strong> · Fracción: <strong style="color:#6ee7b7;">${Math.round(Number(prop.kilos_sugeridos || 0.25) * 1000)}g</strong>${aliasInfo}`;
        if (aliasVidEl) aliasVidEl.value = prop.alias_vidriera_sugerido || '';

        if (prop.ingrediente_sugerido_id && selectEl) {
            selectEl.value = String(prop.ingrediente_sugerido_id);
        }
        const costoVivo = prop.ingrediente_sugerido_id
            ? obtenerCostoVivoIngredientePizarra(prop.ingrediente_sugerido_id, prop.ingrediente_sugerido_costo_kg)
            : Number(prop.ingrediente_sugerido_costo_kg || 10000);

        const kilosSug = Number(prop.kilos_sugeridos || 0.25);

        if (costoEl) costoEl.value = costoVivo.toFixed(2);
        if (kilosEl) kilosEl.value = kilosSug.toFixed(2);
        if (catEl) catEl.value = prop.categoria_sugerida || itemIng?.categoria_lamda || itemIng?.categoria_gestor || 'FRUTOS SECOS';
        if (envEl && prop.insumo_envase_sugerido_id) envEl.value = String(prop.insumo_envase_sugerido_id);
        if (prop.segundos_estimados) fijarSegundosEnMesa(prop.segundos_estimados, true);

        recalcularMesaCotizacionEnVivo();
        await sincronizarAnatomiaMesaConBackend();
    }

    function editarArticuloCatalogoEnMesa(catalogoId) {
        const cat = ESTADO_NODOS.catalogo.find(c => Number(c.id) === Number(catalogoId));
        if (!cat) return;

        ESTADO_NODOS.subTabActiva = 'cotizador';
        ESTADO_NODOS.catalogoEditandoId = Number(cat.id);
        ESTADO_NODOS.propuestaActivaId = null;
        ESTADO_NODOS.anatomiaActualMesa = null;
        ESTADO_NODOS.flujoSeleccionadoMesa = Number(cat.flujo_lamda || 2);
        ESTADO_NODOS.omitirAutoOrigenInicial = true;

        renderizarVistaNodosCompleta();
        ESTADO_NODOS.omitirAutoOrigenInicial = false;

        const selectEl = document.getElementById('cot-origen-select');
        const costoEl = document.getElementById('cot-costo-kg');
        const kilosEl = document.getElementById('cot-kilos-unidad');
        const bunkerNomEl = document.getElementById('cot-bunker-nomenclatura');
        const compMayEl = document.getElementById('cot-compartido-mayorista');
        const skuEl = document.getElementById('cot-sku-nodo');
        const catEl = document.getElementById('cot-categoria');
        const envEl = document.getElementById('cot-envase-select');
        const margenL = document.getElementById('cot-margen-lamda');
        const iibbEl = document.getElementById('cot-iibb-pct');
        const margenG = document.getElementById('cot-margen-gestor');
        const notasEl = document.getElementById('cot-notas-tecnicas');

        if (cat.ingrediente_origen_id && selectEl) selectEl.value = String(cat.ingrediente_origen_id);
        if (costoEl) costoEl.value = Number(cat.costo_insumo_kg_vivo || cat.costo_insumo_kg).toFixed(2);
        if (kilosEl) kilosEl.value = Number(cat.kilos_unidad).toFixed(2);
        if (bunkerNomEl) bunkerNomEl.value = cat.bunker_descripcion_generada || cat.nombre_publico || '';
        if (compMayEl) compMayEl.value = Boolean(cat.compartido_mayorista) ? 'true' : 'false';
        if (skuEl) skuEl.value = cat.sku_nodo;
        if (catEl) catEl.value = cat.bunker_rubro ? `${cat.bunker_rubro}${cat.bunker_sub_rubro ? ` / ${cat.bunker_sub_rubro}` : ''}` : (cat.categoria_familiar || 'FRUTOS SECOS');
        if (envEl && cat.insumo_envase_id) envEl.value = String(cat.insumo_envase_id);
        fijarSegundosEnMesa(cat.segundos_fraccionamiento || 35, true);
        if (margenL) margenL.value = Number(cat.margen_lamda_pct || 22);
        if (iibbEl) iibbEl.value = Number(cat.iibb_pct || 4);
        if (margenG) margenG.value = Number(cat.margen_sugerido_gestor_pct || 28);
        if (notasEl) notasEl.value = cat.notas_tecnicas || '';

        renderizarCadenaRelacionalMesa(null);
        recalcularMesaCotizacionEnVivo();
    }

    function limpiarMesaCotizacion() {
        ESTADO_NODOS.propuestaActivaId = null;
        ESTADO_NODOS.catalogoEditandoId = null;
        ESTADO_NODOS.anatomiaActualMesa = null;
        ESTADO_NODOS.unidadTiempoMesa = 'seg';
        renderizarVistaNodosCompleta();
    }

    async function descartarPropuestaAdmin(propuestaId) {
        const prop = (ESTADO_NODOS.propuestas || []).find(p => Number(p.id) === Number(propuestaId));
        if (!prop) return;

        let motivo = '';
        if (window.Swal) {
            const res = await window.Swal.fire({
                title: `¿Descartar ${prop.codigo_propuesta}?`,
                html: `<div style="text-align:left; font-size:0.88rem; color:#cbd5e1;">
                    Se descartará la solicitud de <strong>${escaparHtml(prop.ingrediente_label_oficial || prop.nombre_sugerido)}</strong> enviada por <strong>${escaparHtml(prop.nodo_solicitante_nombre || 'el Nodo')}</strong>.<br><br>
                    Podés dejar un motivo breve opcional para el Gestor:
                </div>`,
                input: 'text',
                inputPlaceholder: 'Ej: Ese gramaje ya se reemplaza por 150g (opcional)',
                background: '#1e293b',
                color: '#f8fafc',
                showCancelButton: true,
                confirmButtonText: 'Descartar solicitud',
                confirmButtonColor: '#e11d48',
                cancelButtonText: 'Cancelar'
            });
            if (!res.isConfirmed) return;
            motivo = String(res.value || '').trim();
        } else {
            const ok = window.confirm(`¿Descartar la solicitud ${prop.codigo_propuesta} (${prop.nombre_sugerido})?`);
            if (!ok) return;
        }

        try {
            const resp = await fetch(`/api/produccion/nodos/propuestas/${Number(propuestaId)}/descartar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ motivo })
            });
            const data = await resp.json();
            if (!resp.ok || !data.ok) {
                throw new Error(data.error || 'No se pudo descartar la solicitud');
            }
            if (Number(ESTADO_NODOS.propuestaActivaId) === Number(propuestaId)) {
                ESTADO_NODOS.propuestaActivaId = null;
            }
            await cargarDatosNodosBarriales(true);
        } catch (err) {
            alert('⚠️ ' + err.message);
        }
    }

    async function aprobarYPublicarEnPadronNodos() {
        try {
            const origenVal = document.getElementById('cot-origen-select')?.value || '';
            const esArtBunker = origenVal.startsWith('ART:');
            const ingredienteOrigenId = !esArtBunker && origenVal ? Number(origenVal) : null;
            const artBunkerCodigo = esArtBunker ? origenVal.replace('ART:', '') : null;

            if (!esArtBunker && !ingredienteOrigenId) {
                throw new Error('Debe seleccionar un Insumo Base real de LAMDA por código determinista.');
            }

            const envSelect = document.getElementById('cot-envase-select');
            const envOpt = envSelect?.selectedOptions?.[0];
            const insumoEnvaseId = envSelect?.value ? Number(envSelect.value) : null;
            if (Number(ESTADO_NODOS.flujoSeleccionadoMesa) !== 1 && !insumoEnvaseId) {
                throw new Error('Debe seleccionar una Bolsa / Envase real de public.ingredientes (es_insumo = true).');
            }

            const anat = ESTADO_NODOS.anatomiaActualMesa;
            const selCasoB = ESTADO_NODOS.casoBSeleccion || {};
            if (esModoCasoBAnatomia(anat)) {
                if (!selCasoB.articulo_principal_id) {
                    throw new Error('Caso B (sin hermano previo en Búnker): seleccione el Sustantivo Ancla del Diccionario Oficial Búnker.');
                }
                if (!selCasoB.rubro) {
                    throw new Error('Caso B (sin hermano previo en Búnker): seleccione el Rubro Oficial de Búnker.');
                }
            }

            const descripcionOficialBunker = String(document.getElementById('cot-bunker-nomenclatura')?.value || '').trim();
            if (!descripcionOficialBunker) {
                throw new Error('La Nomenclatura Oficial Búnker no puede estar vacía.');
            }

            const tarifaSelect = document.getElementById('cot-tarifa-select');
            const tarifaOpt = tarifaSelect?.selectedOptions?.[0];

            const kilos = Number(document.getElementById('cot-kilos-unidad')?.value || 0.25);
            const aliasVidrieraNodo = String(document.getElementById('cot-alias-vidriera-nodo')?.value || '').trim();
            const payload = {
                catalogo_id: ESTADO_NODOS.catalogoEditandoId || null,
                propuesta_id: ESTADO_NODOS.propuestaActivaId || null,
                sku_nodo: document.getElementById('cot-sku-nodo')?.value || '',
                nombre_publico: descripcionOficialBunker,
                bunker_descripcion_generada: descripcionOficialBunker,
                alias_vidriera_nodo: aliasVidrieraNodo || null,
                compartido_mayorista: document.getElementById('cot-compartido-mayorista')?.value === 'true',
                categoria_familiar: document.getElementById('cot-categoria')?.value || 'FRUTOS SECOS',
                presentacion_etiqueta: kilos >= 1 ? `Bolsa ${kilos}kg` : `Bolsa ${Math.round(kilos * 1000)}g`,
                flujo_lamda: ESTADO_NODOS.flujoSeleccionadoMesa,
                origen_tipo: esArtBunker ? 'ARTICULO_BUNKER' : (ESTADO_NODOS.flujoSeleccionadoMesa === 3 ? 'MIX' : ESTADO_NODOS.flujoSeleccionadoMesa >= 4 ? 'UP_EXTERNA' : 'INGREDIENTE'),
                ingrediente_origen_id: ingredienteOrigenId,
                articulo_bunker_origen_codigo: artBunkerCodigo,
                costo_insumo_kg: Number(document.getElementById('cot-costo-kg')?.value || 0),
                kilos_unidad: kilos,
                insumo_envase_id: insumoEnvaseId,
                costo_envase_unitario: Number(envOpt?.getAttribute('data-costo') || 0),
                segundos_fraccionamiento: Math.max(1, obtenerSegundosDesdeMesa() || 35),
                tarifa_colaborador_id: tarifaSelect?.value ? Number(tarifaSelect.value) : null,
                valor_hora_aplicado: Number(tarifaOpt?.getAttribute('data-valor-hora') || 7000),
                margen_lamda_pct: Number(document.getElementById('cot-margen-lamda')?.value || 22),
                iva_pct: Number(document.getElementById('cot-iva-pct')?.value || 21),
                iibb_pct: Number(document.getElementById('cot-iibb-pct')?.value || 4),
                margen_sugerido_gestor_pct: Number(document.getElementById('cot-margen-gestor')?.value || 28),
                notas_tecnicas: document.getElementById('cot-notas-tecnicas')?.value || ''
            };

            if (esModoCasoBAnatomia(anat)) {
                payload.familia_bunker_id = selCasoB.familia_id;
                payload.familia_id = selCasoB.familia_id;
                payload.incluir_familia = Boolean(selCasoB.incluir_familia);
                payload.modo_display_familia = selCasoB.modo_display_familia || 'ABREVIADO';
                payload.articulo_principal_id = selCasoB.articulo_principal_id;
                payload.silencioso_principal = Boolean(selCasoB.silencioso_principal);
                payload.modo_display_principal = selCasoB.modo_display_principal || 'COMPLETO';
                payload.posiciones_seleccionadas = construirPosicionesSeleccionadasCasoB();
                payload.posiciones = selCasoB.posiciones || {};
                payload.rubro_bunker = selCasoB.rubro;
                payload.rubro = selCasoB.rubro;
                payload.sub_rubro_bunker = selCasoB.sub_rubro || '';
                payload.sub_rubro = selCasoB.sub_rubro || '';
            }

            const resp = await fetch('/api/produccion/nodos/cotizar-aprobar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (!resp.ok || !data.ok) {
                throw new Error(data.error || 'Error al aprobar la cotización');
            }

            if (window.Swal) {
                await Swal.fire({
                    icon: 'success',
                    title: 'Artículo Oficial Sincronizado con Búnker y Nodos',
                    html: `
                        <div style="text-align:left; font-size:0.88rem; line-height:1.5;">
                            <p>🏛️ <strong>Artículo Oficial LAMDA (${escaparHtml(data.articulo.bunker_familia_nombre || 'Familia')}):</strong><br>
                            <code style="color:#38bdf8; font-weight:800;">[${escaparHtml(data.articulo.sku_nodo)}] ${escaparHtml(data.articulo.bunker_descripcion_generada || data.articulo.nombre_publico)}</code></p>
                            <p>📂 <strong>Rubro Oficial Búnker:</strong> ${escaparHtml(data.articulo.bunker_rubro || '-')}${data.articulo.bunker_sub_rubro ? ` / ${escaparHtml(data.articulo.bunker_sub_rubro)}` : ''} (${escaparHtml(data.articulo.presentacion_etiqueta)})</p>
                            <p>✅ <strong>Precio Lista Base Nodos:</strong> ${fmtMoneda(data.calculo.precio_base_nodo_final)}</p>
                            <p>🛒 <strong>Precio Sugerido al Vecino:</strong> ${fmtMoneda(data.calculo.precio_sugerido_vecino)} <span style="font-size:0.76rem; color:#94a3b8;">(cada Nodo puede personalizar el nombre de su vidriera en su panel)</span></p>
                        </div>
                    `,
                    background: '#151e2e',
                    color: '#f8fafc'
                });
            }

            ESTADO_NODOS.propuestaActivaId = null;
            ESTADO_NODOS.catalogoEditandoId = null;
            ESTADO_NODOS.anatomiaActualMesa = null;
            await cargarDatosNodosBarriales(true);
        } catch (err) {
            if (window.Swal) {
                Swal.fire({ icon: 'error', title: 'Error', text: err.message, background: '#151e2e', color: '#f8fafc' });
            } else {
                alert(err.message);
            }
        }
    }

    async function abrirModalNuevaPropuesta() {
        if (!window.Swal) return;
        const nodosOpts = ESTADO_NODOS.nodos.map(n => `<option value="${n.id}">${escaparHtml(n.nombre_marca)} (${escaparHtml(n.gestor_nombre)})</option>`).join('');
        const ingOpts = ESTADO_NODOS.fuentes.ingredientes_por_flujo.map(i => {
            const label = i.label_oficial || `[${i.codigo || i.id}] ${i.nombre_oficial || i.nombre}`;
            return `<option value="${i.id}" data-flujo="${i.flujo}" data-label="${escaparHtml(label)}">[${FLUJO_META[i.flujo]?.corto || 'Flujo'}] ${escaparHtml(label)} (${fmtMoneda(i.costo_kg)}/kg)</option>`;
        }).join('');

        const { value: formValues } = await Swal.fire({
            title: '➕ Nueva Solicitud Técnica de Fracción (Nodo -> LAMDA)',
            background: '#151e2e',
            color: '#f8fafc',
            width: '620px',
            html: `
                <div style="display:flex; flex-direction:column; gap:10px; text-align:left; font-size:0.84rem;">
                    <div>
                        <label>Nodo Solicitante:</label>
                        <select id="swal-prop-nodo" class="swal2-input" style="width:100%; margin:4px 0; background:#0f172a; color:#fff;">${nodosOpts}</select>
                    </div>
                    <div>
                        <label>Insumo Oficial LAMDA (por Código Determinista):</label>
                        <select id="swal-prop-ing" class="swal2-input" style="width:100%; margin:4px 0; background:#0f172a; color:#fff;">${ingOpts}</select>
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                        <div>
                            <label>Peso Fracción (Kg, ej 0.50 = 500g):</label>
                            <input id="swal-prop-kilos" type="number" step="0.05" value="0.50" class="swal2-input" style="width:100%; margin:4px 0; background:#0f172a; color:#fff;">
                        </div>
                        <div>
                            <label>Precio Estimado al Vecino ($ opcional):</label>
                            <input id="swal-prop-target" type="number" step="100" value="" placeholder="Opcional" class="swal2-input" style="width:100%; margin:4px 0; background:#0f172a; color:#fff;">
                        </div>
                    </div>
                    <div>
                        <label>Alias sugerido para la vidriera del Nodo (opcional, informativo):</label>
                        <input id="swal-prop-alias-vidriera" class="swal2-input" placeholder="Ej: Mix Selección Paraíso (no altera el nombre oficial LAMDA)" style="width:100%; margin:4px 0; background:#0f172a; color:#fff;">
                    </div>
                    <div>
                        <label>Observación operativa del Gestor:</label>
                        <input id="swal-prop-comentario" class="swal2-input" placeholder="Ej: Fracción familiar pedida por vecinos" style="width:100%; margin:4px 0; background:#0f172a; color:#fff;">
                    </div>
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Enviar a Bandeja de Cotización',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const ingSelect = document.getElementById('swal-prop-ing');
                const opt = ingSelect?.selectedOptions?.[0];
                const kilosNum = Number(document.getElementById('swal-prop-kilos').value || 0.50);
                const etiqPeso = kilosNum >= 1 ? `${kilosNum}kg` : `${Math.round(kilosNum * 1000)}g`;
                const labelIng = opt?.getAttribute('data-label') || '';
                return {
                    nodo_solicitante_id: Number(document.getElementById('swal-prop-nodo').value),
                    ingrediente_sugerido_id: Number(ingSelect.value),
                    flujo_sugerido: Number(opt?.getAttribute('data-flujo') || 2),
                    nombre_sugerido: `${labelIng} x ${etiqPeso}`.trim(),
                    alias_vidriera_sugerido: document.getElementById('swal-prop-alias-vidriera').value.trim() || null,
                    kilos_sugeridos: kilosNum,
                    precio_objetivo_vecino: Number(document.getElementById('swal-prop-target').value || 0),
                    comentario_gestor: document.getElementById('swal-prop-comentario').value.trim()
                };
            }
        });

        if (formValues && formValues.ingrediente_sugerido_id) {
            const resp = await fetch('/api/produccion/nodos/propuestas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formValues)
            });
            const data = await resp.json();
            if (data.ok) {
                await cargarDatosNodosBarriales(true);
                cargarPropuestaEnMesa(data.propuesta.id);
            }
        }
    }

    async function sincronizarCascadaSeisFlujos() {
        try {
            const costosSimulados = {};
            if (window.pizarraSimulacionMaster && Array.isArray(window.pizarraSimulacionMaster.ingredientes)) {
                window.pizarraSimulacionMaster.ingredientes.forEach(ing => {
                    if (Number(ing.costo_patron) > 0) {
                        costosSimulados[Number(ing.id)] = Number(ing.costo_patron);
                    }
                });
            }

            const resp = await fetch('/api/produccion/nodos/recalcular-cascada', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ costos_simulados: costosSimulados })
            });
            const data = await resp.json();
            if (!resp.ok || !data.ok) throw new Error(data.error || 'Error al recalcular cascada');

            await cargarDatosNodosBarriales(true);
            if (window.Swal) {
                Swal.fire({
                    icon: 'success',
                    title: 'Precios Base Actualizados',
                    text: `Se actualizaron ${data.actualizados} productos del catálogo de Nodos con los costos vigentes de la Pizarra.`,
                    timer: 2200,
                    showConfirmButton: false,
                    background: '#151e2e',
                    color: '#f8fafc'
                });
            }
        } catch (err) {
            console.error(err);
        }
    }

    async function actualizarMargenOfertaGestor(ofertaId, nuevoMargen) {
        try {
            const resp = await fetch(`/api/produccion/nodos/ofertas-gestor/${ofertaId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ margen_gestor_pct: Number(nuevoMargen) })
            });
            const data = await resp.json();
            if (data.ok) {
                await cargarDatosNodosBarriales(true);
            }
        } catch (err) {
            console.error(err);
        }
    }

    async function togglePublicacionOfertaGestor(ofertaId, publicado) {
        try {
            const resp = await fetch(`/api/produccion/nodos/ofertas-gestor/${ofertaId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ publicado_tienda: Boolean(publicado) })
            });
            const data = await resp.json();
            if (data.ok) {
                await cargarDatosNodosBarriales(true);
            }
        } catch (err) {
            console.error(err);
        }
    }

    // =========================================================================
    // FUNCIONES DEL ABM DE NODOS + LOGO TÉRMICO + SIMULADOR ETIQUETA
    // =========================================================================
    let logoOriginalSubidoBase64 = null;
    let abmLeafletMapInstance = null;
    let abmLeafletMarker = null;
    let abmGeoTimers = {};
    let abmUltimaSugerenciaMapa = { barrio: '', calle: '', lat: null, lng: null };

    function formatearBarrioLocalidadGeo(item = {}) {
        const loc = String(item.localidad || '').trim();
        const partido = String(item.partido || '').trim();
        let prov = String(item.provincia || '').trim()
            .replace(/^Provincia de\s+/i, '')
            .replace(/^(?:Ciudad Autónoma de Buenos Aires|Autonomous City of Buenos Aires)$/i, 'CABA')
            .trim();

        const partes = [];
        const pushUnico = (v) => {
            if (!v) return;
            if (!partes.some(p => p.toLowerCase() === v.toLowerCase())) partes.push(v);
        };
        pushUnico(loc);
        pushUnico(partido);
        if (prov && (!partido || prov.toLowerCase() !== partido.toLowerCase())) {
            const esLaPlataPba = /la plata/i.test(loc + ' ' + partido) && /buenos aires/i.test(prov);
            if (!esLaPlataPba) {
                pushUnico(prov);
            }
        }
        return partes.join(', ') || partido || prov || '';
    }

    function pareceDireccionPlatense(rawDir) {
        const txt = String(rawDir || '').trim();
        if (!txt) return false;
        const mencionaOtraJurisdiccion = /caba|capital federal|córdoba|cordoba|rosario|santa fe|mendoza|tucumán|tucuman|salta|neuquén|neuquen|mar del plata|bahía blanca|bahia blanca|tandil|paraná|parana|entre ríos|entre rios|corrientes|posadas|misiones|bariloche|río negro|rio negro|chubut|san juan|san luis|la rioja|catamarca|jujuy|chaco|formosa|santa cruz|tierra del fuego|santiago del estero|la pampa|quilmes|avellaneda|lanús|lanus|lomas de zamora|morón|moron|san isidro|vicente lopez|vicente lópez|martínez|martinez|olivos|tigre|pilar|olavarría|olavarria|necochea|junín|junin|pergamino|luján|lujan|campana|zárate|zarate|mercedes|san nicolás|san nicolas/i.test(txt);
        if (mencionaOtraJurisdiccion) return false;
        const mencionaGranLaPlata = /la plata|city bell|gonnet|villa elisa|olmos|los hornos|tolosa|ringuelet|berisso|ensenada|sicardi|arana|hernandez|hernández|gorina/i.test(txt);
        if (mencionaGranLaPlata) return true;
        const esFechaPatria = /^\s*(?:9\s+de\s+julio|25\s+de\s+mayo|3\s+de\s+febrero|12\s+de\s+octubre|20\s+de\s+junio|1\s+de\s+mayo|11\s+de\s+septiembre|17\s+de\s+agosto)\b/i.test(txt);
        if (esFechaPatria) return false;
        return /\(\s*e\/\s*esq\.?|\besq\.?\b|\be\/\s*\d+|\bbis\b|^\s*\d{1,3}\s*(?:y|e\/|esq\.?)\s*\d{1,3}/i.test(txt);
    }

    function normalizarDireccionParaGeocoder(rawDir, opciones = {}) {
        let txt = String(rawDir || '').trim();
        if (!txt) return '';
        const forzarLaPlata = Boolean(opciones.forzarLaPlata);
        const esPlatense = forzarLaPlata || pareceDireccionPlatense(txt);
        if (esPlatense) {
            txt = txt
                .replace(/\(\s*e\/\s*esq\.?\s*([^)]+)\)/gi, 'y $1')
                .replace(/\besq\.?\b/gi, 'y')
                .replace(/\be\/\s*(\d+)/gi, 'y $1');
            if (!/la plata|city bell|gonnet|villa elisa|olmos|los hornos|tolosa|ringuelet|berisso|ensenada|buenos aires/i.test(txt)) {
                txt += ', La Plata, Buenos Aires';
            }
        }
        return txt;
    }

    function ocultarDropdownsGeoAbm() {
        ['abm-mapa-sugerencias', 'abm-direccion-sugerencias'].forEach(id => {
            const box = document.getElementById(id);
            if (box) {
                box.style.display = 'none';
                box.innerHTML = '';
            }
        });
    }

    function actualizarBarraInfoMapaAbm({ barrio, calle, direccionFormateada, lat, lng, etiquetaOrigen, esAproximada = false }) {
        abmUltimaSugerenciaMapa = {
            barrio: barrio || '',
            calle: calle || direccionFormateada || '',
            lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
            lng: Number.isFinite(Number(lng)) ? Number(lng) : null
        };

        const latEl = document.getElementById('abm-latitud');
        const lngEl = document.getElementById('abm-longitud');
        if (latEl) latEl.value = abmUltimaSugerenciaMapa.lat ?? '';
        if (lngEl) lngEl.value = abmUltimaSugerenciaMapa.lng ?? '';

        const bar = document.getElementById('abm-mapa-info-bar');
        if (!bar) return;

        const coordTxt = abmUltimaSugerenciaMapa.lat && abmUltimaSugerenciaMapa.lng
            ? `${abmUltimaSugerenciaMapa.lat.toFixed(6)}, ${abmUltimaSugerenciaMapa.lng.toFixed(6)}`
            : 'Sin coordenadas';

        const marcaEdicion = (() => {
            const valInput = document.getElementById('abm-nombre-marca')?.value?.trim();
            if (valInput) return valInput;
            const nObj = ESTADO_NODOS.nodoEditandoId
                ? ESTADO_NODOS.nodos.find(x => Number(x.id) === Number(ESTADO_NODOS.nodoEditandoId))
                : null;
            return nObj?.nombre_marca || 'este Nodo';
        })();
        const tieneCoords = Number.isFinite(abmUltimaSugerenciaMapa.lat) && Number.isFinite(abmUltimaSugerenciaMapa.lng);

        bar.innerHTML = `
            <div style="flex:1; min-width:240px; line-height:1.45;">
                ${etiquetaOrigen ? `<span style="font-size:0.7rem; font-weight:800; color:#a78bfa; background:rgba(167,139,250,0.16); padding:1px 6px; border-radius:4px; margin-right:6px;">${escaparHtml(etiquetaOrigen)}</span>` : ''}
                <span style="color:#94a3b8;">Barrio / Localidad en Mapa:</span>
                <strong style="color:#38bdf8; font-size:0.82rem;">${escaparHtml(barrio || 'Sin especificar')}</strong>
                <span style="color:#64748b; margin:0 6px;">|</span>
                <span style="color:#94a3b8;">Dirección detectada:</span>
                <span style="color:#e2e8f0;">${escaparHtml(direccionFormateada || calle || '-')}</span>
                <span style="color:#64748b; font-family:monospace; font-size:0.7rem; margin-left:6px;">(📍 ${coordTxt})</span>
                ${esAproximada ? `
                    <div style="margin-top:5px; padding:4px 8px; border-radius:6px; background:rgba(245,158,11,0.14); border:1px solid rgba(245,158,11,0.4); color:#fcd34d; font-size:0.72rem; font-weight:700;">
                        ⚠️ Ubicación aproximada (nivel localidad o zona). Si necesitás mayor exactitud, agregá calle/altura o arrastrá el pin manualmente sobre el mapa.
                    </div>
                ` : ''}
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                ${barrio ? `
                    <button type="button" onclick="window.NodosPizarra.aplicarBarrioSugeridoMapaAbm()"
                        style="padding:5px 10px; border-radius:6px; font-size:0.72rem; font-weight:800; background:rgba(56,189,248,0.18); border:1px solid #38bdf8; color:#bae6fd; cursor:pointer;">
                        ✅ Usar Barrio "${escaparHtml(barrio)}"
                    </button>
                ` : ''}
                ${(calle || direccionFormateada) ? `
                    <button type="button" onclick="window.NodosPizarra.aplicarCalleSugeridaMapaAbm()"
                        style="padding:5px 10px; border-radius:6px; font-size:0.72rem; font-weight:700; background:rgba(16,185,129,0.16); border:1px solid #10b981; color:#6ee7b7; cursor:pointer;">
                        📝 Usar calle del mapa en Domicilio
                    </button>
                ` : ''}
                ${tieneCoords ? `
                    <button type="button" id="abm-btn-guardar-ubicacion-mapa" onclick="window.NodosPizarra.guardarNodoAbm()"
                        style="padding:6px 12px; border-radius:7px; font-size:0.74rem; font-weight:900; border:none; background:linear-gradient(135deg, #10b981, #059669); color:#052e16; cursor:pointer; box-shadow:0 2px 8px rgba(16,185,129,0.3);">
                        ${ESTADO_NODOS.nodoEditandoId
                            ? `💾 Guardar esta ubicación en ${escaparHtml(marcaEdicion)}`
                            : `💾 Guardar Nuevo Nodo con esta ubicación`}
                    </button>
                ` : ''}
            </div>
        `;
    }

    async function aplicarResultadoGeoEnAbm(item, opciones = {}) {
        const lat = Number(item?.lat);
        const lng = Number(item?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return false;

        const esAproximada = !item.altura && item.fuente === 'georef_localidades';
        const barrioLocalidad = formatearBarrioLocalidadGeo(item);
        const calleFormateada = [item.calle, item.altura].filter(Boolean).join(' ').trim();
        const dirFmt = item.display_name || calleFormateada || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

        await asegurarInstanciaMapaAbm(lat, lng, esAproximada ? 13 : 16);

        actualizarBarraInfoMapaAbm({
            barrio: barrioLocalidad,
            calle: calleFormateada || dirFmt.split(',')[0],
            direccionFormateada: dirFmt,
            lat,
            lng,
            etiquetaOrigen: opciones.etiquetaOrigen || (item.fuente === 'nominatim' ? 'OSM Nominatim AR' : 'GeoRef AR Oficial'),
            esAproximada
        });

        const barrioInput = document.getElementById('abm-barrio');
        if (barrioInput && barrioLocalidad && (opciones.autocompletarBarrio || !barrioInput.value.trim())) {
            barrioInput.value = barrioLocalidad;
        }
        if (opciones.actualizarDomicilioConFormato) {
            const dirInput = document.getElementById('abm-direccion');
            if (dirInput) {
                dirInput.value = calleFormateada ? `${calleFormateada}${item.localidad ? `, ${item.localidad}` : ''}` : dirFmt;
                simularEtiquetaZebra('estandar_pagado');
            }
        }
        return true;
    }

    function vincularAutocompleteGeoAbm() {
        if (!window.__nodosGeoOutsideClickBound) {
            window.__nodosGeoOutsideClickBound = true;
            document.addEventListener('click', (ev) => {
                if (!ev.target?.closest?.('.nodos-geo-suggest-wrap')) {
                    ocultarDropdownsGeoAbm();
                }
            });
        }

        const enlazarInputGeo = (inputId, dropdownId, opts) => {
            const input = document.getElementById(inputId);
            const drop = document.getElementById(dropdownId);
            if (!input || !drop || input.dataset.geoBound === '1') return;
            input.dataset.geoBound = '1';

            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape') {
                    drop.style.display = 'none';
                }
            });

            input.addEventListener('input', () => {
                const val = input.value.trim();
                clearTimeout(abmGeoTimers[inputId]);
                if (val.length < 3) {
                    drop.style.display = 'none';
                    drop.innerHTML = '';
                    return;
                }
                abmGeoTimers[inputId] = setTimeout(async () => {
                    try {
                        const qEnviar = normalizarDireccionParaGeocoder(val);
                        const resp = await fetch(`/api/produccion/nodos/geocodificar-ar?q=${encodeURIComponent(qEnviar)}`);
                        const data = await resp.json();
                        const lista = Array.isArray(data?.resultados) ? data.resultados : [];
                        if (lista.length === 0) {
                            drop.innerHTML = `<div class="nodos-geo-suggest-item" style="color:#94a3b8; cursor:default;">Sin sugerencias automáticas (probá agregar ciudad o provincia)</div>`;
                            drop.style.display = 'block';
                            return;
                        }
                        drop._itemsGeo = lista;
                        drop.innerHTML = lista.map((item, idx) => `
                            <div class="nodos-geo-suggest-item" data-geo-idx="${idx}">
                                <span>📍 ${escaparHtml(item.display_name)}</span>
                                <span class="nodos-geo-suggest-fuente">${item.fuente === 'nominatim' ? 'OSM' : 'GeoRef AR'}</span>
                            </div>
                        `).join('');
                        drop.querySelectorAll('.nodos-geo-suggest-item[data-geo-idx]').forEach(el => {
                            el.addEventListener('click', async () => {
                                const idx = Number(el.dataset.geoIdx);
                                const elegido = drop._itemsGeo?.[idx];
                                drop.style.display = 'none';
                                if (!elegido) return;
                                if (opts.abrirPanelSiCerrado) {
                                    const panel = document.getElementById('abm-mapa-panel');
                                    if (panel && panel.style.display === 'none') {
                                        panel.style.display = 'block';
                                    }
                                }
                                await aplicarResultadoGeoEnAbm(elegido, {
                                    autocompletarBarrio: true,
                                    actualizarDomicilioConFormato: Boolean(opts.actualizarDomicilioConFormato),
                                    etiquetaOrigen: opts.etiquetaOrigen
                                });
                            });
                        });
                        drop.style.display = 'block';
                    } catch (err) {
                        drop.style.display = 'none';
                    }
                }, 340);
            });
        };

        enlazarInputGeo('abm-mapa-search-input', 'abm-mapa-sugerencias', {
            abrirPanelSiCerrado: true,
            actualizarDomicilioConFormato: false,
            etiquetaOrigen: 'Buscador GeoRef / OSM'
        });
        enlazarInputGeo('abm-direccion', 'abm-direccion-sugerencias', {
            abrirPanelSiCerrado: false,
            actualizarDomicilioConFormato: true,
            etiquetaOrigen: 'Dirección AR seleccionada'
        });
    }

    async function resolverBarrioDesdeCoordenadasAbm(lat, lng, opciones = {}) {
        const latNum = Number(lat);
        const lngNum = Number(lng);
        if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;

        try {
            const resp = await fetch(`/api/produccion/nodos/geocodificar-inverso?lat=${encodeURIComponent(latNum)}&lng=${encodeURIComponent(lngNum)}`);
            const data = await resp.json();
            if (!resp.ok || !data?.ok) {
                throw new Error(data?.error || 'Error geocodificando coordenadas');
            }
            const barrioLocalidad = formatearBarrioLocalidadGeo(data);
            const calleFormateada = [data.calle, data.altura].filter(Boolean).join(' ').trim();
            const dirFmt = data.display_name || `${latNum.toFixed(5)}, ${lngNum.toFixed(5)}`;

            actualizarBarraInfoMapaAbm({
                barrio: barrioLocalidad,
                calle: calleFormateada || dirFmt.split(',')[0],
                direccionFormateada: dirFmt,
                lat: latNum,
                lng: lngNum,
                etiquetaOrigen: opciones.etiquetaOrigen || 'Pin en Mapa AR'
            });

            const barrioInput = document.getElementById('abm-barrio');
            if (barrioInput && barrioLocalidad && (opciones.autocompletarBarrio || !barrioInput.value.trim())) {
                barrioInput.value = barrioLocalidad;
            }
            return { ...data, barrioLocalidad, calleFormateada };
        } catch (err) {
            actualizarBarraInfoMapaAbm({
                barrio: document.getElementById('abm-barrio')?.value || '',
                calle: '',
                direccionFormateada: `${latNum.toFixed(5)}, ${lngNum.toFixed(5)}`,
                lat: latNum,
                lng: lngNum,
                etiquetaOrigen: opciones.etiquetaOrigen || 'Coordenadas del Nodo'
            });
            return null;
        }
    }

    async function asegurarInstanciaMapaAbm(latInicial = -34.9214, lngInicial = -57.9545, zoomInicial = 15) {
        const canvas = document.getElementById('abm-google-map-canvas');
        if (!canvas) return null;

        if (!window.L) {
            canvas.innerHTML = '<div style="padding:14px; text-align:center; color:#f87171;">⚠️ No se pudo cargar la librería Leaflet para mapas. Recargue la página o verifique la conexión.</div>';
            return null;
        }

        const center = {
            lat: Number.isFinite(Number(latInicial)) && Number(latInicial) !== 0 ? Number(latInicial) : -34.9214,
            lng: Number.isFinite(Number(lngInicial)) && Number(lngInicial) !== 0 ? Number(lngInicial) : -57.9545
        };

        if (abmLeafletMapInstance && abmLeafletMapInstance.getContainer() !== canvas) {
            try { abmLeafletMapInstance.remove(); } catch (_) {}
            abmLeafletMapInstance = null;
            abmLeafletMarker = null;
        }

        if (!abmLeafletMapInstance) {
            canvas.innerHTML = '';
            abmLeafletMapInstance = window.L.map(canvas, { zoomControl: true }).setView([center.lat, center.lng], zoomInicial);
            window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap · GeoRef AR',
                maxZoom: 19
            }).addTo(abmLeafletMapInstance);

            abmLeafletMarker = window.L.marker([center.lat, center.lng], {
                draggable: true,
                title: 'Punto del Nodo (arrastrá para ajustar)'
            }).addTo(abmLeafletMapInstance);

            abmLeafletMarker.on('dragend', () => {
                const pos = abmLeafletMarker.getLatLng();
                if (pos) {
                    resolverBarrioDesdeCoordenadasAbm(pos.lat, pos.lng, {
                        autocompletarBarrio: true,
                        etiquetaOrigen: 'Pin ajustado manualmente'
                    });
                }
            });

            abmLeafletMapInstance.on('click', (e) => {
                if (e.latlng && abmLeafletMarker) {
                    abmLeafletMarker.setLatLng(e.latlng);
                    resolverBarrioDesdeCoordenadasAbm(e.latlng.lat, e.latlng.lng, {
                        autocompletarBarrio: true,
                        etiquetaOrigen: 'Punto marcado en el mapa'
                    });
                }
            });
        } else {
            abmLeafletMapInstance.setView([center.lat, center.lng], zoomInicial);
            if (abmLeafletMarker) {
                abmLeafletMarker.setLatLng([center.lat, center.lng]);
            }
        }

        setTimeout(() => {
            if (abmLeafletMapInstance) abmLeafletMapInstance.invalidateSize();
        }, 80);

        vincularAutocompleteGeoAbm();
        return abmLeafletMapInstance;
    }

    async function syncMapaSiPanelAbmAbierto(nodo) {
        ocultarDropdownsGeoAbm();
        const searchInput = document.getElementById('abm-mapa-search-input');
        if (searchInput) searchInput.value = '';

        const panel = document.getElementById('abm-mapa-panel');
        if (!panel || panel.style.display === 'none') return;

        const latVal = Number(nodo?.latitud || 0);
        const lngVal = Number(nodo?.longitud || 0);
        if (latVal && lngVal) {
            await asegurarInstanciaMapaAbm(latVal, lngVal, 15);
            actualizarBarraInfoMapaAbm({
                barrio: nodo?.barrio_zona || '',
                calle: nodo?.direccion_retiro || '',
                direccionFormateada: nodo?.direccion_retiro || `${latVal.toFixed(5)}, ${lngVal.toFixed(5)}`,
                lat: latVal,
                lng: lngVal,
                etiquetaOrigen: `Nodo: ${nodo?.nombre_marca || 'Guardado'}`
            });
        } else if (nodo?.direccion_retiro) {
            await geocodificarTextoEnMapaAbm(nodo.direccion_retiro, {
                autocompletarBarrio: !nodo.barrio_zona,
                etiquetaOrigen: `Domicilio ${nodo?.nombre_marca || ''}`
            });
        } else {
            await asegurarInstanciaMapaAbm(-34.9214, -57.9545, 13);
        }
    }

    function renderizarChipsDomiciliosClienteAbm(cli, indiceActivo = 0) {
        const domBox = document.getElementById('abm-domicilios-sugeridos');
        if (!domBox) return;
        if (!cli) {
            domBox.innerHTML = '';
            return;
        }

        const datos = extraerDatosContactoClienteBunker(cli);
        const lista = datos.domiciliosAlternativos || [];
        if (lista.length === 0) {
            domBox.innerHTML = '';
            return;
        }

        domBox.innerHTML = `
            <span style="font-size:0.7rem; color:#94a3b8; font-weight:700;">Domicilios en ficha del cliente (clic para ver en mapa y elegir):</span>
            ${lista.map((d, idx) => {
                const activo = idx === indiceActivo;
                const badgeGps = d.tieneGps ? '🗺️ GPS' : '🔍 Mapa';
                return `
                    <button type="button"
                        onclick="window.NodosPizarra.seleccionarDomicilioClienteEnAbm(${idx}, true)"
                        style="padding:4px 10px; border-radius:999px; border:1px solid ${activo ? '#10b981' : 'rgba(56,189,248,0.45)'}; background:${activo ? 'rgba(16,185,129,0.22)' : 'rgba(56,189,248,0.12)'}; color:${activo ? '#6ee7b7' : '#bae6fd'}; font-size:0.72rem; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:5px;">
                        <span>📍 <strong>${escaparHtml(d.etiqueta)}:</strong> ${escaparHtml(d.direccion)}</span>
                        <span style="font-size:0.65rem; padding:1px 5px; border-radius:4px; background:rgba(15,23,42,0.7); color:#38bdf8;">${badgeGps}</span>
                    </button>
                `;
            }).join('')}
        `;
    }

    function construirQueryDomicilioConContextoAbm(direccionRaw, dom = null) {
        const dir = String(direccionRaw || '').trim();
        if (!dir) return '';
        if (dir.includes(',')) return dir;

        const barrioInput = String(document.getElementById('abm-barrio')?.value || '').trim();
        const locDom = String(dom?.localidad || '').trim();
        const contexto = (locDom && !/sin especificar/i.test(locDom))
            ? locDom
            : ((barrioInput && !/sin especificar/i.test(barrioInput)) ? barrioInput : '');

        if (!contexto) return dir;
        const dirNorm = normalizarTextoBusqueda(dir);
        const ctxNorm = normalizarTextoBusqueda(contexto.split(',')[0] || contexto);
        if (ctxNorm && dirNorm.includes(ctxNorm)) {
            return dir;
        }
        return `${dir}, ${contexto}`;
    }

    async function seleccionarDomicilioClienteEnAbm(indice, abrirPanelMapa = true) {
        const cli = (ESTADO_NODOS.fuentes.clientes_bunker || []).find(
            c => Number(c.id) === Number(ESTADO_NODOS.clienteMadreSeleccionadoId)
        );
        if (!cli) return;

        const datos = extraerDatosContactoClienteBunker(cli);
        const dom = (datos.domiciliosAlternativos || [])[indice];
        if (!dom) return;

        renderizarChipsDomiciliosClienteAbm(cli, indice);

        const dirEl = document.getElementById('abm-direccion');
        if (dirEl) dirEl.value = dom.direccion || '';
        simularEtiquetaZebra('estandar_pagado');

        if (abrirPanelMapa) {
            const panel = document.getElementById('abm-mapa-panel');
            if (panel) panel.style.display = 'block';
        }

        if (dom.tieneGps && Number.isFinite(dom.latitud) && Number.isFinite(dom.longitud)) {
            await asegurarInstanciaMapaAbm(dom.latitud, dom.longitud, 16);
            await resolverBarrioDesdeCoordenadasAbm(dom.latitud, dom.longitud, {
                autocompletarBarrio: true,
                etiquetaOrigen: `${dom.etiqueta} (${dom.direccion})`
            });
        } else if (dom.direccion) {
            const queryConContexto = construirQueryDomicilioConContextoAbm(dom.direccion, dom);
            const searchInput = document.getElementById('abm-mapa-search-input');
            if (searchInput) searchInput.value = queryConContexto;
            await geocodificarTextoEnMapaAbm(queryConContexto, {
                autocompletarBarrio: !String(document.getElementById('abm-barrio')?.value || '').trim(),
                etiquetaOrigen: `${dom.etiqueta} (${queryConContexto})`
            });
        }
    }

    async function geocodificarTextoEnMapaAbm(rawTexto, opciones = {}) {
        const limpio = normalizarDireccionParaGeocoder(rawTexto);
        if (!limpio || limpio.length < 3) return;

        await asegurarInstanciaMapaAbm();

        const ejecutarGeoApi = async (queryAddr) => {
            const resp = await fetch(`/api/produccion/nodos/geocodificar-ar?q=${encodeURIComponent(queryAddr)}`);
            const data = await resp.json();
            return Array.isArray(data?.resultados) ? data.resultados : [];
        };

        let resultados = await ejecutarGeoApi(limpio);

        if (resultados.length === 0
            && !pareceDireccionPlatense(rawTexto)
            && !String(rawTexto).includes(',')
            && /^\s*\d{1,3}\b/.test(String(rawTexto))) {
            const fallbackLp = normalizarDireccionParaGeocoder(rawTexto, { forzarLaPlata: true });
            resultados = await ejecutarGeoApi(fallbackLp);
        }

        if (resultados.length > 0) {
            await aplicarResultadoGeoEnAbm(resultados[0], {
                autocompletarBarrio: Boolean(opciones.autocompletarBarrio),
                etiquetaOrigen: opciones.etiquetaOrigen || (resultados[0].fuente === 'nominatim' ? 'OSM Nominatim AR' : 'GeoRef AR Oficial')
            });
        } else {
            const bar = document.getElementById('abm-mapa-info-bar');
            if (bar) {
                bar.innerHTML = `<span style="color:#fbbf24;">⚠️ No se encontró "${escaparHtml(rawTexto)}" de forma exacta en Argentina. Probá sumar ciudad/provincia (ej: "${escaparHtml(rawTexto)}, Buenos Aires"), elegí una sugerencia del buscador o mové el pin directamente en el mapa.</span>`;
            }
        }
    }

    async function togglePanelMapaAbm() {
        const panel = document.getElementById('abm-mapa-panel');
        if (!panel) return;
        const visible = panel.style.display !== 'none';
        if (visible) {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = 'block';

        const latActual = Number(document.getElementById('abm-latitud')?.value || 0);
        const lngActual = Number(document.getElementById('abm-longitud')?.value || 0);
        const dirActual = document.getElementById('abm-direccion')?.value || '';

        if (latActual && lngActual) {
            await asegurarInstanciaMapaAbm(latActual, lngActual, 15);
            await resolverBarrioDesdeCoordenadasAbm(latActual, lngActual, {
                autocompletarBarrio: false,
                etiquetaOrigen: 'Ubicación actual del Nodo'
            });
        } else if (dirActual) {
            await geocodificarTextoEnMapaAbm(dirActual, {
                autocompletarBarrio: true,
                etiquetaOrigen: 'Domicilio escrito'
            });
        } else {
            await asegurarInstanciaMapaAbm(-34.9214, -57.9545, 13);
        }
    }

    async function buscarDireccionEnMapaAbm() {
        ocultarDropdownsGeoAbm();
        const q = document.getElementById('abm-mapa-search-input')?.value?.trim() || '';
        if (!q) return;
        await geocodificarTextoEnMapaAbm(q, {
            autocompletarBarrio: true,
            etiquetaOrigen: `Búsqueda: ${q}`
        });
    }

    async function ubicarTextoDomicilioActualEnMapaAbm() {
        ocultarDropdownsGeoAbm();
        const dir = document.getElementById('abm-direccion')?.value?.trim() || '';
        const bar = document.getElementById('abm-barrio')?.value?.trim() || '';
        const q = [dir, bar].filter(Boolean).join(', ');
        if (!q) return;
        await geocodificarTextoEnMapaAbm(q, {
            autocompletarBarrio: true,
            etiquetaOrigen: `Domicilio: ${dir}`
        });
    }

    function aplicarBarrioSugeridoMapaAbm() {
        if (!abmUltimaSugerenciaMapa.barrio) return;
        const el = document.getElementById('abm-barrio');
        if (el) el.value = abmUltimaSugerenciaMapa.barrio;
    }

    function aplicarCalleSugeridaMapaAbm() {
        if (!abmUltimaSugerenciaMapa.calle) return;
        const el = document.getElementById('abm-direccion');
        if (el) el.value = abmUltimaSugerenciaMapa.calle;
        simularEtiquetaZebra('estandar_pagado');
    }

    function alCambiarToggleCuentaCompartidaAbm(checked) {
        const cfgCanal = ESTADO_NODOS.fuentes?.config_cuenta_canal || { alias_recaudador: 'pago.canasto' };
        const aliasEl = document.getElementById('abm-alias-display');
        if (checked && aliasEl) {
            aliasEl.value = cfgCanal.alias_recaudador || 'pago.canasto';
        }
    }

    async function abrirModalConfigCuentaCanal() {
        const cfg = ESTADO_NODOS.fuentes?.config_cuenta_canal || {
            banco_recaudador: 'Cuenta Recaudadora Canal Nodos (Provisoria)',
            alias_recaudador: 'pago.canasto',
            titular_recaudador: 'Recaudación Canal Nodos (Provisorio)',
            cbu_recaudador: '0000000000000000000000'
        };

        if (!window.Swal) return;
        const res = await Swal.fire({
            title: '🏦 Cuenta Recaudadora y Alias Compartido (Canal Nodos)',
            background: '#151e2e',
            color: '#f8fafc',
            width: '580px',
            html: `
                <div style="text-align:left; font-size:0.82rem; line-height:1.45;">
                    <p style="color:#cbd5e1; margin-top:0;">
                        Esta configuración se aplica de forma unificada a <strong>todos los Nodos</strong> para recaudar transferencias bajo esquema <strong>Marca Blanca</strong> (sin mencionar a LAMDA ni a un Nodo puntual).
                    </p>
                    <div style="margin-bottom:10px;">
                        <label style="display:block; font-size:0.75rem; font-weight:800; color:#38bdf8; margin-bottom:4px;">Alias Recaudador Neutro (el que ve y copia el Vecino) *</label>
                        <input type="text" id="swal-canal-alias" value="${escaparHtml(cfg.alias_recaudador || 'pago.canasto')}"
                            placeholder="Ej: pago.canasto"
                            style="width:100%; padding:8px 10px; border-radius:7px; border:1px solid #38bdf8; background:#0f172a; color:#38bdf8; font-family:monospace; font-weight:800; font-size:0.9rem; box-sizing:border-box;">
                        <div style="font-size:0.7rem; color:#94a3b8; margin-top:3px;">Debe ser corto, neutro y no incluir la palabra "LAMDA".</div>
                    </div>
                    <div style="margin-bottom:10px;">
                        <label style="display:block; font-size:0.75rem; font-weight:700; color:#cbd5e1; margin-bottom:4px;">Descripción / Entidad de la Cuenta Recaudadora</label>
                        <input type="text" id="swal-canal-banco" value="${escaparHtml(cfg.banco_recaudador || '')}"
                            placeholder="Ej: Cuenta Recaudadora Canal Nodos"
                            style="width:100%; padding:8px 10px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; box-sizing:border-box;">
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                        <div>
                            <label style="display:block; font-size:0.75rem; font-weight:700; color:#cbd5e1; margin-bottom:4px;">Titular Visible (opcional)</label>
                            <input type="text" id="swal-canal-titular" value="${escaparHtml(cfg.titular_recaudador || '')}"
                                style="width:100%; padding:8px 10px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; box-sizing:border-box;">
                        </div>
                        <div>
                            <label style="display:block; font-size:0.75rem; font-weight:700; color:#cbd5e1; margin-bottom:4px;">CBU / CVU Recaudador</label>
                            <input type="text" id="swal-canal-cbu" value="${escaparHtml(cfg.cbu_recaudador || '')}"
                                style="width:100%; padding:8px 10px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-family:monospace; box-sizing:border-box;">
                        </div>
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '🔄 Guardar y Actualizar en Todos los Nodos',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#0284c7',
            preConfirm: () => {
                const alias = document.getElementById('swal-canal-alias')?.value?.trim() || '';
                if (!alias) {
                    Swal.showValidationMessage('Ingrese un alias recaudador.');
                    return false;
                }
                return {
                    alias_recaudador: alias,
                    banco_recaudador: document.getElementById('swal-canal-banco')?.value?.trim() || '',
                    titular_recaudador: document.getElementById('swal-canal-titular')?.value?.trim() || '',
                    cbu_recaudador: document.getElementById('swal-canal-cbu')?.value?.trim() || ''
                };
            }
        });

        if (!res.isConfirmed || !res.value) return;

        const resp = await fetch('/api/produccion/nodos/config-cuenta-canal', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(res.value)
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
            Swal.fire({ icon: 'error', title: 'Error', text: data.error || 'No se pudo actualizar la cuenta del canal.', background: '#151e2e', color: '#f8fafc' });
            return;
        }

        ESTADO_NODOS.fuentes.config_cuenta_canal = data.config_cuenta_canal;
        const bancoLbl = document.getElementById('abm-canal-banco-label');
        if (bancoLbl) bancoLbl.textContent = data.config_cuenta_canal.banco_recaudador || '';
        const aliasLbl = document.getElementById('abm-canal-alias-label');
        if (aliasLbl) aliasLbl.textContent = data.config_cuenta_canal.alias_recaudador || '';
        const chkComp = document.getElementById('abm-cuenta-compartida');
        const aliasInput = document.getElementById('abm-alias-display');
        if ((!chkComp || chkComp.checked) && aliasInput) {
            aliasInput.value = data.config_cuenta_canal.alias_recaudador || 'LAMDA.SER.MARTIN';
        }

        await cargarDatosNodosBarriales(true);

        Swal.fire({
            icon: 'success',
            title: '✅ Alias y Cuenta del Canal Nodos Actualizados',
            text: `Nuevo alias compartido "${data.config_cuenta_canal.alias_recaudador}" aplicado automáticamente (${data.nodos_actualizados || 0} Nodos actualizados).`,
            background: '#151e2e',
            color: '#f8fafc'
        });
    }

    let limpiarLogoOriginalPendiente = false;

    function renderizarPreviewTemaVisualAbm(nodo) {
        const box = document.getElementById('abm-tema-visual-preview');
        if (!box) return;
        const tv = (nodo?.tema_visual && typeof nodo.tema_visual === 'object') ? nodo.tema_visual : (ESTADO_NODOS.temaVisualEditando || {});
        const pal = (tv.paleta && typeof tv.paleta === 'object') ? tv.paleta : {};
        const logos = (tv.logos && typeof tv.logos === 'object') ? tv.logos : {};
        const tip = (tv.tipografia && typeof tv.tipografia === 'object') ? tv.tipografia : {};
        const palEntries = Object.entries(pal).filter(([, hex]) => /^#[0-9a-fA-F]{3,8}$/.test(String(hex || '').trim()));
        const logoSlots = [
            ['Horizontal', logos.horizontal],
            ['Vertical', logos.vertical],
            ['Isotipo', logos.isotipo],
            ['Zebra 1-bit', logos.zebra_mono]
        ].filter(([, url]) => Boolean(url));
        const slugHist = nodo?.slug_historico || ESTADO_NODOS.slugHistoricoActual || '';

        if (palEntries.length === 0 && logoSlots.length === 0 && !tip.familia && !slugHist) {
            const c = nodo?.color_primario || document.getElementById('abm-color-primario')?.value || '#a2553b';
            box.innerHTML = `<span style="color:#94a3b8;">Tema visual por defecto (color primario <code>${escaparHtml(c)}</code> + sello o logo cargado).</span>`;
            return;
        }

        box.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:7px;">
                <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px;">
                    <span style="color:#cbd5e1; font-weight:700;">✨ Identidad Marca Blanca extendida ${tip.familia ? `· Tipografía: <code>${escaparHtml(tip.familia)}</code>` : ''}</span>
                    ${slugHist ? `<span style="color:#bae6fd; background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.35); border-radius:999px; padding:1px 8px;">Alias histórico activo: <code>/tienda/${escaparHtml(slugHist)}</code></span>` : ''}
                </div>
                ${palEntries.length > 0 ? `
                    <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                        ${palEntries.slice(0, 9).map(([k, hex]) => `
                            <span title="${escaparHtml(k)}: ${escaparHtml(hex)}" style="display:inline-flex; align-items:center; gap:4px; padding:2px 6px; border-radius:5px; background:#0f172a; border:1px solid #334155; color:#e2e8f0; font-size:0.67rem;">
                                <span style="width:10px; height:10px; border-radius:3px; background:${escaparHtml(hex)}; border:1px solid rgba(255,255,255,0.35); display:inline-block;"></span>
                                ${escaparHtml(k)}: <code>${escaparHtml(hex)}</code>
                            </span>
                        `).join('')}
                    </div>
                ` : ''}
                ${logoSlots.length > 0 ? `
                    <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                        ${logoSlots.map(([label, url]) => `
                            <div style="display:flex; align-items:center; gap:6px; padding:4px 8px; border-radius:6px; background:#151e2e; border:1px solid #334155;">
                                <div style="width:48px; height:26px; background:#FBF8F3; border-radius:4px; display:flex; align-items:center; justify-content:center; padding:2px; overflow:hidden;">
                                    <img src="${escaparHtml(url)}" alt="${escaparHtml(label)}" style="max-width:100%; max-height:100%; object-fit:contain;">
                                </div>
                                <span style="font-size:0.68rem; color:#cbd5e1; font-weight:700;">${escaparHtml(label)}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function actualizarPreviewLogoColorAbm(srcBase64, nodoRef = null) {
        const imgColor = document.getElementById('abm-logo-color-preview-img');
        const emptyLbl = document.getElementById('abm-logo-color-empty');
        const effectiveSrc = (nodoRef?.tema_visual?.logos?.horizontal && !srcBase64?.startsWith('data:image/'))
            ? nodoRef.tema_visual.logos.horizontal
            : (nodoRef?.tema_visual?.logos?.horizontal && nodoRef?.tema_visual?.logos?.zebra_mono && srcBase64 === logoOriginalSubidoBase64)
                ? nodoRef.tema_visual.logos.horizontal
                : (srcBase64 || nodoRef?.tema_visual?.logos?.horizontal || null);
        if (imgColor && emptyLbl) {
            if (effectiveSrc) {
                imgColor.src = effectiveSrc;
                imgColor.style.display = 'block';
                emptyLbl.style.display = 'none';
            } else {
                imgColor.removeAttribute('src');
                imgColor.style.display = 'none';
                emptyLbl.style.display = 'inline';
            }
        }
    }

    function fijarColorPrimarioNodoAbm(hex) {
        const inp = document.getElementById('abm-color-primario');
        const lbl = document.getElementById('abm-color-hex-label');
        if (inp) inp.value = hex || '#a2553b';
        if (lbl) lbl.textContent = hex || '#a2553b';
    }

    function sincronizarSlugDesdeNombreAbm() {
        const nombre = document.getElementById('abm-nombre-marca')?.value || '';
        const slugEl = document.getElementById('abm-slug');
        if (slugEl && nombre.trim()) {
            slugEl.value = normalizarTextoBusqueda(nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            slugEl.dataset.manual = 'true';
        }
    }

    function resetearPreviewLogoAbm(opciones = {}) {
        const inicialesDefault = opciones.inicialesDefault !== undefined ? String(opciones.inicialesDefault) : '';
        const thresholdDefault = Number(opciones.thresholdDefault || 138);

        logoOriginalSubidoBase64 = null;
        limpiarLogoOriginalPendiente = false;
        actualizarPreviewLogoColorAbm(null);

        const fileInput = document.getElementById('abm-logo-file-input');
        if (fileInput) {
            fileInput.value = '';
        }

        const imgPrev = document.getElementById('abm-logo-preview-img');
        if (imgPrev) {
            imgPrev.removeAttribute('src');
        }

        const rolloPrev = document.getElementById('abm-rollo-preview-img');
        if (rolloPrev) {
            rolloPrev.removeAttribute('src');
        }

        const gfaTxt = document.getElementById('abm-logo-zpl-gfa');
        if (gfaTxt) gfaTxt.value = '';

        const rolloCode = document.getElementById('abm-rollo-zpl-code');
        if (rolloCode) rolloCode.value = '';

        const iniEl = document.getElementById('abm-logo-iniciales');
        if (iniEl) iniEl.value = inicialesDefault;

        const modeEl = document.getElementById('abm-logo-mode');
        if (modeEl) modeEl.value = 'threshold';

        const thEl = document.getElementById('abm-logo-threshold');
        if (thEl) thEl.value = String(thresholdDefault);

        const thSpan = document.getElementById('abm-threshold-val');
        if (thSpan) thSpan.textContent = String(thresholdDefault);
    }

    function alCambiarToggleRepartoAbm() {
        const chkRep = document.getElementById('abm-permitir-reparto');
        const cargoEl = document.getElementById('abm-cargo-envio');
        if (!chkRep || !cargoEl) return;
        cargoEl.disabled = !chkRep.checked;
        cargoEl.style.opacity = chkRep.checked ? '1' : '0.45';
    }

    function actualizarIndicadoresTarjetasAbm() {
        document.querySelectorAll('[data-abm-card-id]').forEach(card => {
            const cid = Number(card.getAttribute('data-abm-card-id'));
            const esActiva = Number(ESTADO_NODOS.nodoEditandoId) === cid;
            card.style.background = esActiva ? 'rgba(30,27,75,0.55)' : 'rgba(15,23,42,0.85)';
            card.style.borderWidth = esActiva ? '2px' : '1px';
            if (esActiva) {
                card.style.borderColor = '#a78bfa';
            } else {
                const nObj = ESTADO_NODOS.nodos.find(x => Number(x.id) === cid);
                card.style.borderColor = (nObj && nObj.activo === false) ? '#b45309' : '#334155';
            }
            const chip = card.querySelector(`[data-abm-edit-chip="${cid}"]`);
            if (chip) {
                chip.textContent = esActiva ? '✏️ Editando actualmente' : '✏️ Editar';
                chip.style.background = esActiva ? 'rgba(167,139,250,0.28)' : 'rgba(56,189,248,0.14)';
                chip.style.borderColor = esActiva ? '#a78bfa' : 'rgba(56,189,248,0.4)';
                chip.style.color = esActiva ? '#ede9fe' : '#bae6fd';
            }
        });
    }

    function actualizarEncabezadoFormularioAbm(nodo) {
        const titleEl = document.getElementById('abm-nodo-form-title');
        const subEl = document.getElementById('abm-nodo-form-sub');
        const actBox = document.getElementById('abm-nodo-form-actions');

        actualizarIndicadoresTarjetasAbm();

        if (nodo) {
            const esArchivado = nodo.activo === false;
            const nombreMarcaActual = document.getElementById('abm-nombre-marca')?.value?.trim() || nodo.nombre_marca || 'este Nodo';
            if (titleEl) {
                titleEl.innerHTML = `
                    <span>✏️ Editando: ${escaparHtml(nodo.nombre_marca)}</span>
                    <span style="font-size:0.76rem; font-family:monospace; color:#c4b5fd; background:rgba(167,139,250,0.18); padding:2px 8px; border-radius:6px;">${escaparHtml(nodo.codigo_nodo || `NODO-${nodo.id}`)}</span>
                    ${esArchivado ? `<span style="font-size:0.72rem; font-weight:900; padding:2px 8px; border-radius:6px; background:rgba(245,158,11,0.22); border:1px solid #f59e0b; color:#fcd34d;">ARCHIVADO</span>` : ''}
                `;
            }
            if (subEl) {
                const chkUnif = document.getElementById('abm-usar-cuenta-madre-unificada');
                const esUnif = chkUnif ? Boolean(chkUnif.checked) : Boolean(nodo.usar_cuenta_madre_unificada);
                const codigoMadre = document.getElementById('abm-cliente-madre-codigo')?.value?.trim() || nodo.codigo_bunker_cliente_madre || '';
                const infoCuenta = (esUnif && codigoMadre)
                    ? `Cuenta Unificada directo en <code>${escaparHtml(codigoMadre)}</code> (subcuenta <code>${escaparHtml(nodo.codigo_bunker_cliente || '')}</code> archivada)`
                    : `Subcuenta aislada <code>${escaparHtml(nodo.codigo_bunker_cliente || 'CB-NODO-xxx')}</code>`;
                subEl.innerHTML = `Modificando Nodo existente · ${infoCuenta} · Link tienda: <code>/tienda/${escaparHtml(nodo.slug)}</code>`;
            }
            if (actBox) {
                actBox.innerHTML = `
                    <button type="button" onclick="window.NodosPizarra.nuevoNodoFormulario()"
                        style="padding:7px 11px; border-radius:7px; font-weight:700; font-size:0.76rem; border:1px solid #475569; background:#0f172a; color:#cbd5e1; cursor:pointer;">
                        ➕ Nuevo / Salir de edición
                    </button>
                    <button type="button" onclick="window.NodosPizarra.toggleArchivarNodoAbm(${Number(nodo.id)}, ${esArchivado ? 'true' : 'false'})"
                        style="padding:7px 11px; border-radius:7px; font-weight:700; font-size:0.76rem; border:1px solid ${esArchivado ? '#10b981' : '#f59e0b'}; background:${esArchivado ? 'rgba(16,185,129,0.18)' : 'rgba(245,158,11,0.16)'}; color:${esArchivado ? '#6ee7b7' : '#fcd34d'}; cursor:pointer;">
                        ${esArchivado ? '♻️ Reactivar Nodo' : '⏸️ Archivar Nodo'}
                    </button>
                    ${ESTADO_NODOS.modoLaboratorio ? `
                        <button type="button" onclick="window.NodosPizarra.eliminarNodoPruebaAbm(${Number(nodo.id)})"
                            style="padding:7px 11px; border-radius:7px; font-weight:700; font-size:0.76rem; border:1px solid rgba(244,63,94,0.65); background:rgba(244,63,94,0.16); color:#fda4af; cursor:pointer;">
                            🗑️ Eliminar Prueba (Lab)
                        </button>
                    ` : ''}
                    <button type="button" id="abm-btn-guardar-principal" onclick="window.NodosPizarra.guardarNodoAbm()"
                        style="padding:8px 16px; border-radius:8px; font-weight:800; font-size:0.82rem; border:none; background:linear-gradient(135deg, #10b981, #059669); color:#052e16; cursor:pointer;">
                        💾 Guardar Cambios en ${escaparHtml(nombreMarcaActual)}
                    </button>
                `;
            }
        } else {
            if (titleEl) {
                titleEl.innerHTML = `➕ Creando Nuevo Nodo`;
            }
            if (subEl) {
                subEl.innerHTML = `Alta nueva · Todo Nodo parte de un Cliente Titular en LAMDA y crea una subcuenta aislada (<code>CB-NODO-xxx</code>).`;
            }
            if (actBox) {
                actBox.innerHTML = `
                    <button type="button" id="abm-btn-guardar-principal" onclick="window.NodosPizarra.guardarNodoAbm()"
                        style="padding:8px 16px; border-radius:8px; font-weight:800; font-size:0.82rem; border:none; background:linear-gradient(135deg, #10b981, #059669); color:#052e16; cursor:pointer;">
                        💾 Guardar Nuevo Nodo y Etiqueta ZPL
                    </button>
                `;
            }
        }
    }

    function toggleMostrarArchivadosAbm(mostrar) {
        ESTADO_NODOS.mostrarArchivadosAbm = Boolean(mostrar);
        renderizarVistaNodosCompleta();
    }

    async function toggleArchivarNodoAbm(nodoId, activar) {
        try {
            const nodo = ESTADO_NODOS.nodos.find(n => Number(n.id) === Number(nodoId));
            const accionLabel = activar ? 'reactivar' : 'archivar';
            if (window.Swal) {
                const conf = await Swal.fire({
                    icon: activar ? 'question' : 'warning',
                    title: activar ? `♻️ ¿Reactivar "${escaparHtml(nodo?.nombre_marca || '')}"?` : `⏸️ ¿Archivar "${escaparHtml(nodo?.nombre_marca || '')}"?`,
                    text: activar
                        ? 'La tienda vecinal, el Panel Gestor y su circuito operativo volverán a estar disponibles.'
                        : 'Bloqueará la tienda vecinal, el Panel del Gestor y el alta de pedidos, pero conservará intacto su historial contable y liquidaciones.',
                    showCancelButton: true,
                    confirmButtonText: `Sí, ${accionLabel}`,
                    cancelButtonText: 'Cancelar',
                    confirmButtonColor: activar ? '#10b981' : '#d97706',
                    background: '#151e2e',
                    color: '#f8fafc'
                });
                if (!conf.isConfirmed) return;
            }
            const resp = await fetch(`/api/produccion/nodos/maestro/${nodoId}/estado`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activo: Boolean(activar) })
            });
            const data = await resp.json();
            if (!resp.ok || !data.ok) throw new Error(data.error || 'No se pudo cambiar el estado del Nodo');
            if (!activar) ESTADO_NODOS.mostrarArchivadosAbm = true;
            await cargarDatosNodosBarriales(true);
            cargarNodoEnFormularioAbm(nodoId);
        } catch (err) {
            alert('❌ ' + err.message);
        }
    }

    async function eliminarNodoPruebaAbm(nodoId) {
        try {
            if (!ESTADO_NODOS.modoLaboratorio) {
                alert('⚠️ Esta acción solo está disponible en Modo Laboratorio.');
                return;
            }
            const nodo = ESTADO_NODOS.nodos.find(n => Number(n.id) === Number(nodoId));
            if (!nodo) return;
            const resConfirm = window.Swal
                ? await Swal.fire({
                    icon: 'warning',
                    title: `🗑️ ¿Eliminar Nodo de prueba "${escaparHtml(nodo.nombre_marca)}"?`,
                    html: `
                        <div style="text-align:left; font-size:0.84rem; line-height:1.5;">
                            <p>Esta acción eliminará <strong>únicamente</strong> este Nodo de prueba (<code>${escaparHtml(nodo.codigo_nodo)}</code>), sus ofertas, vecinos, pedidos, canastos y subcuenta aislada <code>${escaparHtml(nodo.codigo_bunker_cliente || '')}</code> en <strong>etiquetas_pruebas</strong>.</p>
                            <p style="color:#6ee7b7;">🛡️ El Cliente Titular Madre (<code>${escaparHtml(nodo.codigo_bunker_cliente_madre || 'N/A')}</code>) y los demás Nodos permanecerán intactos.</p>
                        </div>
                    `,
                    input: 'text',
                    inputLabel: `Escribí "${nodo.slug}" para confirmar`,
                    inputPlaceholder: nodo.slug,
                    showCancelButton: true,
                    confirmButtonText: '🗑️ Eliminar definitivamente (Lab)',
                    cancelButtonText: 'Cancelar',
                    confirmButtonColor: '#dc2626',
                    background: '#151e2e',
                    color: '#f8fafc',
                    preConfirm: (val) => {
                        if (String(val || '').trim().toLowerCase() !== String(nodo.slug || '').trim().toLowerCase()) {
                            Swal.showValidationMessage(`Debe escribir exactamente "${nodo.slug}"`);
                            return false;
                        }
                        return true;
                    }
                })
                : { isConfirmed: confirm(`¿Eliminar el Nodo de prueba ${nodo.nombre_marca} (${nodo.slug})?`) };

            if (!resConfirm.isConfirmed) return;

            const resp = await fetch(`/api/produccion/nodos/maestro/${nodoId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ motivo: 'Eliminación manual desde ABM Lab' })
            });
            const data = await resp.json();
            if (!resp.ok || !data.ok) throw new Error(data.error || 'Error eliminando Nodo de prueba');

            ESTADO_NODOS.nodoEditandoId = null;
            ESTADO_NODOS.modoCreacionNuevo = false;
            ESTADO_NODOS.clienteMadreSeleccionadoId = null;
            await cargarDatosNodosBarriales(true);

            if (window.Swal && data.resumen) {
                const r = data.resumen;
                Swal.fire({
                    icon: 'success',
                    title: '🗑️ Nodo de prueba eliminado',
                    html: `Se eliminó <strong>${escaparHtml(r.nombre_marca)}</strong> (${r.pedidos_eliminados} pedidos, ${r.vecinos_eliminados} vecinos, ${r.canastos_eliminados} canastos). Cliente Titular <code>${escaparHtml(r.codigo_bunker_cliente_madre_preservado || 'N/A')}</code> preservado.`,
                    background: '#151e2e',
                    color: '#f8fafc'
                });
            }
        } catch (err) {
            alert('❌ ' + err.message);
        }
    }

    function cargarNodoEnFormularioAbm(nodoId) {
        const nodo = ESTADO_NODOS.nodos.find(n => Number(n.id) === Number(nodoId));
        if (!nodo) return;
        ESTADO_NODOS.modoCreacionNuevo = false;
        ESTADO_NODOS.nodoEditandoId = Number(nodo.id);
        ESTADO_NODOS.clienteMadreSeleccionadoId = nodo.cliente_madre_bunker_id ? Number(nodo.cliente_madre_bunker_id) : null;
        ESTADO_NODOS.logoZplConfigActual = (nodo.logo_zpl_config && typeof nodo.logo_zpl_config === 'object') ? { ...nodo.logo_zpl_config } : null;
        ESTADO_NODOS.temaVisualEditando = (nodo.tema_visual && typeof nodo.tema_visual === 'object') ? JSON.parse(JSON.stringify(nodo.tema_visual)) : {};
        ESTADO_NODOS.slugHistoricoActual = nodo.slug_historico || '';
        logoOriginalSubidoBase64 = nodo.logo_original_base64 || null;
        limpiarLogoOriginalPendiente = false;

        const fileInput = document.getElementById('abm-logo-file-input');
        if (fileInput) fileInput.value = '';

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val ?? '';
        };

        const cfgCanal = ESTADO_NODOS.fuentes?.config_cuenta_canal || { alias_recaudador: 'pago.canasto' };

        setVal('abm-nodo-id', nodo.id);
        setVal('abm-nombre-marca', nodo.nombre_marca);
        setVal('abm-bajada-marca', nodo.bajada_marca || '');
        setVal('abm-slug', nodo.slug);
        const slugEl = document.getElementById('abm-slug');
        if (slugEl) slugEl.dataset.manual = 'true';
        setVal('abm-subtitulo', nodo.subtitulo_marca);
        fijarColorPrimarioNodoAbm(nodo.color_primario || '#a2553b');
        renderizarPreviewTemaVisualAbm(nodo);
        setVal('abm-gestor-nombre', nodo.gestor_nombre);
        setVal('abm-gestor-tel', nodo.gestor_telefono);
        setVal('abm-barrio', nodo.barrio_zona);
        setVal('abm-direccion', nodo.direccion_retiro);
        setVal('abm-latitud', nodo.latitud ?? '');
        setVal('abm-longitud', nodo.longitud ?? '');
        setVal('abm-cliente-madre-id', nodo.cliente_madre_bunker_id || '');
        setVal('abm-cliente-madre-codigo', nodo.codigo_bunker_cliente_madre || '');
        const chkUnif = document.getElementById('abm-usar-cuenta-madre-unificada');
        if (chkUnif) chkUnif.checked = Boolean(nodo.usar_cuenta_madre_unificada);
        const chkComp = document.getElementById('abm-cuenta-compartida');
        if (chkComp) chkComp.checked = nodo.usa_cuenta_compartida !== false;
        const chkRet = document.getElementById('abm-permitir-retiro');
        if (chkRet) chkRet.checked = nodo.permitir_retiro_nodo !== false;
        const chkRep = document.getElementById('abm-permitir-reparto');
        if (chkRep) chkRep.checked = Boolean(nodo.permitir_reparto_propio ?? nodo.permitir_envio_barrial ?? true);
        const chkEnc = document.getElementById('abm-permitir-encomienda');
        if (chkEnc) chkEnc.checked = Boolean(nodo.permitir_encomienda);
        alCambiarToggleRepartoAbm();
        const chkIngTienda = document.getElementById('abm-mostrar-ingredientes-tienda');
        if (chkIngTienda) chkIngTienda.checked = nodo.mostrar_ingredientes_tienda !== false;
        setVal('abm-alias-display', nodo.alias_bancario_display || cfgCanal.alias_recaudador || 'pago.canasto');
        setVal('abm-cargo-envio', Number(nodo.cargo_envio_barrial || 0));
        setVal('abm-margen-default', Number(nodo.margen_gestor_default_pct || 28));

        const cfg = nodo.logo_zpl_config || {};
        setVal('abm-logo-iniciales', cfg.iniciales || '');
        setVal('abm-logo-mode', cfg.mode || 'threshold');
        const thEfectivo = cfg.threshold || (nodo.logo_original_base64 ? 180 : 138);
        setVal('abm-logo-threshold', thEfectivo);
        const thSpan = document.getElementById('abm-threshold-val');
        if (thSpan) thSpan.textContent = thEfectivo;

        actualizarPreviewLogoColorAbm(nodo.logo_original_base64 || null, nodo);
        const imgPrev = document.getElementById('abm-logo-preview-img');
        if (imgPrev) {
            if (nodo.logo_mono_preview_base64) {
                imgPrev.src = nodo.logo_mono_preview_base64;
            } else {
                imgPrev.removeAttribute('src');
            }
        }
        setVal('abm-logo-zpl-gfa', nodo.logo_zpl_gfa || '');

        const listaBox = document.getElementById('abm-lista-clientes-titulares');
        if (listaBox) listaBox.innerHTML = renderizarListaClientesTitularesHtml(ESTADO_NODOS.busquedaClienteAbm, ESTADO_NODOS.clienteMadreSeleccionadoId);
        const resBox = document.getElementById('abm-cliente-titular-resumen');
        const cliSel = (ESTADO_NODOS.fuentes.clientes_bunker || []).find(c => Number(c.id) === Number(ESTADO_NODOS.clienteMadreSeleccionadoId));
        if (resBox) resBox.innerHTML = renderizarResumenClienteTitularHtml(cliSel);
        if (cliSel) renderizarChipsDomiciliosClienteAbm(cliSel, 0);

        if (!nodo.logo_mono_preview_base64 || !nodo.logo_zpl_gfa) {
            regenerarLogoZplEnVivo();
        } else {
            simularEtiquetaZebra('estandar_pagado');
        }
        actualizarEncabezadoFormularioAbm(nodo);
        syncMapaSiPanelAbmAbierto(nodo);
    }

    function nuevoNodoFormulario() {
        ESTADO_NODOS.modoCreacionNuevo = true;
        ESTADO_NODOS.nodoEditandoId = null;
        ESTADO_NODOS.clienteMadreSeleccionadoId = null;
        ESTADO_NODOS.logoZplConfigActual = null;
        ESTADO_NODOS.temaVisualEditando = {};
        ESTADO_NODOS.slugHistoricoActual = '';
        ESTADO_NODOS.busquedaClienteAbm = '';
        abmUltimaSugerenciaMapa = { barrio: '', calle: '', lat: null, lng: null };

        // Re-renderizar la vista limpia para quitar selección de tarjeta previa y recrear inputs limpios
        renderizarVistaNodosCompleta();

        const cfgCanal = ESTADO_NODOS.fuentes?.config_cuenta_canal || { alias_recaudador: 'pago.canasto' };
        const ids = [
            'abm-nodo-id',
            'abm-nombre-marca',
            'abm-bajada-marca',
            'abm-slug',
            'abm-gestor-nombre',
            'abm-gestor-tel',
            'abm-barrio',
            'abm-direccion',
            'abm-latitud',
            'abm-longitud',
            'abm-logo-iniciales',
            'abm-cliente-madre-id',
            'abm-cliente-madre-codigo',
            'abm-buscador-cliente-input',
            'abm-mapa-search-input'
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        fijarColorPrimarioNodoAbm('#a2553b');
        resetearPreviewLogoAbm({ inicialesDefault: '', thresholdDefault: 138 });
        renderizarPreviewTemaVisualAbm(null);
        const aliasEl = document.getElementById('abm-alias-display');
        if (aliasEl) aliasEl.value = cfgCanal.alias_recaudador || 'pago.canasto';
        const chkUnif = document.getElementById('abm-usar-cuenta-madre-unificada');
        if (chkUnif) chkUnif.checked = false;
        const chkComp = document.getElementById('abm-cuenta-compartida');
        if (chkComp) chkComp.checked = true;
        const chkRet = document.getElementById('abm-permitir-retiro');
        if (chkRet) chkRet.checked = true;
        const chkRep = document.getElementById('abm-permitir-reparto');
        if (chkRep) chkRep.checked = true;
        const chkEnc = document.getElementById('abm-permitir-encomienda');
        if (chkEnc) chkEnc.checked = false;
        alCambiarToggleRepartoAbm();
        const chkIngTienda = document.getElementById('abm-mostrar-ingredientes-tienda');
        if (chkIngTienda) chkIngTienda.checked = true;
        const slugEl = document.getElementById('abm-slug');
        if (slugEl) slugEl.dataset.manual = '';
        const sub = document.getElementById('abm-subtitulo');
        if (sub) sub.value = 'Alimentos Naturales y Frutos Secos - Entrega Barrial';
        const domSug = document.getElementById('abm-domicilios-sugeridos');
        if (domSug) domSug.innerHTML = '';
        const mapPanel = document.getElementById('abm-mapa-panel');
        if (mapPanel) mapPanel.style.display = 'none';
        const listaBox = document.getElementById('abm-lista-clientes-titulares');
        if (listaBox) listaBox.innerHTML = renderizarListaClientesTitularesHtml('', null);
        const resBox = document.getElementById('abm-cliente-titular-resumen');
        if (resBox) resBox.innerHTML = renderizarResumenClienteTitularHtml(null);
        ocultarDropdownsGeoAbm();
        actualizarEncabezadoFormularioAbm(null);
        regenerarLogoZplEnVivo();
    }

    function alCambiarModoCuentaUnificadaAbm() {
        const resBox = document.getElementById('abm-cliente-titular-resumen');
        const cliSel = (ESTADO_NODOS.fuentes.clientes_bunker || []).find(
            c => Number(c.id) === Number(ESTADO_NODOS.clienteMadreSeleccionadoId)
        );
        if (resBox) resBox.innerHTML = renderizarResumenClienteTitularHtml(cliSel || null);
        const nodoEditando = ESTADO_NODOS.nodoEditandoId
            ? ESTADO_NODOS.nodos.find(n => Number(n.id) === Number(ESTADO_NODOS.nodoEditandoId))
            : null;
        actualizarEncabezadoFormularioAbm(nodoEditando || null);
    }

    function filtrarClientesTitularesAbm(val) {
        ESTADO_NODOS.busquedaClienteAbm = val || '';
        const listaBox = document.getElementById('abm-lista-clientes-titulares');
        if (listaBox) {
            listaBox.innerHTML = renderizarListaClientesTitularesHtml(
                ESTADO_NODOS.busquedaClienteAbm,
                ESTADO_NODOS.clienteMadreSeleccionadoId
            );
        }
    }

    async function seleccionarClienteTitularAbm(clienteId) {
        const cli = (ESTADO_NODOS.fuentes.clientes_bunker || []).find(c => Number(c.id) === Number(clienteId));
        if (!cli) return;

        ESTADO_NODOS.clienteMadreSeleccionadoId = Number(cli.id);

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val ?? '';
        };

        setVal('abm-cliente-madre-id', cli.id);
        setVal('abm-cliente-madre-codigo', cli.codigo_bunker_cliente || '');

        const listaBox = document.getElementById('abm-lista-clientes-titulares');
        if (listaBox) {
            listaBox.innerHTML = renderizarListaClientesTitularesHtml(
                ESTADO_NODOS.busquedaClienteAbm,
                ESTADO_NODOS.clienteMadreSeleccionadoId
            );
        }
        const resBox = document.getElementById('abm-cliente-titular-resumen');
        if (resBox) {
            resBox.innerHTML = renderizarResumenClienteTitularHtml(cli);
        }

        const datos = extraerDatosContactoClienteBunker(cli);
        setVal('abm-gestor-nombre', datos.nombreTitular);
        if (datos.telefono) setVal('abm-gestor-tel', datos.telefono);
        setVal('abm-barrio', datos.barrioZona || '');
        if (datos.direccionPrincipal) setVal('abm-direccion', datos.direccionPrincipal);
        setVal('abm-latitud', datos.latitud ?? '');
        setVal('abm-longitud', datos.longitud ?? '');

        // Renderizar chips de domicilios con indicador GPS / Mapa
        renderizarChipsDomiciliosClienteAbm(cli, 0);

        // Si es un alta nueva (sin nodoEditandoId), sugerir nombre de marca, slug, iniciales y alias compartido del canal
        if (!ESTADO_NODOS.nodoEditandoId) {
            const nombreMarcaInput = document.getElementById('abm-nombre-marca');
            const slugInput = document.getElementById('abm-slug');
            const iniInput = document.getElementById('abm-logo-iniciales');

            const primerNombre = String(datos.nombreTitular || '').trim().split(/\s+/)[0] || 'Barrial';
            const marcaSugerida = `${primerNombre} Frutos Secos`;
            if (nombreMarcaInput && !nombreMarcaInput.value.trim()) {
                nombreMarcaInput.value = marcaSugerida;
            }
            const marcaActual = nombreMarcaInput?.value || marcaSugerida;
            if (slugInput && slugInput.dataset.manual !== 'true') {
                slugInput.value = normalizarTextoBusqueda(marcaActual).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            }
            if (iniInput) {
                const palabras = String(datos.nombreTitular || marcaActual).trim().split(/\s+/).filter(Boolean);
                const inicialesSug = palabras.slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('') || 'NB';
                iniInput.value = inicialesSug;
            }

            const cfgCanal = ESTADO_NODOS.fuentes?.config_cuenta_canal || { alias_recaudador: 'LAMDA.SER.MARTIN' };
            const aliasInput = document.getElementById('abm-alias-display');
            if (aliasInput) {
                aliasInput.value = cfgCanal.alias_recaudador || 'LAMDA.SER.MARTIN';
            }
        }

        regenerarLogoZplEnVivo();

        // Resolver automáticamente el Barrio / Localidad desde Google Maps si el domicilio tiene GPS o texto
        if (datos.latitud && datos.longitud) {
            await resolverBarrioDesdeCoordenadasAbm(datos.latitud, datos.longitud, {
                autocompletarBarrio: true,
                etiquetaOrigen: 'Domicilio con GPS en ficha'
            });
            const mapPanel = document.getElementById('abm-mapa-panel');
            if (mapPanel && mapPanel.style.display !== 'none') {
                await asegurarInstanciaMapaAbm(datos.latitud, datos.longitud);
            }
        } else if (datos.direccionPrincipal) {
            const queryConCtx = construirQueryDomicilioConContextoAbm(datos.direccionPrincipal);
            await geocodificarTextoEnMapaAbm(queryConCtx, {
                autocompletarBarrio: !String(document.getElementById('abm-barrio')?.value || '').trim(),
                etiquetaOrigen: 'Domicilio en ficha'
            });
        }
    }

    function aplicarDomicilioSugeridoAbm(direccion) {
        const el = document.getElementById('abm-direccion');
        if (el) el.value = direccion || '';
        simularEtiquetaZebra('estandar_pagado');
    }

    function alEditarNombreMarcaAbm(nombre) {
        const slugInput = document.getElementById('abm-slug');
        if (!ESTADO_NODOS.nodoEditandoId && slugInput && slugInput.dataset.manual !== 'true') {
            slugInput.value = normalizarTextoBusqueda(nombre || '')
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
        }
        const iniInput = document.getElementById('abm-logo-iniciales');
        if (!ESTADO_NODOS.nodoEditandoId && iniInput && nombre) {
            const palabras = String(nombre).trim().split(/\s+/).filter(Boolean);
            iniInput.value = palabras.slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('').slice(0, 3);
        }
        if (ESTADO_NODOS.nodoEditandoId) {
            const nom = String(nombre || '').trim() || 'este Nodo';
            const btnP = document.getElementById('abm-btn-guardar-principal');
            if (btnP) btnP.textContent = `💾 Guardar Cambios en ${nom}`;
            const btnM = document.getElementById('abm-btn-guardar-ubicacion-mapa');
            if (btnM) btnM.textContent = `💾 Guardar esta ubicación en ${nom}`;
        }
        regenerarLogoZplEnVivo();
    }

    async function enviarLinksBienvenidaNodoWa(nodoId) {
        try {
            if (typeof window.abrirModalEnvioOmnicanalNodo !== 'function') {
                await new Promise((resolve, reject) => {
                    const sc = document.createElement('script');
                    sc.src = '/api/produccion/nodos/comunicaciones-modal.js?v=1.0.0';
                    sc.onload = resolve;
                    sc.onerror = () => reject(new Error('No se pudo cargar el módulo interno de envío omnicanal.'));
                    document.head.appendChild(sc);
                });
            }
            await window.abrirModalEnvioOmnicanalNodo({
                nodoId: Number(nodoId),
                plantillaInicial: 'gestor_y_tienda',
                qrTipoInicial: 'tienda_afiche',
                adjuntarQrInicial: true
            });
        } catch (err) {
            if (window.Swal) {
                Swal.fire({ icon: 'error', title: 'Error de Envío Interno', text: err.message, background: '#151e2e', color: '#f8fafc' });
            } else {
                window.alert(err.message);
            }
        }
    }

    function subirArchivoLogo(event) {
        const file = event?.target?.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            logoOriginalSubidoBase64 = e.target.result;
            limpiarLogoOriginalPendiente = false;
            ESTADO_NODOS.logoZplConfigActual = null;
            actualizarPreviewLogoColorAbm(logoOriginalSubidoBase64, null);
            const thEl = document.getElementById('abm-logo-threshold');
            const thSpan = document.getElementById('abm-threshold-val');
            if (thEl && Number(thEl.value) < 160) {
                thEl.value = 180;
                if (thSpan) thSpan.textContent = '180';
            }
            regenerarLogoZplEnVivo();
        };
        reader.readAsDataURL(file);
    }

    function quitarLogoImagenAbm() {
        logoOriginalSubidoBase64 = null;
        limpiarLogoOriginalPendiente = true;
        ESTADO_NODOS.logoZplConfigActual = null;
        const fileInput = document.getElementById('abm-logo-file-input');
        if (fileInput) fileInput.value = '';
        const thEl = document.getElementById('abm-logo-threshold');
        const thSpan = document.getElementById('abm-threshold-val');
        if (thEl) thEl.value = '138';
        if (thSpan) thSpan.textContent = '138';
        actualizarPreviewLogoColorAbm(null, null);
        regenerarLogoZplEnVivo();
    }

    async function regenerarLogoZplEnVivo() {
        try {
            const nombreMarca = document.getElementById('abm-nombre-marca')?.value || 'NODO';
            const iniciales = document.getElementById('abm-logo-iniciales')?.value || '';
            const mode = document.getElementById('abm-logo-mode')?.value || 'threshold';
            const threshold = Number(document.getElementById('abm-logo-threshold')?.value || 138);
            const zplCfg = ESTADO_NODOS.logoZplConfigActual || {};

            const resp = await fetch('/api/produccion/nodos/convertir-logo-zpl', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageBase64: logoOriginalSubidoBase64,
                    nombreMarca,
                    iniciales,
                    mode,
                    threshold,
                    width: zplCfg.width || undefined,
                    height: zplCfg.height || undefined,
                    padding: zplCfg.padding,
                    invert: Boolean(zplCfg.invert)
                })
            });
            const data = await resp.json();
            if (!data.ok) return;

            const imgPrev = document.getElementById('abm-logo-preview-img');
            if (imgPrev) imgPrev.src = data.logo_mono_preview_base64;
            const gfaTxt = document.getElementById('abm-logo-zpl-gfa');
            if (gfaTxt) gfaTxt.value = data.logo_zpl_gfa;

            simularEtiquetaZebra('estandar_pagado');
        } catch (err) {
            console.error(err);
        }
    }

    async function simularEtiquetaZebra(modo = 'estandar_pagado') {
        try {
            const nombreMarca = document.getElementById('abm-nombre-marca')?.value || 'ALMACEN NATURAL BARRIAL';
            const bajadaMarca = document.getElementById('abm-bajada-marca')?.value || '';
            const subtitulo = document.getElementById('abm-subtitulo')?.value || 'Comunidad Barrial - Entrega Fresca';
            const direccion = document.getElementById('abm-direccion')?.value || 'Punto de Retiro del Nodo';
            const logoGfa = document.getElementById('abm-logo-zpl-gfa')?.value || '';
            const logoMono = document.getElementById('abm-logo-preview-img')?.src || '';

            const itemsEstandar = [
                { cantidad: 2, descripcion: 'Almendra Nonpareil Californiana x 250g' },
                { cantidad: 1, descripcion: 'Mix Frutos Secos con Pasas Familiar x 500g' },
                { cantidad: 1, descripcion: 'Castana de Caju Tostada Artesanal x 250g' },
                { cantidad: 1, descripcion: 'Granola de Sol Crocante con Miel x 500g' }
            ];

            const itemsLargo = [
                ...itemsEstandar,
                { cantidad: 2, descripcion: 'Pack Familiar 6 Barritas Energeticas (6 x 50g)' },
                { cantidad: 1, descripcion: 'Nuez Mariposa Extra Light Seleccionada x 250g' },
                { cantidad: 1, descripcion: 'Arandanos Pasas Deshidratados Premium x 250g' },
                { cantidad: 2, descripcion: 'Coco en Escamas Natural Importado x 200g' },
                { cantidad: 1, descripcion: 'Pistacho con Cascara Tostado y Salado x 200g' }
            ];

            const esLargo = modo === 'largo_continuacion';
            const payload = {
                nombre_marca: nombreMarca,
                bajada_marca: bajadaMarca,
                subtitulo_marca: subtitulo,
                logo_zpl_gfa: logoGfa,
                logo_mono_preview_base64: logoMono,
                logo_zpl_config: ESTADO_NODOS.logoZplConfigActual || undefined,
                pedido_codigo: esLargo ? 'NB-1089' : 'NB-1042',
                vecino_nombre: esLargo ? 'VALERIA SANCHEZ' : 'MARIA LAURA GOMEZ',
                vecino_telefono: esLargo ? '221-509-4412' : '221-554-8910',
                modalidad_entrega: esLargo ? 'ENVIO BARRIAL (17:00 A 20:00 HS)' : 'RETIRO EN NODO (17:00 A 20:00 HS)',
                direccion_barrial: direccion,
                estado_pago: esLargo ? 'COBRAR EFECTIVO' : 'PAGADO (TRANSFERENCIA)',
                monto_cobrar: esLargo ? 46800 : 0,
                bultos_texto: 'BOLSA 1/1',
                items: esLargo ? itemsLargo : itemsEstandar
            };

            const resp = await fetch('/api/produccion/nodos/preview-etiqueta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (!data.ok) return;

            const rolloImg = document.getElementById('abm-rollo-preview-img');
            if (rolloImg) rolloImg.src = data.preview_rollo_base64;
            const zplArea = document.getElementById('abm-rollo-zpl-code');
            if (zplArea) zplArea.value = data.zpl;
        } catch (err) {
            console.error(err);
        }
    }

    async function guardarNodoAbm() {
        try {
            const idExistente = document.getElementById('abm-nodo-id')?.value || null;
            const cfgCanal = ESTADO_NODOS.fuentes?.config_cuenta_canal || {
                cuenta_bancaria_id: 1,
                alias_recaudador: 'LAMDA.SER.MARTIN',
                cbu_recaudador: '0070373230004007844141',
                titular_recaudador: 'Martín Ignacio Serrano'
            };

            const clienteMadreIdVal = document.getElementById('abm-cliente-madre-id')?.value || ESTADO_NODOS.clienteMadreSeleccionadoId || null;
            const cliObj = (ESTADO_NODOS.fuentes.clientes_bunker || []).find(c => Number(c.id) === Number(clienteMadreIdVal));
            const codigoMadreVal = document.getElementById('abm-cliente-madre-codigo')?.value || cliObj?.codigo_bunker_cliente || null;

            if (!clienteMadreIdVal) {
                throw new Error('Debe seleccionar primero el Cliente Titular del Nodo en el buscador del Paso 1.');
            }

            const usaComp = Boolean(document.getElementById('abm-cuenta-compartida')?.checked);
            const aliasEscrito = document.getElementById('abm-alias-display')?.value?.trim() || cfgCanal.alias_recaudador || 'LAMDA.SER.MARTIN';

            const latVal = document.getElementById('abm-latitud')?.value;
            const lngVal = document.getElementById('abm-longitud')?.value;

            const permitirRetiro = Boolean(document.getElementById('abm-permitir-retiro')?.checked ?? true);
            const permitirReparto = Boolean(document.getElementById('abm-permitir-reparto')?.checked ?? true);
            const permitirEncomienda = Boolean(document.getElementById('abm-permitir-encomienda')?.checked ?? false);
            if (!permitirRetiro && !permitirReparto && !permitirEncomienda) {
                throw new Error('Debés habilitar al menos una modalidad activa de entrega (Punto de Retiro, Reparto Propio o Paquetería Nacional).');
            }

            const colorPrimarioVal = document.getElementById('abm-color-primario')?.value || '#a2553b';
            const temaVisualPayload = (ESTADO_NODOS.temaVisualEditando && Object.keys(ESTADO_NODOS.temaVisualEditando).length > 0)
                ? JSON.parse(JSON.stringify(ESTADO_NODOS.temaVisualEditando))
                : undefined;
            if (temaVisualPayload?.paleta && colorPrimarioVal) {
                temaVisualPayload.paleta.terracota = colorPrimarioVal;
            }

            const payload = {
                nombre_marca: document.getElementById('abm-nombre-marca')?.value || '',
                bajada_marca: document.getElementById('abm-bajada-marca')?.value?.trim() || null,
                slug: document.getElementById('abm-slug')?.value || '',
                slug_historico: ESTADO_NODOS.slugHistoricoActual || undefined,
                subtitulo_marca: document.getElementById('abm-subtitulo')?.value || '',
                gestor_nombre: document.getElementById('abm-gestor-nombre')?.value || '',
                gestor_telefono: document.getElementById('abm-gestor-tel')?.value || '',
                barrio_zona: document.getElementById('abm-barrio')?.value || '',
                direccion_retiro: document.getElementById('abm-direccion')?.value || '',
                latitud: latVal !== '' && latVal !== undefined ? Number(latVal) : null,
                longitud: lngVal !== '' && lngVal !== undefined ? Number(lngVal) : null,
                cliente_madre_bunker_id: Number(clienteMadreIdVal),
                codigo_bunker_cliente_madre: codigoMadreVal,
                usar_cuenta_madre_unificada: Boolean(document.getElementById('abm-usar-cuenta-madre-unificada')?.checked),
                cuenta_bancaria_id: cfgCanal.cuenta_bancaria_id || null,
                usa_cuenta_compartida: usaComp,
                alias_bancario_display: usaComp ? (cfgCanal.alias_recaudador || aliasEscrito) : aliasEscrito,
                cbu_display: cfgCanal.cbu_recaudador || '',
                titular_display: cfgCanal.titular_recaudador || '',
                permitir_retiro_nodo: permitirRetiro,
                permitir_reparto_propio: permitirReparto,
                permitir_encomienda: permitirEncomienda,
                permitir_envio_barrial: permitirReparto,
                cargo_envio_barrial: Number(document.getElementById('abm-cargo-envio')?.value || 0),
                mostrar_ingredientes_tienda: Boolean(document.getElementById('abm-mostrar-ingredientes-tienda')?.checked ?? true),
                margen_gestor_default_pct: Number(document.getElementById('abm-margen-default')?.value || 28),
                color_primario: colorPrimarioVal,
                tema_visual: temaVisualPayload,
                logo_original_base64: logoOriginalSubidoBase64,
                limpiar_logo_original: limpiarLogoOriginalPendiente,
                logo_zpl_config: {
                    ...(ESTADO_NODOS.logoZplConfigActual || {}),
                    iniciales: document.getElementById('abm-logo-iniciales')?.value || '',
                    mode: document.getElementById('abm-logo-mode')?.value || 'threshold',
                    threshold: Number(document.getElementById('abm-logo-threshold')?.value || 138)
                }
            };

            const url = idExistente ? `/api/produccion/nodos/maestro/${idExistente}` : '/api/produccion/nodos/maestro';
            const method = idExistente ? 'PUT' : 'POST';

            const resp = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (!resp.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar el Nodo');

            ESTADO_NODOS.modoCreacionNuevo = false;
            ESTADO_NODOS.nodoEditandoId = data.nodo.id;
            await cargarDatosNodosBarriales(true);
            cargarNodoEnFormularioAbm(data.nodo.id);

            if (window.Swal) {
                const resSwal = await Swal.fire({
                    icon: 'success',
                    title: '✅ Nodo Guardado',
                    html: `
                        <div style="text-align:left; font-size:0.85rem; line-height:1.5;">
                            <p><strong>${escaparHtml(data.nodo.nombre_marca)}</strong> quedó activo vinculado al Cliente Titular <code>${escaparHtml(data.nodo.codigo_bunker_cliente_madre || '')}</code> ${data.nodo.usar_cuenta_madre_unificada ? `(<strong>Cuenta Única Unificada</strong> · subcuenta <code>${escaparHtml(data.nodo.codigo_bunker_cliente || '')}</code> archivada sin duplicidad)` : `con subcuenta aislada <code>${escaparHtml(data.nodo.codigo_bunker_cliente || '')}</code>`}.</p>
                            <div style="margin-top:8px; padding:10px; border-radius:8px; background:#0f172a; border:1px solid #334155; font-size:0.79rem;">
                                <div>📍 <strong>Retiro:</strong> ${escaparHtml(data.nodo.direccion_retiro || '')} (${escaparHtml(data.nodo.barrio_zona || '')})</div>
                                <div>🏦 <strong>Alias Vecinos (Marca Blanca):</strong> <code>${escaparHtml(data.nodo.alias_bancario_display || 'pago.canasto')}</code></div>
                                <div>📲 <strong>Panel Gestor:</strong> <code>/gestor/${escaparHtml(data.nodo.slug)}</code></div>
                                <div>🛒 <strong>Tienda Vecino:</strong> <code>/tienda/${escaparHtml(data.nodo.slug)}</code></div>
                            </div>
                        </div>
                    `,
                    showCancelButton: true,
                    confirmButtonText: '📲 Enviar Links al Celular de Prueba (221 661 5746)',
                    cancelButtonText: 'Cerrar',
                    confirmButtonColor: '#16a34a',
                    background: '#151e2e',
                    color: '#f8fafc'
                });
                if (resSwal.isConfirmed) {
                    enviarLinksBienvenidaNodoWa(data.nodo.id);
                }
            }
        } catch (err) {
            if (window.Swal) {
                Swal.fire({ icon: 'error', title: 'Error', text: err.message, background: '#151e2e', color: '#f8fafc' });
            }
        }
    }

    async function ponerACeroDatosPruebasNodos() {
        let conservarBase = true;
        if (window.Swal) {
            const conf = await Swal.fire({
                title: '🧹 Puesta a Cero Integral de Pruebas (Nodos)',
                background: '#151e2e',
                color: '#f8fafc',
                width: '580px',
                html: `
                    <div style="text-align:left; font-size:0.86rem; line-height:1.5;">
                        <p>Esta acción limpia de <code>etiquetas_pruebas</code> todos los Nodos, pedidos vecinales, canastos, propuestas, clientes Nodos (Búnker + Lomas), cuentas corrientes de Nodos y presupuestos Canasto, manteniendo intactos los datos mayoristas.</p>
                        <label style="display:flex; align-items:center; gap:8px; margin-top:12px; padding:10px; border-radius:8px; background:#0f172a; border:1px solid #334155; cursor:pointer;">
                            <input type="checkbox" id="swal-reset-conservar-base" checked style="width:16px; height:16px;">
                            <span><strong>Conservar 2 artículos base en Lista Base Nodos Barriales</strong> (<code>APN25/27X250G</code> Almendra x 250g y <code>GSX500G</code> Granola de Sol x 500g) para probar tanto publicar un artículo preexistente como pedir cotización de uno nuevo.</span>
                        </label>
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: '🧹 Ejecutar Puesta a Cero',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#e11d48',
                preConfirm: () => {
                    return Boolean(document.getElementById('swal-reset-conservar-base')?.checked);
                }
            });
            if (!conf.isConfirmed) return;
            conservarBase = Boolean(conf.value);
        }

        const resp = await fetch('/api/produccion/nodos/reset-pruebas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conservar_articulos_base: conservarBase })
        });
        const data = await resp.json();
        if (data.ok) {
            ESTADO_NODOS.nodoEditandoId = null;
            ESTADO_NODOS.clienteMadreSeleccionadoId = null;
            ESTADO_NODOS.propuestaActivaId = null;
            ESTADO_NODOS.catalogoEditandoId = null;
            await cargarDatosNodosBarriales(true);
            if (window.Swal) {
                Swal.fire({
                    icon: 'success',
                    title: '✅ Entorno Puesto a Cero',
                    text: `0 Nodos, 0 pedidos, 0 canastos y ${data.articulos_base_lista_nodos?.length || 0} artículos base en Lista Base Nodos Barriales.`,
                    background: '#151e2e',
                    color: '#f8fafc'
                });
            }
        }
    }

    // =========================================================================
    // API PÚBLICA EN WINDOW
    // =========================================================================
    window.NodosPizarra = {
        inicializar: cargarDatosNodosBarriales,
        ponerACeroPruebas: ponerACeroDatosPruebasNodos,
        cambiarSubTab: cambiarSubTabNodos,
        seleccionarFlujoMesa,
        alCambiarOrigenSelect,
        alCambiarKilosUnidadMesa,
        alCambiarSelectorDiccionarioCasoB,
        fijarGramajeRapido,
        alCambiarUnidadTiempoMesa,
        recalcularEnVivo: recalcularMesaCotizacionEnVivo,
        cargarIngredienteDirectoEnMesa,
        cargarPresentacionPlantaEnMesa,
        cargarPropuestaEnMesa,
        descartarPropuestaAdmin,
        editarArticuloCatalogoEnMesa,
        limpiarMesaCotizacion,
        aprobarYPublicarEnPadronNodos,
        abrirModalNuevaPropuesta,
        sincronizarCascadaSeisFlujos,
        filtrarFuentesRapidas: (val) => {
            ESTADO_NODOS.busquedaFuentes = val;
            const box = document.getElementById('nodos-lista-fuentes-rapidas');
            if (box) box.innerHTML = renderizarListaFuentesRapidasHtml();
        },
        filtrarCatalogo: (val) => {
            ESTADO_NODOS.busquedaCatalogo = val;
            const body = document.getElementById('nodos-subtab-body');
            if (body) body.innerHTML = renderizarSubTabCatalogo();
        },
        filtrarBusquedaPlantaDisponible: (val) => {
            ESTADO_NODOS.busquedaPlantaDisponible = val;
            const lista = document.getElementById('nodos-planta-disponibles-lista');
            if (lista) lista.innerHTML = renderizarFilasPresentacionesPlantaHtml();
        },
        cambiarFiltroPesoPlantaDisponible: (modo) => {
            ESTADO_NODOS.filtroPesoPlantaDisponible = modo;
            const body = document.getElementById('nodos-subtab-body');
            if (body) body.innerHTML = renderizarSubTabCatalogo();
        },
        filtrarFlujoCatalogo: (val) => {
            ESTADO_NODOS.filtroFlujoCatalogo = Number(val);
            const body = document.getElementById('nodos-subtab-body');
            if (body) body.innerHTML = renderizarSubTabCatalogo();
        },
        filtrarNodoOfertas: (val) => {
            ESTADO_NODOS.filtroNodoOfertas = Number(val);
            const body = document.getElementById('nodos-subtab-body');
            if (body) body.innerHTML = renderizarSubTabCatalogo();
        },
        actualizarMargenOfertaGestor,
        togglePublicacionOfertaGestor,
        cargarNodoEnFormularioAbm,
        nuevoNodoFormulario,
        toggleMostrarArchivadosAbm,
        toggleArchivarNodoAbm,
        eliminarNodoPruebaAbm,
        alCambiarToggleRepartoAbm,
        filtrarClientesTitularesAbm,
        seleccionarClienteTitularAbm,
        seleccionarDomicilioClienteEnAbm,
        togglePanelMapaAbm,
        buscarDireccionEnMapaAbm,
        ubicarTextoDomicilioActualEnMapaAbm,
        aplicarBarrioSugeridoMapaAbm,
        aplicarCalleSugeridaMapaAbm,
        alCambiarModoCuentaUnificadaAbm,
        alCambiarToggleCuentaCompartidaAbm,
        abrirModalConfigCuentaCanal,
        aplicarDomicilioSugeridoAbm,
        alEditarNombreMarcaAbm,
        fijarColorPrimarioNodoAbm,
        sincronizarSlugDesdeNombreAbm,
        enviarLinksBienvenidaNodoWa,
        subirArchivoLogo,
        quitarLogoImagenAbm,
        regenerarLogoZplEnVivo,
        simularEtiquetaZebra,
        guardarNodoAbm
    };

    window.recargarModuloNodosBarriales = () => cargarDatosNodosBarriales(true);

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            fetch('/api/produccion/nodos/inicializar')
                .then(r => r.json())
                .then(data => {
                    if (data && data.ok) {
                        ESTADO_NODOS.nodos = data.nodos || [];
                        ESTADO_NODOS.catalogo = data.catalogo || [];
                        ESTADO_NODOS.propuestas = data.propuestas || [];
                        ESTADO_NODOS.propuestas_combos = data.propuestas_combos || [];
                        ESTADO_NODOS.ofertas_gestor = data.ofertas_gestor || [];
                        ESTADO_NODOS.presentaciones_planta_disponibles = data.presentaciones_planta_disponibles || [];
                        ESTADO_NODOS.fuentes = data.fuentes || ESTADO_NODOS.fuentes;
                        ESTADO_NODOS.modoLaboratorio = Boolean(data.modo_laboratorio);
                        ESTADO_NODOS.inicializado = true;
                        if (data.combos_estado && window.CombosPizarra && typeof window.CombosPizarra.aplicarDatosEstado === 'function') {
                            window.CombosPizarra.aplicarDatosEstado(data.combos_estado);
                        }
                        actualizarBadgePropuestasPendientes();

                        const params = new URLSearchParams(window.location.search);
                        if (params.get('tab') === 'nodos' && typeof window.cambiarContextoLDN === 'function') {
                            window.cambiarContextoLDN(7);
                        }
                    }
                })
                .catch(() => {});
        }, 600);
    });
})();
