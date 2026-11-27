/**
 * ============================================================================
 * COMPONENTE FRONTEND: GOBERNANZA ESCALABLE DE NODOS — ETAPA 4
 * Integrado a pizarra-simulacion.html?tab=nodos
 * - Arquitectura modular sin base64/ZPL (usa /resumen, /catalogo, /presentaciones-planta,
 *   /solicitudes, /diccionario-bunker, PATCH /catalogo/:id, POST /catalogo/:id/nodos,
 *   PATCH /ofertas-gestor/:id).
 * - Sin ABM duplicado de Nodos: enlace directo a /centro-nodos.
 * - 3 Vistas: Matriz de Gobernanza (Por Producto + Drawer Nodos / Por Nodo),
 *   Entrada A (flujo guiado progresivo atenuado 3 pasos + Caso A/B + Combos) y
 *   Entrada B (bandeja de solicitudes de Nodos).
 * ============================================================================
 */
(function () {
    function resolverUrlModuloLamda(puertoLocal, rutaRelativa = '/') {
        const ruta = rutaRelativa.startsWith('/') ? rutaRelativa : ('/' + rutaRelativa);
        if (typeof window.LAMDA_RESOLVE_URL === 'function') {
            const resuelta = window.LAMDA_RESOLVE_URL(`http://localhost:${puertoLocal}${ruta}`);
            if (resuelta) return resuelta;
        }
        const host = (window.location && window.location.hostname) ? window.location.hostname : '';
        const proto = (window.location && window.location.protocol) ? window.location.protocol : 'http:';
        const portActual = (window.location && window.location.port) ? String(window.location.port) : '';
        const esDesarrolloDirectoPuerto = ['3000', '3002', '3003', '3004', '3005'].includes(portActual);
        if (host && esDesarrolloDirectoPuerto) {
            return `${proto}//${host}:${puertoLocal}${ruta}`;
        }
        return ruta;
    }

    const FLUJO_META = {
        1: { corto: 'LDN 1 · Directo', nombre: 'Flujo 1: Bulto Cerrado / Unidad Directa', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.14)' },
        2: { corto: 'LDN 2 · Puro', nombre: 'Flujo 2: Fraccionado Puro (100% Ingrediente)', color: '#34d399', bg: 'rgba(52, 211, 153, 0.14)' },
        3: { corto: 'LDN 3 · Mixes', nombre: 'Flujo 3: Mezcla Interna a Fracción', color: '#a78bfa', bg: 'rgba(167, 139, 250, 0.14)' },
        4: { corto: 'LDN 4 · Tostaderos', nombre: 'Flujo 4: UP Externa (Tostadero)', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.14)' },
        5: { corto: 'LDN 5 · Barritas', nombre: 'Flujo 5: Pre-Mezcla + Barritas', color: '#f87171', bg: 'rgba(248, 113, 113, 0.14)' },
        6: { corto: 'LDN 6 · Granolas', nombre: 'Flujo 6: Doble Mezcla + Granola', color: '#fb923c', bg: 'rgba(251, 146, 60, 0.14)' },
        8: { corto: 'LDN 8 · Combos', nombre: 'LDN 8: Combo Compuesto Multi-SKU', color: '#c4b5fd', bg: 'rgba(168, 85, 247, 0.18)' }
    };

    const ESTADO_NODOS = {
        inicializado: false,
        cargando: false,
        refrescando: false,
        ultimaActualizacionHora: '',
        subTabActiva: 'matriz', // 'matriz' | 'entrada_a' | 'entrada_b'
        perspectivaMatriz: 'producto', // 'producto' | 'nodo'
        nodos: [],
        listasPreciosNodos: [],
        contadores: { nodos_activos: 0, nodos_archivados: 0, catalogo_total: 0, catalogo_activos: 0, catalogo_inactivos: 0, pendientes_fracciones: 0, pendientes_combos: 0, pendientes_total: 0 },
        constantes: { alicuota_iva_default: 21, alicuota_iibb_default: 4, margen_lamda_default: 25, margen_gestor_default: 28 },
        modoLaboratorio: false,

        // Vista 1 — Matriz paginada
        catalogo: [],
        ofertas_gestor: [],
        catalogoPage: 1,
        catalogoLimit: 50,
        catalogoTotal: 0,
        catalogoTotalPages: 1,
        filtroBusqueda: '',
        filtroFlujo: 0,
        filtroEstado: 'activos', // 'activos' | 'inactivos' | 'todos'
        filtroPerfil: '',
        filtroNodoId: 0,
        drawerCatalogoId: null,
        drawerCargando: false,
        drawerFiltroBusqueda: '',
        drawerFiltroPerfil: '',
        drawerSeleccionados: new Set(),

        // Vista 2 — Entrada A (flujo guiado 3 pasos)
        plantaCargada: false,
        presentaciones_planta_disponibles: [],
        fuentes: {
            ingredientes_por_flujo: [],
            articulos_bulto_flujo1: [],
            envases: [],
            tarifas_mano_obra: [],
            familias_bunker: [],
            componentes_combo_disponibles: []
        },
        entradaA: {
            modoOrigen: 'planta', // 'planta' | 'fraccion' | 'combo'
            paso1Completo: false,
            paso2Revisado: false,
            busquedaPlanta: '',
            filtroPesoPlanta: 'SUB_1KG',
            busquedaFuentes: '',
            flujoSeleccionadoMesa: 2,
            unidadTiempoMesa: 'min',
            propuestaActivaId: null,
            catalogoEditandoId: null,
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
            formDraft: {
                origenVal: '',
                skuNodo: '',
                bunkerNomenclatura: '',
                categoria: 'FRUTOS SECOS',
                rubroSecundario: '',
                compartidoMayorista: false,
                costoKg: 0,
                kilosUnidad: 0.25,
                modoPresentacion: 'BOLSA',
                packUnidades: 3,
                packPesoUnitG: 50,
                insumoEnvaseId: '',
                segundosMo: 300,
                tarifaId: '',
                margenLamda: 25,
                ivaPct: 21,
                iibbPct: 4,
                margenGestor: 28,
                aliasVidriera: '',
                notasTecnicas: '',
                tituloContexto: '',
                subtituloContexto: ''
            },
            nodosHabilitadosIds: new Set(),
            nodosPublicadosIds: new Set()
        },

        // Vista 3 — Entrada B (Solicitudes)
        solicitudesCargadas: false,
        propuestas: [],
        propuestas_combos: [],
        filtroSolicitudesEstado: 'PENDIENTE_COTIZACION',
        filtroSolicitudesNodoId: 0,
        filtroSolicitudesTipo: 'TODAS'
    };

    let _timerBusquedaMatriz = null;

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
        return q.split(/\s+/).filter(Boolean).every(t => haystack.includes(t));
    }

    function obtenerCostoVivoIngredientePizarra(ingId, fallbackCosto = 0) {
        const idNum = Number(ingId);
        if (window.pizarraSimulacionMaster && Array.isArray(window.pizarraSimulacionMaster.ingredientes)) {
            const enc = window.pizarraSimulacionMaster.ingredientes.find(i => Number(i.id) === idNum);
            if (enc && Number(enc.costo_patron) > 0) return Number(enc.costo_patron);
        }
        const enFuentes = ESTADO_NODOS.fuentes.ingredientes_por_flujo.find(i => Number(i.id) === idNum);
        return Number(enFuentes?.costo_kg || fallbackCosto || 0);
    }

    function calcularPrecioYGananciaFiscalNodoJs(costoBase, margenPct, ivaPct = 21, iibbPct = 4, modo = 'margen', valOverride = null) {
        const base = Math.max(0, Number(costoBase || 0));
        const iva = Number.isFinite(Number(ivaPct)) ? Number(ivaPct) : 21;
        const iibb = Number.isFinite(Number(iibbPct)) ? Number(iibbPct) : 4;
        const factorNeto = Math.max(0.01, (1 / (1 + iva / 100)) - (iibb / 100));
        let precioTienda;
        if (modo === 'precio' && valOverride != null) {
            precioTienda = Math.max(Math.round(base), Math.round(Number(valOverride) || 0));
        } else {
            const m = Math.max(0, Number(margenPct || 0));
            precioTienda = Math.max(Math.round(base), Math.round(base * (1 + m / 100)));
        }
        const exc = Math.max(0, precioTienda - base);
        const gananciaNeta = Math.round(exc * factorNeto);
        const margenReal = base > 0 ? Number((((precioTienda - base) / base) * 100).toFixed(2)) : Number(margenPct || 0);
        return { precio_tienda: precioTienda, ganancia_neta_nodo: gananciaNeta, margen_pct: margenReal };
    }

    function actualizarBadgePropuestasPendientes() {
        const pendTotal = Number(ESTADO_NODOS.contadores?.pendientes_total || 0);
        const badgePizarra = document.getElementById('badge-nodos-pendientes-pizarra');
        if (badgePizarra) {
            badgePizarra.style.display = pendTotal > 0 ? 'inline-flex' : 'none';
            badgePizarra.textContent = pendTotal > 0 ? `⏳ ${pendTotal}` : '0';
        }
        const badgeTab = document.getElementById('nodos-tab-badge-solicitudes');
        if (badgeTab) {
            badgeTab.style.display = pendTotal > 0 ? 'inline-flex' : 'none';
            badgeTab.textContent = String(pendTotal);
        }
    }

    // =========================================================================
    // CARGA MODULAR SIN BLOBS (RESUMEN + CATALOGO + PLANTA + SOLICITUDES)
    // =========================================================================
    async function cargarResumenModular() {
        const resp = await fetch('/api/produccion/nodos/resumen', { cache: 'no-store' });
        const data = await resp.json();
        if (!resp.ok || !data?.ok) throw new Error(data?.error || 'Error cargando resumen de Nodos');
        ESTADO_NODOS.nodos = Array.isArray(data.nodos) ? data.nodos : [];
        ESTADO_NODOS.listasPreciosNodos = Array.isArray(data.listas_precios_nodos) ? data.listas_precios_nodos : [];
        ESTADO_NODOS.contadores = data.contadores || ESTADO_NODOS.contadores;
        ESTADO_NODOS.constantes = data.constantes || ESTADO_NODOS.constantes;
        ESTADO_NODOS.modoLaboratorio = Boolean(data.modo_laboratorio);
        if (!ESTADO_NODOS.filtroNodoId && ESTADO_NODOS.nodos.length > 0) {
            const activo = ESTADO_NODOS.nodos.find(n => n.activo !== false) || ESTADO_NODOS.nodos[0];
            ESTADO_NODOS.filtroNodoId = Number(activo.id);
        }
        if (ESTADO_NODOS.entradaA.nodosHabilitadosIds.size === 0 && ESTADO_NODOS.nodos.length > 0) {
            ESTADO_NODOS.nodos.filter(n => n.activo !== false).forEach(n => ESTADO_NODOS.entradaA.nodosHabilitadosIds.add(Number(n.id)));
        }
        actualizarBadgePropuestasPendientes();
    }

    async function cargarCatalogoModular() {
        const qs = new URLSearchParams();
        qs.set('page', String(ESTADO_NODOS.catalogoPage || 1));
        qs.set('limit', String(ESTADO_NODOS.catalogoLimit || 50));
        qs.set('estado', ESTADO_NODOS.filtroEstado || 'activos');
        if (ESTADO_NODOS.filtroBusqueda.trim()) qs.set('q', ESTADO_NODOS.filtroBusqueda.trim());
        if (Number(ESTADO_NODOS.filtroFlujo) > 0) qs.set('flujo', String(ESTADO_NODOS.filtroFlujo));
        if (ESTADO_NODOS.filtroPerfil) qs.set('perfil', ESTADO_NODOS.filtroPerfil);
        if (ESTADO_NODOS.perspectivaMatriz === 'nodo') {
            if (!Number(ESTADO_NODOS.filtroNodoId) && Array.isArray(ESTADO_NODOS.nodos) && ESTADO_NODOS.nodos.length > 0) {
                const primeroActivo = ESTADO_NODOS.nodos.find(n => n.activo !== false) || ESTADO_NODOS.nodos[0];
                if (primeroActivo) ESTADO_NODOS.filtroNodoId = Number(primeroActivo.id);
            }
            if (Number(ESTADO_NODOS.filtroNodoId) > 0) {
                qs.set('nodo_id', String(ESTADO_NODOS.filtroNodoId));
            }
        }
        const resp = await fetch(`/api/produccion/nodos/catalogo?${qs.toString()}`, { cache: 'no-store' });
        const data = await resp.json();
        if (!resp.ok || !data?.ok) throw new Error(data?.error || 'Error cargando catálogo modular');
        ESTADO_NODOS.catalogo = Array.isArray(data.catalogo) ? data.catalogo : [];
        ESTADO_NODOS.ofertas_gestor = Array.isArray(data.ofertas_gestor) ? data.ofertas_gestor : [];
        ESTADO_NODOS.catalogoTotal = Number(data.total || 0);
        ESTADO_NODOS.catalogoTotalPages = Number(data.total_pages || 1);
    }

    async function cargarOfertasDrawerCatalogo(cid) {
        const idNum = Number(cid || 0);
        if (!idNum) return;
        ESTADO_NODOS.drawerCargando = true;
        try {
            const resp = await fetch(`/api/produccion/nodos/catalogo?articulo_catalogo_id=${idNum}&estado=todos&limit=1`, { cache: 'no-store' });
            const data = await resp.json();
            if (!resp.ok || !data?.ok) throw new Error(data?.error || 'Error cargando ofertas del artículo');
            const otras = (ESTADO_NODOS.ofertas_gestor || []).filter(o => Number(o.articulo_catalogo_id) !== idNum);
            const nuevas = Array.isArray(data.ofertas_gestor) ? data.ofertas_gestor : [];
            ESTADO_NODOS.ofertas_gestor = [...otras, ...nuevas];
            if (Array.isArray(data.catalogo) && data.catalogo[0]) {
                const catMem = ESTADO_NODOS.catalogo.find(c => Number(c.id) === idNum);
                if (catMem && data.catalogo[0].cobertura) catMem.cobertura = data.catalogo[0].cobertura;
            }
        } finally {
            ESTADO_NODOS.drawerCargando = false;
            renderizarDrawerNodosSiAbierto();
        }
    }

    async function cargarPresentacionesPlantaModular(forzar = false) {
        if (ESTADO_NODOS.plantaCargada && !forzar) return;
        const resp = await fetch('/api/produccion/nodos/presentaciones-planta', { cache: 'no-store' });
        const data = await resp.json();
        if (!resp.ok || !data?.ok) throw new Error(data?.error || 'Error cargando fuentes de planta');
        ESTADO_NODOS.presentaciones_planta_disponibles = Array.isArray(data.presentaciones_planta_disponibles) ? data.presentaciones_planta_disponibles : [];
        ESTADO_NODOS.fuentes = {
            ingredientes_por_flujo: Array.isArray(data.ingredientes_por_flujo) ? data.ingredientes_por_flujo : [],
            articulos_bulto_flujo1: Array.isArray(data.articulos_flujo_1) ? data.articulos_flujo_1 : [],
            envases: Array.isArray(data.envases) ? data.envases : [],
            tarifas_mano_obra: Array.isArray(data.tarifas_mano_obra) ? data.tarifas_mano_obra : [],
            familias_bunker: Array.isArray(data.familias_bunker) ? data.familias_bunker : [],
            componentes_combo_disponibles: Array.isArray(data.componentes_combo_disponibles) ? data.componentes_combo_disponibles : []
        };
        const df = ESTADO_NODOS.entradaA.formDraft;
        if (!df.insumoEnvaseId && ESTADO_NODOS.fuentes.envases.length > 0) {
            df.insumoEnvaseId = String(ESTADO_NODOS.fuentes.envases[0].id);
        }
        if (!df.tarifaId && ESTADO_NODOS.fuentes.tarifas_mano_obra.length > 0) {
            df.tarifaId = String(ESTADO_NODOS.fuentes.tarifas_mano_obra[0].id);
        }
        ESTADO_NODOS.plantaCargada = true;
    }

    async function cargarSolicitudesModular() {
        const qs = new URLSearchParams();
        if (ESTADO_NODOS.filtroSolicitudesEstado) qs.set('estado', ESTADO_NODOS.filtroSolicitudesEstado);
        if (Number(ESTADO_NODOS.filtroSolicitudesNodoId) > 0) qs.set('nodo_id', String(ESTADO_NODOS.filtroSolicitudesNodoId));
        const resp = await fetch(`/api/produccion/nodos/solicitudes?${qs.toString()}`, { cache: 'no-store' });
        const data = await resp.json();
        if (!resp.ok || !data?.ok) throw new Error(data?.error || 'Error cargando solicitudes');
        ESTADO_NODOS.propuestas = Array.isArray(data.propuestas) ? data.propuestas : [];
        ESTADO_NODOS.propuestas_combos = Array.isArray(data.propuestas_combos) ? data.propuestas_combos : [];
        if (data.contadores) {
            ESTADO_NODOS.contadores = { ...ESTADO_NODOS.contadores, ...data.contadores };
            actualizarBadgePropuestasPendientes();
        }
        ESTADO_NODOS.solicitudesCargadas = true;
    }

    async function cargarDatosNodosBarriales(forzar = false) {
        const container = document.getElementById('nodos-cotizador-container');
        if (!container) return;
        if (ESTADO_NODOS.inicializado && !forzar) {
            renderizarVistaNodosCompleta();
            return;
        }
        if (ESTADO_NODOS.cargando && !forzar) return;
        ESTADO_NODOS.cargando = true;
        if (!ESTADO_NODOS.inicializado) {
            container.innerHTML = `<div class="card" style="padding:30px; text-align:center; color:#94a3b8;">⏳ Cargando Gobernanza de Nodos (arquitectura modular Etapa 4)...</div>`;
        }
        try {
            const tareas = [cargarResumenModular()];
            if (ESTADO_NODOS.subTabActiva === 'matriz') {
                tareas.push(cargarCatalogoModular());
            } else if (ESTADO_NODOS.subTabActiva === 'entrada_a') {
                tareas.push(cargarPresentacionesPlantaModular(forzar));
            } else if (ESTADO_NODOS.subTabActiva === 'entrada_b') {
                tareas.push(cargarSolicitudesModular(), cargarPresentacionesPlantaModular(forzar));
            }
            await Promise.all(tareas);
            ESTADO_NODOS.inicializado = true;
            renderizarVistaNodosCompleta();
        } catch (err) {
            console.error('❌ [NodosPizarra] Error inicializando:', err);
            container.innerHTML = `<div class="card" style="padding:20px; border:1px solid #ef4444; color:#fca5a5;">❌ ${escaparHtml(err.message)}</div>`;
        } finally {
            ESTADO_NODOS.cargando = false;
        }
    }

    async function refrescarModuloNodosConFeedback() {
        if (ESTADO_NODOS.refrescando) return;
        ESTADO_NODOS.refrescando = true;
        const btn = document.getElementById('btn-nodos-refrescar');
        const statusEl = document.getElementById('nodos-refrescar-status');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Actualizando...';
            btn.style.opacity = '0.75';
        }
        if (statusEl) {
            statusEl.style.display = 'inline-block';
            statusEl.style.color = '#38bdf8';
            statusEl.textContent = 'Sincronizando resumen, catálogo, solicitudes y radar...';
        }
        try {
            await Promise.all([
                cargarResumenModular(),
                cargarCatalogoModular(),
                cargarSolicitudesModular(),
                cargarPresentacionesPlantaModular(true),
                (typeof window.refrescarRadarCostos === 'function'
                    ? window.refrescarRadarCostos()
                    : Promise.resolve(null))
            ]);
            ESTADO_NODOS.inicializado = true;
            ESTADO_NODOS.ultimaActualizacionHora = new Date().toLocaleTimeString('es-AR', { hour12: false });
            ESTADO_NODOS.refrescando = false;
            renderizarVistaNodosCompleta();
        } catch (err) {
            ESTADO_NODOS.refrescando = false;
            console.error('❌ [NodosPizarra] Error refrescando módulo:', err);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔄 Refrescar';
                btn.style.opacity = '1';
            }
            if (statusEl) {
                statusEl.style.display = 'inline-block';
                statusEl.style.color = '#fda4af';
                statusEl.textContent = `❌ ${err.message || 'Error al actualizar'}`;
            }
        }
    }

    // =========================================================================
    // RENDER PRINCIPAL (SIN ABM DUPLICADO — ENLACE DIRECTO A /centro-nodos)
    // =========================================================================
    function renderizarVistaNodosCompleta() {
        const container = document.getElementById('nodos-cotizador-container');
        if (!container) return;
        const cnt = ESTADO_NODOS.contadores || {};
        const pendTotal = Number(cnt.pendientes_total || 0);
        const centroNodosUrl = resolverUrlModuloLamda(3002, '/centro-nodos');

        container.innerHTML = `
            <style>
                .nodos-step-card { padding:14px; border-radius:12px; background:#0f172a; border:1px solid #334155; transition:opacity 0.2s ease, border-color 0.2s ease; margin-bottom:12px; }
                .nodos-step-card.is-active { border:2px solid #38bdf8; box-shadow:0 0 0 1px rgba(56,189,248,0.2); }
                .nodos-step-card.is-dimmed { opacity:0.42; pointer-events:none; background:rgba(15,23,42,0.55); border:1px dashed #334155; }
                .nodos-cell-st { display:inline-block; font-size:0.68rem; font-weight:700; min-width:74px; text-align:left; margin-left:4px; }
                .nodos-switch { position:relative; display:inline-flex; align-items:center; gap:5px; cursor:pointer; font-size:0.73rem; font-weight:700; }
                .nodos-drawer-backdrop { position:fixed; inset:0; z-index:9400; background:rgba(2,6,23,0.72); display:flex; justify-content:flex-end; }
                .nodos-drawer-panel { width:min(740px, 96vw); height:100vh; background:#0f172a; border-left:1px solid #334155; display:flex; flex-direction:column; color:#f8fafc; box-shadow:-12px 0 35px rgba(0,0,0,0.5); }
            </style>
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px; padding:12px 14px; background:linear-gradient(135deg, #151e2e 0%, #0f172a 100%); border:1px solid rgba(56,189,248,0.3); border-radius:12px;">
                <div>
                    <div style="font-size:1.05rem; font-weight:800; color:#f8fafc; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <span>🏘️ Gobernanza y Catálogo Maestro de Nodos</span>
                        <span style="font-size:0.72rem; padding:2px 8px; border-radius:999px; background:rgba(16,185,129,0.16); color:#6ee7b7; border:1px solid rgba(16,185,129,0.35);">
                            ${Number(cnt.nodos_activos || 0)} Nodos activos · ${Number(cnt.catalogo_activos || 0)} Artículos activos
                        </span>
                    </div>
                    <div style="font-size:0.75rem; color:#94a3b8; margin-top:2px;">
                        Disponibilidad independiente en 3 Niveles (Global LAMDA · Habilitación por Nodo · Publicación en Tienda) y Entrada A / B.
                    </div>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                    <a href="${escaparHtml(centroNodosUrl)}" target="_blank" rel="noopener"
                        style="text-decoration:none; padding:7px 13px; border-radius:8px; font-size:0.79rem; font-weight:800; background:rgba(167,139,250,0.2); border:1px solid #a78bfa; color:#ede9fe;">
                        ⚙️ Configurar Nodos (/centro-nodos) →
                    </a>
                    <button type="button" onclick="window.NodosPizarra.sincronizarCascadaSeisFlujos()"
                        style="padding:7px 12px; border-radius:8px; font-size:0.77rem; font-weight:700; border:1px solid #38bdf8; background:rgba(56,189,248,0.16); color:#bae6fd; cursor:pointer;">
                        ⚡ Sincronizar Costos
                    </button>
                    ${ESTADO_NODOS.modoLaboratorio ? `
                        <button type="button" onclick="window.NodosPizarra.ponerACeroPruebas()"
                            style="padding:7px 11px; border-radius:8px; font-size:0.76rem; font-weight:700; border:1px solid rgba(244,63,94,0.55); background:rgba(244,63,94,0.16); color:#fda4af; cursor:pointer;">
                            🧹 Puesta a Cero (Lab)
                        </button>
                    ` : ''}
                    <button id="btn-nodos-refrescar" type="button" onclick="window.NodosPizarra.refrescarTodo()" ${ESTADO_NODOS.refrescando ? 'disabled' : ''}
                        style="padding:7px 11px; border-radius:8px; font-size:0.77rem; font-weight:700; border:1px solid #334155; background:#1e293b; color:#e2e8f0; cursor:pointer;">
                        ${ESTADO_NODOS.refrescando ? '⏳ Actualizando...' : '🔄 Refrescar'}
                    </button>
                    <span id="nodos-refrescar-status" style="display:${ESTADO_NODOS.ultimaActualizacionHora ? 'inline-block' : 'none'}; font-size:0.73rem; font-weight:700; color:#6ee7b7; padding:4px 9px; border-radius:999px; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.3);">
                        ${ESTADO_NODOS.ultimaActualizacionHora ? `✓ Actualizado ${escaparHtml(ESTADO_NODOS.ultimaActualizacionHora)}` : ''}
                    </span>
                </div>
            </div>

            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
                <button type="button" onclick="window.NodosPizarra.cambiarSubTab('matriz')"
                    style="padding:8px 14px; border-radius:9px; font-size:0.82rem; font-weight:800; cursor:pointer; border:1px solid ${ESTADO_NODOS.subTabActiva === 'matriz' ? '#38bdf8' : '#334155'}; background:${ESTADO_NODOS.subTabActiva === 'matriz' ? 'rgba(56,189,248,0.2)' : '#151e2e'}; color:#f8fafc;">
                    📋 Matriz de Gobernanza (${Number(cnt.catalogo_total || 0)})
                </button>
                <button type="button" onclick="window.NodosPizarra.cambiarSubTab('entrada_a')"
                    style="padding:8px 14px; border-radius:9px; font-size:0.82rem; font-weight:800; cursor:pointer; border:1px solid ${ESTADO_NODOS.subTabActiva === 'entrada_a' ? '#10b981' : '#334155'}; background:${ESTADO_NODOS.subTabActiva === 'entrada_a' ? 'rgba(16,185,129,0.2)' : '#151e2e'}; color:#f8fafc;">
                    ➕ Entrada A · Alta / Edición LAMDA
                </button>
                <button type="button" onclick="window.NodosPizarra.cambiarSubTab('entrada_b')"
                    style="padding:8px 14px; border-radius:9px; font-size:0.82rem; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; gap:6px; border:1px solid ${ESTADO_NODOS.subTabActiva === 'entrada_b' ? '#f59e0b' : '#334155'}; background:${ESTADO_NODOS.subTabActiva === 'entrada_b' ? 'rgba(245,158,11,0.2)' : '#151e2e'}; color:#f8fafc;">
                    <span>📥 Entrada B · Solicitudes de Nodos</span>
                    <span id="nodos-tab-badge-solicitudes" style="display:${pendTotal > 0 ? 'inline-flex' : 'none'}; padding:1px 7px; border-radius:999px; background:#f59e0b; color:#0f172a; font-size:0.72rem; font-weight:900;">${pendTotal}</span>
                </button>
            </div>

            <div id="nodos-subtab-body"></div>
            <div id="nodos-drawer-host"></div>
        `;

        renderizarSubTabActiva();
    }

    function renderizarSubTabActiva() {
        const body = document.getElementById('nodos-subtab-body');
        if (!body) return;
        if (ESTADO_NODOS.subTabActiva === 'entrada_a') {
            body.innerHTML = renderizarVistaEntradaA();
            if (ESTADO_NODOS.entradaA.modoOrigen === 'combo' && window.CombosPizarra && typeof window.CombosPizarra.inicializar === 'function') {
                window.CombosPizarra.inicializar('nodos-combos-subtab-mount');
            } else if (ESTADO_NODOS.entradaA.modoOrigen === 'fraccion') {
                recalcularMesaCotizacionEnVivo();
            }
        } else if (ESTADO_NODOS.subTabActiva === 'entrada_b') {
            body.innerHTML = renderizarVistaEntradaB();
        } else {
            body.innerHTML = renderizarVistaMatrizGobernanza();
        }
        renderizarDrawerNodosSiAbierto();
    }

    async function cambiarSubTabNodos(subTab) {
        ESTADO_NODOS.subTabActiva = subTab === 'cotizador' ? 'entrada_a' : (subTab || 'matriz');
        if (ESTADO_NODOS.subTabActiva === 'matriz') {
            await cargarCatalogoModular().catch(() => {});
        } else if (ESTADO_NODOS.subTabActiva === 'entrada_a') {
            await cargarPresentacionesPlantaModular(false).catch(() => {});
        } else if (ESTADO_NODOS.subTabActiva === 'entrada_b') {
            await Promise.all([cargarSolicitudesModular(), cargarPresentacionesPlantaModular(false)]).catch(() => {});
        }
        renderizarVistaNodosCompleta();
    }

    // =========================================================================
    // VISTA 1 — MATRIZ DE GOBERNANZA ESCALABLE (POR PRODUCTO + DRAWER / POR NODO)
    // =========================================================================
    function renderizarVistaMatrizGobernanza() {
        const persp = ESTADO_NODOS.perspectivaMatriz || 'producto';
        const nodosActivos = (ESTADO_NODOS.nodos || []).filter(n => n.activo !== false);

        const barraFiltros = `
            <div class="card" style="padding:12px 14px; background:#151e2e; border:1px solid #2e3c51; border-radius:12px; margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:10px;">
                    <div style="display:flex; gap:6px;">
                        <button type="button" onclick="window.NodosPizarra.cambiarPerspectivaMatriz('producto')"
                            style="padding:6px 12px; border-radius:7px; font-size:0.78rem; font-weight:800; cursor:pointer; border:1px solid ${persp === 'producto' ? '#38bdf8' : '#334155'}; background:${persp === 'producto' ? 'rgba(56,189,248,0.2)' : '#0f172a'}; color:#f8fafc;">
                            📦 Por Producto
                        </button>
                        <button type="button" onclick="window.NodosPizarra.cambiarPerspectivaMatriz('nodo')"
                            style="padding:6px 12px; border-radius:7px; font-size:0.78rem; font-weight:800; cursor:pointer; border:1px solid ${persp === 'nodo' ? '#38bdf8' : '#334155'}; background:${persp === 'nodo' ? 'rgba(56,189,248,0.2)' : '#0f172a'}; color:#f8fafc;">
                            🏘️ Por Nodo
                        </button>
                    </div>
                    <div style="font-size:0.74rem; color:#94a3b8;">
                        Mostrando <strong>${ESTADO_NODOS.catalogo.length}</strong> de <strong>${ESTADO_NODOS.catalogoTotal}</strong> artículos · Página ${ESTADO_NODOS.catalogoPage} / ${ESTADO_NODOS.catalogoTotalPages}
                    </div>
                </div>
                <div style="display:grid; grid-template-columns: 1.8fr 1fr 0.9fr 0.9fr ${persp === 'nodo' ? '1.2fr' : ''}; gap:8px; align-items:center;">
                    <input type="text" id="matriz-search-input" value="${escaparHtml(ESTADO_NODOS.filtroBusqueda)}"
                        oninput="window.NodosPizarra.onInputBusquedaMatriz(this.value)"
                        placeholder="🔎 Buscar (Búsqueda Universal LAMDA: SKU, nombre, rubro, propiedades dinámicas...)"
                        style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #38bdf8; background:#0f172a; color:#f8fafc; font-size:0.81rem;" />
                    <select onchange="window.NodosPizarra.cambiarFiltroMatriz('filtroFlujo', Number(this.value))"
                        style="padding:8px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.79rem;">
                        <option value="0" ${Number(ESTADO_NODOS.filtroFlujo) === 0 ? 'selected' : ''}>Todas las LDN (1–8)</option>
                        ${[1, 2, 3, 4, 5, 6, 8].map(f => `<option value="${f}" ${Number(ESTADO_NODOS.filtroFlujo) === f ? 'selected' : ''}>${FLUJO_META[f]?.corto || ('LDN ' + f)}</option>`).join('')}
                    </select>
                    <select onchange="window.NodosPizarra.cambiarFiltroMatriz('filtroEstado', this.value)"
                        style="padding:8px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.79rem;">
                        <option value="activos" ${ESTADO_NODOS.filtroEstado === 'activos' ? 'selected' : ''}>🟢 Solo Activos</option>
                        <option value="inactivos" ${ESTADO_NODOS.filtroEstado === 'inactivos' ? 'selected' : ''}>⏸️ Solo Apagados (Nivel 1)</option>
                        <option value="todos" ${ESTADO_NODOS.filtroEstado === 'todos' ? 'selected' : ''}>📋 Todos</option>
                    </select>
                    <select onchange="window.NodosPizarra.cambiarFiltroMatriz('filtroPerfil', this.value)"
                        style="padding:8px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.79rem;">
                        <option value="" ${!ESTADO_NODOS.filtroPerfil ? 'selected' : ''}>Todos los Perfiles</option>
                        <option value="VECINOS" ${ESTADO_NODOS.filtroPerfil === 'VECINOS' ? 'selected' : ''}>🏡 VECINOS</option>
                        <option value="REDES" ${ESTADO_NODOS.filtroPerfil === 'REDES' ? 'selected' : ''}>🚀 REDES</option>
                        <option value="LOCALES" ${ESTADO_NODOS.filtroPerfil === 'LOCALES' ? 'selected' : ''}>🏪 LOCALES</option>
                    </select>
                    ${persp === 'nodo' ? `
                        <select onchange="window.NodosPizarra.cambiarFiltroMatriz('filtroNodoId', Number(this.value))"
                            style="padding:8px; border-radius:8px; border:1px solid #a78bfa; background:#0f172a; color:#f8fafc; font-size:0.79rem; font-weight:700;">
                            ${nodosActivos.map(n => `<option value="${n.id}" ${Number(ESTADO_NODOS.filtroNodoId) === Number(n.id) ? 'selected' : ''}>${escaparHtml(n.nombre_marca)} (${escaparHtml(n.perfil_operativo)})</option>`).join('')}
                        </select>
                    ` : ''}
                </div>
            </div>
        `;

        const paginador = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; font-size:0.78rem; color:#94a3b8;">
                <span>Total: ${ESTADO_NODOS.catalogoTotal} artículos</span>
                <div style="display:flex; gap:6px; align-items:center;">
                    <button type="button" ${ESTADO_NODOS.catalogoPage <= 1 ? 'disabled' : ''} onclick="window.NodosPizarra.irPaginaMatriz(${ESTADO_NODOS.catalogoPage - 1})"
                        style="padding:5px 10px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#e2e8f0; cursor:pointer;">← Anterior</button>
                    <span>Pág. ${ESTADO_NODOS.catalogoPage} / ${ESTADO_NODOS.catalogoTotalPages}</span>
                    <button type="button" ${ESTADO_NODOS.catalogoPage >= ESTADO_NODOS.catalogoTotalPages ? 'disabled' : ''} onclick="window.NodosPizarra.irPaginaMatriz(${ESTADO_NODOS.catalogoPage + 1})"
                        style="padding:5px 10px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#e2e8f0; cursor:pointer;">Siguiente →</button>
                </div>
            </div>
        `;

        if (persp === 'nodo') {
            return barraFiltros + renderizarTablaMatrizPorNodo() + paginador;
        }
        return barraFiltros + renderizarTablaMatrizPorProducto() + paginador;
    }

    function renderizarTablaMatrizPorProducto() {
        const filas = ESTADO_NODOS.catalogo || [];
        if (filas.length === 0) {
            return `<div class="card" style="padding:24px; text-align:center; color:#94a3b8; background:#151e2e; border:1px solid #2e3c51; border-radius:12px;">Sin artículos para los filtros seleccionados.</div>`;
        }
        return `
            <div class="card" style="padding:0; overflow-x:auto; background:#151e2e; border:1px solid #2e3c51; border-radius:12px;">
                <table style="width:100%; border-collapse:collapse; font-size:0.79rem; color:#e2e8f0;">
                    <thead>
                        <tr style="background:#0f172a; color:#94a3b8; text-align:left; border-bottom:1px solid #334155;">
                            <th style="padding:10px 12px;">Artículo Oficial LAMDA & Foto</th>
                            <th style="padding:10px 8px;">LDN</th>
                            <th style="padding:10px 8px;">Costo Puro</th>
                            <th style="padding:10px 8px;">Margen LAMDA %</th>
                            <th style="padding:10px 8px;">Base Nodo</th>
                            <th style="padding:10px 8px;">Nivel 1 Global</th>
                            <th style="padding:10px 12px; text-align:right;">Gobernanza Nodos</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filas.map(c => {
                            const fm = FLUJO_META[Number(c.flujo_lamda)] || FLUJO_META[2];
                            const cob = c.cobertura || { nodos_totales: 0, nodos_habilitados: 0, nodos_publicados: 0 };
                            const imgUrl = c.imagen_base_lamda?.url || c.imagen_base_lamda?.thumbnail_url || '';
                            const ctxFoto = {
                                tipo_ancla: c.es_combo ? 'ARTICULO_SKU' : (c.ingrediente_origen_id ? 'INGREDIENTE' : 'PRODUCTO_BASE'),
                                familia_id: c.bunker_familia_id || c.familia_bunker_id || null,
                                familia_nombre: c.bunker_familia_nombre || c.familia_bunker_nombre || 'Almacén',
                                articulo_principal: c.jerarquia_b2b?.articulo_principal || c.articulo_principal_bunker || c.nombre_base_oficial,
                                subrama_labels: c.jerarquia_b2b?.subrama_labels || [],
                                ingrediente_id: c.ingrediente_origen_id || null,
                                clave_producto_base: c.clave_producto_base || '',
                                sku_combo: c.sku_nodo,
                                nombre_base_oficial: c.nombre_base_oficial || c.nombre_oficial_lamda,
                                imagen_actual: c.imagen_base_lamda || null
                            };
                            const ctxEncoded = encodeURIComponent(JSON.stringify(ctxFoto));
                            return `
                                <tr data-cat-row="${c.id}" style="border-bottom:1px solid rgba(51,65,85,0.55); opacity:${c.activo ? '1' : '0.62'};">
                                    <td style="padding:9px 12px;">
                                        <div style="display:flex; align-items:center; gap:9px;">
                                            <div style="width:42px; height:42px; border-radius:7px; background:#0b1120; border:1px solid #334155; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0;">
                                                ${imgUrl ? `<img src="${escaparHtml(imgUrl)}" style="width:100%; height:100%; object-fit:cover;" />` : `<span style="font-size:1rem;">🥜</span>`}
                                            </div>
                                            <div>
                                                <div style="font-weight:800; color:#f8fafc;">
                                                    <code style="color:#38bdf8;">[${escaparHtml(c.sku_nodo)}]</code> ${escaparHtml(c.nombre_oficial_lamda || c.nombre_publico)}
                                                </div>
                                                <div style="font-size:0.7rem; color:#94a3b8; display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:2px;">
                                                    <span>${escaparHtml(c.bunker_familia_nombre || '')}${c.bunker_rubro ? ` · ${escaparHtml(c.bunker_rubro)}` : ''}</span>
                                                    <button type="button" onclick="window.NodosPizarra.abrirEstudioFotoBase(JSON.parse(decodeURIComponent('${ctxEncoded}')))"
                                                        style="padding:1px 6px; border-radius:5px; font-size:0.67rem; border:1px solid rgba(56,189,248,0.4); background:rgba(56,189,248,0.12); color:#bae6fd; cursor:pointer;">
                                                        🖼️ Foto Base
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td style="padding:9px 8px;">
                                        <span style="padding:2px 7px; border-radius:999px; font-size:0.69rem; font-weight:800; background:${fm.bg}; color:${fm.color};">${fm.corto}</span>
                                    </td>
                                    <td style="padding:9px 8px; font-family:monospace;">${fmtMoneda(c.costo_puro_total)}</td>
                                    <td style="padding:9px 8px; white-space:nowrap;">
                                        <input type="number" step="0.5" value="${Number(c.margen_lamda_pct ?? 25)}"
                                            data-prev-val="${Number(c.margen_lamda_pct ?? 25)}"
                                            onchange="window.NodosPizarra.patchCatalogoCelda(${c.id}, { margen_lamda_pct: Number(this.value) }, this, 'cat-margen-${c.id}')"
                                            style="width:66px; padding:4px 6px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-weight:700; text-align:right;" />%
                                        <span class="nodos-cell-st" data-cell-status="cat-margen-${c.id}"></span>
                                    </td>
                                    <td style="padding:9px 8px; font-weight:800; color:#34d399;" data-cat-base-precio="${c.id}">${fmtMoneda(c.precio_base_nodo_final)}</td>
                                    <td style="padding:9px 8px; white-space:nowrap;">
                                        <label class="nodos-switch">
                                            <input type="checkbox" ${c.activo ? 'checked' : ''}
                                                data-prev-checked="${c.activo ? '1' : '0'}"
                                                onchange="window.NodosPizarra.patchCatalogoCelda(${c.id}, { activo: this.checked }, this, 'cat-activo-${c.id}')" />
                                            <span data-cat-activo-lbl="${c.id}" style="color:${c.activo ? '#6ee7b7' : '#f87171'};">${c.activo ? 'Activo' : 'Apagado'}</span>
                                        </label>
                                        <span class="nodos-cell-st" data-cell-status="cat-activo-${c.id}"></span>
                                    </td>
                                    <td style="padding:9px 12px; text-align:right; white-space:nowrap;">
                                        <span data-cat-cob="${c.id}" style="font-size:0.71rem; color:#cbd5e1; margin-right:8px;">
                                            <strong style="color:#38bdf8;">${cob.nodos_habilitados}/${cob.nodos_totales}</strong> hab · <strong style="color:#34d399;">${cob.nodos_publicados}</strong> pub
                                        </span>
                                        <button type="button" onclick="window.NodosPizarra.abrirDrawerCatalogo(${c.id})"
                                            style="padding:5px 10px; border-radius:7px; font-size:0.74rem; font-weight:800; border:1px solid #a78bfa; background:rgba(167,139,250,0.18); color:#ede9fe; cursor:pointer; margin-right:4px;">
                                            🎛️ Gestionar Nodos ▸
                                        </button>
                                        <button type="button" onclick="window.NodosPizarra.editarArticuloCatalogoEnMesa(${c.id})"
                                            style="padding:5px 8px; border-radius:7px; font-size:0.73rem; border:1px solid #334155; background:#0f172a; color:#cbd5e1; cursor:pointer;">
                                            ✏️
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

    function renderizarTablaMatrizPorNodo() {
        const nodoIdSel = Number(ESTADO_NODOS.filtroNodoId || 0);
        const catMap = new Map((ESTADO_NODOS.catalogo || []).map(c => [Number(c.id), c]));
        const ofertasNodo = (ESTADO_NODOS.ofertas_gestor || []).filter(o => Number(o.nodo_id) === nodoIdSel);
        if (ofertasNodo.length === 0) {
            return `<div class="card" style="padding:24px; text-align:center; color:#94a3b8; background:#151e2e; border:1px solid #2e3c51; border-radius:12px;">Sin ofertas registradas para el Nodo y filtros actuales.</div>`;
        }
        return `
            <div class="card" style="padding:0; overflow-x:auto; background:#151e2e; border:1px solid #2e3c51; border-radius:12px;">
                <table style="width:100%; border-collapse:collapse; font-size:0.79rem; color:#e2e8f0;">
                    <thead>
                        <tr style="background:#0f172a; color:#94a3b8; text-align:left; border-bottom:1px solid #334155;">
                            <th style="padding:10px 12px;">Artículo Oficial LAMDA</th>
                            <th style="padding:10px 8px;">Base LAMDA</th>
                            <th style="padding:10px 8px;">Niv. 1 Global</th>
                            <th style="padding:10px 8px;">Niv. 2 LAMDA Nodo</th>
                            <th style="padding:10px 8px;">Niv. 3 Tienda</th>
                            <th style="padding:10px 8px;">Margen Nodo %</th>
                            <th style="padding:10px 8px;">Precio Vecino $</th>
                            <th style="padding:10px 12px;">Ganancia Neta</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${ofertasNodo.map(of => {
                            const c = catMap.get(Number(of.articulo_catalogo_id)) || {};
                            const activoGlobal = c.activo !== false;
                            const habLamda = of.habilitado_lamda !== false;
                            return `
                                <tr style="border-bottom:1px solid rgba(51,65,85,0.55); opacity:${activoGlobal ? '1' : '0.58'};">
                                    <td style="padding:8px 12px;">
                                        <code style="color:#38bdf8;">[${escaparHtml(c.sku_nodo || '')}]</code> <strong>${escaparHtml(c.nombre_oficial_lamda || c.nombre_publico || '')}</strong>
                                        ${of.nombre_vidriera_personalizado ? `<div style="font-size:0.69rem; color:#94a3b8;">Vidriera: "${escaparHtml(of.nombre_vidriera_personalizado)}"</div>` : ''}
                                    </td>
                                    <td style="padding:8px;">${fmtMoneda(c.precio_base_nodo_final || of.precio_base_nodo_snapshot)}</td>
                                    <td style="padding:8px;">
                                        <span style="font-size:0.7rem; font-weight:800; color:${activoGlobal ? '#6ee7b7' : '#f87171'};">${activoGlobal ? '✓ Activo' : '✕ Apagado'}</span>
                                    </td>
                                    <td style="padding:8px; white-space:nowrap;">
                                        <input type="checkbox" ${habLamda ? 'checked' : ''} data-prev-checked="${habLamda ? '1' : '0'}"
                                            onchange="window.NodosPizarra.patchOfertaCelda(${of.id}, { habilitado_lamda: this.checked }, this, 'of-hab-${of.id}')" />
                                        <span class="nodos-cell-st" data-cell-status="of-hab-${of.id}"></span>
                                    </td>
                                    <td style="padding:8px; white-space:nowrap;">
                                        <input type="checkbox" ${of.publicado_tienda ? 'checked' : ''} data-prev-checked="${of.publicado_tienda ? '1' : '0'}"
                                            onchange="window.NodosPizarra.patchOfertaCelda(${of.id}, { publicado_tienda: this.checked }, this, 'of-pub-${of.id}')" />
                                        <span class="nodos-cell-st" data-cell-status="of-pub-${of.id}"></span>
                                    </td>
                                    <td style="padding:8px; white-space:nowrap;">
                                        <input type="number" step="0.5" value="${Number(of.margen_gestor_pct || 0)}" data-prev-val="${Number(of.margen_gestor_pct || 0)}"
                                            data-oferta-margen="${of.id}"
                                            onchange="window.NodosPizarra.patchOfertaCelda(${of.id}, { margen_gestor_pct: Number(this.value) }, this, 'of-mrg-${of.id}')"
                                            style="width:64px; padding:4px 6px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#f8fafc; text-align:right;" />%
                                        <span class="nodos-cell-st" data-cell-status="of-mrg-${of.id}"></span>
                                    </td>
                                    <td style="padding:8px; white-space:nowrap;">
                                        $<input type="number" step="10" value="${Number(of.precio_venta_vecino || 0)}" data-prev-val="${Number(of.precio_venta_vecino || 0)}"
                                            data-oferta-precio="${of.id}"
                                            onchange="window.NodosPizarra.patchOfertaCelda(${of.id}, { precio_venta_vecino: Number(this.value) }, this, 'of-prc-${of.id}')"
                                            style="width:80px; padding:4px 6px; border-radius:6px; border:1px solid #10b981; background:#0f172a; color:#6ee7b7; font-weight:800; text-align:right;" />
                                        <span class="nodos-cell-st" data-cell-status="of-prc-${of.id}"></span>
                                    </td>
                                    <td style="padding:8px 12px; font-weight:800; color:#34d399;" data-oferta-gan="${of.id}">${fmtMoneda(of.ganancia_unitaria_gestor)}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    // =========================================================================
    // DRAWER LATERAL POR PRODUCTO (GESTIÓN INDIVIDUAL Y MASIVA DE N NODOS)
    // =========================================================================
    function renderizarDrawerNodosSiAbierto() {
        const host = document.getElementById('nodos-drawer-host');
        if (!host) return;
        const cid = Number(ESTADO_NODOS.drawerCatalogoId || 0);
        if (!cid) {
            host.innerHTML = '';
            return;
        }
        const cat = ESTADO_NODOS.catalogo.find(c => Number(c.id) === cid);
        if (!cat) {
            host.innerHTML = '';
            return;
        }
        const ofs = (ESTADO_NODOS.ofertas_gestor || []).filter(o => {
            if (Number(o.articulo_catalogo_id) !== cid) return false;
            if (ESTADO_NODOS.drawerFiltroPerfil && String(o.perfil_operativo || '') !== ESTADO_NODOS.drawerFiltroPerfil) return false;
            if (ESTADO_NODOS.drawerFiltroBusqueda.trim()) {
                return cumpleBusquedaUniversalLamda(`${o.nombre_marca} ${o.codigo_nodo} ${o.perfil_operativo}`, ESTADO_NODOS.drawerFiltroBusqueda);
            }
            return true;
        });

        host.innerHTML = `
            <div class="nodos-drawer-backdrop" onclick="if(event.target===this) window.NodosPizarra.cerrarDrawerCatalogo()">
                <div class="nodos-drawer-panel">
                    <div style="padding:14px 18px; border-bottom:1px solid #334155; display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
                        <div>
                            <div style="font-size:0.98rem; font-weight:900;">🎛️ Gobernanza por Nodo · <code style="color:#38bdf8;">[${escaparHtml(cat.sku_nodo)}]</code></div>
                            <div style="font-size:0.77rem; color:#94a3b8; margin-top:2px;">${escaparHtml(cat.nombre_oficial_lamda || cat.nombre_publico)} · Base LAMDA: <strong style="color:#34d399;">${fmtMoneda(cat.precio_base_nodo_final)}</strong></div>
                        </div>
                        <button type="button" onclick="window.NodosPizarra.cerrarDrawerCatalogo()"
                            style="padding:5px 10px; border-radius:7px; border:1px solid #334155; background:#1e293b; color:#e2e8f0; cursor:pointer; font-weight:700;">✕ Cerrar</button>
                    </div>

                    <div style="padding:10px 18px; background:#151e2e; border-bottom:1px solid #334155; display:flex; flex-direction:column; gap:8px;">
                        <div style="display:flex; gap:8px; flex-wrap:wrap;">
                            <input type="text" value="${escaparHtml(ESTADO_NODOS.drawerFiltroBusqueda)}" placeholder="🔎 Filtrar nodos por marca o código..."
                                oninput="window.NodosPizarra.filtrarDrawer('drawerFiltroBusqueda', this.value)"
                                style="flex:1; min-width:190px; padding:6px 10px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.78rem;" />
                            <select onchange="window.NodosPizarra.filtrarDrawer('drawerFiltroPerfil', this.value)"
                                style="padding:6px 10px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.78rem;">
                                <option value="">Todos los Perfiles</option>
                                <option value="VECINOS" ${ESTADO_NODOS.drawerFiltroPerfil === 'VECINOS' ? 'selected' : ''}>🏡 VECINOS</option>
                                <option value="REDES" ${ESTADO_NODOS.drawerFiltroPerfil === 'REDES' ? 'selected' : ''}>🚀 REDES</option>
                                <option value="LOCALES" ${ESTADO_NODOS.drawerFiltroPerfil === 'LOCALES' ? 'selected' : ''}>🏪 LOCALES</option>
                            </select>
                        </div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; font-size:0.73rem;">
                            <span style="color:#94a3b8; font-weight:800;">Masivo (${ESTADO_NODOS.drawerSeleccionados.size || 'Todos visibles'}):</span>
                            <button type="button" onclick="window.NodosPizarra.ejecutarAccionMasivaDrawer(${cid}, { habilitado_lamda: true })"
                                style="padding:4px 8px; border-radius:6px; border:1px solid #10b981; background:rgba(16,185,129,0.18); color:#6ee7b7; cursor:pointer; font-weight:700;">✓ Habilitar LAMDA</button>
                            <button type="button" onclick="window.NodosPizarra.ejecutarAccionMasivaDrawer(${cid}, { habilitado_lamda: false })"
                                style="padding:4px 8px; border-radius:6px; border:1px solid #f87171; background:rgba(248,113,113,0.16); color:#fca5a5; cursor:pointer; font-weight:700;">✕ Deshabilitar LAMDA</button>
                            <button type="button" onclick="window.NodosPizarra.ejecutarAccionMasivaDrawer(${cid}, { habilitado_lamda: true, publicado_tienda: true })"
                                style="padding:4px 8px; border-radius:6px; border:1px solid #38bdf8; background:rgba(56,189,248,0.18); color:#bae6fd; cursor:pointer; font-weight:700;">🟢 Publicar Tienda</button>
                            <button type="button" onclick="window.NodosPizarra.ejecutarAccionMasivaDrawer(${cid}, { publicado_tienda: false })"
                                style="padding:4px 8px; border-radius:6px; border:1px solid #475569; background:#1e293b; color:#cbd5e1; cursor:pointer; font-weight:700;">⏸ Despublicar</button>
                            <input type="number" id="drawer-bulk-margen" placeholder="% mrg" step="0.5" style="width:66px; padding:4px 6px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#fff;" />
                            <button type="button" onclick="window.NodosPizarra.ejecutarAccionMasivaDrawer(${cid}, { margen_gestor_pct: Number(document.getElementById('drawer-bulk-margen').value) })"
                                style="padding:4px 8px; border-radius:6px; border:1px solid #a78bfa; background:rgba(167,139,250,0.2); color:#ede9fe; cursor:pointer; font-weight:700;">Aplicar %</button>
                        </div>
                    </div>

                    <div style="flex:1; overflow-y:auto; padding:12px 18px;">
                        ${ESTADO_NODOS.drawerCargando ? `<div style="padding:28px; text-align:center; color:#94a3b8; font-size:0.84rem;">⏳ Cargando configuración de Nodos para este artículo…</div>` : (ofs.length === 0 ? `<div style="padding:24px; text-align:center; color:#94a3b8; font-size:0.82rem;">Sin Nodos coincidentes con el filtro.</div>` : ofs.map(of => {
                            const nid = Number(of.nodo_id);
                            const chkSel = ESTADO_NODOS.drawerSeleccionados.has(nid);
                            const hab = of.habilitado_lamda !== false;
                            return `
                                <div style="padding:10px 12px; border-radius:9px; border:1px solid #334155; background:#151e2e; margin-bottom:8px; display:grid; grid-template-columns: auto 1.2fr auto auto auto auto; gap:10px; align-items:center;">
                                    <input type="checkbox" ${chkSel ? 'checked' : ''} onchange="window.NodosPizarra.toggleSelNodoDrawer(${nid}, this.checked)" />
                                    <div>
                                        <div style="font-weight:800; font-size:0.83rem;">${escaparHtml(of.nombre_marca)} <span style="font-size:0.68rem; color:#94a3b8;">(${escaparHtml(of.perfil_operativo)})</span></div>
                                        <div style="font-size:0.69rem; color:#94a3b8;">Gan. neta: <strong style="color:#34d399;" data-oferta-gan="${of.id}">${fmtMoneda(of.ganancia_unitaria_gestor)}</strong></div>
                                    </div>
                                    <label style="font-size:0.71rem; display:flex; flex-direction:column; align-items:center; gap:2px;">
                                        <span style="color:#94a3b8;">Niv.2 LAMDA</span>
                                        <input type="checkbox" ${hab ? 'checked' : ''} data-prev-checked="${hab ? '1' : '0'}"
                                            onchange="window.NodosPizarra.patchOfertaCelda(${of.id}, { habilitado_lamda: this.checked }, this, 'drw-hab-${of.id}')" />
                                        <span class="nodos-cell-st" data-cell-status="drw-hab-${of.id}" style="min-width:60px; text-align:center;"></span>
                                    </label>
                                    <label style="font-size:0.71rem; display:flex; flex-direction:column; align-items:center; gap:2px;">
                                        <span style="color:#94a3b8;">Niv.3 Tienda</span>
                                        <input type="checkbox" ${of.publicado_tienda ? 'checked' : ''} data-prev-checked="${of.publicado_tienda ? '1' : '0'}"
                                            onchange="window.NodosPizarra.patchOfertaCelda(${of.id}, { publicado_tienda: this.checked }, this, 'drw-pub-${of.id}')" />
                                        <span class="nodos-cell-st" data-cell-status="drw-pub-${of.id}" style="min-width:60px; text-align:center;"></span>
                                    </label>
                                    <div style="font-size:0.71rem;">
                                        <span style="color:#94a3b8;">Mrg %</span><br>
                                        <input type="number" step="0.5" value="${Number(of.margen_gestor_pct || 0)}" data-prev-val="${Number(of.margen_gestor_pct || 0)}"
                                            data-oferta-margen="${of.id}"
                                            onchange="window.NodosPizarra.patchOfertaCelda(${of.id}, { margen_gestor_pct: Number(this.value) }, this, 'drw-mrg-${of.id}')"
                                            style="width:58px; padding:3px 5px; border-radius:5px; border:1px solid #334155; background:#0f172a; color:#fff; text-align:right;" />
                                        <span class="nodos-cell-st" data-cell-status="drw-mrg-${of.id}"></span>
                                    </div>
                                    <div style="font-size:0.71rem;">
                                        <span style="color:#94a3b8;">Vecino $</span><br>
                                        <input type="number" step="10" value="${Number(of.precio_venta_vecino || 0)}" data-prev-val="${Number(of.precio_venta_vecino || 0)}"
                                            data-oferta-precio="${of.id}"
                                            onchange="window.NodosPizarra.patchOfertaCelda(${of.id}, { precio_venta_vecino: Number(this.value) }, this, 'drw-prc-${of.id}')"
                                            style="width:72px; padding:3px 5px; border-radius:5px; border:1px solid #10b981; background:#0f172a; color:#6ee7b7; font-weight:800; text-align:right;" />
                                        <span class="nodos-cell-st" data-cell-status="drw-prc-${of.id}"></span>
                                    </div>
                                </div>
                            `;
                        }).join(''))}
                    </div>
                </div>
            </div>
        `;
    }

    // =========================================================================
    // FEEDBACK ATÓMICO POR CELDA SIN DESTRUIR DOM NI PERDER SCROLL/FILTROS
    // =========================================================================
    function pintarEstadoCelda(statusKey, tipo, texto = '') {
        const el = document.querySelector(`[data-cell-status="${statusKey}"]`);
        if (!el) return;
        if (tipo === 'saving') {
            el.style.color = '#fbbf24';
            el.textContent = '⏳ Guardando…';
        } else if (tipo === 'ok') {
            el.style.color = '#34d399';
            el.textContent = '✓ Guardado';
            setTimeout(() => {
                if (el.textContent === '✓ Guardado') el.textContent = '';
            }, 2200);
        } else if (tipo === 'error') {
            el.style.color = '#f87171';
            el.textContent = `✕ Error${texto ? ' · ' + texto.slice(0, 18) : ''}`;
        }
    }

    async function patchCatalogoCelda(catalogoId, payload, controlEl, statusKey) {
        const isCheckbox = controlEl && controlEl.type === 'checkbox';
        const prevChecked = isCheckbox ? controlEl.getAttribute('data-prev-checked') === '1' : null;
        const prevVal = !isCheckbox && controlEl ? controlEl.getAttribute('data-prev-val') : null;
        pintarEstadoCelda(statusKey, 'saving');
        try {
            const resp = await fetch(`/api/produccion/nodos/catalogo/${Number(catalogoId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json().catch(() => null);
            if (!resp.ok || !data?.ok) throw new Error(data?.error || 'Error guardando');
            const art = data.articulo;
            const catMem = ESTADO_NODOS.catalogo.find(c => Number(c.id) === Number(catalogoId));
            if (catMem && art) {
                catMem.activo = Boolean(art.activo);
                catMem.margen_lamda_pct = Number(art.margen_lamda_pct ?? catMem.margen_lamda_pct);
                catMem.precio_base_nodo_final = Number(art.precio_base_nodo_final ?? catMem.precio_base_nodo_final);
            }
            if (isCheckbox) controlEl.setAttribute('data-prev-checked', art.activo ? '1' : '0');
            else if (controlEl) controlEl.setAttribute('data-prev-val', String(art.margen_lamda_pct));
            const baseEl = document.querySelector(`[data-cat-base-precio="${catalogoId}"]`);
            if (baseEl && art) baseEl.textContent = fmtMoneda(art.precio_base_nodo_final);
            const lblAct = document.querySelector(`[data-cat-activo-lbl="${catalogoId}"]`);
            if (lblAct && art) {
                lblAct.style.color = art.activo ? '#6ee7b7' : '#f87171';
                lblAct.textContent = art.activo ? 'Activo' : 'Apagado';
            }
            const rowEl = document.querySelector(`[data-cat-row="${catalogoId}"]`);
            if (rowEl && art) rowEl.style.opacity = art.activo ? '1' : '0.62';
            pintarEstadoCelda(statusKey, 'ok');
        } catch (err) {
            if (isCheckbox && controlEl) controlEl.checked = Boolean(prevChecked);
            else if (controlEl && prevVal !== null) controlEl.value = prevVal;
            pintarEstadoCelda(statusKey, 'error', 'Reintentar');
        }
    }

    async function patchOfertaCelda(ofertaId, payload, controlEl, statusKey) {
        const isCheckbox = controlEl && controlEl.type === 'checkbox';
        const prevChecked = isCheckbox ? controlEl.getAttribute('data-prev-checked') === '1' : null;
        const prevVal = !isCheckbox && controlEl ? controlEl.getAttribute('data-prev-val') : null;
        pintarEstadoCelda(statusKey, 'saving');
        try {
            const resp = await fetch(`/api/produccion/nodos/ofertas-gestor/${Number(ofertaId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json().catch(() => null);
            if (!resp.ok || !data?.ok || !data.oferta) throw new Error(data?.error || 'Error guardando');
            const ofNew = data.oferta;
            const ofMem = ESTADO_NODOS.ofertas_gestor.find(o => Number(o.id) === Number(ofertaId));
            if (ofMem) {
                ofMem.habilitado_lamda = ofNew.habilitado_lamda !== false;
                ofMem.publicado_tienda = Boolean(ofNew.publicado_tienda);
                ofMem.margen_gestor_pct = Number(ofNew.margen_gestor_pct || 0);
                ofMem.precio_venta_vecino = Number(ofNew.precio_venta_vecino || 0);
                ofMem.ganancia_unitaria_gestor = Number(ofNew.ganancia_unitaria_gestor || 0);
            }
            if (isCheckbox) {
                const isPub = Object.prototype.hasOwnProperty.call(payload, 'publicado_tienda');
                controlEl.setAttribute('data-prev-checked', (isPub ? ofNew.publicado_tienda : (ofNew.habilitado_lamda !== false)) ? '1' : '0');
            } else if (controlEl) {
                controlEl.setAttribute('data-prev-val', String(controlEl.value));
            }
            const mrgEl = document.querySelector(`[data-oferta-margen="${ofertaId}"]`);
            if (mrgEl) {
                mrgEl.value = String(Number(ofNew.margen_gestor_pct || 0));
                mrgEl.setAttribute('data-prev-val', mrgEl.value);
            }
            const prcEl = document.querySelector(`[data-oferta-precio="${ofertaId}"]`);
            if (prcEl) {
                prcEl.value = String(Number(ofNew.precio_venta_vecino || 0));
                prcEl.setAttribute('data-prev-val', prcEl.value);
            }
            document.querySelectorAll(`[data-oferta-gan="${ofertaId}"]`).forEach(g => {
                g.textContent = fmtMoneda(ofNew.ganancia_unitaria_gestor || 0);
            });
            const cid = Number(ofNew.articulo_catalogo_id);
            const ofsCat = ESTADO_NODOS.ofertas_gestor.filter(o => Number(o.articulo_catalogo_id) === cid);
            const habC = ofsCat.filter(o => o.habilitado_lamda !== false).length;
            const pubC = ofsCat.filter(o => o.habilitado_lamda !== false && o.publicado_tienda).length;
            const cobEl = document.querySelector(`[data-cat-cob="${cid}"]`);
            if (cobEl) {
                cobEl.innerHTML = `<strong style="color:#38bdf8;">${habC}/${ofsCat.length}</strong> hab · <strong style="color:#34d399;">${pubC}</strong> pub`;
            }
            pintarEstadoCelda(statusKey, 'ok');
        } catch (err) {
            if (isCheckbox && controlEl) controlEl.checked = Boolean(prevChecked);
            else if (controlEl && prevVal !== null) controlEl.value = prevVal;
            pintarEstadoCelda(statusKey, 'error', 'Reintentar');
        }
    }

    async function ejecutarAccionMasivaDrawer(catalogoId, cambios) {
        if (cambios.margen_gestor_pct !== undefined && (!Number.isFinite(cambios.margen_gestor_pct) || cambios.margen_gestor_pct < 0)) {
            return alert('Ingresá un margen % válido para aplicar masivamente.');
        }
        const nodosIds = ESTADO_NODOS.drawerSeleccionados.size > 0
            ? Array.from(ESTADO_NODOS.drawerSeleccionados)
            : (ESTADO_NODOS.drawerFiltroPerfil
                ? undefined
                : (ESTADO_NODOS.ofertas_gestor || []).filter(o => Number(o.articulo_catalogo_id) === Number(catalogoId)).map(o => Number(o.nodo_id)));

        const body = {
            ...cambios,
            ...(nodosIds && nodosIds.length > 0 ? { nodos_ids: nodosIds } : {}),
            ...(ESTADO_NODOS.drawerFiltroPerfil && ESTADO_NODOS.drawerSeleccionados.size === 0 ? { perfil_operativo: ESTADO_NODOS.drawerFiltroPerfil } : {})
        };
        const resp = await fetch(`/api/produccion/nodos/catalogo/${Number(catalogoId)}/nodos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data?.ok) return alert(data?.error || 'Error aplicando cambios masivos.');
        await Promise.all([cargarCatalogoModular(), cargarOfertasDrawerCatalogo(catalogoId)]);
        renderizarSubTabActiva();
    }

    // =========================================================================
    // VISTA 2 — ENTRADA A (INICIATIVA LAMDA — 3 PASOS PROGRESIVOS ATENUADOS)
    // =========================================================================
    function esModoCasoBAnatomia(anat) {
        return Boolean(anat && (anat.modo_resolucion === 'CASO_B_DICCIONARIO' || anat.modo_resolucion === 'CASO_B_PENDIENTE' || anat.requiere_diccionario_bunker || (!anat.tiene_hermano_bunker && !anat.existe_en_bunker)));
    }

    function construirPosicionesSeleccionadasCasoB() {
        return Object.values(ESTADO_NODOS.entradaA.casoBSeleccion?.posiciones || {})
            .filter(v => v && Number(v.categoria_id) > 0 && Number(v.termino_id) > 0)
            .map(v => ({
                categoria_id: Number(v.categoria_id),
                termino_id: Number(v.termino_id),
                modo_display: v.modo_display || 'COMPLETO',
                silencioso: Boolean(v.silencioso)
            }));
    }

    async function cargarDiccionarioBunkerCasoB(familiaId = null, articuloPrincipalId = null) {
        const sel = ESTADO_NODOS.entradaA.casoBSeleccion;
        const famTarget = familiaId || sel.familia_id || 1;
        const princTarget = articuloPrincipalId !== undefined ? articuloPrincipalId : sel.articulo_principal_id;
        const qs = new URLSearchParams();
        if (famTarget) qs.set('familia_id', String(famTarget));
        if (princTarget) qs.set('articulo_principal_id', String(princTarget));
        const resp = await fetch(`/api/produccion/nodos/diccionario-bunker?${qs.toString()}`);
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || 'Error cargando Diccionario Oficial Búnker');
        ESTADO_NODOS.entradaA.diccionarioBunkerActual = data;
        sel.familia_id = Number(data.familia_activa_id || famTarget);
        sel.articulo_principal_id = data.articulo_principal_activo_id ? Number(data.articulo_principal_activo_id) : null;
        if (!sel.rubro && Array.isArray(data.rubros) && data.rubros.length > 0) {
            sel.rubro = data.rubros[0].rubro || data.rubros[0].nombre || '';
        }
        return data;
    }

    function validarPaso1EntradaACompleto() {
        const ea = ESTADO_NODOS.entradaA;
        const df = ea.formDraft;
        if (ea.modoOrigen === 'combo') return false;
        if (!df.origenVal) return false;
        if (String(df.origenVal).startsWith('ART:')) {
            ea.paso1Completo = Boolean(df.bunkerNomenclatura);
            return ea.paso1Completo;
        }
        const anat = ea.anatomiaActualMesa;
        if (!anat) {
            ea.paso1Completo = Boolean(df.bunkerNomenclatura && ea.catalogoEditandoId);
            return ea.paso1Completo;
        }
        if (esModoCasoBAnatomia(anat)) {
            ea.paso1Completo = Boolean(ea.casoBSeleccion.articulo_principal_id && ea.casoBSeleccion.rubro && anat.nomenclatura_bunker);
            return ea.paso1Completo;
        }
        ea.paso1Completo = Boolean(anat.sku_nativo && anat.nomenclatura_bunker);
        return ea.paso1Completo;
    }

    function renderizarVistaEntradaA() {
        const ea = ESTADO_NODOS.entradaA;
        const df = ea.formDraft;
        const p1Ok = validarPaso1EntradaACompleto();
        const nodosActivos = (ESTADO_NODOS.nodos || []).filter(n => n.activo !== false);

        if (ea.modoOrigen === 'combo') {
            return `
                <div class="nodos-step-card is-active">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
                        <strong style="font-size:0.9rem; color:#f8fafc;">1️⃣ Elegir Origen de Alta LAMDA</strong>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            <button type="button" onclick="window.NodosPizarra.cambiarModoOrigenEntradaA('planta')" style="padding:5px 11px; border-radius:7px; border:1px solid #334155; background:#1e293b; color:#cbd5e1; cursor:pointer; font-size:0.76rem; font-weight:700;">🏭 Presentación de Planta (SKU-First)</button>
                            <button type="button" onclick="window.NodosPizarra.cambiarModoOrigenEntradaA('fraccion')" style="padding:5px 11px; border-radius:7px; border:1px solid #334155; background:#1e293b; color:#cbd5e1; cursor:pointer; font-size:0.76rem; font-weight:700;">🧬 Nueva Fracción (Caso A / Caso B)</button>
                            <button type="button" onclick="window.NodosPizarra.cambiarModoOrigenEntradaA('combo')" style="padding:5px 11px; border-radius:7px; border:1px solid #a855f7; background:rgba(168,85,247,0.25); color:#f3e8ff; cursor:pointer; font-size:0.76rem; font-weight:800;">🎁 Combo LDN 8</button>
                        </div>
                    </div>
                    <div id="nodos-combos-subtab-mount"></div>
                </div>
            `;
        }

        const paso2Cls = p1Ok ? 'nodos-step-card is-active' : 'nodos-step-card is-dimmed';
        const paso3Cls = p1Ok ? 'nodos-step-card is-active' : 'nodos-step-card is-dimmed';
        const disP2 = p1Ok ? '' : 'disabled';

        return `
            ${df.tituloContexto ? `
                <div style="padding:10px 14px; border-radius:10px; background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.45); margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <div>
                        <div style="font-weight:800; font-size:0.88rem; color:#f8fafc;">${df.tituloContexto}</div>
                        <div style="font-size:0.75rem; color:#bae6fd;">${df.subtituloContexto}</div>
                    </div>
                    <button type="button" onclick="window.NodosPizarra.limpiarMesaCotizacion()" style="padding:5px 10px; border-radius:7px; border:1px solid #475569; background:#0f172a; color:#cbd5e1; cursor:pointer; font-size:0.74rem; font-weight:700;">✕ Limpiar Mesa</button>
                </div>
            ` : ''}

            <!-- PASO 1: ORIGEN (SKU-FIRST PLANTA / NUEVA FRACCIÓN / COMBO) -->
            <div class="nodos-step-card ${p1Ok ? '' : 'is-active'}">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
                    <div>
                        <div style="font-size:0.9rem; font-weight:800; color:#f8fafc;">1️⃣ Paso 1 · Origen Oficial del Artículo</div>
                        <div style="font-size:0.73rem; color:#94a3b8;">Elegí una presentación de Planta, creá una fracción (Caso A hermano o Caso B Diccionario Búnker) o armá un Combo LDN 8.</div>
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <button type="button" onclick="window.NodosPizarra.cambiarModoOrigenEntradaA('planta')"
                            style="padding:5px 11px; border-radius:7px; font-size:0.76rem; font-weight:800; cursor:pointer; border:1px solid ${ea.modoOrigen === 'planta' ? '#38bdf8' : '#334155'}; background:${ea.modoOrigen === 'planta' ? 'rgba(56,189,248,0.22)' : '#1e293b'}; color:#f8fafc;">
                            🏭 Presentación Planta (SKU-First)
                        </button>
                        <button type="button" onclick="window.NodosPizarra.cambiarModoOrigenEntradaA('fraccion')"
                            style="padding:5px 11px; border-radius:7px; font-size:0.76rem; font-weight:800; cursor:pointer; border:1px solid ${ea.modoOrigen === 'fraccion' ? '#10b981' : '#334155'}; background:${ea.modoOrigen === 'fraccion' ? 'rgba(16,185,129,0.22)' : '#1e293b'}; color:#f8fafc;">
                            🧬 Nueva Fracción (Caso A / B)
                        </button>
                        <button type="button" onclick="window.NodosPizarra.cambiarModoOrigenEntradaA('combo')"
                            style="padding:5px 11px; border-radius:7px; font-size:0.76rem; font-weight:800; cursor:pointer; border:1px solid #334155; background:#1e293b; color:#e9d5ff;">
                            🎁 Combo LDN 8
                        </button>
                    </div>
                </div>

                ${ea.modoOrigen === 'planta' ? renderizarSelectorPlantaEntradaA() : ''}
                ${renderizarConstructorFraccionEntradaA()}
            </div>

            <!-- PASO 2: COSTO REAL, MARGEN LAMDA Y FOTO BASE -->
            <div class="${paso2Cls}">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <div style="font-size:0.9rem; font-weight:800; color:#f8fafc;">2️⃣ Paso 2 · Costo Vivo, Escalón Fiscal 1 (Margen LAMDA) y Radiografía</div>
                    ${!p1Ok ? `<span style="font-size:0.74rem; color:#fcd34d; font-weight:700;">🔒 Completá el paso anterior</span>` : ''}
                </div>
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:9px; margin-bottom:10px;">
                    <div>
                        <label style="display:block; font-size:0.71rem; color:#94a3b8; margin-bottom:2px;">Tarifa Colaborador MO:</label>
                        <select id="cot-tarifa-select" ${disP2} onchange="window.NodosPizarra.recalcularEnVivo()" style="width:100%; padding:6px 8px; border-radius:6px; border:1px solid #334155; background:#151e2e; color:#f8fafc; font-size:0.78rem;">
                            ${(ESTADO_NODOS.fuentes.tarifas_mano_obra || []).map(t => `<option value="${t.id}" data-valor-hora="${t.valor_hora}" ${String(df.tarifaId) === String(t.id) ? 'selected' : ''}>${escaparHtml(t.nombre_completo)} (${fmtMoneda(t.valor_hora)}/h)</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="display:block; font-size:0.71rem; color:#94a3b8; margin-bottom:2px;">Tiempo Armado (<span id="cot-tiempo-equiv-label"></span>):</label>
                        <div style="display:flex; gap:4px;">
                            <input type="number" id="cot-segundos-mo" ${disP2} step="0.5" value="${ea.unidadTiempoMesa === 'min' ? Number((df.segundosMo / 60).toFixed(2)) : df.segundosMo}" oninput="window.NodosPizarra.recalcularEnVivo()"
                                style="width:72px; padding:6px; border-radius:6px; border:1px solid #334155; background:#151e2e; color:#fff; font-size:0.78rem;" />
                            <select id="cot-unidad-tiempo-mo" ${disP2} onchange="window.NodosPizarra.alCambiarUnidadTiempoMesa(this.value)" style="padding:6px; border-radius:6px; border:1px solid #334155; background:#151e2e; color:#cbd5e1; font-size:0.76rem;">
                                <option value="min" ${ea.unidadTiempoMesa === 'min' ? 'selected' : ''}>min</option>
                                <option value="seg" ${ea.unidadTiempoMesa === 'seg' ? 'selected' : ''}>seg</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label style="display:block; font-size:0.71rem; color:#38bdf8; font-weight:700; margin-bottom:2px;">Margen LAMDA (%):</label>
                        <input type="number" id="cot-margen-lamda" ${disP2} step="0.5" value="${Number(df.margenLamda ?? 25)}" oninput="window.NodosPizarra.recalcularEnVivo()"
                            style="width:100%; padding:6px 8px; border-radius:6px; border:1px solid #38bdf8; background:#151e2e; color:#f8fafc; font-weight:800; font-size:0.8rem;" />
                    </div>
                    <div>
                        <label style="display:block; font-size:0.71rem; color:#94a3b8; margin-bottom:2px;">IVA (%) / IIBB (%):</label>
                        <div style="display:flex; gap:4px;">
                            <input type="number" id="cot-iva-pct" ${disP2} step="0.5" value="${Number(df.ivaPct ?? 21)}" oninput="window.NodosPizarra.recalcularEnVivo()" style="width:50%; padding:6px; border-radius:6px; border:1px solid #334155; background:#151e2e; color:#fff; font-size:0.78rem;" />
                            <input type="number" id="cot-iibb-pct" ${disP2} step="0.5" value="${Number(df.iibbPct ?? 4)}" oninput="window.NodosPizarra.recalcularEnVivo()" style="width:50%; padding:6px; border-radius:6px; border:1px solid #334155; background:#151e2e; color:#fff; font-size:0.78rem;" />
                        </div>
                    </div>
                    <div>
                        <label style="display:block; font-size:0.71rem; color:#34d399; font-weight:700; margin-bottom:2px;">Margen Sug. Nodo (%):</label>
                        <input type="number" id="cot-margen-gestor" ${disP2} step="0.5" value="${Number(df.margenGestor ?? 28)}" oninput="window.NodosPizarra.recalcularEnVivo()"
                            style="width:100%; padding:6px 8px; border-radius:6px; border:1px solid #10b981; background:#151e2e; color:#6ee7b7; font-weight:800; font-size:0.8rem;" />
                    </div>
                    <div>
                        <label style="display:block; font-size:0.71rem; color:#94a3b8; margin-bottom:2px;">Compartir con Mayorista:</label>
                        <select id="cot-compartido-mayorista" ${disP2} style="width:100%; padding:6px; border-radius:6px; border:1px solid #334155; background:#151e2e; color:#fff; font-size:0.76rem;">
                            <option value="false" ${!df.compartidoMayorista ? 'selected' : ''}>Solo Canal Nodos</option>
                            <option value="true" ${df.compartidoMayorista ? 'selected' : ''}>Sí (Padrón Mayorista)</option>
                        </select>
                    </div>
                </div>
                <input type="hidden" id="cot-alias-vidriera-nodo" value="${escaparHtml(df.aliasVidriera || '')}" />
                <input type="text" id="cot-notas-tecnicas" ${disP2} value="${escaparHtml(df.notasTecnicas || '')}" placeholder="Notas técnicas opcionales (armado, observaciones)..."
                    style="width:100%; padding:6px 9px; border-radius:6px; border:1px solid #334155; background:#151e2e; color:#e2e8f0; font-size:0.77rem; margin-bottom:8px;" />
                <div id="cot-radiografia-box" style="padding:10px; border-radius:9px; background:#151e2e; border:1px solid #2e3c51;"></div>
            </div>

            <!-- PASO 3: NODOS DESTINO (NIVEL 2 HABILITACIÓN Y NIVEL 3 PUBLICACIÓN) -->
            <div class="${paso3Cls}">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
                    <div>
                        <div style="font-size:0.9rem; font-weight:800; color:#f8fafc;">3️⃣ Paso 3 · Nodos Destino (Nivel 2 LAMDA y Nivel 3 Tienda)</div>
                        <div style="font-size:0.72rem; color:#94a3b8;">Por defecto todos los Nodos activos reciben disponibilidad en <code>/gestor</code> (<code>habilitado_lamda=true</code>) sin autopublicarse en <code>/tienda</code> salvo marca expresa.</div>
                    </div>
                    ${!p1Ok ? `<span style="font-size:0.74rem; color:#fcd34d; font-weight:700;">🔒 Completá el paso anterior</span>` : `
                        <div style="display:flex; gap:5px; flex-wrap:wrap;">
                            <button type="button" onclick="window.NodosPizarra.seleccionarDestinoEntradaA('TODOS')" style="padding:4px 9px; border-radius:6px; border:1px solid #38bdf8; background:rgba(56,189,248,0.16); color:#bae6fd; font-size:0.72rem; cursor:pointer;">✓ Todos</button>
                            <button type="button" onclick="window.NodosPizarra.seleccionarDestinoEntradaA('VECINOS')" style="padding:4px 9px; border-radius:6px; border:1px solid #10b981; background:rgba(16,185,129,0.16); color:#6ee7b7; font-size:0.72rem; cursor:pointer;">🏡 Solo VECINOS</button>
                            <button type="button" onclick="window.NodosPizarra.seleccionarDestinoEntradaA('REDES')" style="padding:4px 9px; border-radius:6px; border:1px solid #f59e0b; background:rgba(245,158,11,0.16); color:#fcd34d; font-size:0.72rem; cursor:pointer;">🚀 Solo REDES</button>
                            <button type="button" onclick="window.NodosPizarra.seleccionarDestinoEntradaA('LOCALES')" style="padding:4px 9px; border-radius:6px; border:1px solid #94a3b8; background:#1e293b; color:#e2e8f0; font-size:0.72rem; cursor:pointer;">🏪 Solo LOCALES</button>
                        </div>
                    `}
                </div>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:7px; margin-bottom:12px;">
                    ${nodosActivos.map(n => {
                        const nid = Number(n.id);
                        const habChk = ea.nodosHabilitadosIds.has(nid);
                        const pubChk = ea.nodosPublicadosIds.has(nid);
                        return `
                            <div style="padding:7px 9px; border-radius:8px; border:1px solid #334155; background:#151e2e; display:flex; justify-content:space-between; align-items:center; gap:6px; font-size:0.75rem;">
                                <div>
                                    <strong>${escaparHtml(n.nombre_marca)}</strong>
                                    <div style="font-size:0.67rem; color:#94a3b8;">${escaparHtml(n.perfil_operativo)}</div>
                                </div>
                                <div style="display:flex; gap:8px; align-items:center;">
                                    <label title="Habilitado en LAMDA (Nivel 2)" style="font-size:0.68rem; color:#bae6fd; display:flex; align-items:center; gap:3px; cursor:pointer;">
                                        <input type="checkbox" ${disP2} ${habChk ? 'checked' : ''} onchange="window.NodosPizarra.toggleDestinoEntradaA(${nid}, 'hab', this.checked)" /> Hab
                                    </label>
                                    <label title="Publicar directo en Tienda (Nivel 3)" style="font-size:0.68rem; color:#6ee7b7; display:flex; align-items:center; gap:3px; cursor:pointer;">
                                        <input type="checkbox" ${disP2} ${pubChk ? 'checked' : ''} onchange="window.NodosPizarra.toggleDestinoEntradaA(${nid}, 'pub', this.checked)" /> Pub
                                    </label>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
                <div style="display:flex; justify-content:flex-end;">
                    <button type="button" ${disP2} onclick="window.NodosPizarra.aprobarYPublicarEnPadronNodos()"
                        style="padding:10px 20px; border-radius:9px; border:none; background:linear-gradient(135deg, #10b981, #059669); color:#052e16; font-weight:900; font-size:0.86rem; cursor:pointer;">
                        ✅ Aprobar y Sincronizar con Búnker y Nodos
                    </button>
                </div>
            </div>
        `;
    }

    function renderizarSelectorPlantaEntradaA() {
        const ea = ESTADO_NODOS.entradaA;
        const lista = (ESTADO_NODOS.presentaciones_planta_disponibles || []).filter(p => {
            if (ea.filtroPesoPlanta === 'SUB_1KG' && Number(p.kilos_unidad || 0) >= 1.05 && !p.es_pack) return false;
            return cumpleBusquedaUniversalLamda(`${p.articulo_id} ${p.descripcion_generada} ${p.ingrediente_nombre} ${p.categoria_lamda}`, ea.busquedaPlanta);
        }).slice(0, 30);

        return `
            <div style="padding:10px; border-radius:9px; background:#151e2e; border:1px solid rgba(56,189,248,0.35); margin-bottom:10px;">
                <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:8px;">
                    <input type="text" value="${escaparHtml(ea.busquedaPlanta)}" oninput="window.NodosPizarra.filtrarPlantaEntradaA(this.value)"
                        placeholder="🔎 Buscar presentación ya fabricada en Planta (ej: Nuez Mariposa, GDFX200G, Mani)..."
                        style="flex:1; min-width:220px; padding:6px 9px; border-radius:7px; border:1px solid #38bdf8; background:#0f172a; color:#fff; font-size:0.78rem;" />
                    <select onchange="window.NodosPizarra.cambiarFiltroPesoPlantaEntradaA(this.value)" style="padding:6px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#cbd5e1; font-size:0.75rem;">
                        <option value="SUB_1KG" ${ea.filtroPesoPlanta === 'SUB_1KG' ? 'selected' : ''}>Fracciones &lt;= 1kg y Packs</option>
                        <option value="ALL" ${ea.filtroPesoPlanta === 'ALL' ? 'selected' : ''}>Todas</option>
                    </select>
                </div>
                <div style="max-height:175px; overflow-y:auto; display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:6px;">
                    ${lista.length === 0 ? `<div style="color:#94a3b8; font-size:0.75rem;">Sin presentaciones pendientes de incorporar.</div>` : lista.map(p => `
                        <button type="button" onclick="window.NodosPizarra.cargarPresentacionPlantaEnMesa(${Number(p.ingrediente_id)}, ${Number(p.kilos_unidad)}, '${escaparHtml(p.articulo_id)}')"
                            style="text-align:left; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; cursor:pointer; font-size:0.74rem;">
                            <div style="font-weight:800;"><code style="color:#38bdf8;">[${escaparHtml(p.articulo_id)}]</code> ${escaparHtml(p.descripcion_generada)}</div>
                            <div style="font-size:0.68rem; color:#94a3b8;">${escaparHtml(p.etiqueta_peso)} · Insumo: ${fmtMoneda(p.costo_insumo_kg)}/kg</div>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function renderizarConstructorFraccionEntradaA() {
        const ea = ESTADO_NODOS.entradaA;
        const df = ea.formDraft;
        const flujo = Number(ea.flujoSeleccionadoMesa || 2);
        const origenesHtml = flujo === 1
            ? (ESTADO_NODOS.fuentes.articulos_bulto_flujo1 || []).filter(a => cumpleBusquedaUniversalLamda(`${a.articulo_id} ${a.nombre} ${a.rubro}`, ea.busquedaFuentes))
                .map(a => `<option value="ART:${escaparHtml(a.articulo_id)}" data-costo="${a.costo_kg}" data-categoria="${escaparHtml(a.rubro || 'Bultos Cerrados')}" data-nombre="${escaparHtml(a.nombre)}" ${df.origenVal === 'ART:' + a.articulo_id ? 'selected' : ''}>[${escaparHtml(a.articulo_id)}] ${escaparHtml(a.nombre)} (${fmtMoneda(a.costo_kg)}/kg)</option>`).join('')
            : (ESTADO_NODOS.fuentes.ingredientes_por_flujo || []).filter(i => Number(i.flujo) === flujo && cumpleBusquedaUniversalLamda(`${i.codigo} ${i.nombre} ${i.familia_bunker_nombre}`, ea.busquedaFuentes))
                .map(i => `<option value="${i.id}" data-costo="${i.costo_kg}" data-categoria="${escaparHtml(i.familia_bunker_nombre || i.categoria_lamda || 'Frutos Secos')}" data-nombre="${escaparHtml(i.nombre)}" ${String(df.origenVal) === String(i.id) ? 'selected' : ''}>${escaparHtml(i.label_oficial)} (${fmtMoneda(i.costo_kg)}/kg)</option>`).join('');

        return `
            <div style="display:flex; gap:5px; flex-wrap:wrap; margin-bottom:9px;">
                ${[1, 2, 3, 4, 5, 6].map(f => {
                    const fm = FLUJO_META[f];
                    const act = flujo === f;
                    return `<button type="button" onclick="window.NodosPizarra.seleccionarFlujoMesa(${f})"
                        style="padding:4px 9px; border-radius:999px; font-size:0.72rem; font-weight:800; cursor:pointer; border:1px solid ${act ? fm.color : '#334155'}; background:${act ? fm.bg : '#151e2e'}; color:${act ? fm.color : '#cbd5e1'};">${fm.corto}</button>`;
                }).join('')}
            </div>

            <div style="display:grid; grid-template-columns: 1.5fr 0.7fr 0.7fr 1.2fr; gap:8px; margin-bottom:8px;">
                <div>
                    <label style="display:block; font-size:0.71rem; color:#38bdf8; font-weight:700; margin-bottom:2px;">Insumo Base / Bulto LAMDA:</label>
                    <select id="cot-origen-select" onchange="window.NodosPizarra.alCambiarOrigenSelect()"
                        style="width:100%; padding:6px 8px; border-radius:6px; border:1px solid #38bdf8; background:#151e2e; color:#fff; font-size:0.78rem;">
                        <option value="">— Seleccionar origen oficial —</option>
                        ${origenesHtml}
                    </select>
                </div>
                <div>
                    <label style="display:block; font-size:0.71rem; color:#94a3b8; margin-bottom:2px;">Costo Base $/kg:</label>
                    <input type="number" id="cot-costo-kg" step="10" value="${Number(df.costoKg || 0).toFixed(2)}" oninput="window.NodosPizarra.recalcularEnVivo()"
                        style="width:100%; padding:6px 8px; border-radius:6px; border:1px solid #334155; background:#151e2e; color:#34d399; font-weight:800; font-size:0.78rem;" />
                </div>
                <div>
                    <label style="display:block; font-size:0.71rem; color:#94a3b8; margin-bottom:2px;">Peso (kg):</label>
                    <input type="number" id="cot-kilos-unidad" step="0.05" min="0.01" value="${Number(df.kilosUnidad || 0.25).toFixed(2)}" onchange="window.NodosPizarra.alCambiarKilosUnidadMesa()"
                        style="width:100%; padding:6px 8px; border-radius:6px; border:1px solid #334155; background:#151e2e; color:#fff; font-weight:800; font-size:0.78rem;" />
                </div>
                <div>
                    <label style="display:block; font-size:0.71rem; color:#94a3b8; margin-bottom:2px;">Envase Real (<code>es_insumo=true</code>):</label>
                    <select id="cot-envase-select" onchange="window.NodosPizarra.recalcularEnVivo()"
                        style="width:100%; padding:6px 8px; border-radius:6px; border:1px solid #334155; background:#151e2e; color:#fff; font-size:0.77rem;">
                        ${(ESTADO_NODOS.fuentes.envases || []).map(e => `<option value="${e.id}" data-costo="${e.costo_unitario}" ${String(df.insumoEnvaseId) === String(e.id) ? 'selected' : ''}>${escaparHtml(e.label_oficial)} (${fmtMoneda(e.costo_unitario)})</option>`).join('')}
                    </select>
                </div>
            </div>

            <div style="display:flex; gap:5px; flex-wrap:wrap; align-items:center; margin-bottom:8px; font-size:0.72rem;">
                <span style="color:#94a3b8;">Gramajes rápidos:</span>
                ${[[0.1, '100g'], [0.2, '200g'], [0.25, '250g'], [0.5, '500g'], [1, '1kg']].map(([kg, lbl]) => `
                    <button type="button" onclick="window.NodosPizarra.fijarGramajeRapido(${kg})" style="padding:2px 8px; border-radius:5px; border:1px solid #334155; background:#1e293b; color:#e2e8f0; cursor:pointer; font-size:0.71rem;">${lbl}</button>
                `).join('')}
                <select id="cot-modo-presentacion" onchange="window.NodosPizarra.alCambiarPresentacionMesa(true)" style="margin-left:auto; padding:3px 7px; border-radius:5px; border:1px solid #334155; background:#151e2e; color:#cbd5e1; font-size:0.72rem;">
                    <option value="BOLSA" ${df.modoPresentacion !== 'PACK' ? 'selected' : ''}>Bolsa Unitaria</option>
                    <option value="PACK" ${df.modoPresentacion === 'PACK' ? 'selected' : ''}>Multipack</option>
                </select>
                <span id="cot-pack-params-wrap" style="display:${df.modoPresentacion === 'PACK' ? 'inline-flex' : 'none'}; gap:4px; align-items:center;">
                    <input type="number" id="cot-pack-unidades" min="2" value="${Number(df.packUnidades || 3)}" onchange="window.NodosPizarra.alCambiarPresentacionMesa(false)" style="width:48px; padding:3px; border-radius:5px; border:1px solid #334155; background:#151e2e; color:#fff;" />u ×
                    <input type="number" id="cot-pack-peso-unit-g" min="5" value="${Number(df.packPesoUnitG || 50)}" onchange="window.NodosPizarra.alCambiarPresentacionMesa(false)" style="width:52px; padding:3px; border-radius:5px; border:1px solid #334155; background:#151e2e; color:#fff;" />g
                </span>
            </div>

            <div style="display:grid; grid-template-columns: 0.7fr 1.5fr 0.9fr; gap:8px; margin-bottom:8px;">
                <div>
                    <label style="display:block; font-size:0.71rem; color:#94a3b8; margin-bottom:2px;">SKU Oficial (Búnker):</label>
                    <input type="text" id="cot-sku-nodo" readonly value="${escaparHtml(df.skuNodo || '')}" style="width:100%; padding:6px 8px; border-radius:6px; border:1px solid #334155; background:#0b1120; color:#38bdf8; font-family:monospace; font-weight:800; font-size:0.78rem;" />
                </div>
                <div>
                    <label style="display:block; font-size:0.71rem; color:#94a3b8; margin-bottom:2px;">Nomenclatura Oficial Generada:</label>
                    <input type="text" id="cot-bunker-nomenclatura" readonly value="${escaparHtml(df.bunkerNomenclatura || '')}" style="width:100%; padding:6px 8px; border-radius:6px; border:1px solid #334155; background:#0b1120; color:#f8fafc; font-weight:700; font-size:0.78rem;" />
                </div>
                <div>
                    <label style="display:block; font-size:0.71rem; color:#94a3b8; margin-bottom:2px;">Familia Búnker:</label>
                    <input type="text" id="cot-categoria" readonly value="${escaparHtml(df.categoria || '')}" style="width:100%; padding:6px 8px; border-radius:6px; border:1px solid #334155; background:#0b1120; color:#cbd5e1; font-size:0.78rem;" />
                </div>
            </div>
            <div id="cot-rubro-secundario" style="font-size:0.7rem; color:#94a3b8; margin-bottom:6px;">${escaparHtml(df.rubroSecundario || '')}</div>
            <div id="cot-bunker-receta-badge" style="display:none; padding:7px 10px; border-radius:7px; font-size:0.74rem; margin-bottom:8px;"></div>
            <div id="cot-caso-b-diccionario-panel" style="display:none; padding:10px; border-radius:9px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.45); margin-top:6px;"></div>
        `;
    }

    function renderizarPanelDiccionarioCasoB(anat = null) {
        const panel = document.getElementById('cot-caso-b-diccionario-panel');
        if (!panel) return;
        if (!esModoCasoBAnatomia(anat)) {
            panel.style.display = 'none';
            panel.innerHTML = '';
            return;
        }
        const dic = ESTADO_NODOS.entradaA.diccionarioBunkerActual;
        if (!dic) {
            panel.style.display = 'block';
            panel.innerHTML = `<div style="font-size:0.75rem; color:#fcd34d;">⏳ Cargando Diccionario Oficial Búnker...</div>`;
            return;
        }
        const sel = ESTADO_NODOS.entradaA.casoBSeleccion;
        const kilos = Math.max(0.001, Number(document.getElementById('cot-kilos-unidad')?.value || 0.25));
        const etiquetaPeso = kilos >= 1 ? `${Number(kilos.toFixed(2))}kg` : `${Math.round(kilos * 1000)}g`;

        const familiasOpts = (dic.familias || []).map(f =>
            `<option value="${f.id}" ${Number(sel.familia_id) === Number(f.id) ? 'selected' : ''}>#${f.id} ${escaparHtml(f.nombre)}${f.abreviatura ? ` (${escaparHtml(f.abreviatura)})` : ''}</option>`
        ).join('');
        const listaPrincipales = dic.articulos_principales || dic.principales || [];
        const principalesOpts = [
            `<option value="">— Seleccionar Sustantivo Ancla (bunker_diccionario) —</option>`,
            ...listaPrincipales.map(p => `<option value="${p.id}" ${Number(sel.articulo_principal_id) === Number(p.id) ? 'selected' : ''}>#${p.id} ${escaparHtml(p.termino)}${p.abreviatura ? ` [${escaparHtml(p.abreviatura)}]` : ''}</option>`)
        ].join('');
        const categoriasHtml = (dic.categorias_familia || []).map(cat => {
            const ordenNum = Number(cat.orden_posicional || cat.orden_posicion || 1);
            const slotKey = `pos_${ordenNum}`;
            const nombreCat = String(cat.categoria || cat.nombre_categoria || '').trim();
            const esSlotPeso = Boolean(cat.es_eje_presentacion);
            const valorActual = sel.posiciones?.[slotKey]?.termino_id || '';
            const optsTerminos = [
                esSlotPeso ? `<option value="">⚡ Automático por peso (${escaparHtml(etiquetaPeso)})</option>` : `<option value="">— Sin atributo pos_${ordenNum} —</option>`,
                ...(cat.terminos || []).map(t => `<option value="${t.id}" ${Number(valorActual) === Number(t.id) ? 'selected' : ''}>#${t.id} ${escaparHtml(t.termino)}${t.abreviatura ? ` [${escaparHtml(t.abreviatura)}]` : ''}</option>`)
            ].join('');
            return `
                <div>
                    <label style="display:block; font-size:0.69rem; color:#fcd34d; font-weight:700; margin-bottom:2px;">Pos ${ordenNum} · ${escaparHtml(nombreCat)}:</label>
                    <select onchange="window.NodosPizarra.alCambiarSelectorDiccionarioCasoB('${slotKey}', this.value, ${Number(cat.id)})"
                        style="width:100%; padding:5px 7px; border-radius:6px; border:1px solid rgba(245,158,11,0.45); background:#0f172a; color:#f8fafc; font-size:0.75rem;">${optsTerminos}</select>
                </div>
            `;
        }).join('');
        const rubrosOpts = [
            `<option value="">— Seleccionar Rubro Oficial —</option>`,
            ...(dic.rubros || []).map(r => {
                const nom = r.rubro || r.nombre || '';
                return `<option value="${escaparHtml(nom)}" ${String(sel.rubro || '').toUpperCase() === nom.toUpperCase() ? 'selected' : ''}>${escaparHtml(nom)}</option>`;
            })
        ].join('');
        const rubroObj = (dic.rubros || []).find(r => String(r.rubro || r.nombre || '').toUpperCase() === String(sel.rubro || '').toUpperCase());
        const subrubrosOpts = [
            `<option value="">— Sin Sub-Rubro —</option>`,
            ...(Array.isArray(rubroObj?.subrubros) ? rubroObj.subrubros : []).map(sr => {
                const nomSub = typeof sr === 'string' ? sr : (sr.nombre || '');
                return `<option value="${escaparHtml(nomSub)}" ${String(sel.sub_rubro || '').toUpperCase() === nomSub.toUpperCase() ? 'selected' : ''}>${escaparHtml(nomSub)}</option>`;
            })
        ].join('');

        panel.style.display = 'block';
        panel.innerHTML = `
            <div style="font-size:0.75rem; font-weight:800; color:#fcd34d; margin-bottom:6px;">🧬 Caso B (Sin hermano previo en Búnker): Construcción Relacional por Diccionario Oficial Búnker</div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:8px;">
                <div>
                    <label style="display:block; font-size:0.69rem; color:#cbd5e1; margin-bottom:2px;">1. Familia Búnker:</label>
                    <select onchange="window.NodosPizarra.alCambiarSelectorDiccionarioCasoB('familia_id', this.value)" style="width:100%; padding:5px 7px; border-radius:6px; border:1px solid #f59e0b; background:#0f172a; color:#fff; font-size:0.76rem;">${familiasOpts}</select>
                    <label style="font-size:0.68rem; color:#cbd5e1; margin-top:3px; display:inline-flex; gap:4px; align-items:center;"><input type="checkbox" ${sel.incluir_familia ? 'checked' : ''} onchange="window.NodosPizarra.alCambiarSelectorDiccionarioCasoB('incluir_familia', this.checked)" /> Incluir abreviatura familia</label>
                </div>
                <div>
                    <label style="display:block; font-size:0.69rem; color:#cbd5e1; margin-bottom:2px;">2. Sustantivo Ancla:</label>
                    <select onchange="window.NodosPizarra.alCambiarSelectorDiccionarioCasoB('articulo_principal_id', this.value)" style="width:100%; padding:5px 7px; border-radius:6px; border:1px solid #f59e0b; background:#0f172a; color:#fff; font-size:0.76rem;">${principalesOpts}</select>
                    <label style="font-size:0.68rem; color:#cbd5e1; margin-top:3px; display:inline-flex; gap:4px; align-items:center;"><input type="checkbox" ${sel.silencioso_principal ? 'checked' : ''} onchange="window.NodosPizarra.alCambiarSelectorDiccionarioCasoB('silencioso_principal', this.checked)" /> Sustantivo silencioso</label>
                </div>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap:8px; margin-bottom:8px;">${categoriasHtml}</div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
                <div><label style="display:block; font-size:0.69rem; color:#cbd5e1; margin-bottom:2px;">Rubro Oficial:</label><select onchange="window.NodosPizarra.alCambiarSelectorDiccionarioCasoB('rubro', this.value)" style="width:100%; padding:5px 7px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#fff; font-size:0.76rem;">${rubrosOpts}</select></div>
                <div><label style="display:block; font-size:0.69rem; color:#cbd5e1; margin-bottom:2px;">Sub-Rubro:</label><select onchange="window.NodosPizarra.alCambiarSelectorDiccionarioCasoB('sub_rubro', this.value)" style="width:100%; padding:5px 7px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#fff; font-size:0.76rem;">${subrubrosOpts}</select></div>
            </div>
        `;
    }

    async function sincronizarAnatomiaMesaConBackend(opciones = {}) {
        const ea = ESTADO_NODOS.entradaA;
        const df = ea.formDraft;
        const val = String(df.origenVal || '');
        if (!val || val.startsWith('ART:')) {
            ea.anatomiaActualMesa = null;
            validarPaso1EntradaACompleto();
            renderizarSubTabActiva();
            return;
        }
        const ingId = Number(val);
        const kilos = Math.max(0.001, Number(df.kilosUnidad || 0.25));
        const bodyReq = {
            ingrediente_origen_id: ingId,
            kilos_unidad: kilos,
            flujo_lamda: Number(ea.flujoSeleccionadoMesa || 2)
        };
        if (df.modoPresentacion === 'PACK') {
            bodyReq.modo_presentacion = 'PACK';
            bodyReq.pack_unidades = Math.max(2, Math.round(Number(df.packUnidades || 3)));
            bodyReq.peso_unitario_gramos = Math.max(5, Math.round(Number(df.packPesoUnitG || 50)));
        }
        const selB = ea.casoBSeleccion;
        if (opciones.desdeCasoB || esModoCasoBAnatomia(ea.anatomiaActualMesa)) {
            if (selB.familia_id) { bodyReq.familia_bunker_id = selB.familia_id; bodyReq.familia_id = selB.familia_id; }
            bodyReq.incluir_familia = Boolean(selB.incluir_familia);
            bodyReq.modo_display_familia = selB.modo_display_familia || 'ABREVIADO';
            if (selB.articulo_principal_id) bodyReq.articulo_principal_id = selB.articulo_principal_id;
            bodyReq.silencioso_principal = Boolean(selB.silencioso_principal);
            bodyReq.modo_display_principal = selB.modo_display_principal || 'COMPLETO';
            bodyReq.posiciones_seleccionadas = construirPosicionesSeleccionadasCasoB();
            bodyReq.posiciones = selB.posiciones || {};
            if (selB.rubro) { bodyReq.rubro_bunker = selB.rubro; bodyReq.rubro = selB.rubro; }
            if (selB.sub_rubro) { bodyReq.sub_rubro_bunker = selB.sub_rubro; bodyReq.sub_rubro = selB.sub_rubro; }
        }
        const resp = await fetch('/api/produccion/nodos/previsualizar-anatomia', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyReq)
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data?.ok || !data.anatomia) return;
        const anat = data.anatomia;
        ea.anatomiaActualMesa = anat;
        if (anat.sku_nativo && !ea.catalogoEditandoId) df.skuNodo = anat.sku_nativo;
        df.bunkerNomenclatura = anat.nomenclatura_bunker || '';
        df.categoria = anat.familia_nombre || 'Sin Familia Búnker';
        df.rubroSecundario = [anat.articulo_principal ? `Ancla: ${anat.articulo_principal}` : '', anat.rubro ? `Rubro: ${anat.rubro}` : ''].filter(Boolean).join(' · ');
        if (anat.insumo_envase_id && !ea.catalogoEditandoId && !opciones.desdeCasoB) df.insumoEnvaseId = String(anat.insumo_envase_id);
        if (anat.segundos_nativos && !ea.catalogoEditandoId && !opciones.desdeCasoB) df.segundosMo = Number(anat.segundos_nativos);
        if (esModoCasoBAnatomia(anat) && !ea.diccionarioBunkerActual) {
            await cargarDiccionarioBunkerCasoB(anat.familia_id || 1, anat.articulo_principal_id || null).catch(() => {});
        }
        validarPaso1EntradaACompleto();
        renderizarSubTabActiva();
        const badgeEl = document.getElementById('cot-bunker-receta-badge');
        if (badgeEl) {
            badgeEl.style.display = 'block';
            badgeEl.style.background = anat.existe_en_bunker ? 'rgba(16,185,129,0.14)' : (anat.modo_resolucion === 'CASO_A_HERMANO' ? 'rgba(56,189,248,0.12)' : 'rgba(245,158,11,0.14)');
            badgeEl.style.border = '1px solid rgba(56,189,248,0.35)';
            badgeEl.style.color = '#f8fafc';
            badgeEl.innerHTML = anat.existe_en_bunker
                ? `✅ <strong>Caso 0 (Existente en Búnker):</strong> <code>[${escaparHtml(anat.sku_nativo)}] ${escaparHtml(anat.nomenclatura_bunker)}</code>`
                : (anat.modo_resolucion === 'CASO_A_HERMANO'
                    ? `🧬 <strong>Caso A (Hermano Búnker ${escaparHtml(anat.hermano_origen_sku || '')}):</strong> <code>[${escaparHtml(anat.sku_nativo)}] ${escaparHtml(anat.nomenclatura_bunker)}</code>`
                    : `🏛️ <strong>Caso B (Diccionario Búnker):</strong> <code>[${escaparHtml(anat.sku_nativo || 'PEND')}] ${escaparHtml(anat.nomenclatura_bunker || 'Completá los selectores debajo')}</code>`);
        }
        renderizarPanelDiccionarioCasoB(anat);
    }

    function obtenerSegundosDesdeMesa(unidadOverride) {
        const segEl = document.getElementById('cot-segundos-mo');
        const df = ESTADO_NODOS.entradaA.formDraft;
        if (!segEl) return Number(df.segundosMo || 300);
        const num = Number(String(segEl.value ?? '').trim().replace(',', '.'));
        if (!Number.isFinite(num) || num < 0) return 0;
        const unidad = unidadOverride || document.getElementById('cot-unidad-tiempo-mo')?.value || ESTADO_NODOS.entradaA.unidadTiempoMesa || 'min';
        const segs = unidad === 'min' ? Math.round(num * 60) : Math.round(num);
        df.segundosMo = segs;
        return segs;
    }

    function recalcularMesaCotizacionEnVivo() {
        const box = document.getElementById('cot-radiografia-box');
        const df = ESTADO_NODOS.entradaA.formDraft;
        if (!box) return;
        const costoKgEl = document.getElementById('cot-costo-kg');
        const kilosEl = document.getElementById('cot-kilos-unidad');
        const envEl = document.getElementById('cot-envase-select');
        const tarEl = document.getElementById('cot-tarifa-select');
        const mrgLEl = document.getElementById('cot-margen-lamda');
        const ivaEl = document.getElementById('cot-iva-pct');
        const iibbEl = document.getElementById('cot-iibb-pct');
        const mrgGEl = document.getElementById('cot-margen-gestor');

        if (costoKgEl) df.costoKg = Math.max(0, Number(costoKgEl.value || 0));
        if (kilosEl) df.kilosUnidad = Math.max(0.001, Number(kilosEl.value || 0.25));
        if (envEl && envEl.value) df.insumoEnvaseId = envEl.value;
        if (tarEl && tarEl.value) df.tarifaId = tarEl.value;
        if (mrgLEl) df.margenLamda = Math.max(0, Number(mrgLEl.value || 25));
        if (ivaEl) df.ivaPct = Math.max(0, Number(ivaEl.value || 21));
        if (iibbEl) df.iibbPct = Math.max(0, Number(iibbEl.value || 4));
        if (mrgGEl) df.margenGestor = Math.max(0, Number(mrgGEl.value || 28));

        const envCosto = Number(envEl?.selectedOptions?.[0]?.getAttribute('data-costo') || 45);
        const valorHora = Number(tarEl?.selectedOptions?.[0]?.getAttribute('data-valor-hora') || 7000);
        const seg = obtenerSegundosDesdeMesa();
        const eq = document.getElementById('cot-tiempo-equiv-label');
        if (eq) eq.textContent = ESTADO_NODOS.entradaA.unidadTiempoMesa === 'min' ? `= ${seg}s` : `= ${(seg / 60).toFixed(1)}m`;

        const cMp = df.costoKg * df.kilosUnidad;
        const cMatEnv = cMp + envCosto;
        const cMo = (seg / 3600) * valorHora;
        const cPuro = cMatEnv + cMo;
        const pNeto = cMatEnv * (1 + df.margenLamda / 100) + cMo;
        const pBaseNodo = Math.round(pNeto * (1 + df.ivaPct / 100));
        const calcEsc2 = calcularPrecioYGananciaFiscalNodoJs(pBaseNodo, df.margenGestor, df.ivaPct, df.iibbPct, 'margen');

        box.innerHTML = `
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; font-size:0.78rem;">
                <div><span style="color:#94a3b8;">Costo Puro:</span><br><strong style="color:#f8fafc;">${fmtMoneda(cPuro, 2)}</strong></div>
                <div><span style="color:#94a3b8;">MO (${seg}s):</span><br><strong style="color:#cbd5e1;">${fmtMoneda(cMo, 2)}</strong></div>
                <div><span style="color:#38bdf8;">Precio Base Nodo:</span><br><strong style="color:#38bdf8; font-size:0.95rem;">${fmtMoneda(pBaseNodo)}</strong></div>
                <div><span style="color:#34d399;">Sug. Vecino (Gan. ${fmtMoneda(calcEsc2.ganancia_neta_nodo)}):</span><br><strong style="color:#34d399; font-size:0.95rem;">${fmtMoneda(calcEsc2.precio_tienda)}</strong></div>
            </div>
        `;
    }

    async function aprobarYPublicarEnPadronNodos() {
        try {
            const ea = ESTADO_NODOS.entradaA;
            const df = ea.formDraft;
            const origenVal = String(df.origenVal || '');
            const esArtBunker = origenVal.startsWith('ART:');
            const ingId = !esArtBunker && origenVal ? Number(origenVal) : null;
            const artCod = esArtBunker ? origenVal.replace('ART:', '') : null;
            if (!esArtBunker && !ingId) throw new Error('Seleccioná un origen oficial de LAMDA.');
            const envSel = document.getElementById('cot-envase-select');
            const envCosto = Number(envSel?.selectedOptions?.[0]?.getAttribute('data-costo') || 0);
            const tarSel = document.getElementById('cot-tarifa-select');
            const valorHora = Number(tarSel?.selectedOptions?.[0]?.getAttribute('data-valor-hora') || 7000);
            const kilos = Number(df.kilosUnidad || 0.25);
            const segs = Math.max(1, obtenerSegundosDesdeMesa());
            const presEt = (df.modoPresentacion === 'PACK' && Number(df.packUnidades) > 1)
                ? `Pack x ${df.packUnidades} (${df.packPesoUnitG}g c/u)`
                : (kilos >= 1 ? `Bolsa ${kilos}kg` : `Bolsa ${Math.round(kilos * 1000)}g`);

            const payload = {
                catalogo_id: ea.catalogoEditandoId || null,
                propuesta_id: ea.propuestaActivaId || null,
                sku_nodo: document.getElementById('cot-sku-nodo')?.value || df.skuNodo || '',
                nombre_publico: document.getElementById('cot-bunker-nomenclatura')?.value || df.bunkerNomenclatura || '',
                bunker_descripcion_generada: document.getElementById('cot-bunker-nomenclatura')?.value || df.bunkerNomenclatura || '',
                alias_vidriera_nodo: document.getElementById('cot-alias-vidriera-nodo')?.value?.trim() || null,
                compartido_mayorista: document.getElementById('cot-compartido-mayorista')?.value === 'true',
                categoria_familiar: document.getElementById('cot-categoria')?.value || df.categoria || 'FRUTOS SECOS',
                presentacion_etiqueta: presEt,
                modo_presentacion: df.modoPresentacion,
                pack_unidades: df.packUnidades,
                peso_unitario_gramos: df.packPesoUnitG,
                origen_tipo: esArtBunker ? 'ARTICULO_BUNKER' : undefined,
                ingrediente_origen_id: ingId,
                articulo_bunker_origen_codigo: artCod,
                costo_insumo_kg: Number(df.costoKg || 0),
                kilos_unidad: kilos,
                insumo_envase_id: df.insumoEnvaseId ? Number(df.insumoEnvaseId) : null,
                costo_envase_unitario: envCosto,
                segundos_fraccionamiento: segs,
                tarifa_colaborador_id: df.tarifaId ? Number(df.tarifaId) : null,
                valor_hora_aplicado: valorHora,
                margen_lamda_pct: Number(df.margenLamda ?? 25),
                iva_pct: Number(df.ivaPct ?? 21),
                iibb_pct: Number(df.iibbPct ?? 4),
                margen_sugerido_gestor_pct: Number(df.margenGestor ?? 28),
                notas_tecnicas: document.getElementById('cot-notas-tecnicas')?.value || '',
                nodos_habilitados_ids: Array.from(ea.nodosHabilitadosIds),
                nodos_publicados_ids: Array.from(ea.nodosPublicadosIds)
            };

            if (esModoCasoBAnatomia(ea.anatomiaActualMesa)) {
                const sb = ea.casoBSeleccion;
                if (!sb.articulo_principal_id || !sb.rubro) throw new Error('Caso B: completá Sustantivo Ancla y Rubro Oficial.');
                payload.familia_bunker_id = sb.familia_id;
                payload.familia_id = sb.familia_id;
                payload.incluir_familia = Boolean(sb.incluir_familia);
                payload.modo_display_familia = sb.modo_display_familia || 'ABREVIADO';
                payload.articulo_principal_id = sb.articulo_principal_id;
                payload.silencioso_principal = Boolean(sb.silencioso_principal);
                payload.modo_display_principal = sb.modo_display_principal || 'COMPLETO';
                payload.posiciones_seleccionadas = construirPosicionesSeleccionadasCasoB();
                payload.posiciones = sb.posiciones || {};
                payload.rubro_bunker = sb.rubro;
                payload.rubro = sb.rubro;
                payload.sub_rubro_bunker = sb.sub_rubro || '';
                payload.sub_rubro = sb.sub_rubro || '';
            }

            const resp = await fetch('/api/produccion/nodos/cotizar-aprobar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (!resp.ok || !data?.ok) throw new Error(data?.error || 'Error aprobando artículo');
            if (window.Swal) {
                await Swal.fire({
                    icon: 'success',
                    title: '✅ Artículo Sincronizado con Búnker y Nodos',
                    text: `[${data.articulo.sku_nodo}] ${data.articulo.nomenclatura_bunker || data.articulo.nombre_publico} — Base Nodo: ${fmtMoneda(data.calculo.precio_base_nodo_final)}`,
                    background: '#151e2e',
                    color: '#f8fafc'
                });
            }
            limpiarMesaCotizacion();
            ESTADO_NODOS.subTabActiva = 'matriz';
            await cargarDatosNodosBarriales(true);
        } catch (err) {
            if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: err.message, background: '#151e2e', color: '#f8fafc' });
            else alert(err.message);
        }
    }

    // =========================================================================
    // VISTA 3 — ENTRADA B (BANDEJA DE SOLICITUDES DE NODOS)
    // =========================================================================
    function renderizarVistaEntradaB() {
        const fracc = (ESTADO_NODOS.propuestas || []).filter(p => ESTADO_NODOS.filtroSolicitudesTipo === 'TODAS' || ESTADO_NODOS.filtroSolicitudesTipo === 'FRACCIONES');
        const combos = (ESTADO_NODOS.propuestas_combos || []).filter(c => ESTADO_NODOS.filtroSolicitudesTipo === 'TODAS' || ESTADO_NODOS.filtroSolicitudesTipo === 'COMBOS');
        const nodosActivos = (ESTADO_NODOS.nodos || []).filter(n => n.activo !== false);

        return `
            <div class="card" style="padding:12px 14px; background:#151e2e; border:1px solid #2e3c51; border-radius:12px; margin-bottom:12px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                <select onchange="window.NodosPizarra.cambiarFiltroSolicitudes('filtroSolicitudesEstado', this.value)" style="padding:7px 10px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.79rem;">
                    <option value="PENDIENTE_COTIZACION" ${ESTADO_NODOS.filtroSolicitudesEstado === 'PENDIENTE_COTIZACION' ? 'selected' : ''}>⏳ Pendientes de Cotización</option>
                    <option value="TODAS" ${ESTADO_NODOS.filtroSolicitudesEstado === 'TODAS' ? 'selected' : ''}>📋 Todas (activas)</option>
                    <option value="APROBADA" ${ESTADO_NODOS.filtroSolicitudesEstado === 'APROBADA' ? 'selected' : ''}>✅ Aprobadas</option>
                    <option value="DESCARTADA" ${ESTADO_NODOS.filtroSolicitudesEstado === 'DESCARTADA' ? 'selected' : ''}>🗑️ Descartadas</option>
                </select>
                <select onchange="window.NodosPizarra.cambiarFiltroSolicitudes('filtroSolicitudesNodoId', Number(this.value))" style="padding:7px 10px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.79rem;">
                    <option value="0">Todos los Nodos</option>
                    ${nodosActivos.map(n => `<option value="${n.id}" ${Number(ESTADO_NODOS.filtroSolicitudesNodoId) === Number(n.id) ? 'selected' : ''}>${escaparHtml(n.nombre_marca)}</option>`).join('')}
                </select>
                <select onchange="window.NodosPizarra.cambiarFiltroSolicitudes('filtroSolicitudesTipo', this.value)" style="padding:7px 10px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.79rem;">
                    <option value="TODAS" ${ESTADO_NODOS.filtroSolicitudesTipo === 'TODAS' ? 'selected' : ''}>Fracciones + Combos</option>
                    <option value="FRACCIONES" ${ESTADO_NODOS.filtroSolicitudesTipo === 'FRACCIONES' ? 'selected' : ''}>Solo Fracciones / SKUs</option>
                    <option value="COMBOS" ${ESTADO_NODOS.filtroSolicitudesTipo === 'COMBOS' ? 'selected' : ''}>Solo Combos LDN 8</option>
                </select>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(340px, 1fr)); gap:10px;">
                ${fracc.map(p => {
                    const pend = p.estado === 'PENDIENTE_COTIZACION';
                    const esHab = p.tipo_solicitud === 'HABILITAR_SKU_EXISTENTE';
                    const pesoCardTxt = p.peso_sugerido_label || ((Number(p.kilos_sugeridos || 0) >= 1) ? `${Number(Number(p.kilos_sugeridos).toFixed(2))}kg` : `${Math.round(Number(p.kilos_sugeridos || 0) * 1000)}g`);
                    const tituloCard = p.ingrediente_label_oficial || p.nombre_sugerido;
                    return `
                        <div class="card" style="padding:12px 14px; background:#151e2e; border:1px solid ${pend ? '#f59e0b' : '#334155'}; border-radius:11px;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                                <div>
                                    <span style="font-size:0.69rem; padding:2px 7px; border-radius:5px; background:rgba(56,189,248,0.16); color:#bae6fd; font-weight:800;">${escaparHtml(p.codigo_propuesta)}</span>
                                    <span style="font-size:0.69rem; padding:2px 7px; border-radius:5px; background:rgba(167,139,250,0.16); color:#ddd6fe; font-weight:700;">${esHab ? 'Habilitar SKU' : (p.tipo_solicitud || 'Nueva Fracción')}</span>
                                </div>
                                <span style="font-size:0.7rem; font-weight:800; color:${pend ? '#fbbf24' : '#34d399'};">${escaparHtml(p.estado)}</span>
                            </div>
                            <div style="font-weight:800; font-size:0.86rem; color:#f8fafc; margin-top:6px;">${escaparHtml(tituloCard)}</div>
                            <div style="font-size:0.73rem; color:#94a3b8; margin-top:3px;">
                                Nodo: <strong style="color:#e2e8f0;">${escaparHtml(p.nodo_solicitante_nombre || '')}</strong> · ${escaparHtml(pesoCardTxt)}
                                ${p.articulo_bunker_sugerido_codigo ? ` · SKU: <code>${escaparHtml(p.articulo_bunker_sugerido_codigo)}</code>` : ''}
                            </div>
                            ${p.alias_vidriera_sugerido ? `<div style="font-size:0.72rem; color:#38bdf8; margin-top:3px;">Alias vidriera: "${escaparHtml(p.alias_vidriera_sugerido)}"</div>` : ''}
                            ${p.comentario_gestor ? `<div style="font-size:0.72rem; color:#cbd5e1; margin-top:4px;">💬 ${escaparHtml(p.comentario_gestor)}</div>` : ''}
                            <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:10px;">
                                ${pend ? `<button type="button" onclick="window.NodosPizarra.descartarPropuestaAdmin(${p.id})" style="padding:5px 9px; border-radius:6px; border:1px solid rgba(248,113,113,0.45); background:rgba(248,113,113,0.12); color:#fca5a5; cursor:pointer; font-size:0.73rem;">Descartar</button>` : ''}
                                <button type="button" onclick="window.NodosPizarra.cargarPropuestaEnMesa(${p.id})"
                                    style="padding:5px 11px; border-radius:6px; border:none; background:#10b981; color:#052e16; font-weight:800; cursor:pointer; font-size:0.75rem;">
                                    🧮 Cotizar / Aprobar →
                                </button>
                            </div>
                        </div>
                    `;
                }).join('')}

                ${combos.map(pc => {
                    const pend = pc.estado === 'PENDIENTE_COTIZACION';
                    return `
                        <div class="card" style="padding:12px 14px; background:#151e2e; border:1px solid ${pend ? '#a855f7' : '#334155'}; border-radius:11px;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:0.69rem; padding:2px 7px; border-radius:5px; background:rgba(168,85,247,0.22); color:#e9d5ff; font-weight:800;">🎁 COMBO · ${escaparHtml(pc.codigo_propuesta)}</span>
                                <span style="font-size:0.7rem; font-weight:800; color:${pend ? '#fbbf24' : '#34d399'};">${escaparHtml(pc.estado)}</span>
                            </div>
                            <div style="font-weight:800; font-size:0.85rem; color:#f8fafc; margin-top:6px;">${escaparHtml(pc.alias_vidriera_sugerido || 'Combo Solicitado')}</div>
                            <div style="font-size:0.72rem; color:#cbd5e1; margin-top:4px;">
                                ${(pc.items || []).map(it => `• ${it.cantidad}x ${escaparHtml(it.etiqueta_oficial_lamda || it.componente_articulo_id)}`).join('<br>')}
                            </div>
                            <div style="font-size:0.71rem; color:#94a3b8; margin-top:4px;">Nodo: <strong>${escaparHtml(pc.nodo_solicitante_nombre || '')}</strong> · Peso: ${Number(pc.kilos_totales || 0).toFixed(2)}kg</div>
                            <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:10px;">
                                <button type="button" onclick="window.NodosPizarra.abrirComboSolicitudEnEntradaA(${pc.id})"
                                    style="padding:5px 11px; border-radius:6px; border:none; background:#a855f7; color:#fff; font-weight:800; cursor:pointer; font-size:0.75rem;">
                                    🎁 Cotizar Combo →
                                </button>
                            </div>
                        </div>
                    `;
                }).join('')}
                ${(fracc.length === 0 && combos.length === 0) ? `<div class="card" style="grid-column:1/-1; padding:24px; text-align:center; color:#94a3b8; background:#151e2e; border:1px solid #2e3c51; border-radius:12px;">Sin solicitudes para los filtros actuales.</div>` : ''}
            </div>
        `;
    }

    // =========================================================================
    // ACCIONES DE ENTRADA A / B & COMPATIBILIDAD ESTUDIO DE FOTO BASE
    // =========================================================================
    function limpiarMesaCotizacion() {
        const ea = ESTADO_NODOS.entradaA;
        ea.propuestaActivaId = null;
        ea.catalogoEditandoId = null;
        ea.anatomiaActualMesa = null;
        ea.paso1Completo = false;
        ea.casoBSeleccion = { familia_id: null, incluir_familia: true, modo_display_familia: 'ABREVIATURA', articulo_principal_id: null, silencioso_principal: false, modo_display_principal: 'COMPLETO', posiciones: {}, rubro: '', sub_rubro: '' };
        ea.formDraft = {
            ...ea.formDraft,
            origenVal: '', skuNodo: '', bunkerNomenclatura: '', categoria: 'FRUTOS SECOS', rubroSecundario: '',
            costoKg: 0, kilosUnidad: 0.25, modoPresentacion: 'BOLSA', aliasVidriera: '', notasTecnicas: '', tituloContexto: '', subtituloContexto: ''
        };
        ea.nodosHabilitadosIds = new Set(ESTADO_NODOS.nodos.filter(n => n.activo !== false).map(n => Number(n.id)));
        ea.nodosPublicadosIds = new Set();
        renderizarSubTabActiva();
    }

    function cambiarModoOrigenEntradaA(modo) {
        ESTADO_NODOS.entradaA.modoOrigen = modo;
        ESTADO_NODOS.entradaA.propuestaActivaId = null;
        ESTADO_NODOS.entradaA.catalogoEditandoId = null;
        ESTADO_NODOS.entradaA.anatomiaActualMesa = null;
        ESTADO_NODOS.entradaA.paso1Completo = false;
        renderizarSubTabActiva();
    }

    async function cargarPresentacionPlantaEnMesa(ingId, kilosUnidad, skuSug = '') {
        await cargarPresentacionesPlantaModular(false);
        const ea = ESTADO_NODOS.entradaA;
        const item = ESTADO_NODOS.fuentes.ingredientes_por_flujo.find(i => Number(i.id) === Number(ingId));
        const pres = ESTADO_NODOS.presentaciones_planta_disponibles.find(p => Number(p.ingrediente_id) === Number(ingId) && Math.abs(Number(p.kilos_unidad) - Number(kilosUnidad)) < 0.002);
        ea.modoOrigen = 'fraccion';
        ea.propuestaActivaId = null;
        ea.catalogoEditandoId = null;
        ea.flujoSeleccionadoMesa = Number(item?.flujo || pres?.flujo || 2);
        ea.formDraft.origenVal = String(ingId);
        ea.formDraft.costoKg = obtenerCostoVivoIngredientePizarra(ingId, item?.costo_kg || pres?.costo_insumo_kg || 0);
        ea.formDraft.kilosUnidad = Number(kilosUnidad || 0.25);
        ea.formDraft.skuNodo = pres?.articulo_id || skuSug || '';
        ea.formDraft.bunkerNomenclatura = pres?.descripcion_generada || '';
        ea.formDraft.compartidoMayorista = true;
        ea.formDraft.tituloContexto = `🏭 Presentación Existente de Planta (${ea.formDraft.skuNodo})`;
        ea.formDraft.subtituloContexto = pres ? `[${pres.articulo_id}] ${pres.descripcion_generada}` : '';
        await sincronizarAnatomiaMesaConBackend();
    }

    async function cargarPropuestaEnMesa(propuestaId) {
        await Promise.all([cargarSolicitudesModular(), cargarPresentacionesPlantaModular(false)]);
        const prop = ESTADO_NODOS.propuestas.find(p => Number(p.id) === Number(propuestaId));
        if (!prop) return;
        const itemIng = prop.ingrediente_sugerido_id
            ? ESTADO_NODOS.fuentes.ingredientes_por_flujo.find(i => Number(i.id) === Number(prop.ingrediente_sugerido_id))
            : null;
        const ea = ESTADO_NODOS.entradaA;
        ESTADO_NODOS.subTabActiva = 'entrada_a';
        ea.modoOrigen = 'fraccion';
        ea.propuestaActivaId = Number(prop.id);
        ea.catalogoEditandoId = prop.articulo_catalogo_id ? Number(prop.articulo_catalogo_id) : null;
        ea.flujoSeleccionadoMesa = Number(itemIng?.flujo || prop.flujo_sugerido || 2);
        ea.formDraft.origenVal = prop.ingrediente_sugerido_id ? String(prop.ingrediente_sugerido_id) : '';
        ea.formDraft.costoKg = obtenerCostoVivoIngredientePizarra(prop.ingrediente_sugerido_id, prop.ingrediente_sugerido_costo_kg || 0);
        ea.formDraft.kilosUnidad = Number(prop.kilos_sugeridos || 0.25);
        ea.formDraft.aliasVidriera = prop.alias_vidriera_sugerido || '';
        const pesoPropTxt = prop.peso_sugerido_label || (Number(prop.kilos_sugeridos || 0.25) >= 1 ? `${Number(Number(prop.kilos_sugeridos).toFixed(2))}kg` : `${Math.round(Number(prop.kilos_sugeridos || 0.25) * 1000)}g`);
        const labelPropSinPeso = prop.ingrediente_label_oficial || itemIng?.label_oficial || '';
        ea.formDraft.tituloContexto = `📥 Cotizando Solicitud ${prop.codigo_propuesta} (${prop.nodo_solicitante_nombre || 'Nodo'})`;
        ea.formDraft.subtituloContexto = labelPropSinPeso
            ? `${labelPropSinPeso} · ${pesoPropTxt}`
            : String(prop.nombre_sugerido || '');
        if (prop.nodo_solicitante_id) {
            ea.nodosHabilitadosIds.add(Number(prop.nodo_solicitante_id));
        }
        if (prop.insumo_envase_sugerido_id) ea.formDraft.insumoEnvaseId = String(prop.insumo_envase_sugerido_id);
        renderizarVistaNodosCompleta();
        await sincronizarAnatomiaMesaConBackend();
    }

    async function editarArticuloCatalogoEnMesa(catalogoId) {
        await cargarPresentacionesPlantaModular(false);
        const cat = ESTADO_NODOS.catalogo.find(c => Number(c.id) === Number(catalogoId));
        if (!cat) return;
        const ea = ESTADO_NODOS.entradaA;
        ESTADO_NODOS.subTabActiva = 'entrada_a';
        ea.modoOrigen = Number(cat.flujo_lamda) === 8 || cat.es_combo ? 'combo' : 'fraccion';
        ea.catalogoEditandoId = Number(cat.id);
        ea.propuestaActivaId = null;
        ea.flujoSeleccionadoMesa = Number(cat.flujo_lamda || 2);
        ea.formDraft.origenVal = cat.articulo_bunker_origen_codigo ? `ART:${cat.articulo_bunker_origen_codigo}` : String(cat.ingrediente_origen_id || '');
        ea.formDraft.skuNodo = cat.sku_nodo;
        ea.formDraft.bunkerNomenclatura = cat.nombre_oficial_lamda || cat.nombre_publico;
        ea.formDraft.categoria = cat.bunker_familia_nombre || cat.categoria_familiar || 'Frutos Secos';
        ea.formDraft.costoKg = Number(cat.costo_insumo_kg_vivo || cat.costo_insumo_kg || 0);
        ea.formDraft.kilosUnidad = Number(cat.kilos_unidad || 0.25);
        ea.formDraft.insumoEnvaseId = cat.insumo_envase_id ? String(cat.insumo_envase_id) : ea.formDraft.insumoEnvaseId;
        ea.formDraft.segundosMo = Number(cat.segundos_fraccionamiento || 300);
        ea.formDraft.margenLamda = Number(cat.margen_lamda_pct ?? 25);
        ea.formDraft.margenGestor = Number(cat.margen_sugerido_gestor_pct ?? 28);
        ea.formDraft.compartidoMayorista = Boolean(cat.compartido_mayorista);
        ea.formDraft.tituloContexto = `✏️ Editando Artículo [${cat.sku_nodo}]`;
        ea.formDraft.subtituloContexto = cat.nombre_oficial_lamda || cat.nombre_publico;
        ea.paso1Completo = true;
        renderizarVistaNodosCompleta();
        if (ea.modoOrigen === 'combo' && window.CombosPizarra?.editarComboExistente) {
            setTimeout(() => window.CombosPizarra.editarComboExistente(cat.sku_nodo), 150);
        }
    }

    async function descartarPropuestaAdmin(propuestaId) {
        const motivo = window.prompt('Motivo opcional del descarte para el Gestor:') || '';
        const resp = await fetch(`/api/produccion/nodos/propuestas/${Number(propuestaId)}/descartar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo })
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data?.ok) return alert(data?.error || 'Error descartando solicitud');
        await cargarSolicitudesModular();
        renderizarSubTabActiva();
    }

    async function abrirComboSolicitudEnEntradaA(propuestaComboId) {
        ESTADO_NODOS.subTabActiva = 'entrada_a';
        ESTADO_NODOS.entradaA.modoOrigen = 'combo';
        renderizarVistaNodosCompleta();
        setTimeout(() => {
            if (window.CombosPizarra && typeof window.CombosPizarra.cargarPropuestaComboEnMesa === 'function') {
                window.CombosPizarra.cargarPropuestaComboEnMesa(Number(propuestaComboId));
            }
        }, 180);
    }

    async function sincronizarCascadaSeisFlujos() {
        const costosSimulados = {};
        if (window.pizarraSimulacionMaster?.ingredientes) {
            window.pizarraSimulacionMaster.ingredientes.forEach(i => { if (Number(i.costo_patron) > 0) costosSimulados[Number(i.id)] = Number(i.costo_patron); });
        }
        const resp = await fetch('/api/produccion/nodos/recalcular-cascada', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ costos_simulados: costosSimulados }) });
        const data = await resp.json();
        if (!resp.ok || !data?.ok) return alert(data?.error || 'Error recalculando cascada');
        await cargarDatosNodosBarriales(true);
    }

    async function ponerACeroDatosPruebasNodos() {
        if (!ESTADO_NODOS.modoLaboratorio) return;
        if (!confirm('¿Ejecutar Puesta a Cero integral de Nodos en etiquetas_pruebas?')) return;
        const resp = await fetch('/api/produccion/nodos/reset-pruebas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conservar_articulos_base: true }) });
        const data = await resp.json();
        if (data.ok) await cargarDatosNodosBarriales(true);
    }

    // =========================================================================
    // ESTUDIO DE FOTO BASE LAMDA (lamda_imagenes_base — PRESERVADO INTACTO)
    // =========================================================================
    async function abrirEstudioFotoBase(ctx) {
        if (typeof ctx.imagen_actual === 'string') {
            try { ctx.imagen_actual = JSON.parse(ctx.imagen_actual); } catch (_) { ctx.imagen_actual = null; }
        }
        let modal = document.getElementById('pizarra-estudio-img-base-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'pizarra-estudio-img-base-modal';
            modal.style.cssText = 'position:fixed; inset:0; z-index:9500; background:rgba(2,6,23,0.78); display:flex; align-items:center; justify-content:center; padding:16px;';
            document.body.appendChild(modal);
        }
        const subLabels = Array.isArray(ctx.subrama_labels) ? ctx.subrama_labels.filter(Boolean) : [];
        const state = {
            destino: subLabels.length > 0 ? 'subrama' : (ctx.familia_id && ctx.articulo_principal ? 'ancla' : 'variedad'),
            modo: 'biblioteca', preset: 'cuenco_neutro', modoPrompt: 'preset', promptText: '', promptCustom: false,
            incluirReglaSinEnvases: true, incluirFidelidadReceta: true, fidelidad: null, promptsGuardados: [],
            promptGuardadoId: null, calidad: 'estandar', preview: null, bibItems: [], generating: false
        };
        const buildTargetPayload = () => {
            if (state.destino === 'subrama' && subLabels.length > 0) return { tipo_ancla: 'SUBRAMA_JERARQUIA', familia_id: ctx.familia_id, familia_nombre: ctx.familia_nombre, articulo_principal: ctx.articulo_principal, ruta_subrama: subLabels.join('>'), ruta_subrama_labels: subLabels, titulo_referencia: `${ctx.articulo_principal} › ${subLabels.join(' › ')}` };
            if (state.destino === 'ancla') return { tipo_ancla: 'ANCLA_PRINCIPAL', familia_id: ctx.familia_id, familia_nombre: ctx.familia_nombre, articulo_principal: ctx.articulo_principal, titulo_referencia: `${ctx.familia_nombre} › ${ctx.articulo_principal}` };
            return { tipo_ancla: ctx.tipo_ancla, familia_id: ctx.familia_id, familia_nombre: ctx.familia_nombre, articulo_principal: ctx.articulo_principal, ingrediente_id: ctx.ingrediente_id || null, clave_producto_base: ctx.clave_producto_base, articulo_sku: ctx.sku_combo || null, titulo_referencia: ctx.nombre_base_oficial };
        };
        const buildPrompt = () => {
            if (state.preset === 'libre') return '';
            const subj = state.destino === 'subrama' ? `${ctx.articulo_principal} › ${subLabels.join(' › ')}` : (state.destino === 'ancla' ? ctx.articulo_principal : ctx.nombre_base_oficial);
            const mapP = { cuenco_neutro: 'Fotografía gastronómica profesional a 45° en cuenco cerámico claro.', granel_cenital: 'Fotografía cenital 90° a granel.', macro_editorial: 'Fotografía macro editorial de ultra detalle.', mesa_cinematografica: 'Producto sobre mesa de madera cálida.', producto_elaborado: 'Producto elaborado entero y corte.', fondo_blanco: 'Catálogo minimalista fondo blanco.' };
            return `${mapP[state.preset] || mapP.cuenco_neutro} Producto: "${subj}" (${ctx.familia_nombre}). ${state.incluirReglaSinEnvases ? 'Sin envases ni marcas.' : ''}`.trim();
        };
        state.promptText = buildPrompt();
        const loadBib = async () => {
            const qs = new URLSearchParams();
            if (ctx.familia_id) qs.set('familia_id', String(ctx.familia_id));
            const [rBib, rPr] = await Promise.all([
                fetch(`/api/produccion/nodos/admin/imagenes-base/biblioteca?${qs.toString()}`),
                fetch('/api/produccion/nodos/admin/imagenes-base/prompts').catch(() => null)
            ]);
            const d = await rBib.json();
            state.bibItems = d.ok ? (d.items || []) : [];
            if (rPr && rPr.ok) { const dp = await rPr.json().catch(() => null); if (dp?.ok) state.promptsGuardados = dp.items || []; }
            render();
        };
        const render = () => {
            modal.style.display = 'flex';
            modal.innerHTML = `
                <div style="width:100%; max-width:740px; max-height:90vh; overflow-y:auto; background:#1e293b; border:1px solid #334155; border-radius:14px; padding:16px; color:#f8fafc; display:flex; flex-direction:column; gap:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div><strong>🖼️ Estudio de Foto Base LAMDA</strong><div style="font-size:0.75rem; color:#94a3b8;">${escaparHtml(ctx.familia_nombre)} › ${escaparHtml(ctx.nombre_base_oficial)}</div></div>
                        <button type="button" id="piz-ib-close" style="background:#0f172a; border:1px solid #334155; color:#cbd5e1; border-radius:7px; padding:5px 10px; cursor:pointer;">✕</button>
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <button type="button" id="piz-tab-bib" style="padding:6px 11px; border-radius:8px; border:1px solid #38bdf8; background:${state.modo === 'biblioteca' ? 'rgba(56,189,248,0.2)' : '#0f172a'}; color:#bae6fd; cursor:pointer;">📚 Biblioteca</button>
                        <button type="button" id="piz-tab-ia" style="padding:6px 11px; border-radius:8px; border:1px solid #c084fc; background:${state.modo === 'ia' ? 'rgba(142,71,133,0.35)' : '#0f172a'}; color:#f5d0fe; cursor:pointer;">✨ Generar con IA</button>
                        <button type="button" id="piz-btn-pc" style="padding:6px 11px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#cbd5e1; cursor:pointer;">📤 Subir desde PC</button>
                    </div>
                    ${state.modo === 'biblioteca' ? `
                        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(130px, 1fr)); gap:8px;">
                            ${state.bibItems.length === 0 ? `<div style="grid-column:1/-1; padding:18px; text-align:center; color:#94a3b8; font-size:0.78rem;">Biblioteca vacía para esta familia.</div>` : state.bibItems.map(it => `
                                <div style="border:1px solid #334155; border-radius:9px; padding:6px; background:#0f172a;">
                                    <img src="${escaparHtml(it.url)}" style="width:100%; aspect-ratio:1/1; object-fit:cover; border-radius:6px;" />
                                    <button type="button" data-piz-usar="${it.id}" style="width:100%; margin-top:4px; padding:4px; border-radius:6px; border:1px solid #38bdf8; background:rgba(56,189,248,0.16); color:#bae6fd; cursor:pointer; font-size:0.72rem;">✓ Usar</button>
                                </div>
                            `).join('')}
                        </div>
                    ` : `
                        <textarea id="piz-ia-prompt" rows="3" style="width:100%; background:#0f172a; color:#f8fafc; border:1px solid #334155; border-radius:7px; padding:7px;">${escaparHtml(state.promptText)}</textarea>
                        <button type="button" id="piz-ia-gen" style="padding:7px 12px; border-radius:8px; border:1px solid #c084fc; background:rgba(142,71,133,0.45); color:#f5d0fe; cursor:pointer;">${state.generating ? '⏳ Generando...' : '✨ Generar'}</button>
                        ${state.preview ? `<div><img src="${state.preview.preview_data_url}" style="width:120px; border-radius:8px;" /><button type="button" id="piz-ia-confirm" style="margin-left:10px; padding:7px 12px; border-radius:8px; border:1px solid #10b981; background:rgba(16,185,129,0.22); color:#a7f3d0; cursor:pointer;">✅ Guardar</button></div>` : ''}
                    `}
                </div>
            `;
            modal.querySelector('#piz-ib-close').onclick = () => { modal.style.display = 'none'; };
            modal.querySelector('#piz-tab-bib').onclick = () => { state.modo = 'biblioteca'; loadBib(); };
            modal.querySelector('#piz-tab-ia').onclick = () => { state.modo = 'ia'; render(); };
            modal.querySelector('#piz-btn-pc').onclick = () => {
                const pT = buildTargetPayload();
                window.NodosPizarra.subirImagenBaseLamda(pT.clave_producto_base || '', pT.tipo_ancla, pT.ingrediente_id || 0, pT.articulo_sku || '', pT.titulo_referencia, pT.familia_id, pT.familia_nombre, pT.articulo_principal, () => { modal.style.display = 'none'; }, pT.ruta_subrama || '');
            };
            modal.querySelectorAll('[data-piz-usar]').forEach(b => {
                b.onclick = async () => {
                    const r = await fetch('/api/produccion/nodos/admin/imagenes-base/asignar-biblioteca', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ biblioteca_imagen_id: Number(b.getAttribute('data-piz-usar')), ...buildTargetPayload() }) });
                    const d = await r.json();
                    if (!r.ok || !d.ok) return alert(d.error || 'Error');
                    modal.style.display = 'none';
                    await cargarCatalogoModular();
                    renderizarSubTabActiva();
                };
            });
            const genB = modal.querySelector('#piz-ia-gen');
            if (genB) genB.onclick = async () => {
                state.generating = true;
                state.promptText = modal.querySelector('#piz-ia-prompt')?.value || state.promptText;
                render();
                try {
                    const pT = buildTargetPayload();
                    const r = await fetch('/api/produccion/nodos/admin/imagenes-base/generar-ia', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ familia_id: ctx.familia_id || null, familia_nombre: ctx.familia_nombre, articulo_principal: ctx.articulo_principal, nombre_variante: state.destino === 'variedad' ? ctx.nombre_base_oficial : '', ingrediente_id: pT.ingrediente_id || null, articulo_sku: pT.articulo_sku || null, preset_estilo: state.preset, prompt_personalizado: state.promptText })
                    });
                    const d = await r.json();
                    if (!r.ok || !d.ok) throw new Error(d.error || 'Error IA');
                    state.preview = d;
                } catch (e) { alert(e.message); }
                state.generating = false;
                render();
            };
            const confB = modal.querySelector('#piz-ia-confirm');
            if (confB) confB.onclick = async () => {
                const r = await fetch('/api/produccion/nodos/admin/imagenes-base/confirmar-ia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preview_token: state.preview.preview_token, ...buildTargetPayload(), aplicar_al_ancla: true }) });
                const d = await r.json();
                if (!r.ok || !d.ok) return alert(d.error || 'Error');
                modal.style.display = 'none';
                await cargarCatalogoModular();
                renderizarSubTabActiva();
            };
        };
        await loadBib();
    }

    // =========================================================================
    // API PÚBLICA WINDOW.NODOSPIZARRA
    // =========================================================================
    window.NodosPizarra = {
        inicializar: cargarDatosNodosBarriales,
        refrescarTodo: refrescarModuloNodosConFeedback,
        ponerACeroPruebas: ponerACeroDatosPruebasNodos,
        cambiarSubTab: cambiarSubTabNodos,
        cambiarPerspectivaMatriz: (p) => {
            ESTADO_NODOS.perspectivaMatriz = p;
            ESTADO_NODOS.catalogoPage = 1;
            cargarCatalogoModular().then(() => renderizarSubTabActiva());
        },
        onInputBusquedaMatriz: (val) => {
            ESTADO_NODOS.filtroBusqueda = val;
            ESTADO_NODOS.catalogoPage = 1;
            clearTimeout(_timerBusquedaMatriz);
            _timerBusquedaMatriz = setTimeout(() => cargarCatalogoModular().then(() => renderizarSubTabActiva()), 240);
        },
        cambiarFiltroMatriz: (campo, val) => {
            ESTADO_NODOS[campo] = val;
            ESTADO_NODOS.catalogoPage = 1;
            cargarCatalogoModular().then(() => renderizarSubTabActiva());
        },
        irPaginaMatriz: (p) => {
            ESTADO_NODOS.catalogoPage = Math.max(1, Number(p) || 1);
            cargarCatalogoModular().then(() => renderizarSubTabActiva());
        },
        abrirDrawerCatalogo: (cid) => {
            ESTADO_NODOS.drawerCatalogoId = Number(cid);
            ESTADO_NODOS.drawerSeleccionados = new Set();
            ESTADO_NODOS.drawerCargando = true;
            renderizarDrawerNodosSiAbierto();
            cargarOfertasDrawerCatalogo(cid).catch(err => {
                ESTADO_NODOS.drawerCargando = false;
                console.error('Error abriendo Drawer Nodos:', err);
                renderizarDrawerNodosSiAbierto();
            });
        },
        cerrarDrawerCatalogo: () => {
            ESTADO_NODOS.drawerCatalogoId = null;
            renderizarDrawerNodosSiAbierto();
        },
        filtrarDrawer: (campo, val) => {
            ESTADO_NODOS[campo] = val;
            renderizarDrawerNodosSiAbierto();
        },
        toggleSelNodoDrawer: (nid, chk) => {
            if (chk) ESTADO_NODOS.drawerSeleccionados.add(Number(nid));
            else ESTADO_NODOS.drawerSeleccionados.delete(Number(nid));
        },
        ejecutarAccionMasivaDrawer,
        patchCatalogoCelda,
        patchOfertaCelda,

        cambiarModoOrigenEntradaA,
        filtrarPlantaEntradaA: (v) => { ESTADO_NODOS.entradaA.busquedaPlanta = v; renderizarSubTabActiva(); },
        cambiarFiltroPesoPlantaEntradaA: (v) => { ESTADO_NODOS.entradaA.filtroPesoPlanta = v; renderizarSubTabActiva(); },
        seleccionarFlujoMesa: (f) => {
            ESTADO_NODOS.entradaA.flujoSeleccionadoMesa = Number(f);
            ESTADO_NODOS.entradaA.formDraft.origenVal = '';
            ESTADO_NODOS.entradaA.anatomiaActualMesa = null;
            ESTADO_NODOS.entradaA.paso1Completo = false;
            renderizarSubTabActiva();
        },
        alCambiarOrigenSelect: () => {
            const sel = document.getElementById('cot-origen-select');
            const df = ESTADO_NODOS.entradaA.formDraft;
            df.origenVal = sel ? sel.value : '';
            ESTADO_NODOS.entradaA.anatomiaActualMesa = null;
            const opt = sel?.selectedOptions?.[0];
            if (opt) {
                df.costoKg = Number(opt.getAttribute('data-costo') || 0);
                df.categoria = opt.getAttribute('data-categoria') || df.categoria;
                if (String(df.origenVal).startsWith('ART:')) {
                    const skuB = String(df.origenVal).replace('ART:', '');
                    df.skuNodo = skuB;
                    df.bunkerNomenclatura = opt.getAttribute('data-nombre') || skuB;
                    validarPaso1EntradaACompleto();
                    renderizarSubTabActiva();
                    return;
                }
            }
            sincronizarAnatomiaMesaConBackend();
        },
        alCambiarKilosUnidadMesa: () => {
            const k = Number(document.getElementById('cot-kilos-unidad')?.value || 0.25);
            ESTADO_NODOS.entradaA.formDraft.kilosUnidad = Math.max(0.01, k);
            sincronizarAnatomiaMesaConBackend();
        },
        fijarGramajeRapido: (kg) => {
            ESTADO_NODOS.entradaA.formDraft.kilosUnidad = Number(kg);
            sincronizarAnatomiaMesaConBackend();
        },
        alCambiarPresentacionMesa: (esToggle) => {
            const df = ESTADO_NODOS.entradaA.formDraft;
            df.modoPresentacion = document.getElementById('cot-modo-presentacion')?.value || 'BOLSA';
            if (df.modoPresentacion === 'PACK') {
                df.packUnidades = Math.max(2, Number(document.getElementById('cot-pack-unidades')?.value || 3));
                df.packPesoUnitG = Math.max(5, Number(document.getElementById('cot-pack-peso-unit-g')?.value || 50));
                df.kilosUnidad = Number(((df.packUnidades * df.packPesoUnitG) / 1000).toFixed(3));
            }
            sincronizarAnatomiaMesaConBackend({ desdePresentacion: !esToggle });
        },
        alCambiarSelectorDiccionarioCasoB: async (campo, val, catId = null) => {
            const sb = ESTADO_NODOS.entradaA.casoBSeleccion;
            if (campo === 'familia_id') { sb.familia_id = Number(val) || 1; sb.posiciones = {}; await cargarDiccionarioBunkerCasoB(sb.familia_id, sb.articulo_principal_id); }
            else if (campo === 'articulo_principal_id') { sb.articulo_principal_id = val ? Number(val) : null; sb.posiciones = {}; await cargarDiccionarioBunkerCasoB(sb.familia_id, sb.articulo_principal_id); }
            else if (campo === 'incluir_familia') sb.incluir_familia = Boolean(val);
            else if (campo === 'silencioso_principal') sb.silencioso_principal = Boolean(val);
            else if (campo === 'rubro') { sb.rubro = String(val || ''); sb.sub_rubro = ''; }
            else if (campo === 'sub_rubro') sb.sub_rubro = String(val || '');
            else if (campo.startsWith('pos_')) {
                if (val) sb.posiciones[campo] = { categoria_id: Number(catId || 0), termino_id: Number(val), modo_display: 'COMPLETO' };
                else delete sb.posiciones[campo];
            }
            await sincronizarAnatomiaMesaConBackend({ desdeCasoB: true });
        },
        alCambiarUnidadTiempoMesa: (u) => {
            obtenerSegundosDesdeMesa();
            ESTADO_NODOS.entradaA.unidadTiempoMesa = u === 'min' ? 'min' : 'seg';
            renderizarSubTabActiva();
        },
        recalcularEnVivo: recalcularMesaCotizacionEnVivo,
        toggleDestinoEntradaA: (nid, tipo, chk) => {
            const ea = ESTADO_NODOS.entradaA;
            if (tipo === 'hab') { if (chk) ea.nodosHabilitadosIds.add(nid); else { ea.nodosHabilitadosIds.delete(nid); ea.nodosPublicadosIds.delete(nid); } }
            else { if (chk) { ea.nodosHabilitadosIds.add(nid); ea.nodosPublicadosIds.add(nid); } else ea.nodosPublicadosIds.delete(nid); }
        },
        seleccionarDestinoEntradaA: (modo) => {
            const ea = ESTADO_NODOS.entradaA;
            ea.nodosHabilitadosIds.clear();
            ESTADO_NODOS.nodos.filter(n => n.activo !== false).forEach(n => {
                if (modo === 'TODOS' || n.perfil_operativo === modo) ea.nodosHabilitadosIds.add(Number(n.id));
            });
            renderizarSubTabActiva();
        },
        cargarPresentacionPlantaEnMesa,
        cargarPropuestaEnMesa,
        editarArticuloCatalogoEnMesa,
        limpiarMesaCotizacion,
        descartarPropuestaAdmin,
        abrirComboSolicitudEnEntradaA,
        cambiarFiltroSolicitudes: (campo, val) => {
            ESTADO_NODOS[campo] = val;
            cargarSolicitudesModular().then(() => renderizarSubTabActiva());
        },
        aprobarYPublicarEnPadronNodos,
        sincronizarCascadaSeisFlujos,
        abrirEstudioFotoBase,
        subirImagenBaseLamda: (claveBase, tipoAncla, ingId, skuCombo, tituloRef, famId = 0, famNom = '', artPrincipal = '', onDone = null, rutaSubrama = '') => {
            let inp = document.getElementById('pizarra-input-img-base-file');
            if (!inp) { inp = document.createElement('input'); inp.type = 'file'; inp.id = 'pizarra-input-img-base-file'; inp.accept = 'image/*'; inp.style.display = 'none'; document.body.appendChild(inp); }
            inp.value = '';
            inp.onchange = async () => {
                const file = inp.files?.[0];
                if (!file) return;
                const fd = new FormData();
                fd.append('foto', file);
                fd.append('tipo_ancla', tipoAncla);
                if (Number(famId) > 0) fd.append('familia_id', String(famId));
                if (famNom) fd.append('familia_nombre', famNom);
                if (artPrincipal) fd.append('articulo_principal', artPrincipal);
                if (rutaSubrama) fd.append('ruta_subrama', rutaSubrama);
                if (Number(ingId) > 0) fd.append('ingrediente_id', String(ingId));
                if (claveBase) fd.append('clave_producto_base', claveBase);
                if (skuCombo) fd.append('articulo_sku', skuCombo);
                if (tituloRef) fd.append('titulo_referencia', tituloRef);
                const resp = await fetch('/api/produccion/nodos/admin/imagenes-base', { method: 'POST', body: fd });
                const data = await resp.json();
                if (!resp.ok || !data.ok) return alert(data.error || 'Error subiendo imagen');
                if (typeof onDone === 'function') onDone();
                await cargarCatalogoModular();
                renderizarSubTabActiva();
            };
            inp.click();
        }
    };

    window.recargarModuloNodosBarriales = () => cargarDatosNodosBarriales(true);

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            cargarResumenModular()
                .then(() => {
                    const params = new URLSearchParams(window.location.search);
                    const sub = (params.get('subtab') || '').toLowerCase();
                    if (sub === 'solicitudes' || sub === 'propuestas') ESTADO_NODOS.subTabActiva = 'entrada_b';
                    else if (sub === 'cotizador' || sub === 'combos') ESTADO_NODOS.subTabActiva = 'entrada_a';
                    if (params.get('tab') === 'nodos' && typeof window.cambiarContextoLDN === 'function') {
                        window.cambiarContextoLDN(7);
                    }
                })
                .catch(() => {});
        }, 500);
    });
})();
