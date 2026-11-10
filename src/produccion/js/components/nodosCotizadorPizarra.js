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
        busquedaClienteAbm: '',
        clienteMadreSeleccionadoId: null,
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
            } else {
                regenerarLogoZplEnVivo();
            }
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
                                <h2 style="margin:0; font-size:1.08rem; color:#f8fafc; font-weight:700;">Nodos Barriales (Marca Blanca)</h2>
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
                    ${ESTADO_NODOS.subTabActiva === 'cotizador'
                        ? renderizarSubTabCotizador()
                        : ESTADO_NODOS.subTabActiva === 'catalogo'
                            ? renderizarSubTabCatalogo()
                            : renderizarSubTabAbmNodos()}
                </div>
            </div>
        `;

        if (ESTADO_NODOS.subTabActiva === 'cotizador') {
            if (!ESTADO_NODOS.propuestaActivaId && !ESTADO_NODOS.catalogoEditandoId) {
                alCambiarOrigenSelect();
            } else {
                recalcularMesaCotizacionEnVivo();
            }
        } else if (ESTADO_NODOS.subTabActiva === 'abm_nodos') {
            const nodoTarget = ESTADO_NODOS.nodoEditandoId
                ? ESTADO_NODOS.nodos.find(n => Number(n.id) === Number(ESTADO_NODOS.nodoEditandoId))
                : ESTADO_NODOS.nodos[0];
            if (nodoTarget && !ESTADO_NODOS.clienteMadreSeleccionadoId) {
                cargarNodoEnFormularioAbm(nodoTarget.id);
            } else if (!nodoTarget && !ESTADO_NODOS.clienteMadreSeleccionadoId) {
                regenerarLogoZplEnVivo();
            }
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

                    <!-- IDENTIDAD COMERCIAL DEL ARTÍCULO EN EL PADRÓN DE NODOS Y NOMENCLATURA BÚNKER -->
                    <div style="display:grid; grid-template-columns: 1.4fr 1.4fr; gap:10px; margin-bottom:10px;">
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#38bdf8; font-weight:700; margin-bottom:4px;">🏛️ Nomenclatura Posicional en Búnker (Familia Real LAMDA)</label>
                            <input type="text" id="cot-bunker-nomenclatura" placeholder="Ej: ALMENDRA Peladas NP 25-27 x 250g"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #0284c7; background:#0f172a; color:#bae6fd; font-weight:700; font-size:0.82rem;">
                        </div>
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#34d399; font-weight:700; margin-bottom:4px;">🏘️ Alias Amigable para Tienda del Vecino y Etiqueta</label>
                            <input type="text" id="cot-nombre-publico" placeholder="Ej: Almendra Nonpareil"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #10b981; background:#0f172a; color:#f8fafc; font-weight:700; font-size:0.83rem;">
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns: 0.9fr 1fr 1.3fr; gap:10px; margin-bottom:12px;">
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Código SKU (Búnker + Nodo)</label>
                            <input type="text" id="cot-sku-nodo" placeholder="Automático (ej: APN25/27X250G)"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#cbd5e1; font-family:monospace; font-size:0.82rem;">
                        </div>
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Categoría en Tienda Vecinal</label>
                            <input type="text" id="cot-categoria" value="Frutos Secos Puros"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.82rem;">
                        </div>
                        <div>
                            <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Disponibilidad en Listas del Búnker</label>
                            <select id="cot-compartido-mayorista"
                                style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#e2e8f0; font-size:0.8rem; font-weight:700;">
                                <option value="false">🏘️ Exclusivo Nodos Barriales (0/6 en Mayorista)</option>
                                <option value="true">🔄 Compartido: Nodos + Mayorista (Dietética y Cons. Final)</option>
                            </select>
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
        const costoEnvaseContenedor = Number(envaseOpt?.getAttribute('data-costo') || 45.96);
        const origenSelect = document.getElementById('cot-origen-select');
        const ingSelId = Number(origenSelect?.value || 0);
        const env181 = (ESTADO_NODOS.fuentes.envases || []).find(e => Number(e.id) === 181);
        const costoFlowpackUnit = Number(env181?.costo_unitario || 18.16);
        const packUnidades = ingSelId === 141 ? Math.max(1, Math.round(kilosUnidad / 0.05)) : 1;
        const costoEnvaseExtra = ingSelId === 141 ? (packUnidades * costoFlowpackUnit) : 0;
        const costoEnvaseUnitario = costoEnvaseContenedor + costoEnvaseExtra;
        const segundos = Math.max(0, Number(segEl.value) || 35);
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

        const precioSugeridoVecino = Math.ceil((precioBaseNodoFinal * (1 + margenGestorPct / 100)) / 50) * 50;
        const gananciaGestorUnitaria = Math.max(0, precioSugeridoVecino - precioBaseNodoFinal);

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
                    <div style="font-size:0.7rem; color:#94a3b8;">2. Envase + Armado (${segundos}s)</div>
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
    // SUB-PESTAÑA 2: CATÁLOGO CONECTADO AL BÚNKER Y MÁRGENES POR GESTOR
    // =========================================================================
    function renderizarSubTabCatalogo() {
        const q = ESTADO_NODOS.busquedaCatalogo;
        const fFlujo = Number(ESTADO_NODOS.filtroFlujoCatalogo || 0);
        const fNodo = Number(ESTADO_NODOS.filtroNodoOfertas || 0);
        const listaBunkerNodos = ESTADO_NODOS.fuentes.lista_bunker_nodos || { nombre_lista: 'Lista Base Nodos Barriales', canal_comercial: 'NODOS' };
        const politicasNodos = ESTADO_NODOS.fuentes.politicas_bunker_nodos || [];

        const filasCatalogo = ESTADO_NODOS.catalogo.filter(c => {
            if (fFlujo > 0 && Number(c.flujo_lamda) !== fFlujo) return false;
            const bolsa = `${c.sku_nodo} ${c.bunker_descripcion_generada || ''} ${c.bunker_familia_nombre || ''} ${c.nombre_publico} ${c.categoria_familiar} ${c.presentacion_etiqueta || ''} ${c.ingrediente_origen_nombre || ''} ${c.notas_tecnicas || ''} flujo ${c.flujo_lamda}`;
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
                                Sincronizada bidireccionalmente con <code>bunker_lista_articulos</code>, <code>bunker_lista_insumos</code> y <code>bunker_cliente_listas_precios</code>
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
                        <input type="text" placeholder="🔍 Buscar por nomenclatura Búnker, alias vecino, familia, código o peso..."
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
                                <th style="padding:10px;">Código / Flujo / Canal</th>
                                <th style="padding:10px;">Nomenclatura Búnker y Alias Vecino</th>
                                <th style="padding:10px;">Insumo Base</th>
                                <th style="padding:10px;">Costo Total</th>
                                <th style="padding:10px;">Margen LAMDA</th>
                                <th style="padding:10px; color:#34d399;">Precio Lista Base Nodo</th>
                                <th style="padding:10px; color:#38bdf8;">Márgenes y Precio al Vecino por Nodo</th>
                                <th style="padding:10px; text-align:right;">Acción</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filasCatalogo.map(cat => {
                                const meta = FLUJO_META[cat.flujo_lamda] || FLUJO_META[2];
                                const esCompartido = Boolean(cat.compartido_mayorista);
                                const ofertasItem = ESTADO_NODOS.ofertas_gestor.filter(o =>
                                    Number(o.articulo_catalogo_id) === Number(cat.id) &&
                                    (fNodo === 0 || Number(o.nodo_id) === fNodo)
                                );

                                return `
                                    <tr style="border-bottom:1px solid #1e293b;">
                                        <td style="padding:10px; vertical-align:top;">
                                            <div style="font-family:monospace; font-weight:800; color:#f8fafc;">${escaparHtml(cat.sku_nodo)}</div>
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
                                                    🌳 ${escaparHtml(cat.bunker_familia_nombre || 'Frutos Secos')}
                                                </span>
                                                <strong style="color:#f8fafc; font-size:0.86rem;">${escaparHtml(cat.bunker_descripcion_generada || cat.nombre_publico)}</strong>
                                            </div>
                                            <div style="font-size:0.76rem; color:#6ee7b7; margin-top:4px; font-weight:700;">
                                                🏘️ Alias Vecino: "${escaparHtml(cat.nombre_publico)}" · <span style="color:#cbd5e1;">${escaparHtml(cat.presentacion_etiqueta || `${Math.round(Number(cat.kilos_unidad) * 1000)}g`)}</span>
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
                                            <div style="font-size:0.71rem; color:#94a3b8;">IVA ${Number(cat.iva_pct)}% · Ret. IIBB ${Number(cat.iibb_pct)}%</div>
                                        </td>
                                        <td style="padding:10px; vertical-align:top;">
                                            <div style="font-size:1.05rem; font-weight:900; color:#34d399;">${fmtMoneda(cat.precio_base_nodo_final)}</div>
                                            <div style="font-size:0.7rem; color:#94a3b8;">S/IVA: ${fmtMoneda(cat.precio_base_nodo_neto, 0)}</div>
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
        return `
            <div style="padding:8px 12px; border-radius:7px; background:rgba(16,185,129,0.14); border:1px solid rgba(16,185,129,0.45); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <div style="font-size:0.78rem; color:#ecfdf5;">
                    ✅ <strong>Cliente Titular Vinculado:</strong>
                    <code style="color:#6ee7b7; font-weight:800;">${escaparHtml(cli.codigo_bunker_cliente)}</code>
                    ${cli.lomas_soft_id ? `<span style="color:#94a3b8;">(Lomas #${escaparHtml(cli.lomas_soft_id)})</span>` : ''}
                    — <strong>${escaparHtml(cli.razon_social || cli.cliente_nombre)}</strong>
                    <span style="margin-left:6px; color:#6ee7b7; font-weight:700;">(${saldoTxt})</span>
                </div>
                <div style="font-size:0.71rem; color:#a7f3d0;">
                    Subcuenta operativa aislada <code>CB-NODO-xxx</code> + liquidación neta en <code>${escaparHtml(cli.codigo_bunker_cliente)}</code>
                </div>
            </div>
        `;
    }

    function renderizarSubTabAbmNodos() {
        const cfgCanal = ESTADO_NODOS.fuentes.config_cuenta_canal || {
            alias_recaudador: 'pago.canasto',
            banco_recaudador: 'Cuenta Recaudadora Canal Nodos (Provisoria)',
            titular_recaudador: 'Recaudación Canal Nodos (Provisorio)',
            cbu_recaudador: '0000000000000000000000'
        };
        const aliasCompartido = cfgCanal.alias_recaudador || 'pago.canasto';

        return `
            <div style="display:grid; grid-template-columns: 34% 65%; gap:16px; align-items:start;">
                <!-- COLUMNA IZQUIERDA: LISTADO DE NODOS BARRIALES ACTIVOS -->
                <div class="card" style="padding:14px; background:#151e2e; border:1px solid #2e3c51; border-radius:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; gap:6px; flex-wrap:wrap;">
                        <div>
                            <div style="font-weight:700; font-size:0.95rem; color:#f8fafc;">🏘️ Nodos Barriales Activos</div>
                            <div style="font-size:0.74rem; color:#94a3b8;">Seleccione un Nodo para editarlo o dé de alta uno nuevo</div>
                        </div>
                        <button onclick="window.NodosPizarra.nuevoNodoFormulario()"
                            style="padding:6px 11px; border-radius:7px; font-size:0.76rem; font-weight:700; border:1px solid #10b981; background:rgba(16,185,129,0.2); color:#6ee7b7; cursor:pointer;">
                            ➕ Nuevo Nodo
                        </button>
                    </div>

                    <div style="display:flex; flex-direction:column; gap:10px;">
                        ${ESTADO_NODOS.nodos.length === 0 ? `
                            <div style="padding:16px; border-radius:10px; background:rgba(15,23,42,0.7); border:1px dashed #475569; color:#cbd5e1; font-size:0.8rem; line-height:1.5;">
                                <div style="font-weight:800; color:#38bdf8; margin-bottom:4px;">📋 Sin Nodos dados de alta actualmente</div>
                                Para crear un Nodo, busque y seleccione primero al <strong>Cliente Titular en el Padrón de LAMDA</strong> en el paso <code>1️⃣</code> de la derecha. Sus datos de contacto y domicilio se precargarán automáticamente para que solo complete el nombre comercial del Nodo y guarde.
                            </div>
                        ` : ''}
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
                                            👤 Gestor: <strong>${escaparHtml(n.gestor_nombre)}</strong> · 📍 ${escaparHtml(n.barrio_zona || n.direccion_retiro || '')}
                                        </div>
                                        <div style="font-size:0.72rem; color:#94a3b8; margin-top:3px; display:flex; gap:10px; flex-wrap:wrap;">
                                            <span>📒 Subcuenta <code>${escaparHtml(n.codigo_bunker_cliente || 'CB-NODO')}</code>: <strong style="color:#34d399;">${fmtMoneda(n.saldo_cuenta_corriente)}</strong></span>
                                            <span>🏦 Alias: <strong style="color:#38bdf8;">${escaparHtml(n.alias_bancario_display || 'pago.canasto')}</strong></span>
                                            <span>🛵 Envío: <strong>${fmtMoneda(n.cargo_envio_barrial)}</strong></span>
                                        </div>
                                        ${n.codigo_bunker_cliente_madre ? `
                                            <div style="font-size:0.71rem; color:#6ee7b7; margin-top:4px; padding:3px 7px; border-radius:5px; background:rgba(16,185,129,0.14); border:1px solid rgba(16,185,129,0.35); display:inline-block;">
                                                🔗 Cliente Titular LAMDA: <strong>${escaparHtml(n.codigo_bunker_cliente_madre)}</strong> (${escaparHtml(n.cliente_madre_razon_social || n.cliente_madre_nombre || '')}) · Saldo CC: <strong>${fmtMoneda(n.saldo_cuenta_corriente_madre)}</strong>
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                                <div style="display:flex; justify-content:flex-end; gap:6px; padding-top:6px; border-top:1px solid rgba(51,65,85,0.6); flex-wrap:wrap;" onclick="event.stopPropagation();">
                                    <button type="button" onclick="window.NodosPizarra.enviarLinksBienvenidaNodoWa(${n.id})"
                                        style="padding:4px 9px; border-radius:6px; font-size:0.71rem; font-weight:700; background:rgba(16,185,129,0.2); border:1px solid #10b981; color:#6ee7b7; cursor:pointer;">
                                        📲 Enviar Links por WA
                                    </button>
                                    <a href="/gestor/${escaparHtml(n.slug)}" target="_blank"
                                        style="text-decoration:none; padding:4px 9px; border-radius:6px; font-size:0.71rem; font-weight:700; background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.4); color:#bae6fd;">
                                        🎛️ App Gestor ↗
                                    </a>
                                    <a href="/tienda/${escaparHtml(n.slug)}" target="_blank"
                                        style="text-decoration:none; padding:4px 9px; border-radius:6px; font-size:0.71rem; font-weight:700; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.4); color:#6ee7b7;">
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
                                    🏷️ Alta y Configuración del Nodo Barrial
                                </div>
                                <div style="font-size:0.75rem; color:#94a3b8;">
                                    Todo Nodo parte de un Cliente Titular en LAMDA y opera sus canastos con una subcuenta aislada (<code>CB-NODO-xxx</code>).
                                </div>
                            </div>
                            <button type="button" onclick="window.NodosPizarra.guardarNodoAbm()"
                                style="padding:8px 16px; border-radius:8px; font-weight:800; font-size:0.82rem; border:none; background:linear-gradient(135deg, #10b981, #059669); color:#052e16; cursor:pointer;">
                                💾 Guardar Nodo y Etiqueta ZPL
                            </button>
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
                        </div>

                        <!-- PASO 2: DATOS DE CONTACTO, PUNTO DE RETIRO Y HERRAMIENTA GOOGLE MAPS -->
                        <div style="margin-bottom:12px; padding:11px 12px; border-radius:9px; background:rgba(15,23,42,0.65); border:1px solid #263244;">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
                                <div style="font-size:0.75rem; color:#cbd5e1; font-weight:800;">
                                    2️⃣ Datos de Contacto y Punto de Retiro del Nodo <span style="font-weight:500; color:#94a3b8;">(precargados del Cliente y ajustables con Google Maps)</span>
                                </div>
                                <button type="button" onclick="window.NodosPizarra.togglePanelMapaAbm()"
                                    style="padding:4px 10px; border-radius:6px; font-size:0.73rem; font-weight:800; background:rgba(56,189,248,0.16); border:1px solid #38bdf8; color:#bae6fd; cursor:pointer;">
                                    🗺️ Ver / Ubicar en Google Maps
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
                                <div>
                                    <label style="display:block; font-size:0.72rem; color:#cbd5e1; margin-bottom:3px;">Domicilio del Nodo (Texto Impreso / Vecinos)</label>
                                    <input type="text" id="abm-direccion" placeholder="Calle y número de retiro"
                                        oninput="window.NodosPizarra.simularEtiquetaZebra('estandar_pagado')"
                                        style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; box-sizing:border-box;">
                                </div>
                            </div>

                            <!-- OPCIONES DE DOMICILIOS DEL CLIENTE -->
                            <div id="abm-domicilios-sugeridos" style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:8px;"></div>

                            <!-- PANEL DESPLEGABLE INTERACTIVO GOOGLE MAPS -->
                            <div id="abm-mapa-panel" style="display:none; margin-top:10px; padding:10px; border-radius:9px; background:#0b1120; border:1px solid rgba(56,189,248,0.45);">
                                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px;">
                                    <input type="text" id="abm-mapa-search-input"
                                        onkeydown="if(event.key==='Enter'){event.preventDefault(); window.NodosPizarra.buscarDireccionEnMapaAbm();}"
                                        placeholder="🔎 Buscar otra dirección, esquina o localidad en Google Maps (ej: Calle 70 y 182 bis, La Plata)..."
                                        style="flex:1; min-width:220px; padding:6px 10px; border-radius:6px; border:1px solid #334155; background:#151e2e; color:#f8fafc; font-size:0.78rem;">
                                    <button type="button" onclick="window.NodosPizarra.buscarDireccionEnMapaAbm()"
                                        style="padding:6px 12px; border-radius:6px; font-size:0.75rem; font-weight:800; background:#0284c7; border:none; color:#fff; cursor:pointer;">
                                        🔍 Buscar en Mapa
                                    </button>
                                    <button type="button" onclick="window.NodosPizarra.ubicarTextoDomicilioActualEnMapaAbm()"
                                        style="padding:6px 11px; border-radius:6px; font-size:0.74rem; font-weight:700; background:rgba(16,185,129,0.18); border:1px solid #10b981; color:#6ee7b7; cursor:pointer;">
                                        📍 Ubicar Domicilio Escrito
                                    </button>
                                </div>

                                <div id="abm-google-map-canvas" style="width:100%; height:265px; border-radius:8px; border:1px solid #334155; background:#0f172a; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:0.8rem;">
                                    ⏳ Inicializando Google Maps...
                                </div>

                                <div id="abm-mapa-info-bar" style="margin-top:8px; padding:8px 10px; border-radius:7px; background:#151e2e; border:1px solid #2e3c51; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; font-size:0.75rem; color:#cbd5e1;">
                                    <div>
                                        🗺️ Haga clic en cualquiera de los domicilios del cliente arriba, busque una calle o haga clic / arrastre el pin rojo sobre el mapa para detectar el <strong>Barrio / Localidad</strong>.
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- PASO 3: IDENTIDAD DE MARCA BLANCA Y CONDICIONES DEL NODO -->
                        <div style="font-size:0.75rem; color:#cbd5e1; font-weight:800; margin-bottom:6px;">
                            3️⃣ Identidad de la Tienda Vecinal (Marca Blanca) y Condiciones Operativas
                        </div>
                        <div style="display:grid; grid-template-columns: 1.3fr 1fr 1fr; gap:10px; margin-bottom:10px;">
                            <div>
                                <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:3px;">Nombre de la Marca del Nodo</label>
                                <input type="text" id="abm-nombre-marca" placeholder="Nombre comercial de la tienda barrial"
                                    oninput="window.NodosPizarra.alEditarNombreMarcaAbm(this.value)"
                                    style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-weight:700; box-sizing:border-box;">
                            </div>
                            <div>
                                <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:3px;">Dirección Web de la Tienda (Link corto)</label>
                                <input type="text" id="abm-slug" placeholder="identificador-web-del-nodo"
                                    oninput="this.dataset.manual='true'"
                                    style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#38bdf8; font-family:monospace; box-sizing:border-box;">
                            </div>
                            <div>
                                <label style="display:block; font-size:0.73rem; color:#cbd5e1; margin-bottom:3px;">Bajada / Subtítulo de Marca</label>
                                <input type="text" id="abm-subtitulo" value="Alimentos Naturales y Frutos Secos - Entrega Barrial"
                                    oninput="window.NodosPizarra.simularEtiquetaZebra('estandar_pagado')"
                                    style="width:100%; padding:7px 9px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; box-sizing:border-box;">
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
        ESTADO_NODOS.propuestaActivaId = null;
        ESTADO_NODOS.catalogoEditandoId = null;
        renderizarVistaNodosCompleta();
    }

    function derivarDesdeHermanoNativoFrontend(ingId, nombreBase, kilos, flujo) {
        const ing = (ESTADO_NODOS.fuentes.ingredientes_por_flujo || []).find(i => Number(i.id) === Number(ingId));
        const k = Math.max(0.001, Number(kilos) || 0.25);
        const gramos = Math.round(k * 1000);
        const etiquetaPeso = k >= 1
            ? `${k.toFixed(k % 1 === 0 ? 0 : 2)}kg`
            : `${gramos}g`;

        if (ing && (ing.hermano_sku_base || ing.hermano_descripcion_generada)) {
            let skuBase = String(ing.hermano_sku_base || '').trim();
            let descBase = String(ing.hermano_descripcion_generada || '').trim();

            if (Number(ing.id) === 141) {
                const packU = Math.max(1, Math.round(k / 0.05));
                skuBase = skuBase.replace(/\d+X50/i, `${packU}X50`);
                descBase = descBase.replace(/\b\d+\s*x\s*50g/i, `${packU} x 50g`);
                return { sku: skuBase, nomenclatura: descBase };
            }

            if (skuBase) {
                if (/X\d+G$/i.test(skuBase)) {
                    skuBase = skuBase.replace(/X\d+G$/i, k >= 1 ? `X${Math.round(k)}` : `X${gramos}G`);
                } else if (/x\d+$/i.test(skuBase)) {
                    skuBase = skuBase.replace(/x\d+$/i, k >= 1 ? `x${Math.round(k)}` : `x${gramos}`);
                }
            }
            if (descBase) {
                descBase = descBase.replace(/x\s*\d+(?:[.,]\d+)?\s*(?:kg|g|gr)$/i, `x ${etiquetaPeso}`);
            }
            return { sku: skuBase, nomenclatura: descBase };
        }

        const txt = String(nombreBase || '').replace(/\s*\(Simple\)\s*/i, '').trim();
        return {
            sku: '',
            nomenclatura: `${txt.replace(/\s+x\s+\d+.*$/i, '').trim()} x ${etiquetaPeso}`
        };
    }

    function sugerirNomenclaturaPosicionalFrontend(nombreBase, kilos, flujo, ingId) {
        const selectEl = document.getElementById('cot-origen-select');
        const idTarget = ingId || (selectEl && !String(selectEl.value).startsWith('ART:') ? Number(selectEl.value) : null);
        const res = derivarDesdeHermanoNativoFrontend(idTarget, nombreBase, kilos, flujo);
        const skuEl = document.getElementById('cot-sku-nodo');
        if (skuEl && res.sku && (!ESTADO_NODOS.catalogoEditandoId || /^NB-/i.test(skuEl.value))) {
            skuEl.value = res.sku;
        }
        return res.nomenclatura;
    }

    function alCambiarOrigenSelect() {
        const selectEl = document.getElementById('cot-origen-select');
        const costoEl = document.getElementById('cot-costo-kg');
        const nombreEl = document.getElementById('cot-nombre-publico');
        const bunkerNomEl = document.getElementById('cot-bunker-nomenclatura');
        const kilosEl = document.getElementById('cot-kilos-unidad');
        if (!selectEl || !costoEl) return;

        const opt = selectEl.selectedOptions?.[0];
        if (opt) {
            const costo = Number(opt.getAttribute('data-costo') || 0);
            const nombreBase = opt.getAttribute('data-nombre') || '';
            const kilos = Number(kilosEl?.value) || 0.25;
            const ingId = !String(selectEl.value).startsWith('ART:') ? Number(selectEl.value) : null;
            costoEl.value = costo.toFixed(2);
            if (nombreEl && (!nombreEl.value.trim() || !ESTADO_NODOS.propuestaActivaId)) {
                nombreEl.value = nombreBase.replace(/\s*\((Mix|Simple)\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
            }
            if (bunkerNomEl && (!bunkerNomEl.value.trim() || !ESTADO_NODOS.catalogoEditandoId)) {
                bunkerNomEl.value = sugerirNomenclaturaPosicionalFrontend(nombreBase, kilos, ESTADO_NODOS.flujoSeleccionadoMesa, ingId);
            }
        }
        recalcularMesaCotizacionEnVivo();
    }

    function fijarGramajeRapido(kilos) {
        const kilosEl = document.getElementById('cot-kilos-unidad');
        const nombreEl = document.getElementById('cot-nombre-publico');
        const bunkerNomEl = document.getElementById('cot-bunker-nomenclatura');
        if (kilosEl) {
            kilosEl.value = Number(kilos).toFixed(2);
        }
        const etiquetaGramos = kilos >= 1 ? `${kilos}kg` : `${Math.round(kilos * 1000)}g`;
        if (nombreEl && nombreEl.value) {
            nombreEl.value = nombreEl.value.replace(/\s*x\s*\d+(\.\d+)?\s*(g|gr|kg)/i, '').trim();
        }
        if (bunkerNomEl && bunkerNomEl.value) {
            if (/x\s*\d+(\.\d+)?\s*(g|gr|kg)/i.test(bunkerNomEl.value)) {
                bunkerNomEl.value = bunkerNomEl.value.replace(/x\s*\d+(\.\d+)?\s*(g|gr|kg)/i, `x ${etiquetaGramos}`);
            } else {
                bunkerNomEl.value = `${bunkerNomEl.value.trim()} x ${etiquetaGramos}`;
            }
        }
        recalcularMesaCotizacionEnVivo();
    }

    function cargarIngredienteDirectoEnMesa(ingId) {
        const item = ESTADO_NODOS.fuentes.ingredientes_por_flujo.find(i => Number(i.id) === Number(ingId));
        if (!item) return;

        ESTADO_NODOS.subTabActiva = 'cotizador';
        ESTADO_NODOS.propuestaActivaId = null;
        ESTADO_NODOS.catalogoEditandoId = null;
        ESTADO_NODOS.flujoSeleccionadoMesa = Number(item.flujo || 2);
        renderizarVistaNodosCompleta();

        const selectEl = document.getElementById('cot-origen-select');
        const costoEl = document.getElementById('cot-costo-kg');
        const nombreEl = document.getElementById('cot-nombre-publico');
        const bunkerNomEl = document.getElementById('cot-bunker-nomenclatura');
        const kilosEl = document.getElementById('cot-kilos-unidad');

        if (selectEl) selectEl.value = String(item.id);
        const costoVivo = obtenerCostoVivoIngredientePizarra(item.id, item.costo_kg);
        if (costoEl) costoEl.value = costoVivo.toFixed(2);
        const kilos = Number(kilosEl?.value) || 0.25;
        if (nombreEl) nombreEl.value = item.nombre.replace(/\s*\(Mix\)\s*/i, ' ').replace(/\s+/g, ' ').trim();
        if (bunkerNomEl) bunkerNomEl.value = sugerirNomenclaturaPosicionalFrontend(item.nombre, kilos, item.flujo);
        recalcularMesaCotizacionEnVivo();
    }

    function cargarPropuestaEnMesa(propuestaId) {
        const prop = ESTADO_NODOS.propuestas.find(p => Number(p.id) === Number(propuestaId));
        if (!prop) return;

        ESTADO_NODOS.subTabActiva = 'cotizador';
        ESTADO_NODOS.propuestaActivaId = Number(prop.id);
        ESTADO_NODOS.catalogoEditandoId = prop.articulo_catalogo_id ? Number(prop.articulo_catalogo_id) : null;
        ESTADO_NODOS.flujoSeleccionadoMesa = Number(prop.flujo_sugerido || 2);

        renderizarVistaNodosCompleta();

        const selectEl = document.getElementById('cot-origen-select');
        const costoEl = document.getElementById('cot-costo-kg');
        const kilosEl = document.getElementById('cot-kilos-unidad');
        const nombreEl = document.getElementById('cot-nombre-publico');
        const bunkerNomEl = document.getElementById('cot-bunker-nomenclatura');
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

        const kilosSug = Number(prop.kilos_sugeridos || 0.25);
        if (costoEl) costoEl.value = costoVivo.toFixed(2);
        if (kilosEl) kilosEl.value = kilosSug.toFixed(2);
        if (nombreEl) nombreEl.value = (prop.nombre_sugerido || '').replace(/\s*x\s*\d+(\.\d+)?\s*(g|gr|kg)/i, '').trim();
        if (bunkerNomEl) bunkerNomEl.value = sugerirNomenclaturaPosicionalFrontend(prop.ingrediente_sugerido_nombre || prop.nombre_sugerido, kilosSug, prop.flujo_sugerido);
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
        const bunkerNomEl = document.getElementById('cot-bunker-nomenclatura');
        const compMayEl = document.getElementById('cot-compartido-mayorista');
        const skuEl = document.getElementById('cot-sku-nodo');
        const catEl = document.getElementById('cot-categoria');
        const envEl = document.getElementById('cot-envase-select');
        const segEl = document.getElementById('cot-segundos-mo');
        const margenL = document.getElementById('cot-margen-lamda');
        const iibbEl = document.getElementById('cot-iibb-pct');
        const margenG = document.getElementById('cot-margen-gestor');
        const notasEl = document.getElementById('cot-notas-tecnicas');

        if (cat.ingrediente_origen_id && selectEl) selectEl.value = String(cat.ingrediente_origen_id);
        if (costoEl) costoEl.value = Number(cat.costo_insumo_kg_vivo || cat.costo_insumo_kg).toFixed(2);
        if (kilosEl) kilosEl.value = Number(cat.kilos_unidad).toFixed(2);
        if (nombreEl) nombreEl.value = cat.nombre_publico;
        if (bunkerNomEl) bunkerNomEl.value = cat.bunker_descripcion_generada || sugerirNomenclaturaPosicionalFrontend(cat.nombre_publico, cat.kilos_unidad, cat.flujo_lamda);
        if (compMayEl) compMayEl.value = Boolean(cat.compartido_mayorista) ? 'true' : 'false';
        if (skuEl) skuEl.value = cat.sku_nodo;
        if (catEl) catEl.value = cat.categoria_familiar || 'Frutos Secos';
        if (envEl && cat.insumo_envase_id) envEl.value = String(cat.insumo_envase_id);
        if (segEl) segEl.value = Number(cat.segundos_fraccionamiento || 35);
        if (margenL) margenL.value = Number(cat.margen_lamda_pct || 22);
        if (iibbEl) iibbEl.value = Number(cat.iibb_pct || 4);
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
                bunker_descripcion_generada: document.getElementById('cot-bunker-nomenclatura')?.value || '',
                compartido_mayorista: document.getElementById('cot-compartido-mayorista')?.value === 'true',
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
                iibb_pct: Number(document.getElementById('cot-iibb-pct')?.value || 4),
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
                    title: 'Artículo Sincronizado con Búnker y Nodos',
                    html: `
                        <div style="text-align:left; font-size:0.88rem; line-height:1.5;">
                            <p>🏛️ <strong>Nomenclatura Búnker (${escaparHtml(data.articulo.bunker_familia_nombre || 'Familia')}):</strong><br>
                            <code style="color:#38bdf8;">${escaparHtml(data.articulo.bunker_descripcion_generada || data.articulo.nombre_publico)}</code> (<code>${escaparHtml(data.articulo.sku_nodo)}</code>)</p>
                            <p>🏘️ <strong>Alias Tienda Vecinal:</strong> ${escaparHtml(data.articulo.nombre_publico)} (${escaparHtml(data.articulo.presentacion_etiqueta)})</p>
                            <p>✅ <strong>Precio Lista Base Nodos:</strong> ${fmtMoneda(data.calculo.precio_base_nodo_final)}</p>
                            <p>🛒 <strong>Precio Sugerido al Vecino:</strong> ${fmtMoneda(data.calculo.precio_sugerido_vecino)}</p>
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
    let abmGoogleMapInstance = null;
    let abmGoogleMarkerMain = null;
    let abmGoogleMarkersSecundarios = [];
    let abmGoogleGeocoder = null;
    let abmUltimaSugerenciaMapa = { barrio: '', calle: '', lat: null, lng: null };

    async function asegurarGoogleMapsSdkAbm() {
        if (window.google && window.google.maps) return true;
        const apiKey = ESTADO_NODOS.fuentes?.google_maps_api_key || '';
        if (!apiKey) {
            console.warn('[NODOS-MAPA] google_maps_api_key no disponible en fuentes');
            return false;
        }
        if (window.__cargandoGoogleMapsAbmPromise) {
            return window.__cargandoGoogleMapsAbmPromise;
        }
        window.__cargandoGoogleMapsAbmPromise = new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=es&region=AR`;
            script.async = true;
            script.defer = true;
            script.onload = () => resolve(true);
            script.onerror = () => resolve(false);
            document.head.appendChild(script);
        });
        return window.__cargandoGoogleMapsAbmPromise;
    }

    function normalizarDireccionParaGeocoder(rawDir) {
        let txt = String(rawDir || '').trim();
        if (!txt) return '';
        // Convertir expresiones típicas platenses ("70 ESQ 182 BIS 4374" o "72 (e/ Esq 182 bis)") a formato claro para Google Geocoder
        txt = txt
            .replace(/\(\s*e\/\s*esq\.?\s*([^)]+)\)/gi, 'y Calle $1')
            .replace(/\besq\.?\b/gi, 'y Calle')
            .replace(/^(\d+)\b/, 'Calle $1');
        if (!/la plata|city bell|gonnet|villa elisa|olmos|los hornos|tolosa|berisso|ensenada|buenos aires/i.test(txt)) {
            txt += ', La Plata, Provincia de Buenos Aires, Argentina';
        } else if (!/argentina/i.test(txt)) {
            txt += ', Argentina';
        }
        return txt;
    }

    function extraerBarrioYLocalidadDeComponentesGoogle(components = []) {
        const buscar = (tipos) => {
            const comp = components.find(c => Array.isArray(c.types) && tipos.some(t => c.types.includes(t)));
            return comp ? comp.long_name : '';
        };
        const barrio = buscar(['sublocality_level_1', 'sublocality', 'neighborhood']);
        const localidad = buscar(['locality', 'administrative_area_level_3']);
        const partido = buscar(['administrative_area_level_2']);

        const partes = [];
        if (barrio) partes.push(barrio);
        if (localidad && !partes.some(p => p.toLowerCase() === localidad.toLowerCase())) {
            partes.push(localidad);
        } else if (!localidad && partido && !partes.some(p => p.toLowerCase() === partido.toLowerCase())) {
            partes.push(partido);
        }

        const calle = buscar(['route']);
        const altura = buscar(['street_number']);
        const calleFormateada = [calle, altura].filter(Boolean).join(' ').trim();

        return {
            barrioLocalidad: partes.join(', ') || localidad || partido || '',
            calleFormateada
        };
    }

    function actualizarBarraInfoMapaAbm({ barrio, calle, direccionFormateada, lat, lng, etiquetaOrigen }) {
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

        bar.innerHTML = `
            <div style="flex:1; min-width:240px; line-height:1.45;">
                ${etiquetaOrigen ? `<span style="font-size:0.7rem; font-weight:800; color:#a78bfa; background:rgba(167,139,250,0.16); padding:1px 6px; border-radius:4px; margin-right:6px;">${escaparHtml(etiquetaOrigen)}</span>` : ''}
                <span style="color:#94a3b8;">Barrio / Localidad en Mapa:</span>
                <strong style="color:#38bdf8; font-size:0.82rem;">${escaparHtml(barrio || 'Sin especificar')}</strong>
                <span style="color:#64748b; margin:0 6px;">|</span>
                <span style="color:#94a3b8;">Ref. Google:</span>
                <span style="color:#e2e8f0;">${escaparHtml(direccionFormateada || calle || '-')}</span>
                <span style="color:#64748b; font-family:monospace; font-size:0.7rem; margin-left:6px;">(📍 ${coordTxt})</span>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                ${barrio ? `
                    <button type="button" onclick="window.NodosPizarra.aplicarBarrioSugeridoMapaAbm()"
                        style="padding:4px 9px; border-radius:6px; font-size:0.72rem; font-weight:800; background:rgba(56,189,248,0.18); border:1px solid #38bdf8; color:#bae6fd; cursor:pointer;">
                        ✅ Usar Barrio "${escaparHtml(barrio)}"
                    </button>
                ` : ''}
                ${(calle || direccionFormateada) ? `
                    <button type="button" onclick="window.NodosPizarra.aplicarCalleSugeridaMapaAbm()"
                        style="padding:4px 9px; border-radius:6px; font-size:0.72rem; font-weight:700; background:rgba(16,185,129,0.16); border:1px solid #10b981; color:#6ee7b7; cursor:pointer;">
                        📝 Usar calle del mapa en Domicilio
                    </button>
                ` : ''}
            </div>
        `;
    }

    async function resolverBarrioDesdeCoordenadasAbm(lat, lng, opciones = {}) {
        const okSdk = await asegurarGoogleMapsSdkAbm();
        if (!okSdk || !window.google?.maps) return null;
        if (!abmGoogleGeocoder) abmGoogleGeocoder = new window.google.maps.Geocoder();

        return new Promise((resolve) => {
            abmGoogleGeocoder.geocode({ location: { lat: Number(lat), lng: Number(lng) } }, (results, status) => {
                if (status === 'OK' && Array.isArray(results) && results.length > 0) {
                    // Combinar componentes de los primeros resultados para no perder sublocality/neighborhood
                    const todosComponentes = [];
                    results.slice(0, 3).forEach(r => {
                        if (Array.isArray(r.address_components)) {
                            todosComponentes.push(...r.address_components);
                        }
                    });
                    const extraido = extraerBarrioYLocalidadDeComponentesGoogle(todosComponentes);
                    const dirFmt = results[0].formatted_address || '';

                    actualizarBarraInfoMapaAbm({
                        barrio: extraido.barrioLocalidad,
                        calle: extraido.calleFormateada || dirFmt.split(',')[0],
                        direccionFormateada: dirFmt,
                        lat,
                        lng,
                        etiquetaOrigen: opciones.etiquetaOrigen || ''
                    });

                    // Si el campo Barrio / Localidad está vacío o se pidió autocompletar, completarlo
                    const barrioInput = document.getElementById('abm-barrio');
                    if (barrioInput && extraido.barrioLocalidad && (opciones.autocompletarBarrio || !barrioInput.value.trim())) {
                        barrioInput.value = extraido.barrioLocalidad;
                    }
                    resolve({ ...extraido, formatted_address: dirFmt });
                } else {
                    actualizarBarraInfoMapaAbm({
                        barrio: '',
                        calle: '',
                        direccionFormateada: 'Coordenadas seleccionadas',
                        lat,
                        lng,
                        etiquetaOrigen: opciones.etiquetaOrigen || ''
                    });
                    resolve(null);
                }
            });
        });
    }

    async function asegurarInstanciaMapaAbm(latInicial = -34.9214, lngInicial = -57.9545) {
        const canvas = document.getElementById('abm-google-map-canvas');
        if (!canvas) return null;

        const okSdk = await asegurarGoogleMapsSdkAbm();
        if (!okSdk || !window.google?.maps) {
            canvas.innerHTML = '<div style="padding:14px; text-align:center; color:#f87171;">⚠️ No se pudo cargar Google Maps SDK. Verifique la conexión o GOOGLE_MAPS_API_KEY.</div>';
            return null;
        }

        const center = {
            lat: Number.isFinite(Number(latInicial)) && Number(latInicial) !== 0 ? Number(latInicial) : -34.9214,
            lng: Number.isFinite(Number(lngInicial)) && Number(lngInicial) !== 0 ? Number(lngInicial) : -57.9545
        };

        if (!abmGoogleMapInstance || abmGoogleMapInstance.getDiv() !== canvas) {
            canvas.innerHTML = '';
            abmGoogleMapInstance = new window.google.maps.Map(canvas, {
                center,
                zoom: 15,
                mapTypeControl: true,
                streetViewControl: false,
                fullscreenControl: true
            });

            abmGoogleMarkerMain = new window.google.maps.Marker({
                position: center,
                map: abmGoogleMapInstance,
                draggable: true,
                title: 'Punto de Retiro del Nodo (arrastre para ajustar)'
            });

            abmGoogleMarkerMain.addListener('dragend', () => {
                const pos = abmGoogleMarkerMain.getPosition();
                if (pos) {
                    resolverBarrioDesdeCoordenadasAbm(pos.lat(), pos.lng(), {
                        autocompletarBarrio: true,
                        etiquetaOrigen: 'Pin ajustado manualmente'
                    });
                }
            });

            abmGoogleMapInstance.addListener('click', (e) => {
                if (e.latLng && abmGoogleMarkerMain) {
                    abmGoogleMarkerMain.setPosition(e.latLng);
                    resolverBarrioDesdeCoordenadasAbm(e.latLng.lat(), e.latLng.lng(), {
                        autocompletarBarrio: true,
                        etiquetaOrigen: 'Punto marcado en el mapa'
                    });
                }
            });
        } else {
            abmGoogleMapInstance.setCenter(center);
            if (abmGoogleMarkerMain) abmGoogleMarkerMain.setPosition(center);
        }

        return abmGoogleMapInstance;
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
            await asegurarInstanciaMapaAbm(dom.latitud, dom.longitud);
            await resolverBarrioDesdeCoordenadasAbm(dom.latitud, dom.longitud, {
                autocompletarBarrio: true,
                etiquetaOrigen: `${dom.etiqueta} (${dom.direccion})`
            });
        } else if (dom.direccion) {
            const searchInput = document.getElementById('abm-mapa-search-input');
            if (searchInput) searchInput.value = dom.direccion;
            await geocodificarTextoEnMapaAbm(dom.direccion, {
                autocompletarBarrio: true,
                etiquetaOrigen: `${dom.etiqueta} (${dom.direccion})`
            });
        }
    }

    async function geocodificarTextoEnMapaAbm(rawTexto, opciones = {}) {
        const limpio = normalizarDireccionParaGeocoder(rawTexto);
        if (!limpio) return;

        const okSdk = await asegurarGoogleMapsSdkAbm();
        if (!okSdk || !window.google?.maps) return;
        if (!abmGoogleGeocoder) abmGoogleGeocoder = new window.google.maps.Geocoder();

        await asegurarInstanciaMapaAbm();

        abmGoogleGeocoder.geocode({ address: limpio, region: 'AR' }, (results, status) => {
            if (status === 'OK' && Array.isArray(results) && results.length > 0) {
                const loc = results[0].geometry?.location;
                if (!loc) return;
                const lat = loc.lat();
                const lng = loc.lng();
                if (abmGoogleMapInstance) {
                    abmGoogleMapInstance.setCenter({ lat, lng });
                    abmGoogleMapInstance.setZoom(16);
                }
                if (abmGoogleMarkerMain) {
                    abmGoogleMarkerMain.setPosition({ lat, lng });
                }
                const extraido = extraerBarrioYLocalidadDeComponentesGoogle(results[0].address_components || []);
                const dirFmt = results[0].formatted_address || '';
                actualizarBarraInfoMapaAbm({
                    barrio: extraido.barrioLocalidad,
                    calle: extraido.calleFormateada || dirFmt.split(',')[0],
                    direccionFormateada: dirFmt,
                    lat,
                    lng,
                    etiquetaOrigen: opciones.etiquetaOrigen || 'Ubicado por dirección'
                });
                const barrioInput = document.getElementById('abm-barrio');
                if (barrioInput && extraido.barrioLocalidad && (opciones.autocompletarBarrio || !barrioInput.value.trim())) {
                    barrioInput.value = extraido.barrioLocalidad;
                }
            } else {
                const bar = document.getElementById('abm-mapa-info-bar');
                if (bar) {
                    bar.innerHTML = `<span style="color:#fbbf24;">⚠️ No se encontró "${escaparHtml(rawTexto)}" de forma exacta. Puede buscar la esquina/barrio arriba o mover el pin rojo directamente en el mapa.</span>`;
                }
            }
        });
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
            await asegurarInstanciaMapaAbm(latActual, lngActual);
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
            await asegurarInstanciaMapaAbm(-34.9214, -57.9545);
        }
    }

    async function buscarDireccionEnMapaAbm() {
        const q = document.getElementById('abm-mapa-search-input')?.value?.trim() || '';
        if (!q) return;
        await geocodificarTextoEnMapaAbm(q, {
            autocompletarBarrio: true,
            etiquetaOrigen: `Búsqueda: ${q}`
        });
    }

    async function ubicarTextoDomicilioActualEnMapaAbm() {
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
                        Esta configuración se aplica de forma unificada a <strong>todos los Nodos Barriales</strong> para recaudar transferencias de vecinos bajo esquema <strong>Marca Blanca</strong> (sin mencionar a LAMDA ni a un Nodo puntual).
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
                if (/lamda/i.test(alias)) {
                    Swal.showValidationMessage('Por criterio de Marca Blanca, el alias para vecinos no puede contener la palabra "LAMDA".');
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
            aliasInput.value = data.config_cuenta_canal.alias_recaudador || 'pago.canasto';
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

    function cargarNodoEnFormularioAbm(nodoId) {
        const nodo = ESTADO_NODOS.nodos.find(n => Number(n.id) === Number(nodoId));
        if (!nodo) return;
        ESTADO_NODOS.nodoEditandoId = Number(nodo.id);
        ESTADO_NODOS.clienteMadreSeleccionadoId = nodo.cliente_madre_bunker_id ? Number(nodo.cliente_madre_bunker_id) : null;
        logoOriginalSubidoBase64 = nodo.logo_original_base64 || null;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val ?? '';
        };

        const cfgCanal = ESTADO_NODOS.fuentes?.config_cuenta_canal || { alias_recaudador: 'pago.canasto' };

        setVal('abm-nodo-id', nodo.id);
        setVal('abm-nombre-marca', nodo.nombre_marca);
        setVal('abm-slug', nodo.slug);
        const slugEl = document.getElementById('abm-slug');
        if (slugEl) slugEl.dataset.manual = 'true';
        setVal('abm-subtitulo', nodo.subtitulo_marca);
        setVal('abm-gestor-nombre', nodo.gestor_nombre);
        setVal('abm-gestor-tel', nodo.gestor_telefono);
        setVal('abm-barrio', nodo.barrio_zona);
        setVal('abm-direccion', nodo.direccion_retiro);
        setVal('abm-latitud', nodo.latitud ?? '');
        setVal('abm-longitud', nodo.longitud ?? '');
        setVal('abm-cliente-madre-id', nodo.cliente_madre_bunker_id || '');
        setVal('abm-cliente-madre-codigo', nodo.codigo_bunker_cliente_madre || '');
        const chkComp = document.getElementById('abm-cuenta-compartida');
        if (chkComp) chkComp.checked = nodo.usa_cuenta_compartida !== false;
        setVal('abm-alias-display', nodo.alias_bancario_display || cfgCanal.alias_recaudador || 'pago.canasto');
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

        const listaBox = document.getElementById('abm-lista-clientes-titulares');
        if (listaBox) listaBox.innerHTML = renderizarListaClientesTitularesHtml(ESTADO_NODOS.busquedaClienteAbm, ESTADO_NODOS.clienteMadreSeleccionadoId);
        const resBox = document.getElementById('abm-cliente-titular-resumen');
        const cliSel = (ESTADO_NODOS.fuentes.clientes_bunker || []).find(c => Number(c.id) === Number(ESTADO_NODOS.clienteMadreSeleccionadoId));
        if (resBox) resBox.innerHTML = renderizarResumenClienteTitularHtml(cliSel);
        if (cliSel) renderizarChipsDomiciliosClienteAbm(cliSel, 0);

        simularEtiquetaZebra('estandar_pagado');
    }

    function nuevoNodoFormulario() {
        ESTADO_NODOS.nodoEditandoId = null;
        ESTADO_NODOS.clienteMadreSeleccionadoId = null;
        ESTADO_NODOS.busquedaClienteAbm = '';
        logoOriginalSubidoBase64 = null;
        const cfgCanal = ESTADO_NODOS.fuentes?.config_cuenta_canal || { alias_recaudador: 'pago.canasto' };
        const ids = [
            'abm-nodo-id',
            'abm-nombre-marca',
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
            'abm-buscador-cliente-input'
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const aliasEl = document.getElementById('abm-alias-display');
        if (aliasEl) aliasEl.value = cfgCanal.alias_recaudador || 'pago.canasto';
        const chkComp = document.getElementById('abm-cuenta-compartida');
        if (chkComp) chkComp.checked = true;
        const slugEl = document.getElementById('abm-slug');
        if (slugEl) slugEl.dataset.manual = '';
        const sub = document.getElementById('abm-subtitulo');
        if (sub) sub.value = 'Alimentos Naturales y Frutos Secos - Entrega Barrial';
        const domSug = document.getElementById('abm-domicilios-sugeridos');
        if (domSug) domSug.innerHTML = '';
        const listaBox = document.getElementById('abm-lista-clientes-titulares');
        if (listaBox) listaBox.innerHTML = renderizarListaClientesTitularesHtml('', null);
        const resBox = document.getElementById('abm-cliente-titular-resumen');
        if (resBox) resBox.innerHTML = renderizarResumenClienteTitularHtml(null);
        regenerarLogoZplEnVivo();
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

            const cfgCanal = ESTADO_NODOS.fuentes?.config_cuenta_canal || { alias_recaudador: 'pago.canasto' };
            const aliasInput = document.getElementById('abm-alias-display');
            if (aliasInput) {
                aliasInput.value = cfgCanal.alias_recaudador || 'pago.canasto';
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
            await geocodificarTextoEnMapaAbm(datos.direccionPrincipal, {
                autocompletarBarrio: true,
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
        regenerarLogoZplEnVivo();
    }

    async function enviarLinksBienvenidaNodoWa(nodoId) {
        try {
            const nodo = ESTADO_NODOS.nodos.find(n => Number(n.id) === Number(nodoId));
            if (!nodo) return;
            const origin = window.location.origin;
            const urlGestor = `${origin}/gestor/${encodeURIComponent(nodo.slug)}`;
            const urlTienda = `${origin}/tienda/${encodeURIComponent(nodo.slug)}`;
            const mensaje = [
                `🌱 *Bienvenido/a a Nodos Barriales — ${nodo.nombre_marca}*`,
                `👤 Gestor/a: ${nodo.gestor_nombre}`,
                `📍 Punto de retiro: ${nodo.direccion_retiro || nodo.barrio_zona || '-'}`,
                `🏦 Alias recaudador vecinos: ${nodo.alias_bancario_display || 'pago.canasto'}`,
                ``,
                `📲 *1. Tu Panel de Gestor (Armado de Canasto, Márgenes y Cobros):*`,
                urlGestor,
                ``,
                `🛒 *2. Tu Tienda Vecinal Marca Blanca (para compartir con tus vecinos):*`,
                urlTienda
            ].join('\n');

            const resp = await fetch('/api/produccion/nodos/whatsapp-prueba', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatario_nombre: nodo.gestor_nombre || nodo.nombre_marca,
                    telefono_original: nodo.gestor_telefono || '',
                    mensaje
                })
            });
            const data = await resp.json();
            if (!resp.ok || !data.ok) throw new Error(data.error || 'No se pudo generar el envío de WhatsApp.');

            const linksDetectados = Array.isArray(data.links_detectados) ? data.links_detectados : [];
            const qrCardsHtml = linksDetectados.length > 0 ? `
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(175px, 1fr)); gap:10px; margin-top:10px;">
                    ${linksDetectados.map(lk => `
                        <div style="padding:10px; border-radius:10px; background:#0f172a; border:1px solid #334155; text-align:center;">
                            <div style="font-size:0.76rem; font-weight:800; color:#38bdf8; margin-bottom:6px;">${escaparHtml(lk.label)}</div>
                            ${lk.qr_data_url ? `<img src="${lk.qr_data_url}" alt="QR" style="width:130px; height:130px; border-radius:8px; background:#fff; padding:4px; margin-bottom:6px;">` : ''}
                            <div style="font-size:0.68rem; color:#cbd5e1; word-break:break-all; margin-bottom:6px; font-family:monospace;">${escaparHtml(lk.url)}</div>
                            <div style="display:flex; gap:5px; justify-content:center;">
                                <a href="${escaparHtml(lk.url)}" target="_blank" rel="noopener"
                                    style="padding:5px 9px; border-radius:6px; background:#0284c7; color:#fff; text-decoration:none; font-weight:800; font-size:0.7rem;">
                                    Abrir ↗
                                </a>
                                <button type="button" onclick="navigator.clipboard.writeText('${escaparHtml(lk.url)}')"
                                    style="padding:5px 9px; border-radius:6px; border:1px solid #475569; background:#1e293b; color:#e2e8f0; font-weight:700; font-size:0.7rem; cursor:pointer;">
                                    Copiar Link
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : '';

            if (window.Swal) {
                Swal.fire({
                    icon: 'success',
                    width: 620,
                    title: '✅ WhatsApp Despachado por Conexión Interna LAMDA',
                    html: `
                        <div style="text-align:left; font-size:0.83rem; line-height:1.45;">
                            <div style="padding:10px 12px; border-radius:8px; background:rgba(16,185,129,0.12); border:1px solid #059669; color:#a7f3d0; margin-bottom:10px;">
                                📲 <strong>Despacho directo completado (sin abrir ventanas externas):</strong><br>
                                Destinatario original: <strong>${escaparHtml(nodo.gestor_nombre || nodo.nombre_marca)} (${escaparHtml(nodo.gestor_telefono || 'S/T')})</strong><br>
                                🛡️ Redirigido en Modo Laboratorio a: <strong>${escaparHtml(data.telefono_destino_display || '221 661 5746')}</strong>
                            </div>
                            <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:4px;">
                                Mensaje enviado con links optimizados para celular en red Wi-Fi (<strong>${escaparHtml(data.base_url_movil || '')}</strong>):
                            </div>
                            <pre style="white-space:pre-wrap; word-break:break-word; padding:10px; border-radius:8px; background:#0b1120; border:1px solid #1e293b; color:#e2e8f0; font-size:0.75rem; font-family:inherit; margin:0 0 8px 0; max-height:170px; overflow-y:auto;">${escaparHtml(data.mensaje_enviado || mensaje)}</pre>
                            ${qrCardsHtml}
                        </div>
                    `,
                    confirmButtonText: 'Entendido',
                    confirmButtonColor: '#16a34a',
                    background: '#151e2e',
                    color: '#f8fafc'
                });
            }
        } catch (err) {
            if (window.Swal) {
                Swal.fire({ icon: 'error', title: 'Error WhatsApp', text: err.message, background: '#151e2e', color: '#f8fafc' });
            }
        }
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
            const nombreMarca = document.getElementById('abm-nombre-marca')?.value || 'ALMACEN NATURAL BARRIAL';
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
            const cfgCanal = ESTADO_NODOS.fuentes?.config_cuenta_canal || {
                cuenta_bancaria_id: null,
                alias_recaudador: 'pago.canasto',
                cbu_recaudador: '0000000000000000000000',
                titular_recaudador: 'Recaudación Canal Nodos (Provisorio)'
            };

            const clienteMadreIdVal = document.getElementById('abm-cliente-madre-id')?.value || ESTADO_NODOS.clienteMadreSeleccionadoId || null;
            const cliObj = (ESTADO_NODOS.fuentes.clientes_bunker || []).find(c => Number(c.id) === Number(clienteMadreIdVal));
            const codigoMadreVal = document.getElementById('abm-cliente-madre-codigo')?.value || cliObj?.codigo_bunker_cliente || null;

            if (!clienteMadreIdVal) {
                throw new Error('Debe seleccionar primero el Cliente Titular del Nodo en el buscador del Paso 1.');
            }

            const usaComp = Boolean(document.getElementById('abm-cuenta-compartida')?.checked);
            const aliasEscrito = document.getElementById('abm-alias-display')?.value?.trim() || cfgCanal.alias_recaudador || 'pago.canasto';
            if (/lamda/i.test(aliasEscrito)) {
                throw new Error('Por criterio de Marca Blanca, el alias bancario para vecinos no puede mencionar a LAMDA.');
            }

            const latVal = document.getElementById('abm-latitud')?.value;
            const lngVal = document.getElementById('abm-longitud')?.value;

            const payload = {
                nombre_marca: document.getElementById('abm-nombre-marca')?.value || '',
                slug: document.getElementById('abm-slug')?.value || '',
                subtitulo_marca: document.getElementById('abm-subtitulo')?.value || '',
                gestor_nombre: document.getElementById('abm-gestor-nombre')?.value || '',
                gestor_telefono: document.getElementById('abm-gestor-tel')?.value || '',
                barrio_zona: document.getElementById('abm-barrio')?.value || '',
                direccion_retiro: document.getElementById('abm-direccion')?.value || '',
                latitud: latVal !== '' && latVal !== undefined ? Number(latVal) : null,
                longitud: lngVal !== '' && lngVal !== undefined ? Number(lngVal) : null,
                cliente_madre_bunker_id: Number(clienteMadreIdVal),
                codigo_bunker_cliente_madre: codigoMadreVal,
                cuenta_bancaria_id: cfgCanal.cuenta_bancaria_id || null,
                usa_cuenta_compartida: usaComp,
                alias_bancario_display: usaComp ? (cfgCanal.alias_recaudador || aliasEscrito) : aliasEscrito,
                cbu_display: cfgCanal.cbu_recaudador || '',
                titular_display: cfgCanal.titular_recaudador || '',
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
                const resSwal = await Swal.fire({
                    icon: 'success',
                    title: '✅ Nodo Barrial Guardado',
                    html: `
                        <div style="text-align:left; font-size:0.85rem; line-height:1.5;">
                            <p><strong>${escaparHtml(data.nodo.nombre_marca)}</strong> quedó activo y vinculado al Cliente Titular <code>${escaparHtml(data.nodo.codigo_bunker_cliente_madre || '')}</code> con subcuenta aislada <code>${escaparHtml(data.nodo.codigo_bunker_cliente || '')}</code>.</p>
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
                title: '🧹 Puesta a Cero Integral de Pruebas (Nodos Barriales)',
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
        filtrarClientesTitularesAbm,
        seleccionarClienteTitularAbm,
        seleccionarDomicilioClienteEnAbm,
        togglePanelMapaAbm,
        buscarDireccionEnMapaAbm,
        ubicarTextoDomicilioActualEnMapaAbm,
        aplicarBarrioSugeridoMapaAbm,
        aplicarCalleSugeridaMapaAbm,
        alCambiarToggleCuentaCompartidaAbm,
        abrirModalConfigCuentaCanal,
        aplicarDomicilioSugeridoAbm,
        alEditarNombreMarcaAbm,
        enviarLinksBienvenidaNodoWa,
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
