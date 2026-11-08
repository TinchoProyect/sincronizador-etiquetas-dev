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
        subTabActiva: 'cotizador', // 'cotizador' | 'catalogo' | 'abm_nodos'
        nodos: [],
        catalogo: [],
        propuestas: [],
        ofertas_gestor: [],
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
        busquedaFuentes: '',
        flujoSeleccionadoMesa: 2,
        propuestaActivaId: null,
        catalogoEditandoId: null,
        nodoEditandoId: null,
        ultimoPreviewEtiqueta: null
    };

    const FLUJO_META = {
        1: { corto: 'Flujo 1 · Directo', nombre: 'Flujo 1: Bulto Cerrado / Unidad Directa', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.14)' },
        2: { corto: 'Flujo 2 · Puro Fraccionado', nombre: 'Flujo 2: Fraccionado Puro (100% Ingrediente Único)', color: '#34d399', bg: 'rgba(52, 211, 153, 0.14)' },
        3: { corto: 'Flujo 3 · Mixes', nombre: 'Flujo 3: Mezcla Interna (Carro Mix) a Fracción', color: '#a78bfa', bg: 'rgba(167, 139, 250, 0.14)' },
        4: { corto: 'Flujo 4 · Tostaderos', nombre: 'Flujo 4: Unidad Productiva Externa (Tostadero)', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.14)' },
        5: { corto: 'Flujo 5 · Barritas', nombre: 'Flujo 5: Pre-Mezcla + Elaboración Barritas', color: '#f87171', bg: 'rgba(248, 113, 113, 0.14)' },
        6: { corto: 'Flujo 6 · Granolas', nombre: 'Flujo 6: Doble Mezcla + Horneado + Agregado Seco', color: '#fb923c', bg: 'rgba(251, 146, 60, 0.14)' }
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
                throw new Error(data.error || 'No se pudo inicializar el módulo de Nodos Barriales');
            }

            ESTADO_NODOS.nodos = data.nodos || [];
            ESTADO_NODOS.catalogo = data.catalogo || [];
            ESTADO_NODOS.propuestas = data.propuestas || [];
            ESTADO_NODOS.ofertas_gestor = data.ofertas_gestor || [];
            ESTADO_NODOS.fuentes = data.fuentes || ESTADO_NODOS.fuentes;
            ESTADO_NODOS.inicializado = true;

            actualizarBadgePropuestasPendientes();
            renderizarVistaNodosCompleta();
        } catch (err) {
            console.error('❌ [NodosCotizador] Error cargando datos:', err);
            const container = document.getElementById('nodos-cotizador-container');
            if (container) {
                container.innerHTML = `
                    <div style="padding: 28px; background: #1e293b; border: 1px solid #ef4444; border-radius: 12px; color: #fecaca;">
                        <h3 style="margin-top:0;">⚠️ Error al conectar con el módulo de Nodos Barriales</h3>
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
        const badge = document.getElementById('ldn-badge-7');
        if (!badge) return;
        const pendientes = (ESTADO_NODOS.propuestas || []).filter(p => p.estado === 'PENDIENTE_COTIZACION').length;
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
        if (subTab === 'cotizador') {
            recalcularMesaCotizacionEnVivo();
        } else if (subTab === 'abm_nodos') {
            const nodoInicial = ESTADO_NODOS.nodoEditandoId
                ? ESTADO_NODOS.nodos.find(n => Number(n.id) === Number(ESTADO_NODOS.nodoEditandoId))
                : ESTADO_NODOS.nodos[0];
            if (nodoInicial) {
                cargarNodoEnFormularioAbm(nodoInicial.id);
            }
        }
    }

    function renderizarVistaNodosCompleta() {
        const container = document.getElementById('nodos-cotizador-container');
        if (!container) return;

        const pendientesCount = ESTADO_NODOS.propuestas.filter(p => p.estado === 'PENDIENTE_COTIZACION').length;
        const catalogoCount = ESTADO_NODOS.catalogo.length;
        const nodosActivosCount = ESTADO_NODOS.nodos.filter(n => n.activo).length;
        const nodoPrincipalSlug = ESTADO_NODOS.nodos[0]?.slug || 'almacen-verde-city-bell';

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:14px; padding: 4px 2px 30px 2px;">
                <!-- CABECERA EJECUTIVA Y SUB-NAVEGACIÓN DE NODOS BARRIALES -->
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; background: linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.92)); border: 1px solid rgba(52,211,153,0.3); border-radius: 12px; padding: 12px 18px;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div style="width:42px; height:42px; border-radius:10px; background:rgba(16,185,129,0.18); border:1px solid rgba(16,185,129,0.4); display:flex; align-items:center; justify-content:center; font-size:1.35rem;">🏘️</div>
                        <div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <h2 style="margin:0; font-size:1.08rem; color:#f8fafc; font-weight:700;">Nodos Barriales (Marca Blanca)</h2>
                                <span style="background:rgba(16,185,129,0.18); color:#34d399; border:1px solid rgba(16,185,129,0.35); font-size:0.72rem; padding:2px 8px; border-radius:999px; font-weight:700;">Catálogo Exclusivo Familiar</span>
                            </div>
                            <div style="font-size:0.78rem; color:#94a3b8; margin-top:2px;">
                                Cotización de fracciones familiares, márgenes por gestor, cuentas corrientes y etiquetas térmicas con marca del Nodo.
                            </div>
                        </div>
                    </div>

                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <button onclick="window.NodosPizarra.cambiarSubTab('cotizador')"
                            style="padding:8px 14px; border-radius:8px; font-weight:700; font-size:0.82rem; cursor:pointer; border:1px solid ${ESTADO_NODOS.subTabActiva === 'cotizador' ? '#10b981' : '#334155'}; background:${ESTADO_NODOS.subTabActiva === 'cotizador' ? 'rgba(16,185,129,0.22)' : '#0f172a'}; color:${ESTADO_NODOS.subTabActiva === 'cotizador' ? '#6ee7b7' : '#cbd5e1'}; display:flex; align-items:center; gap:6px;">
                            🧮 Cotizador de Fracciones
                            ${pendientesCount > 0 ? `<span style="background:#f59e0b; color:#0f172a; padding:1px 7px; border-radius:999px; font-size:0.72rem; font-weight:800;">${pendientesCount} pend.</span>` : ''}
                        </button>

                        <button onclick="window.NodosPizarra.cambiarSubTab('catalogo')"
                            style="padding:8px 14px; border-radius:8px; font-weight:700; font-size:0.82rem; cursor:pointer; border:1px solid ${ESTADO_NODOS.subTabActiva === 'catalogo' ? '#38bdf8' : '#334155'}; background:${ESTADO_NODOS.subTabActiva === 'catalogo' ? 'rgba(56,189,248,0.2)' : '#0f172a'}; color:${ESTADO_NODOS.subTabActiva === 'catalogo' ? '#bae6fd' : '#cbd5e1'}; display:flex; align-items:center; gap:6px;">
                            📦 Catálogo y Márgenes por Nodo
                            <span style="background:rgba(255,255,255,0.12); color:#e2e8f0; padding:1px 7px; border-radius:999px; font-size:0.72rem;">${catalogoCount} productos</span>
                        </button>

                        <button onclick="window.NodosPizarra.cambiarSubTab('abm_nodos')"
                            style="padding:8px 14px; border-radius:8px; font-weight:700; font-size:0.82rem; cursor:pointer; border:1px solid ${ESTADO_NODOS.subTabActiva === 'abm_nodos' ? '#a78bfa' : '#334155'}; background:${ESTADO_NODOS.subTabActiva === 'abm_nodos' ? 'rgba(167,139,250,0.22)' : '#0f172a'}; color:${ESTADO_NODOS.subTabActiva === 'abm_nodos' ? '#ddd6fe' : '#cbd5e1'}; display:flex; align-items:center; gap:6px;">
                            🏷️ Nodos y Etiqueta Térmica
                            <span style="background:rgba(255,255,255,0.12); color:#e2e8f0; padding:1px 7px; border-radius:999px; font-size:0.72rem;">${nodosActivosCount} activos</span>
                        </button>

                        <a href="/gestor/${escaparHtml(nodoPrincipalSlug)}" target="_blank"
                            style="text-decoration:none; padding:8px 12px; border-radius:8px; font-weight:700; font-size:0.8rem; border:1px solid rgba(56,189,248,0.45); background:rgba(56,189,248,0.14); color:#bae6fd; display:inline-flex; align-items:center; gap:5px;"
                            title="Abrir Panel de Autogestión del Gestor del Nodo">
                            🎛️ Panel del Gestor ↗
                        </a>

                        <a href="/tienda/${escaparHtml(nodoPrincipalSlug)}" target="_blank"
                            style="text-decoration:none; padding:8px 12px; border-radius:8px; font-weight:700; font-size:0.8rem; border:1px solid rgba(16,185,129,0.45); background:rgba(16,185,129,0.15); color:#6ee7b7; display:inline-flex; align-items:center; gap:5px;"
                            title="Abrir Tienda Marca Blanca del Vecino">
                            🏪 Tienda del Vecino ↗
                        </a>

                        <button onclick="window.NodosPizarra.sincronizarCascadaSeisFlujos()"
                            title="Actualizar todos los precios base tomando los costos vigentes de la Pizarra"
                            style="padding:8px 12px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer; border:1px solid rgba(245,158,11,0.45); background:rgba(245,158,11,0.14); color:#fcd34d;">
                            ⚡ Actualizar Costos
                        </button>
                    </div>
                </div>

                <!-- CONTENIDO DINÁMICO DE LA SUB-PESTAÑA ACTIVA -->
                <div id="nodos-subtab-body">
                    ${ESTADO_NODOS.subTabActiva === 'cotizador'
                        ? renderizarSubTabCotizador()
                        : ESTADO_NODOS.subTabActiva === 'catalogo'
                            ? renderizarSubTabCatalogo()
                            : renderizarSubTabAbmNodos()}
                </div>
            </div>
        `;

        if (ESTADO_NODOS.subTabActiva === 'cotizador') {
            recalcularMesaCotizacionEnVivo();
        }
    }

    // =========================================================================
    // SUB-PESTAÑA 1: MESA COTIZADORA DE FRACCIONES CONECTADA A LOS 6 FLUJOS
    // =========================================================================
    function renderizarSubTabCotizador() {
        const flujoActual = Number(ESTADO_NODOS.flujoSeleccionadoMesa || 2);
        const envasesOpts = ESTADO_NODOS.fuentes.envases.map(e =>
            `<option value="${e.id}" data-costo="${e.costo_unitario}" ${e.id === 180 ? 'selected' : ''}>${escaparHtml(e.nombre)} (${fmtMoneda(e.costo_unitario, 2)})</option>`
        ).join('');

        const tarifasOpts = ESTADO_NODOS.fuentes.tarifas_mano_obra.map(t =>
            `<option value="${t.id}" data-valor-hora="${t.valor_hora}">${escaparHtml(t.nombre_completo)} (${fmtMoneda(t.valor_hora)}/hora)</option>`
        ).join('');

        const opcionesInsumoFlujo = construirOpcionesSelectorFuentePorFlujo(flujoActual);

        const propuestasHtml = ESTADO_NODOS.propuestas.map(prop => {
            const esPendiente = prop.estado === 'PENDIENTE_COTIZACION';
            const metaFlujo = FLUJO_META[prop.flujo_sugerido] || FLUJO_META[2];
            const activa = Number(ESTADO_NODOS.propuestaActivaId) === Number(prop.id);

            return `
                <div style="padding:11px 13px; border-radius:10px; background:${activa ? 'rgba(16,185,129,0.14)' : 'rgba(15,23,42,0.75)'}; border:1px solid ${activa ? '#10b981' : esPendiente ? 'rgba(245,158,11,0.4)' : '#334155'}; display:flex; flex-direction:column; gap:6px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                        <div>
                            <span style="font-size:0.7rem; font-weight:800; padding:2px 6px; border-radius:4px; background:${esPendiente ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)'}; color:${esPendiente ? '#fbbf24' : '#34d399'};">
                                ${esPendiente ? '⏳ PENDIENTE COTIZAR' : '✅ APROBADA'}
                            </span>
                            <span style="font-size:0.72rem; color:#94a3b8; margin-left:6px;">${escaparHtml(prop.codigo_propuesta)} · Nodo: <strong style="color:#e2e8f0;">${escaparHtml(prop.nodo_solicitante_nombre || 'General')}</strong></span>
                        </div>
                        <span style="font-size:0.7rem; padding:2px 7px; border-radius:999px; background:${metaFlujo.bg}; color:${metaFlujo.color}; font-weight:700;">
                            ${metaFlujo.corto}
                        </span>
                    </div>

                    <div style="font-weight:700; font-size:0.9rem; color:#f8fafc;">
                        ${escaparHtml(prop.nombre_sugerido)}
                    </div>

                    <div style="font-size:0.77rem; color:#cbd5e1; display:flex; gap:12px; flex-wrap:wrap;">
                        <span>⚖️ Fracción: <strong>${Math.round(Number(prop.kilos_sugeridos || 0.25) * 1000)}g</strong> (${Number(prop.kilos_sugeridos || 0.25)} kg)</span>
                        ${prop.ingrediente_sugerido_nombre ? `<span>🌾 Base: <strong>${escaparHtml(prop.ingrediente_sugerido_nombre)}</strong> (${fmtMoneda(prop.ingrediente_sugerido_costo_kg)}/kg)</span>` : ''}
                        ${prop.precio_objetivo_vecino ? `<span>🎯 Precio estimado vecino: <strong style="color:#38bdf8;">${fmtMoneda(prop.precio_objetivo_vecino)}</strong></span>` : ''}
                    </div>

                    ${prop.comentario_gestor ? `<div style="font-size:0.75rem; color:#94a3b8; font-style:italic; background:rgba(0,0,0,0.25); padding:5px 8px; border-radius:6px;">"${escaparHtml(prop.comentario_gestor)}"</div>` : ''}

                    <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:2px;">
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
                                <div style="font-size:0.75rem; color:#94a3b8;">Los pedidos de nuevas presentaciones ingresan aquí para cotizar y fijar su Precio Base Nodo</div>
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
                            <div style="font-weight:700; font-size:0.9rem; color:#f8fafc;">🧭 Elegir Producto o Receta de la Pizarra</div>
                            <input type="text" id="nodos-search-fuentes" placeholder="🔍 Buscar almendra, mix, granola, barrita..."
                                value="${escaparHtml(ESTADO_NODOS.busquedaFuentes)}"
                                oninput="window.NodosPizarra.filtrarFuentesRapidas(this.value)"
                                style="padding:5px 10px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.78rem; width:220px;">
                        </div>
                        <div id="nodos-lista-fuentes-rapidas" style="display:flex; flex-direction:column; gap:6px; max-height:290px; overflow-y:auto; padding-right:4px;">
                            ${renderizarListaFuentesRapidasHtml()}
                        </div>
                    </div>
                </div>

                <!-- COLUMNA DERECHA: MESA DE COTIZACIÓN DE FRACCIONES Y APROBACIÓN DE PRECIO BASE NODO -->
                <div class="card" style="padding:16px 18px; background:#151e2e; border:1px solid rgba(16,185,129,0.4); border-radius:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #2e3c51; padding-bottom:10px; margin-bottom:14px;">
                        <div>
                            <div style="font-size:1rem; font-weight:800; color:#f8fafc;" id="mesa-cotizacion-titulo">
                                🧮 Cotizador de Fracciones Familiares
                            </div>
                            <div style="font-size:0.76rem; color:#94a3b8;" id="mesa-cotizacion-subtitulo">
                                Seleccione un flujo productivo o cargue una solicitud de la bandeja izquierda.
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

                    <!-- DATOS DE ORIGEN, FRACCIÓN Y ENVASE -->
                    <div style="display:grid; grid-template-columns: 1.5fr 1fr 0.9fr; gap:10px; margin-bottom:10px;">
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Producto / Receta Base (${FLUJO_META[flujoActual].corto})</label>
                            <select id="cot-origen-select" onchange="window.NodosPizarra.alCambiarOrigenSelect()"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.82rem;">
                                ${opcionesInsumoFlujo}
                            </select>
                        </div>
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Costo por Kilo ($ / Kg)</label>
                            <input type="number" id="cot-costo-kg" step="0.01" value="18109.43" oninput="window.NodosPizarra.recalcularEnVivo()"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #38bdf8; background:#0f172a; color:#38bdf8; font-weight:800; font-size:0.86rem;">
                        </div>
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Peso Fracción (Kg)</label>
                            <input type="number" id="cot-kilos-unidad" step="0.01" min="0.01" value="0.25" oninput="window.NodosPizarra.recalcularEnVivo()"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #10b981; background:#0f172a; color:#6ee7b7; font-weight:800; font-size:0.86rem;">
                        </div>
                    </div>

                    <!-- ATAJOS RÁPIDOS DE GRAMAJE FAMILIAR -->
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:12px; flex-wrap:wrap;">
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

                    <!-- IDENTIDAD COMERCIAL DEL ARTÍCULO EN EL PADRÓN DE NODOS -->
                    <div style="display:grid; grid-template-columns: 1.6fr 0.9fr 0.9fr; gap:10px; margin-bottom:12px;">
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Nombre Comercial para el Vecino</label>
                            <input type="text" id="cot-nombre-publico" placeholder="Ej: Almendra Nonpareil Californiana x 250g"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.83rem;">
                        </div>
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Código Interno Nodo</label>
                            <input type="text" id="cot-sku-nodo" placeholder="Automático (ej: NB-ALM-250G)"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#cbd5e1; font-family:monospace; font-size:0.82rem;">
                        </div>
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Categoría en Tienda</label>
                            <input type="text" id="cot-categoria" value="Frutos Secos Puros"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.82rem;">
                        </div>
                    </div>

                    <!-- ENVASE, TIEMPO DE FRACCIONADO Y TARIFA HORARIA -->
                    <div style="display:grid; grid-template-columns: 1.3fr 0.8fr 1.2fr; gap:10px; margin-bottom:12px;">
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Envase / Bolsa</label>
                            <select id="cot-envase-select" onchange="window.NodosPizarra.recalcularEnVivo()"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.81rem;">
                                ${envasesOpts}
                            </select>
                        </div>
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Tiempo de Armado (seg)</label>
                            <input type="number" id="cot-segundos-mo" step="1" min="0" value="35" oninput="window.NodosPizarra.recalcularEnVivo()"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.83rem;">
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
                            <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:4px;">Ingresos Brutos (%)</label>
                            <input type="number" id="cot-iibb-pct" step="0.1" value="3.5" oninput="window.NodosPizarra.recalcularEnVivo()"
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
                        <input type="text" id="cot-notas-tecnicas" placeholder="Observación o nota para el gestor del Nodo..."
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
            return `<option value="${i.id}" data-costo="${costoVivo}" data-nombre="${escaparHtml(i.nombre)}">${escaparHtml(i.nombre)} (${fmtMoneda(costoVivo)}/kg)</option>`;
        }).join('');
    }

    function renderizarListaFuentesRapidasHtml() {
        const q = ESTADO_NODOS.busquedaFuentes;
        const filtrados = ESTADO_NODOS.fuentes.ingredientes_por_flujo.filter(item => {
            const bolsa = `${item.id} ${item.codigo || ''} ${item.nombre} ${item.flujo_nombre} ${item.articulo_vinculado_numero || ''}`;
            return cumpleBusquedaUniversalLamda(bolsa, q);
        });

        return filtrados.slice(0, 40).map(item => {
            const meta = FLUJO_META[item.flujo] || FLUJO_META[2];
            const costoVivo = obtenerCostoVivoIngredientePizarra(item.id, item.costo_kg);
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; border-radius:7px; background:rgba(15,23,42,0.7); border:1px solid #263244;">
                    <div>
                        <span style="font-size:0.68rem; padding:1px 6px; border-radius:4px; background:${meta.bg}; color:${meta.color}; font-weight:700; margin-right:6px;">
                            ${meta.corto}
                        </span>
                        <strong style="font-size:0.8rem; color:#f1f5f9;">${escaparHtml(item.nombre)}</strong>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
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

    function recalcularMesaCotizacionEnVivo() {
        const costoKgEl = document.getElementById('cot-costo-kg');
        const kilosEl = document.getElementById('cot-kilos-unidad');
        const envaseEl = document.getElementById('cot-envase-select');
        const segEl = document.getElementById('cot-segundos-mo');
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
        const costoEnvaseUnitario = Number(envaseOpt?.getAttribute('data-costo') || 45.96);
        const segundos = Math.max(0, Number(segEl.value) || 35);
        const tarifaOpt = tarifaEl?.selectedOptions?.[0];
        const valorHora = Number(tarifaOpt?.getAttribute('data-valor-hora') || 7000);
        const margenLamdaPct = Math.max(0, Number(margenLamdaEl.value) || 22);
        const ivaPct = Math.max(0, Number(ivaEl.value) || 21);
        const iibbPct = Math.max(0, Number(iibbEl.value) || 3.5);
        const margenGestorPct = Math.max(0, Number(margenGestorEl.value) || 28);

        const costoInsumoFraccion = costoInsumoKg * kilosUnidad;
        const costoMateriaYEnvase = costoInsumoFraccion + costoEnvaseUnitario;
        const costoManoObra = (segundos / 3600) * valorHora;
        const costoPuroTotal = costoMateriaYEnvase + costoManoObra;

        const gananciaLamda = costoMateriaYEnvase * (margenLamdaPct / 100);
        const precioBaseNeto = costoMateriaYEnvase + gananciaLamda + costoManoObra;
        const impuestosMonto = precioBaseNeto * ((ivaPct + iibbPct) / 100);
        const precioBaseNodoFinal = Math.round(precioBaseNeto + impuestosMonto);

        const precioSugeridoVecino = Math.ceil((precioBaseNodoFinal * (1 + margenGestorPct / 100)) / 50) * 50;
        const gananciaGestorUnitaria = Math.max(0, precioSugeridoVecino - precioBaseNodoFinal);

        const propActiva = ESTADO_NODOS.propuestas.find(p => Number(p.id) === Number(ESTADO_NODOS.propuestaActivaId));
        const targetVecino = propActiva && Number(propActiva.precio_objetivo_vecino) > 0
            ? Number(propActiva.precio_objetivo_vecino)
            : null;

        box.innerHTML = `
            <div style="font-size:0.74rem; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:8px;">
                📊 Desglose de Costos por Presentación (${Math.round(kilosUnidad * 1000)}g)
            </div>
            <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; margin-bottom:10px;">
                <div style="padding:8px; border-radius:7px; background:#0f172a; border:1px solid #1e293b;">
                    <div style="font-size:0.7rem; color:#94a3b8;">1. Materia Prima (${Math.round(kilosUnidad * 1000)}g)</div>
                    <div style="font-size:0.95rem; font-weight:800; color:#f8fafc;">${fmtMoneda(costoInsumoFraccion, 2)}</div>
                </div>
                <div style="padding:8px; border-radius:7px; background:#0f172a; border:1px solid #1e293b;">
                    <div style="font-size:0.7rem; color:#94a3b8;">2. Envase + Armado (${segundos}s)</div>
                    <div style="font-size:0.95rem; font-weight:800; color:#f8fafc;">${fmtMoneda(costoEnvaseUnitario + costoManoObra, 2)}</div>
                    <div style="font-size:0.66rem; color:#64748b;">Bolsa ${fmtMoneda(costoEnvaseUnitario, 1)} + MO ${fmtMoneda(costoManoObra, 1)}</div>
                </div>
                <div style="padding:8px; border-radius:7px; background:#0f172a; border:1px solid #1e293b;">
                    <div style="font-size:0.7rem; color:#94a3b8;">3. Costo + Margen LAMDA</div>
                    <div style="font-size:0.95rem; font-weight:800; color:#34d399;">${fmtMoneda(precioBaseNeto, 2)}</div>
                    <div style="font-size:0.66rem; color:#6ee7b7;">Costo ${fmtMoneda(costoPuroTotal, 0)} + Ganancia ${fmtMoneda(gananciaLamda, 0)}</div>
                </div>
                <div style="padding:8px; border-radius:7px; background:#0f172a; border:1px solid #1e293b;">
                    <div style="font-size:0.7rem; color:#94a3b8;">4. IVA (${ivaPct}%) + IIBB (${iibbPct}%)</div>
                    <div style="font-size:0.95rem; font-weight:800; color:#fbbf24;">+${fmtMoneda(impuestosMonto, 2)}</div>
                </div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; padding-top:8px; border-top:1px dashed #334155;">
                <div style="padding:10px 12px; border-radius:8px; background:rgba(16,185,129,0.14); border:1px solid rgba(16,185,129,0.45); display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-size:0.72rem; color:#6ee7b7; font-weight:800; text-transform:uppercase;">Precio Base LAMDA → Nodo</div>
                        <div style="font-size:0.7rem; color:#94a3b8;">Valor en Cuenta Corriente del Gestor</div>
                    </div>
                    <div style="font-size:1.35rem; font-weight:900; color:#34d399;">${fmtMoneda(precioBaseNodoFinal)}</div>
                </div>

                <div style="padding:10px 12px; border-radius:8px; background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.45); display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-size:0.72rem; color:#bae6fd; font-weight:800; text-transform:uppercase;">Precio Sugerido al Vecino (+${margenGestorPct}%)</div>
                        <div style="font-size:0.7rem; color:#93c5fd;">
                            Ganancia del Gestor: <strong>+${fmtMoneda(gananciaGestorUnitaria)}/u.</strong>
                            ${targetVecino ? ` · Pedido gestor: ${fmtMoneda(targetVecino)}` : ''}
                        </div>
                    </div>
                    <div style="font-size:1.35rem; font-weight:900; color:#38bdf8;">${fmtMoneda(precioSugeridoVecino)}</div>
                </div>
            </div>
        `;
    }

    // =========================================================================
    // SUB-PESTAÑA 2: CATÁLOGO AISLADO DE NODOS Y MÁRGENES POR GESTOR
    // =========================================================================
    function renderizarSubTabCatalogo() {
        const q = ESTADO_NODOS.busquedaCatalogo;
        const fFlujo = Number(ESTADO_NODOS.filtroFlujoCatalogo || 0);
        const fNodo = Number(ESTADO_NODOS.filtroNodoOfertas || 0);

        const filasCatalogo = ESTADO_NODOS.catalogo.filter(c => {
            if (fFlujo > 0 && Number(c.flujo_lamda) !== fFlujo) return false;
            const bolsa = `${c.sku_nodo} ${c.nombre_publico} ${c.categoria_familiar} ${c.presentacion_etiqueta || ''} ${c.ingrediente_origen_nombre || ''} ${c.notas_tecnicas || ''} flujo ${c.flujo_lamda}`;
            return cumpleBusquedaUniversalLamda(bolsa, q);
        });

        return `
            <div style="display:flex; flex-direction:column; gap:14px;">
                <div class="card" style="padding:12px 16px; background:#151e2e; border:1px solid #2e3c51; border-radius:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                    <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:280px;">
                        <input type="text" placeholder="🔍 Buscar producto por nombre, código, ingrediente o peso..."
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
                                <th style="padding:10px;">Código / Flujo</th>
                                <th style="padding:10px;">Producto Familiar</th>
                                <th style="padding:10px;">Insumo Base</th>
                                <th style="padding:10px;">Costo Total</th>
                                <th style="padding:10px;">Margen LAMDA</th>
                                <th style="padding:10px; color:#34d399;">Precio Base Nodo</th>
                                <th style="padding:10px; color:#38bdf8;">Márgenes y Precio al Vecino por Nodo</th>
                                <th style="padding:10px; text-align:right;">Acción</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filasCatalogo.map(cat => {
                                const meta = FLUJO_META[cat.flujo_lamda] || FLUJO_META[2];
                                const ofertasItem = ESTADO_NODOS.ofertas_gestor.filter(o =>
                                    Number(o.articulo_catalogo_id) === Number(cat.id) &&
                                    (fNodo === 0 || Number(o.nodo_id) === fNodo)
                                );

                                return `
                                    <tr style="border-bottom:1px solid #1e293b;">
                                        <td style="padding:10px; vertical-align:top;">
                                            <div style="font-family:monospace; font-weight:800; color:#f8fafc;">${escaparHtml(cat.sku_nodo)}</div>
                                            <span style="display:inline-block; margin-top:4px; font-size:0.68rem; padding:2px 6px; border-radius:4px; background:${meta.bg}; color:${meta.color}; font-weight:700;">
                                                ${meta.corto}
                                            </span>
                                        </td>
                                        <td style="padding:10px; vertical-align:top;">
                                            <div style="font-weight:700; color:#f8fafc; font-size:0.88rem;">${escaparHtml(cat.nombre_publico)}</div>
                                            <div style="font-size:0.74rem; color:#94a3b8;">
                                                Presentación: <strong>${escaparHtml(cat.presentacion_etiqueta || `${Math.round(Number(cat.kilos_unidad) * 1000)}g`)}</strong>
                                                · ${escaparHtml(cat.categoria_familiar)}
                                            </div>
                                        </td>
                                        <td style="padding:10px; vertical-align:top;">
                                            <div style="color:#cbd5e1;">${escaparHtml(cat.ingrediente_origen_nombre || 'Directo')}</div>
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
                                            <div style="font-size:0.71rem; color:#94a3b8;">IVA ${Number(cat.iva_pct)}% + IIBB ${Number(cat.iibb_pct)}%</div>
                                        </td>
                                        <td style="padding:10px; vertical-align:top;">
                                            <div style="font-size:1.05rem; font-weight:900; color:#34d399;">${fmtMoneda(cat.precio_base_nodo_final)}</div>
                                            <div style="font-size:0.7rem; color:#94a3b8;">Neto: ${fmtMoneda(cat.precio_base_nodo_neto, 0)}</div>
                                        </td>
                                        <td style="padding:10px; vertical-align:top; min-width:310px;">
                                            <div style="display:flex; flex-direction:column; gap:6px;">
                                                ${ofertasItem.map(of => `
                                                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; background:#0f172a; border:1px solid ${of.alerta_cambio_costo ? '#f59e0b' : '#263244'}; padding:5px 8px; border-radius:6px;">
                                                        <div style="font-size:0.74rem;">
                                                            <strong style="color:#f8fafc;">${escaparHtml(of.nombre_marca)}</strong>
                                                            <div style="color:#6ee7b7; font-size:0.7rem;">Gana: +${fmtMoneda(of.ganancia_unitaria_gestor)}/u.</div>
                                                        </div>
                                                        <div style="display:flex; align-items:center; gap:6px;">
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
                                                `).join('')}
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
            </div>
        `;
    }

    // =========================================================================
    // SUB-PESTAÑA 3: ABM DE NODOS BARRIALES + LOGO TÉRMICO + PREVIEW ZEBRA LIMPIO
    // =========================================================================
    function renderizarSubTabAbmNodos() {
        const cuentasOpts = ESTADO_NODOS.fuentes.cuentas_bancarias.map(c =>
            `<option value="${c.id}" data-alias="${escaparHtml(c.alias || '')}" data-cbu="${escaparHtml(c.cbu || '')}" data-titular="${escaparHtml(c.titular || '')}">
                ${escaparHtml(c.banco)} — Alias: ${escaparHtml(c.alias || 'S/A')}
            </option>`
        ).join('');

        return `
            <div style="display:grid; grid-template-columns: 34% 65%; gap:16px; align-items:start;">
                <!-- COLUMNA IZQUIERDA: LISTADO DE NODOS BARRIALES ACTIVOS -->
                <div class="card" style="padding:14px; background:#151e2e; border:1px solid #2e3c51; border-radius:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <div>
                            <div style="font-weight:700; font-size:0.95rem; color:#f8fafc;">🏘️ Nodos Barriales Activos</div>
                            <div style="font-size:0.74rem; color:#94a3b8;">Seleccione un Nodo para configurar su marca, entregas o etiqueta</div>
                        </div>
                        <button onclick="window.NodosPizarra.nuevoNodoFormulario()"
                            style="padding:6px 11px; border-radius:7px; font-size:0.76rem; font-weight:700; border:1px solid #10b981; background:rgba(16,185,129,0.2); color:#6ee7b7; cursor:pointer;">
                            ➕ Nuevo Nodo
                        </button>
                    </div>

                    <div style="display:flex; flex-direction:column; gap:10px;">
                        ${ESTADO_NODOS.nodos.map(n => `
                            <div onclick="window.NodosPizarra.cargarNodoEnFormularioAbm(${n.id})"
                                style="padding:12px; border-radius:10px; background:rgba(15,23,42,0.85); border:1px solid ${Number(ESTADO_NODOS.nodoEditandoId) === Number(n.id) ? '#a78bfa' : '#334155'}; cursor:pointer; display:flex; flex-direction:column; gap:8px;">
                                <div style="display:flex; gap:12px; align-items:center;">
                                    <div style="width:74px; height:40px; background:#ffffff; border-radius:6px; border:1px solid #475569; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0;">
                                        ${n.logo_mono_preview_base64
                                            ? `<img src="${n.logo_mono_preview_base64}" style="max-width:100%; max-height:100%; image-rendering:pixelated;" alt="Logo">`
                                            : `<span style="color:#000; font-weight:800; font-size:0.75rem;">LOGO</span>`}
                                    </div>
                                    <div style="flex:1; min-width:0;">
                                        <div style="display:flex; justify-content:space-between; align-items:center;">
                                            <span style="font-weight:800; color:#f8fafc; font-size:0.9rem;">${escaparHtml(n.nombre_marca)}</span>
                                            <span style="font-size:0.68rem; font-family:monospace; color:#a78bfa; background:rgba(167,139,250,0.14); padding:2px 6px; border-radius:4px;">${escaparHtml(n.codigo_nodo)}</span>
                                        </div>
                                        <div style="font-size:0.75rem; color:#cbd5e1; margin-top:2px;">
                                            👤 Gestor: <strong>${escaparHtml(n.gestor_nombre)}</strong> · 📍 ${escaparHtml(n.barrio_zona || '')}
                                        </div>
                                        <div style="font-size:0.72rem; color:#94a3b8; margin-top:3px; display:flex; gap:10px; flex-wrap:wrap;">
                                            <span>📒 Saldo Cta.Cte: <strong style="color:#34d399;">${fmtMoneda(n.saldo_cuenta_corriente)}</strong></span>
                                            <span>🏦 Alias: <strong style="color:#38bdf8;">${escaparHtml(n.alias_bancario_display || 'S/A')}</strong></span>
                                            <span>🛵 Envío: <strong>${fmtMoneda(n.cargo_envio_barrial)}</strong></span>
                                        </div>
                                    </div>
                                </div>
                                <div style="display:flex; justify-content:flex-end; gap:8px; padding-top:6px; border-top:1px solid rgba(51,65,85,0.6);" onclick="event.stopPropagation();">
                                    <a href="/gestor/${escaparHtml(n.slug)}" target="_blank"
                                        style="text-decoration:none; padding:4px 9px; border-radius:6px; font-size:0.72rem; font-weight:700; background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.4); color:#bae6fd;">
                                        🎛️ Panel Gestor ↗
                                    </a>
                                    <a href="/tienda/${escaparHtml(n.slug)}" target="_blank"
                                        style="text-decoration:none; padding:4px 9px; border-radius:6px; font-size:0.72rem; font-weight:700; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.4); color:#6ee7b7;">
                                        🏪 Tienda Vecinos ↗
                                    </a>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- COLUMNA DERECHA: FORMULARIO ABM + LOGO TÉRMICO + SIMULADOR ETIQUETA ZEBRA -->
                <div style="display:flex; flex-direction:column; gap:14px;">
                    <div class="card" style="padding:16px; background:#151e2e; border:1px solid rgba(167,139,250,0.4); border-radius:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #2e3c51; padding-bottom:10px; margin-bottom:12px;">
                            <div>
                                <div style="font-size:0.98rem; font-weight:800; color:#f8fafc;" id="abm-nodo-form-title">
                                    🏷️ Datos del Nodo, Cobranza y Logo para Etiqueta
                                </div>
                                <div style="font-size:0.75rem; color:#94a3b8;">
                                    Cada Nodo cuenta con su propia tienda vecinal, cuenta corriente y diseño de etiqueta térmica.
                                </div>
                            </div>
                            <button type="button" onclick="window.NodosPizarra.guardarNodoAbm()"
                                style="padding:8px 16px; border-radius:8px; font-weight:800; font-size:0.82rem; border:none; background:linear-gradient(135deg, #8b5cf6, #6d28d9); color:#ffffff; cursor:pointer;">
                                💾 Guardar Cambios del Nodo
                            </button>
                        </div>

                        <input type="hidden" id="abm-nodo-id" value="">

                        <div style="display:grid; grid-template-columns: 1.3fr 1fr 1fr; gap:10px; margin-bottom:10px;">
                            <div>
                                <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:3px;">Nombre de la Marca del Nodo</label>
                                <input type="text" id="abm-nombre-marca" placeholder="Ej: Almacén Verde City Bell"
                                    style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-weight:700;">
                            </div>
                            <div>
                                <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:3px;">Dirección Web de la Tienda (Link para vecinos)</label>
                                <input type="text" id="abm-slug" placeholder="almacen-verde-city-bell"
                                    style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#38bdf8; font-family:monospace;">
                            </div>
                            <div>
                                <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:3px;">Bajada / Subtítulo de Marca</label>
                                <input type="text" id="abm-subtitulo" placeholder="Alimentación Consciente - Entrega Barrial"
                                    style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc;">
                            </div>
                        </div>

                        <div style="display:grid; grid-template-columns: 1fr 0.9fr 1fr 1.3fr; gap:10px; margin-bottom:10px;">
                            <div>
                                <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:3px;">Nombre del Gestor</label>
                                <input type="text" id="abm-gestor-nombre" placeholder="Carolina Méndez"
                                    style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc;">
                            </div>
                            <div>
                                <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:3px;">WhatsApp del Gestor</label>
                                <input type="text" id="abm-gestor-tel" placeholder="5492215548910"
                                    style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc;">
                            </div>
                            <div>
                                <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:3px;">Barrio / Zona</label>
                                <input type="text" id="abm-barrio" placeholder="City Bell / Cantilo"
                                    style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc;">
                            </div>
                            <div>
                                <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:3px;">Domicilio del Nodo (Retiro de Vecinos)</label>
                                <input type="text" id="abm-direccion" placeholder="Cantilo 452 e/ 13c y 14, City Bell"
                                    style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc;">
                            </div>
                        </div>

                        <!-- CONFIGURACIÓN BANCARIA Y CARGO DE ENVÍO BARRIAL (100% GESTOR) -->
                        <div style="display:grid; grid-template-columns: 1.4fr 1fr 0.8fr 0.8fr; gap:10px; margin-bottom:12px; padding:10px; border-radius:8px; background:rgba(15,23,42,0.75); border:1px solid #263244;">
                            <div>
                                <label style="display:block; font-size:0.72rem; color:#38bdf8; font-weight:700; margin-bottom:3px;">Cuenta Bancaria Recaudadora</label>
                                <select id="abm-cuenta-bancaria"
                                    style="width:100%; padding:7px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.79rem;">
                                    ${cuentasOpts}
                                </select>
                                <label style="display:inline-flex; align-items:center; gap:5px; font-size:0.71rem; color:#94a3b8; margin-top:4px; cursor:pointer;">
                                    <input type="checkbox" id="abm-cuenta-compartida">
                                    Usar cuenta recaudadora compartida (conciliación automática de vecinos)
                                </label>
                            </div>
                            <div>
                                <label style="display:block; font-size:0.72rem; color:#38bdf8; font-weight:700; margin-bottom:3px;">Alias Bancario Visible al Vecino</label>
                                <input type="text" id="abm-alias-display" placeholder="ALMACEN.VERDE.CB"
                                    style="width:100%; padding:7px; border-radius:6px; border:1px solid #38bdf8; background:#0f172a; color:#38bdf8; font-weight:800; font-size:0.81rem;">
                            </div>
                            <div>
                                <label style="display:block; font-size:0.72rem; color:#34d399; font-weight:700; margin-bottom:3px;">Costo Envío Barrial ($)</label>
                                <input type="number" id="abm-cargo-envio" step="100" value="1500"
                                    style="width:100%; padding:7px; border-radius:6px; border:1px solid #10b981; background:#0f172a; color:#34d399; font-weight:800; font-size:0.81rem;">
                                <div style="font-size:0.66rem; color:#6ee7b7; margin-top:2px;">100% para el Gestor</div>
                            </div>
                            <div>
                                <label style="display:block; font-size:0.72rem; color:#cbd5e1; margin-bottom:3px;">Margen Inicial (%)</label>
                                <input type="number" id="abm-margen-default" step="0.5" value="28"
                                    style="width:100%; padding:7px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-weight:700; font-size:0.81rem;">
                            </div>
                        </div>

                        <!-- LOGO DEL NODO PARA ETIQUETA TÉRMICA -->
                        <div style="padding:12px; border-radius:10px; background:#0f172a; border:1px solid #334155;">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:10px;">
                                <div>
                                    <div style="font-weight:800; font-size:0.86rem; color:#f8fafc;">🖨️ Logo del Nodo para Etiqueta Térmica</div>
                                    <div style="font-size:0.73rem; color:#94a3b8;">Suba una imagen PNG/JPG o genere un sello con las iniciales del Nodo para el encabezado de sus etiquetas.</div>
                                </div>
                                <div style="display:flex; gap:8px; align-items:center;">
                                    <label style="padding:6px 11px; border-radius:6px; font-size:0.75rem; font-weight:700; background:rgba(56,189,248,0.16); border:1px solid #38bdf8; color:#bae6fd; cursor:pointer;">
                                        📂 Subir Imagen Logo
                                        <input type="file" accept="image/*" style="display:none;" onchange="window.NodosPizarra.subirArchivoLogo(event)">
                                    </label>
                                    <button type="button" onclick="window.NodosPizarra.regenerarLogoZplEnVivo()"
                                        style="padding:6px 11px; border-radius:6px; font-size:0.75rem; font-weight:700; background:rgba(16,185,129,0.16); border:1px solid #10b981; color:#6ee7b7; cursor:pointer;">
                                        ⚡ Actualizar Sello / Logo
                                    </button>
                                </div>
                            </div>

                            <div style="display:grid; grid-template-columns: 160px 1fr; gap:14px; align-items:center;">
                                <div style="display:flex; flex-direction:column; align-items:center; gap:5px; background:#1e293b; padding:10px; border-radius:8px; border:1px solid #475569;">
                                    <div style="font-size:0.68rem; color:#cbd5e1; font-weight:700;">VISTA EN ETIQUETA</div>
                                    <div style="width:116px; height:60px; background:#ffffff; display:flex; align-items:center; justify-content:center; border:1px solid #000;">
                                        <img id="abm-logo-preview-img" src="" alt="Vista previa del logo" style="max-width:112px; max-height:56px; image-rendering:pixelated;">
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
    // ACCIONES INTERACTIVAS DEL MÓDULO
    // =========================================================================
    function seleccionarFlujoMesa(flujo) {
        ESTADO_NODOS.flujoSeleccionadoMesa = Number(flujo);
        const selectEl = document.getElementById('cot-origen-select');
        if (selectEl) {
            selectEl.innerHTML = construirOpcionesSelectorFuentePorFlujo(flujo);
            alCambiarOrigenSelect();
        }
        renderizarVistaNodosCompleta();
    }

    function alCambiarOrigenSelect() {
        const selectEl = document.getElementById('cot-origen-select');
        const costoEl = document.getElementById('cot-costo-kg');
        const nombreEl = document.getElementById('cot-nombre-publico');
        const kilosEl = document.getElementById('cot-kilos-unidad');
        if (!selectEl || !costoEl) return;

        const opt = selectEl.selectedOptions?.[0];
        if (opt) {
            const costo = Number(opt.getAttribute('data-costo') || 0);
            const nombreBase = opt.getAttribute('data-nombre') || '';
            costoEl.value = costo.toFixed(2);
            const gramos = Math.round((Number(kilosEl?.value) || 0.25) * 1000);
            if (nombreEl && (!nombreEl.value.trim() || !ESTADO_NODOS.propuestaActivaId)) {
                nombreEl.value = `${nombreBase.replace(/\s*\(Mix\)\s*/i, ' ')} x ${gramos}g`.replace(/\s+/g, ' ').trim();
            }
        }
        recalcularMesaCotizacionEnVivo();
    }

    function fijarGramajeRapido(kilos) {
        const kilosEl = document.getElementById('cot-kilos-unidad');
        const nombreEl = document.getElementById('cot-nombre-publico');
        if (kilosEl) {
            kilosEl.value = Number(kilos).toFixed(2);
        }
        if (nombreEl && nombreEl.value) {
            const etiquetaGramos = kilos >= 1 ? `${kilos}kg` : `${Math.round(kilos * 1000)}g`;
            nombreEl.value = nombreEl.value.replace(/x\s*\d+(\.\d+)?\s*(g|gr|kg)/i, `x ${etiquetaGramos}`);
        }
        recalcularMesaCotizacionEnVivo();
    }

    function cargarIngredienteDirectoEnMesa(ingId) {
        const item = ESTADO_NODOS.fuentes.ingredientes_por_flujo.find(i => Number(i.id) === Number(ingId));
        if (!item) return;

        ESTADO_NODOS.propuestaActivaId = null;
        ESTADO_NODOS.catalogoEditandoId = null;
        ESTADO_NODOS.flujoSeleccionadoMesa = Number(item.flujo || 2);
        renderizarVistaNodosCompleta();

        const selectEl = document.getElementById('cot-origen-select');
        const costoEl = document.getElementById('cot-costo-kg');
        const nombreEl = document.getElementById('cot-nombre-publico');
        const kilosEl = document.getElementById('cot-kilos-unidad');

        if (selectEl) selectEl.value = String(item.id);
        const costoVivo = obtenerCostoVivoIngredientePizarra(item.id, item.costo_kg);
        if (costoEl) costoEl.value = costoVivo.toFixed(2);
        const gramos = Math.round((Number(kilosEl?.value) || 0.25) * 1000);
        if (nombreEl) nombreEl.value = `${item.nombre.replace(/\s*\(Mix\)\s*/i, ' ')} Familiar x ${gramos}g`.replace(/\s+/g, ' ');
        recalcularMesaCotizacionEnVivo();
    }

    function cargarPropuestaEnMesa(propuestaId) {
        const prop = ESTADO_NODOS.propuestas.find(p => Number(p.id) === Number(propuestaId));
        if (!prop) return;

        ESTADO_NODOS.propuestaActivaId = Number(prop.id);
        ESTADO_NODOS.catalogoEditandoId = prop.articulo_catalogo_id ? Number(prop.articulo_catalogo_id) : null;
        ESTADO_NODOS.flujoSeleccionadoMesa = Number(prop.flujo_sugerido || 2);

        renderizarVistaNodosCompleta();

        const selectEl = document.getElementById('cot-origen-select');
        const costoEl = document.getElementById('cot-costo-kg');
        const kilosEl = document.getElementById('cot-kilos-unidad');
        const nombreEl = document.getElementById('cot-nombre-publico');
        const catEl = document.getElementById('cot-categoria');
        const envEl = document.getElementById('cot-envase-select');
        const segEl = document.getElementById('cot-segundos-mo');
        const titEl = document.getElementById('mesa-cotizacion-titulo');
        const subEl = document.getElementById('mesa-cotizacion-subtitulo');

        if (titEl) titEl.innerHTML = `🧮 Cotizando Solicitud ${escaparHtml(prop.codigo_propuesta)} (${escaparHtml(prop.nodo_solicitante_nombre || 'Nodo')})`;
        if (subEl) subEl.innerHTML = `Precio estimado al vecino por el gestor: <strong style="color:#38bdf8;">${prop.precio_objetivo_vecino ? fmtMoneda(prop.precio_objetivo_vecino) : 'Abierto'}</strong>`;

        if (prop.ingrediente_sugerido_id && selectEl) {
            selectEl.value = String(prop.ingrediente_sugerido_id);
        }
        const costoVivo = prop.ingrediente_sugerido_id
            ? obtenerCostoVivoIngredientePizarra(prop.ingrediente_sugerido_id, prop.ingrediente_sugerido_costo_kg)
            : Number(prop.ingrediente_sugerido_costo_kg || 10000);

        if (costoEl) costoEl.value = costoVivo.toFixed(2);
        if (kilosEl) kilosEl.value = Number(prop.kilos_sugeridos || 0.25).toFixed(2);
        if (nombreEl) nombreEl.value = prop.nombre_sugerido || '';
        if (catEl) catEl.value = prop.categoria_sugerida || 'Frutos Secos';
        if (envEl && prop.insumo_envase_sugerido_id) envEl.value = String(prop.insumo_envase_sugerido_id);
        if (segEl && prop.segundos_estimados) segEl.value = Number(prop.segundos_estimados);

        recalcularMesaCotizacionEnVivo();
    }

    function editarArticuloCatalogoEnMesa(catalogoId) {
        const cat = ESTADO_NODOS.catalogo.find(c => Number(c.id) === Number(catalogoId));
        if (!cat) return;

        ESTADO_NODOS.subTabActiva = 'cotizador';
        ESTADO_NODOS.catalogoEditandoId = Number(cat.id);
        ESTADO_NODOS.propuestaActivaId = null;
        ESTADO_NODOS.flujoSeleccionadoMesa = Number(cat.flujo_lamda || 2);

        renderizarVistaNodosCompleta();

        const selectEl = document.getElementById('cot-origen-select');
        const costoEl = document.getElementById('cot-costo-kg');
        const kilosEl = document.getElementById('cot-kilos-unidad');
        const nombreEl = document.getElementById('cot-nombre-publico');
        const skuEl = document.getElementById('cot-sku-nodo');
        const catEl = document.getElementById('cot-categoria');
        const envEl = document.getElementById('cot-envase-select');
        const segEl = document.getElementById('cot-segundos-mo');
        const margenL = document.getElementById('cot-margen-lamda');
        const margenG = document.getElementById('cot-margen-gestor');
        const notasEl = document.getElementById('cot-notas-tecnicas');

        if (cat.ingrediente_origen_id && selectEl) selectEl.value = String(cat.ingrediente_origen_id);
        if (costoEl) costoEl.value = Number(cat.costo_insumo_kg_vivo || cat.costo_insumo_kg).toFixed(2);
        if (kilosEl) kilosEl.value = Number(cat.kilos_unidad).toFixed(2);
        if (nombreEl) nombreEl.value = cat.nombre_publico;
        if (skuEl) skuEl.value = cat.sku_nodo;
        if (catEl) catEl.value = cat.categoria_familiar || 'Frutos Secos';
        if (envEl && cat.insumo_envase_id) envEl.value = String(cat.insumo_envase_id);
        if (segEl) segEl.value = Number(cat.segundos_fraccionamiento || 35);
        if (margenL) margenL.value = Number(cat.margen_lamda_pct || 22);
        if (margenG) margenG.value = Number(cat.margen_sugerido_gestor_pct || 28);
        if (notasEl) notasEl.value = cat.notas_tecnicas || '';

        recalcularMesaCotizacionEnVivo();
    }

    function limpiarMesaCotizacion() {
        ESTADO_NODOS.propuestaActivaId = null;
        ESTADO_NODOS.catalogoEditandoId = null;
        renderizarVistaNodosCompleta();
    }

    async function aprobarYPublicarEnPadronNodos() {
        try {
            const origenVal = document.getElementById('cot-origen-select')?.value || '';
            const esArtBunker = origenVal.startsWith('ART:');
            const ingredienteOrigenId = !esArtBunker && origenVal ? Number(origenVal) : null;
            const artBunkerCodigo = esArtBunker ? origenVal.replace('ART:', '') : null;

            const envSelect = document.getElementById('cot-envase-select');
            const envOpt = envSelect?.selectedOptions?.[0];
            const tarifaSelect = document.getElementById('cot-tarifa-select');
            const tarifaOpt = tarifaSelect?.selectedOptions?.[0];

            const kilos = Number(document.getElementById('cot-kilos-unidad')?.value || 0.25);
            const payload = {
                catalogo_id: ESTADO_NODOS.catalogoEditandoId || null,
                propuesta_id: ESTADO_NODOS.propuestaActivaId || null,
                sku_nodo: document.getElementById('cot-sku-nodo')?.value || '',
                nombre_publico: document.getElementById('cot-nombre-publico')?.value || '',
                categoria_familiar: document.getElementById('cot-categoria')?.value || 'Frutos Secos',
                presentacion_etiqueta: kilos >= 1 ? `Bolsa ${kilos}kg` : `Bolsa ${Math.round(kilos * 1000)}g`,
                flujo_lamda: ESTADO_NODOS.flujoSeleccionadoMesa,
                origen_tipo: esArtBunker ? 'ARTICULO_BUNKER' : (ESTADO_NODOS.flujoSeleccionadoMesa === 3 ? 'MIX' : ESTADO_NODOS.flujoSeleccionadoMesa >= 4 ? 'UP_EXTERNA' : 'INGREDIENTE'),
                ingrediente_origen_id: ingredienteOrigenId,
                articulo_bunker_origen_codigo: artBunkerCodigo,
                costo_insumo_kg: Number(document.getElementById('cot-costo-kg')?.value || 0),
                kilos_unidad: kilos,
                insumo_envase_id: envSelect?.value ? Number(envSelect.value) : null,
                costo_envase_unitario: Number(envOpt?.getAttribute('data-costo') || 0),
                segundos_fraccionamiento: Number(document.getElementById('cot-segundos-mo')?.value || 35),
                tarifa_colaborador_id: tarifaSelect?.value ? Number(tarifaSelect.value) : null,
                valor_hora_aplicado: Number(tarifaOpt?.getAttribute('data-valor-hora') || 7000),
                margen_lamda_pct: Number(document.getElementById('cot-margen-lamda')?.value || 22),
                iva_pct: Number(document.getElementById('cot-iva-pct')?.value || 21),
                iibb_pct: Number(document.getElementById('cot-iibb-pct')?.value || 3.5),
                margen_sugerido_gestor_pct: Number(document.getElementById('cot-margen-gestor')?.value || 28),
                notas_tecnicas: document.getElementById('cot-notas-tecnicas')?.value || ''
            };

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
                    title: 'Precio Base Nodo Aprobado',
                    html: `
                        <div style="text-align:left; font-size:0.9rem;">
                            <p><strong>${escaparHtml(data.articulo.nombre_publico)}</strong> (<code>${escaparHtml(data.articulo.sku_nodo)}</code>)</p>
                            <p>✅ <strong>Precio Base LAMDA → Nodo:</strong> ${fmtMoneda(data.calculo.precio_base_nodo_final)}</p>
                            <p>🏘️ <strong>Precio Sugerido al Vecino:</strong> ${fmtMoneda(data.calculo.precio_sugerido_vecino)}</p>
                        </div>
                    `,
                    background: '#151e2e',
                    color: '#f8fafc'
                });
            }

            ESTADO_NODOS.propuestaActivaId = null;
            ESTADO_NODOS.catalogoEditandoId = null;
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
        const ingOpts = ESTADO_NODOS.fuentes.ingredientes_por_flujo.map(i => `<option value="${i.id}" data-flujo="${i.flujo}">[${FLUJO_META[i.flujo]?.corto || 'Flujo'}] ${escaparHtml(i.nombre)} (${fmtMoneda(i.costo_kg)}/kg)</option>`).join('');

        const { value: formValues } = await Swal.fire({
            title: '➕ Nueva Solicitud de Fracción de un Nodo',
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
                        <label>Producto / Receta de interés:</label>
                        <select id="swal-prop-ing" class="swal2-input" style="width:100%; margin:4px 0; background:#0f172a; color:#fff;">${ingOpts}</select>
                    </div>
                    <div>
                        <label>Nombre de la presentación familiar solicitada:</label>
                        <input id="swal-prop-nombre" class="swal2-input" placeholder="Ej: Castaña de Pará Pelada Familiar x 200g" style="width:100%; margin:4px 0; background:#0f172a; color:#fff;">
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                        <div>
                            <label>Peso Fracción (Kg, ej 0.20 = 200g):</label>
                            <input id="swal-prop-kilos" type="number" step="0.05" value="0.25" class="swal2-input" style="width:100%; margin:4px 0; background:#0f172a; color:#fff;">
                        </div>
                        <div>
                            <label>Precio Estimado al Vecino ($ opcional):</label>
                            <input id="swal-prop-target" type="number" step="100" value="6500" class="swal2-input" style="width:100%; margin:4px 0; background:#0f172a; color:#fff;">
                        </div>
                    </div>
                    <div>
                        <label>Comentario del Gestor:</label>
                        <input id="swal-prop-comentario" class="swal2-input" placeholder="Ej: Muy pedido en el grupo de WhatsApp del barrio" style="width:100%; margin:4px 0; background:#0f172a; color:#fff;">
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
                return {
                    nodo_solicitante_id: Number(document.getElementById('swal-prop-nodo').value),
                    ingrediente_sugerido_id: Number(ingSelect.value),
                    flujo_sugerido: Number(opt?.getAttribute('data-flujo') || 2),
                    nombre_sugerido: document.getElementById('swal-prop-nombre').value.trim(),
                    kilos_sugeridos: Number(document.getElementById('swal-prop-kilos').value || 0.25),
                    precio_objetivo_vecino: Number(document.getElementById('swal-prop-target').value || 0),
                    comentario_gestor: document.getElementById('swal-prop-comentario').value.trim()
                };
            }
        });

        if (formValues && formValues.nombre_sugerido) {
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

    function cargarNodoEnFormularioAbm(nodoId) {
        const nodo = ESTADO_NODOS.nodos.find(n => Number(n.id) === Number(nodoId));
        if (!nodo) return;
        ESTADO_NODOS.nodoEditandoId = Number(nodo.id);
        logoOriginalSubidoBase64 = nodo.logo_original_base64 || null;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val ?? '';
        };

        setVal('abm-nodo-id', nodo.id);
        setVal('abm-nombre-marca', nodo.nombre_marca);
        setVal('abm-slug', nodo.slug);
        setVal('abm-subtitulo', nodo.subtitulo_marca);
        setVal('abm-gestor-nombre', nodo.gestor_nombre);
        setVal('abm-gestor-tel', nodo.gestor_telefono);
        setVal('abm-barrio', nodo.barrio_zona);
        setVal('abm-direccion', nodo.direccion_retiro);
        if (nodo.cuenta_bancaria_id) setVal('abm-cuenta-bancaria', nodo.cuenta_bancaria_id);
        const chkComp = document.getElementById('abm-cuenta-compartida');
        if (chkComp) chkComp.checked = Boolean(nodo.usa_cuenta_compartida);
        setVal('abm-alias-display', nodo.alias_bancario_display);
        setVal('abm-cargo-envio', Number(nodo.cargo_envio_barrial || 0));
        setVal('abm-margen-default', Number(nodo.margen_gestor_default_pct || 28));

        const cfg = nodo.logo_zpl_config || {};
        setVal('abm-logo-iniciales', cfg.iniciales || '');
        setVal('abm-logo-mode', cfg.mode || 'threshold');
        setVal('abm-logo-threshold', cfg.threshold || 138);
        const thSpan = document.getElementById('abm-threshold-val');
        if (thSpan) thSpan.textContent = cfg.threshold || 138;

        const imgPrev = document.getElementById('abm-logo-preview-img');
        if (imgPrev && nodo.logo_mono_preview_base64) imgPrev.src = nodo.logo_mono_preview_base64;
        setVal('abm-logo-zpl-gfa', nodo.logo_zpl_gfa || '');

        simularEtiquetaZebra('estandar_pagado');
    }

    function nuevoNodoFormulario() {
        ESTADO_NODOS.nodoEditandoId = null;
        logoOriginalSubidoBase64 = null;
        const ids = ['abm-nodo-id', 'abm-nombre-marca', 'abm-slug', 'abm-gestor-nombre', 'abm-gestor-tel', 'abm-barrio', 'abm-direccion', 'abm-alias-display', 'abm-logo-iniciales'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const sub = document.getElementById('abm-subtitulo');
        if (sub) sub.value = 'Comunidad Barrial - Entrega Fresca';
        regenerarLogoZplEnVivo();
    }

    function subirArchivoLogo(event) {
        const file = event?.target?.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            logoOriginalSubidoBase64 = e.target.result;
            regenerarLogoZplEnVivo();
        };
        reader.readAsDataURL(file);
    }

    async function regenerarLogoZplEnVivo() {
        try {
            const nombreMarca = document.getElementById('abm-nombre-marca')?.value || 'NODO BARRIAL';
            const iniciales = document.getElementById('abm-logo-iniciales')?.value || '';
            const mode = document.getElementById('abm-logo-mode')?.value || 'threshold';
            const threshold = Number(document.getElementById('abm-logo-threshold')?.value || 138);

            const resp = await fetch('/api/produccion/nodos/convertir-logo-zpl', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageBase64: logoOriginalSubidoBase64,
                    nombreMarca,
                    iniciales,
                    mode,
                    threshold
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
            const nombreMarca = document.getElementById('abm-nombre-marca')?.value || 'ALMACEN VERDE CITY BELL';
            const subtitulo = document.getElementById('abm-subtitulo')?.value || 'Alimentacion Consciente - Entrega Barrial';
            const direccion = document.getElementById('abm-direccion')?.value || 'Cantilo 452 e/ 13c y 14 - City Bell';
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
                subtitulo_marca: subtitulo,
                logo_zpl_gfa: logoGfa,
                logo_mono_preview_base64: logoMono,
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
            const ctaSelect = document.getElementById('abm-cuenta-bancaria');
            const ctaOpt = ctaSelect?.selectedOptions?.[0];

            const payload = {
                nombre_marca: document.getElementById('abm-nombre-marca')?.value || '',
                slug: document.getElementById('abm-slug')?.value || '',
                subtitulo_marca: document.getElementById('abm-subtitulo')?.value || '',
                gestor_nombre: document.getElementById('abm-gestor-nombre')?.value || '',
                gestor_telefono: document.getElementById('abm-gestor-tel')?.value || '',
                barrio_zona: document.getElementById('abm-barrio')?.value || '',
                direccion_retiro: document.getElementById('abm-direccion')?.value || '',
                cuenta_bancaria_id: ctaSelect?.value ? Number(ctaSelect.value) : null,
                usa_cuenta_compartida: Boolean(document.getElementById('abm-cuenta-compartida')?.checked),
                alias_bancario_display: document.getElementById('abm-alias-display')?.value || ctaOpt?.getAttribute('data-alias') || '',
                cbu_display: ctaOpt?.getAttribute('data-cbu') || '',
                titular_display: ctaOpt?.getAttribute('data-titular') || '',
                cargo_envio_barrial: Number(document.getElementById('abm-cargo-envio')?.value || 0),
                margen_gestor_default_pct: Number(document.getElementById('abm-margen-default')?.value || 28),
                logo_original_base64: logoOriginalSubidoBase64,
                logo_zpl_config: {
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

            ESTADO_NODOS.nodoEditandoId = data.nodo.id;
            await cargarDatosNodosBarriales(true);
            cargarNodoEnFormularioAbm(data.nodo.id);

            if (window.Swal) {
                Swal.fire({
                    icon: 'success',
                    title: 'Nodo Barrial Guardado',
                    text: `${data.nodo.nombre_marca} actualizado correctamente.`,
                    timer: 2200,
                    showConfirmButton: false,
                    background: '#151e2e',
                    color: '#f8fafc'
                });
            }
        } catch (err) {
            if (window.Swal) {
                Swal.fire({ icon: 'error', title: 'Error', text: err.message, background: '#151e2e', color: '#f8fafc' });
            }
        }
    }

    // =========================================================================
    // API PÚBLICA EN WINDOW
    // =========================================================================
    window.NodosPizarra = {
        inicializar: cargarDatosNodosBarriales,
        cambiarSubTab: cambiarSubTabNodos,
        seleccionarFlujoMesa,
        alCambiarOrigenSelect,
        fijarGramajeRapido,
        recalcularEnVivo: recalcularMesaCotizacionEnVivo,
        cargarIngredienteDirectoEnMesa,
        cargarPropuestaEnMesa,
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
        subirArchivoLogo,
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
                        ESTADO_NODOS.ofertas_gestor = data.ofertas_gestor || [];
                        ESTADO_NODOS.fuentes = data.fuentes || ESTADO_NODOS.fuentes;
                        ESTADO_NODOS.inicializado = true;
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
