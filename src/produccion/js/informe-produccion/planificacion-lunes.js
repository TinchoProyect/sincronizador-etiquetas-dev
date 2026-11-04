/**
 * ============================================================================
 * CONTROLADOR CLIENTE: TABLERO DETERMINISTA DE PLANIFICACIÓN ("INFORME DEL LUNES")
 * Sistema LAMDA — Inteligencia de Producción y Abastecimiento
 * ============================================================================
 */

(function () {
    'use strict';

    // Estado global reactivo
    let dataMaster = null;
    let datosCompras = null;
    let tabActiva = 'tab-produccion-interna';
    let filtroSemaforo = 'todos';
    let filtroGrupoTaller = 'todos'; // 'todos' | 'ldn2' | 'ldn3' | 'packs'
    let ventanaDiasDemanda = 14;
    let diasObjetivoCobertura = 21;
    let diasObjetivoCompras = 30;
    let tandaMixKg = 10;
    let queryBusqueda = '';
    let estadoAcordeonesTostadero = {};

    window.filtrarGrupoTaller = function (grupo) {
        filtroGrupoTaller = grupo || 'todos';
        ['todos', 'ldn2', 'ldn3', 'packs'].forEach(g => {
            const btn = document.getElementById(`btn-filtro-taller-${g}`);
            if (btn) {
                if (g === filtroGrupoTaller) btn.classList.add('active');
                else btn.classList.remove('active');
            }
        });
        renderizarTabProduccionInterna();
    };

    function formatearUnidadesStock(val) {
        if (val === null || val === undefined || isNaN(val)) return '0';
        const num = Number(val);
        if (Math.abs(num - Math.round(num)) < 0.005) {
            return Math.round(num).toLocaleString('es-AR');
        }
        return parseFloat(num.toFixed(2)).toLocaleString('es-AR');
    }

    function formatearBolsas(val) {
        if (val === null || val === undefined || isNaN(val)) return '0';
        const num = Number(val);
        if (Math.abs(num - Math.round(num)) < 0.005) {
            return Math.round(num).toLocaleString('es-AR');
        }
        return parseFloat(num.toFixed(2)).toLocaleString('es-AR');
    }

    function calcularPesoUrgencia(art) {
        // Pedidos comprometidos pendientes de clientes siempre tienen máxima urgencia (1)
        if ((art.comprometido_presupuestos || 0) > 0 && (art.stock_neto_disponible !== undefined && art.stock_neto_disponible <= 0)) {
            return 1;
        }

        // Si es esporádico (vende 1 vez cada 3 meses) y no tiene pedidos comprometidos:
        // no debe desplazar a los artículos de rotación regular de taller
        if (art.es_esporadico && (art.comprometido_presupuestos || 0) === 0) {
            if (art.stock_actual <= 0 || art.estado_alarma === 'CRITICO_SIN_STOCK') {
                return 3; // Nivel atención preventiva / lote mínimo
            }
            return 4; // Óptimo
        }

        // Artículo padre (Pack): Solo es urgente si tiene pedidos pendientes de armar
        if (art.es_padre) {
            if ((art.packs_a_armar && art.packs_a_armar > 0) || ((art.comprometido_presupuestos || 0) > (art.stock_actual || 0))) {
                return 2;
            }
            return 4; // Si ya hay stock de hijos y 0 pedidos pendientes, es óptimo
        }

        if (art.estado_alarma === 'CRITICO_SIN_STOCK' || 
            (art.stock_neto_disponible !== undefined && art.stock_neto_disponible <= 0) ||
            (art.stock_actual !== undefined && art.stock_actual <= 0)) {
            return 1;
        }
        if (art.estado_alarma === 'CRITICO' || (art.dias_cobertura !== undefined && art.dias_cobertura <= 5)) {
            return 2;
        }
        if (art.estado_alarma === 'ATENCION' || art.estado_alarma === 'ARMABLE_EN_DEPOSITO' || (art.dias_cobertura !== undefined && art.dias_cobertura <= 12)) {
            return 3;
        }
        if (art.estado_alarma === 'OPTIMO') {
            return 4;
        }
        return art.prioridad || 5;
    }

    function ordenarPorUrgenciaYCantidad(a, b) {
        // 1. Prioridad de Apuro / Urgencia estricta (1: quiebres, 2: críticos, 3: atención, 4: óptimos)
        const urgA = calcularPesoUrgencia(a);
        const urgB = calcularPesoUrgencia(b);
        if (urgA !== urgB) return urgA - urgB;

        // Pedidos comprometidos pendientes de clientes siempre van primero
        const compA = a.comprometido_presupuestos || 0;
        const compB = b.comprometido_presupuestos || 0;
        if ((compA > 0) !== (compB > 0)) {
            return (compB > 0) - (compA > 0);
        }

        // Si no hay pedidos comprometidos pendientes:
        // Artículos de ROTACIÓN SEMANAL REGULAR tienen prioridad sobre ESPORÁDICOS
        const semA = a.semanas_activas_90d || 0;
        const semB = b.semanas_activas_90d || 0;
        if ((semA >= 6) !== (semB >= 6)) {
            return (semB >= 6) ? 1 : -1;
        }

        // 2. Cantidad / Kilos a envasar o armar de MAYOR a MENOR
        const cantA = (a.kilos_sugeridos && a.kilos_sugeridos > 0)
            ? a.kilos_sugeridos
            : ((a.cantidad_sugerida || 0) * (a.kilos_unidad || 1)) || (a.packs_armables || 0);
        const cantB = (b.kilos_sugeridos && b.kilos_sugeridos > 0)
            ? b.kilos_sugeridos
            : ((b.cantidad_sugerida || 0) * (b.kilos_unidad || 1)) || (b.packs_armables || 0);
        if (cantB !== cantA) return cantB - cantA;

        // 3. Menor cobertura primero (el que antes se quiebra)
        const cobA = a.dias_cobertura !== undefined ? a.dias_cobertura : 999;
        const cobB = b.dias_cobertura !== undefined ? b.dias_cobertura : 999;
        if (cobA !== cobB) return cobA - cobB;

        return (a.descripcion || '').localeCompare(b.descripcion || '');
    }

    function agruparYOrdenarPorIngrediente(items) {
        if (!Array.isArray(items) || items.length === 0) return [];

        const gruposMap = new Map();
        items.forEach(art => {
            const rawMp = art.materia_prima_nombre || '';
            const mpKey = (rawMp.trim() !== '' && rawMp.trim() !== '-' && rawMp.trim() !== 'Insumo Puro')
                ? rawMp.trim()
                : (art.familia_nombre || 'General');

            if (!gruposMap.has(mpKey)) {
                gruposMap.set(mpKey, []);
            }
            gruposMap.get(mpKey).push(art);
        });

        const gruposArray = [];
        for (const [mpKey, artList] of gruposMap.entries()) {
            // Ordenar presentaciones dentro del ingrediente:
            // 1. Quiebres/Críticos primero
            // 2. Mayor tamaño de bolsa primero (ej: 5kg antes de 1kg)
            // 3. Cantidad a envasar descendente
            artList.sort((a, b) => {
                const urgA = calcularPesoUrgencia(a);
                const urgB = calcularPesoUrgencia(b);
                if (urgA !== urgB) return urgA - urgB;

                const kgUA = a.kilos_unidad || 0;
                const kgUB = b.kilos_unidad || 0;
                if (kgUB !== kgUA) return kgUB - kgUA;

                return (b.kilos_sugeridos || 0) - (a.kilos_sugeridos || 0);
            });

            const urgMin = Math.min(...artList.map(a => calcularPesoUrgencia(a)));
            const totalKg = artList.reduce((sum, a) => sum + (a.kilos_sugeridos || 0), 0);

            gruposArray.push({
                materia_prima: mpKey,
                items: artList,
                urgencia_minima: urgMin,
                total_kilos: totalKg
            });
        }

        // Ordenar materias primas: las más urgentes primero (con quiebres arriba), luego mayor volumen a envasar
        gruposArray.sort((gA, gB) => {
            if (gA.urgencia_minima !== gB.urgencia_minima) {
                return gA.urgencia_minima - gB.urgencia_minima;
            }
            if (gB.total_kilos !== gA.total_kilos) {
                return gB.total_kilos - gA.total_kilos;
            }
            return gA.materia_prima.localeCompare(gB.materia_prima);
        });

        const resultadoPlano = [];
        gruposArray.forEach(g => {
            resultadoPlano.push(...g.items);
        });

        return resultadoPlano;
    }

    window.cambiarTandaMix = function (val) {
        tandaMixKg = parseInt(val) || 10;
        console.log(`🥣 [CLIENTE-LUNES] Tamaño estándar de carro ajustado a: ${tandaMixKg} kg`);
        cargarPlanificacion();
    };

    window.cambiarHorizonteCompras = async function (val) {
        if (val === 'manual') {
            window.ingresarDiasObjetivoManual('compras');
            return;
        }
        diasObjetivoCompras = parseInt(val) || 30;
        if (typeof asegurarOpcionPersonalizada === 'function') {
            asegurarOpcionPersonalizada('select-horizonte-compras', diasObjetivoCompras, 'Proyección');
        }
        console.log(`🛒 [CLIENTE-LUNES] Horizonte de compras ajustado a: ${diasObjetivoCompras} días`);
        try {
            const urlCompras = `/api/produccion/informe/compras-proveedores?demanda=90&objetivo=${diasObjetivoCompras}&solo_faltantes=true&_t=${Date.now()}`;
            const res = await fetch(urlCompras);
            if (res.ok) {
                const jsonCompras = await res.json();
                if (jsonCompras.success) {
                    datosCompras = jsonCompras;
                    datosUltimoReporteCompras = jsonCompras;
                    actualizarKpiCards(dataMaster ? dataMaster.resumen_kpi : null, datosCompras.resumen_kpi);
                    actualizarTabCounters();
                    if (tabActiva === 'tab-abastecimiento') {
                        renderizarTabAbastecimiento();
                    }
                }
            }
        } catch (e) {
            console.error('Error al actualizar compras por horizonte:', e);
        }
    };

    window.cargarPlanificacion = function () {
        cargarPlanificacion();
    };

    // =========================================================================
    // POLÍTICA UNIVERSAL DE BÚSQUEDA LAMDA (FASE 49)
    // =========================================================================
    function normalizarTexto(txt) {
        if (!txt) return '';
        return String(txt).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    }

    window.obtenerTextoBusquedaArticulo = function (art) {
        if (!art) return '';
        const tokens = [
            art.articulo_id || '',
            art.descripcion || '',
            art.familia_nombre || '',
            art.rubro || '',
            art.sub_rubro || '',
            art.tipo_proceso || '',
            art.accion_requerida || '',
            art.kilos_unidad ? `${art.kilos_unidad}kg ${art.kilos_unidad} kg` : ''
        ];
        if (art.factibilidad && art.factibilidad.cuello_botella) {
            tokens.push(art.factibilidad.cuello_botella);
        }
        return normalizarTexto(tokens.join(' '));
    };

    function coincideBusqueda(art, searchTerms) {
        if (!searchTerms || searchTerms.length === 0) return true;
        const textoArticulo = window.obtenerTextoBusquedaArticulo(art);
        // Filtrado acumulativo: cada palabra debe coincidir (AND)
        return searchTerms.every(term => textoArticulo.includes(term));
    }

    // =========================================================================
    // AGRUPACIÓN DETERMINISTA DE TOSTADEROS (LDN 4 POR TIPO DE PRODUCCIÓN)
    // =========================================================================
    function obtenerGrupoTostadero(art) {
        const desc = normalizarTexto(art.descripcion);
        const sku = (art.articulo_id || '').toUpperCase();
        const ingId = parseInt(art.ingrediente_tostado_id || 0);

        // 1. Almendra Tostada Natural / Sin Sal (Insumo 57)
        if (ingId === 57 || sku === 'APTPGUP' || sku === 'APTPGXK' || sku.startsWith('ATX')) {
            return {
                id: 'almendra_tostada_natural',
                orden: 1,
                titulo: 'Almendra Tostada (Natural / Sin Sal)',
                icono: '🥜',
                materiaPrimaCodigo: art.materia_prima_cruda_codigo || 'APN27/30X22,68',
                materiaPrimaNombre: art.materia_prima_nombre || 'Almendra Peladas NP 27/30 x 22.68kg',
                mermaPct: art.merma_pct || art.merma_esperada || 7
            };
        }

        // 2. Almendra Tostada y Salada (Insumo 123)
        if (ingId === 123 || sku === 'APTSPGUP' || sku === 'APTSPGXK' || sku.startsWith('ATYS') || sku.startsWith('ATYSX') || (sku.startsWith('ATY') && !sku.includes('PM'))) {
            return {
                id: 'almendra_tostada_salada',
                orden: 2,
                titulo: 'Almendra Tostada y Salada',
                icono: '🧂',
                materiaPrimaCodigo: art.materia_prima_cruda_codigo || 'APN27/30X22,68',
                materiaPrimaNombre: art.materia_prima_nombre || 'Almendra Peladas NP 27/30 x 22.68kg',
                mermaPct: art.merma_pct || art.merma_esperada || 7
            };
        }

        // 3. Almendra Tostada y Salada Para Mix (Insumo 38)
        if (ingId === 38 || sku === 'APTSPGUPPM' || sku === 'APTSPGXKPM' || sku === 'EMB-STMAK2' || sku.includes('PM')) {
            return {
                id: 'almendra_tostada_salada_mix',
                orden: 3,
                titulo: 'Almendra Tostada y Salada (Para Mix)',
                icono: '🥣',
                materiaPrimaCodigo: art.materia_prima_cruda_codigo || 'AGRX10Q',
                materiaPrimaNombre: art.materia_prima_nombre || 'Almendra Guara Ramillada x 10kg',
                mermaPct: art.merma_pct || art.merma_esperada || 7
            };
        }

        // 4. Castaña de Cajú Tostada Natural / Sin Sal (Insumo 18)
        if (ingId === 18 || sku === 'CCTGXKUP' || sku === 'CCTGXK' || (sku.startsWith('CCTX') && !sku.includes('S'))) {
            return {
                id: 'caju_tostada_natural',
                orden: 4,
                titulo: 'Castaña de Cajú Tostada (Natural / Sin Sal)',
                icono: '🥜',
                materiaPrimaCodigo: art.materia_prima_cruda_codigo || 'EMB-MN4UM1',
                materiaPrimaNombre: art.materia_prima_nombre || 'Castañas de Caju W5 x 22.68kg',
                mermaPct: art.merma_pct || art.merma_esperada || 5
            };
        }

        // 5. Castaña de Cajú Tostada y Salada (Insumo 41)
        if (ingId === 41 || sku === 'CCTSGXKUP' || sku === 'CCTSGXK' || sku.startsWith('CCTS') || sku === 'EMB-IZP49Q') {
            return {
                id: 'caju_tostada_salada',
                orden: 5,
                titulo: 'Castaña de Cajú Tostada y Salada',
                icono: '🧂',
                materiaPrimaCodigo: art.materia_prima_cruda_codigo || 'EMB-MN4UM1',
                materiaPrimaNombre: art.materia_prima_nombre || 'Castañas de Caju W5 x 22.68kg',
                mermaPct: art.merma_pct || art.merma_esperada || 5
            };
        }

        // 6. Castaña de Cajú Partida Tostada y Salada Para Mix (Insumo 166)
        if (ingId === 166 || sku === 'EMB-3RMHD2' || sku === 'EMB-GZ6U9K') {
            return {
                id: 'caju_partida_tostada_salada_mix',
                orden: 6,
                titulo: 'Castaña de Cajú Partida Tostada y Salada (Para Mix)',
                icono: '🥣',
                materiaPrimaCodigo: art.materia_prima_cruda_codigo || 'CCP3X22.68',
                materiaPrimaNombre: art.materia_prima_nombre || 'Castaña de Caju P3 x 22.68kg',
                mermaPct: art.merma_pct || art.merma_esperada || 5
            };
        }

        // Fallback genérico por nombre si no se resolvió
        if (desc.includes('caju')) {
            return {
                id: 'caju_tostada_natural',
                orden: 4,
                titulo: 'Castaña de Cajú Tostada (Natural / Sin Sal)',
                icono: '🥜',
                materiaPrimaCodigo: art.materia_prima_cruda_codigo || 'EMB-MN4UM1',
                materiaPrimaNombre: art.materia_prima_nombre || 'Castañas de Caju W5 x 22.68kg',
                mermaPct: art.merma_pct || 5
            };
        }

        return {
            id: 'almendra_tostada_natural',
            orden: 1,
            titulo: 'Almendra Tostada (Natural / Sin Sal)',
            icono: '🥜',
            materiaPrimaCodigo: art.materia_prima_cruda_codigo || 'APN27/30X22,68',
            materiaPrimaNombre: art.materia_prima_nombre || 'Almendra Peladas NP 27/30 x 22.68kg',
            mermaPct: art.merma_pct || 7
        };
    }

    window.toggleAcordeonTostadero = function (grupoId) {
        estadoAcordeonesTostadero[grupoId] = !estadoAcordeonesTostadero[grupoId];
        const card = document.getElementById(`acordeon-tostadero-${grupoId}`);
        if (card) {
            if (estadoAcordeonesTostadero[grupoId]) {
                card.classList.add('abierto');
            } else {
                card.classList.remove('abierto');
            }
        }
    };

    window.desplegarTodosTostaderos = function (abrir) {
        const cards = document.querySelectorAll('.acordeon-tostadero-card');
        cards.forEach(c => {
            const id = c.getAttribute('data-grupo-id');
            if (id) estadoAcordeonesTostadero[id] = abrir;
            if (abrir) {
                c.classList.add('abierto');
            } else {
                c.classList.remove('abierto');
            }
        });
    };

    // =========================================================================
    // COMUNICACIÓN CON BACKEND (FETCH DETERMINISTA MAESTRO + COMPRAS PROVEEDORES)
    // =========================================================================
    async function cargarPlanificacion() {
        const loadingContainer = document.getElementById('loading-state');
        const dashboardContent = document.getElementById('dashboard-content');
        
        if (loadingContainer) loadingContainer.style.display = 'block';
        if (dashboardContent) dashboardContent.style.display = 'none';

        try {
            const urlPlan = `/api/produccion/informe/planificacion-lunes?dias_demanda=${ventanaDiasDemanda}&dias_objetivo=${diasObjetivoCobertura}&tanda_mix_kg=${tandaMixKg}&_t=${Date.now()}`;
            const urlCompras = `/api/produccion/informe/compras-proveedores?demanda=90&objetivo=${diasObjetivoCompras}&solo_faltantes=true&_t=${Date.now()}`;

            console.log(`📡 [CLIENTE-LUNES] Consultando plan maestro (Tanda ${tandaMixKg}kg) y orden de compras...`);

            const [responsePlan, responseCompras] = await Promise.all([
                fetch(urlPlan),
                fetch(urlCompras)
            ]);

            if (!responsePlan.ok) {
                throw new Error(`Error HTTP en plan maestro ${responsePlan.status}: ${responsePlan.statusText}`);
            }

            const jsonPlan = await responsePlan.json();
            if (!jsonPlan.success) {
                throw new Error(jsonPlan.error || 'Error desconocido al obtener la planificación.');
            }
            dataMaster = jsonPlan;

            if (responseCompras.ok) {
                const jsonCompras = await responseCompras.json();
                if (jsonCompras.success) {
                    datosCompras = jsonCompras;
                    datosUltimoReporteCompras = jsonCompras;
                }
            }

            console.log('✅ [CLIENTE-LUNES] Datos recibidos con éxito:', dataMaster.resumen_kpi);

            // Actualizar interfaz
            actualizarKpiCards(dataMaster.resumen_kpi, datosCompras ? datosCompras.resumen_kpi : null);
            actualizarBannerBloqueos(dataMaster.insumos_bloqueantes);
            actualizarTabCounters();
            renderizarVistaActiva();

            if (loadingContainer) loadingContainer.style.display = 'none';
            if (dashboardContent) dashboardContent.style.display = 'flex';

        } catch (error) {
            console.error('❌ [CLIENTE-LUNES] Error al cargar:', error);
            if (loadingContainer) {
                loadingContainer.innerHTML = `
                    <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; padding: 24px; max-width: 600px; margin: 40px auto; color: #f87171;">
                        <h3 style="font-size: 1.1rem; margin-bottom: 8px;">⚠️ Error de Carga</h3>
                        <p style="font-size: 0.88rem; color: #fca5a5;">${error.message}</p>
                        <button onclick="window.cargarPlanificacion()" style="margin-top: 14px; background: #ef4444; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer;">
                            🔄 Reintentar
                        </button>
                    </div>
                `;
            }
        }
    }

    // =========================================================================
    // RENDERIZADORES DE KPIS Y BANNERS
    // =========================================================================
    function actualizarKpiCards(kpi, kpiCompras) {
        if (!kpi) return;

        const elCriticos = document.getElementById('kpi-criticos');
        const elCriticosFooter = document.getElementById('kpi-criticos-footer');
        const elTallerItems = document.getElementById('kpi-taller-items');
        const elTallerKg = document.getElementById('kpi-taller-kg');
        const elFraccionados = document.getElementById('kpi-fraccionados');
        const elFraccionadosKg = document.getElementById('kpi-fraccionados-kg');
        const elMixes = document.getElementById('kpi-mixes');
        const elMixesKg = document.getElementById('kpi-mixes-kg');
        const elMixesFooter = document.getElementById('kpi-mixes-footer');
        const elExternos = document.getElementById('kpi-externos');
        const elExternosKg = document.getElementById('kpi-externos-kg');
        const elCompras = document.getElementById('kpi-compras');
        const elComprasBultos = document.getElementById('kpi-compras-bultos');
        const elComprasFooter = document.getElementById('kpi-compras-footer');

        // KPI 1: Taller Producción Interna (Puros + Mixes)
        if (elTallerItems) elTallerItems.innerText = kpi.taller_items_a_producir || kpi.fraccionados_puros_count || 0;
        if (elTallerKg) elTallerKg.innerText = `${(kpi.taller_kilos_a_producir || kpi.kilos_fraccionados_puros || 0).toLocaleString('es-AR')} kg tot.`;

        // Retrocompatibilidad con IDs anteriores
        if (elFraccionados) elFraccionados.innerText = kpi.fraccionados_puros_count || 0;
        if (elFraccionadosKg) elFraccionadosKg.innerText = `${(kpi.kilos_fraccionados_puros || 0).toLocaleString('es-AR')} kg tot.`;

        // KPI 2: Carros de Mezcla Granel (Fase 1)
        if (elMixes) elMixes.innerText = kpi.taller_carros_a_mezclar !== undefined ? kpi.taller_carros_a_mezclar : (kpi.carros_mixes_count || 0);
        if (elMixesKg) elMixesKg.innerText = `${(kpi.kilos_carros_mixes || 0).toLocaleString('es-AR')} kg tot.`;
        if (elMixesFooter) {
            elMixesFooter.innerHTML = `<span style="color: #38bdf8; font-weight: 700;">🥣 ${kpi.carros_mixes_requieren_mezcla_count || 0}</span> a mezclar &bull; <span style="color: #34d399; font-weight: 700;">🟢 ${kpi.carros_mixes_granel_suficiente_count || 0}</span> granel listo`;
        }

        // KPI 3: Quiebres / Críticos Taller
        if (elCriticos) {
            const quiebresTaller = kpi.taller_quiebres_inmediatos || 0;
            const criticosTaller = kpi.taller_criticos_semana || 0;
            elCriticos.innerText = (quiebresTaller + criticosTaller > 0) ? (quiebresTaller + criticosTaller) : (kpi.total_criticos || 0);
        }
        if (elCriticosFooter) {
            elCriticosFooter.innerHTML = `<span style="color: #ef4444; font-weight: 700;">🔴 ${kpi.taller_quiebres_inmediatos || 0}</span> quiebres &bull; <span style="color: #f97316; font-weight: 700;">🟠 ${kpi.taller_criticos_semana || 0}</span> críticos`;
        }

        if (elExternos) elExternos.innerText = kpi.sugerencias_externas_count || 0;
        if (elExternosKg) elExternosKg.innerText = `${(kpi.kilos_totales_externos || 0).toLocaleString('es-AR')} kg tot.`;

        // KPI 4: Abastecimiento Compras Proveedores
        if (kpiCompras) {
            if (elCompras) elCompras.innerText = kpiCompras.total_items_a_pedir || 0;
            if (elComprasBultos) elComprasBultos.innerText = `${kpiCompras.total_bultos_estimados || 0} Bultos`;
            if (elComprasFooter) {
                elComprasFooter.innerHTML = `<span style="color: #ef4444; font-weight: 700;">🔴 ${kpiCompras.quiebres_inmediatos_count || 0}</span> quiebres &bull; <span style="color: #f97316; font-weight: 700;">🟠 ${kpiCompras.criticos_semana_count || 0}</span> críticos (${diasObjetivoCompras}d)`;
            }
        } else {
            if (elCompras) elCompras.innerText = kpi.sugerencias_compras_count || 0;
        }
    }

    function actualizarBannerBloqueos(bloqueos) {
        const container = document.getElementById('container-banner-bloqueos');
        if (!container) return;

        if (!bloqueos || bloqueos.length === 0) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        container.innerHTML = bloqueos.map(b => `
            <div class="banner-bloqueo" style="margin-bottom: 8px;">
                <div>
                    <strong>⚠️ Cuello de Botella Detectado:</strong> 
                    Falta insumo <u>${b.ingrediente_nombre}</u> (Stock actual: ${parseFloat(b.disponible || 0).toFixed(1)} kg). 
                    Frena la producción de <strong>${b.productos_afectados.length}</strong> producto(s): ${b.productos_afectados.slice(0, 3).join(', ')}${b.productos_afectados.length > 3 ? '...' : ''}.
                </div>
                <button onclick="window.filtrarPorTexto('${b.ingrediente_nombre}')" class="btn-action btn-secondary" style="padding: 4px 10px; font-size: 0.72rem; white-space: nowrap;">
                    🔍 Ver Afectados
                </button>
            </div>
        `).join('');
    }

    function actualizarTabCounters() {
        if (!dataMaster) return;
        const ldn = dataMaster.lineas_de_negocio || {};

        const cTaller = document.getElementById('count-tab-taller');
        const cPlan = document.getElementById('count-tab-plan');
        const cFrac = document.getElementById('count-tab-fraccionado');
        const cMix = document.getElementById('count-tab-mixes');
        const cExt = document.getElementById('count-tab-externa');
        const cComp = document.getElementById('count-tab-compras');

        const itemsTaller = dataMaster.produccion_interna_taller || [];
        const itemsTallerAccion = itemsTaller.filter(a => a.cantidad_sugerida > 0 || (a.es_padre && a.packs_armables > 0));
        const totalFraccionados = (ldn.ldn2_fraccionados || []).length;
        const extData = dataMaster.produccion_externa_ups || {};
        const totalExternos = extData.items ? extData.items.length : ((ldn.ldn4_tostaderos || []).length + (ldn.ldn5_barritas || []).length + (ldn.ldn6_granolas || []).length);
        const accionExternos = extData.resumen ? extData.resumen.a_producir_count : totalExternos;
        const totalCompras = datosCompras && datosCompras.items_compras ? datosCompras.items_compras.length : (ldn.ldn1_directos || []).length;

        if (cTaller) cTaller.innerText = itemsTallerAccion.length > 0 ? itemsTallerAccion.length : itemsTaller.length;
        if (cPlan) cPlan.innerText = (dataMaster.plan_semanal_priorizado || []).length;
        if (cFrac) cFrac.innerText = totalFraccionados;
        if (cMix) cMix.innerText = totalCarrosMix;
        if (cExt) cExt.innerText = accionExternos > 0 ? accionExternos : totalExternos;
        if (cComp) cComp.innerText = totalCompras;
    }

    // =========================================================================
    // HELPERS DE RENDERIZADO VISUAL
    // =========================================================================
    // =========================================================================
    // HELPERS DE RENDERIZADO VISUAL
    // =========================================================================
    function getBadgeSemaforo(estado, dias, armables = 0) {
        let diasText = dias === 999 ? '∞ (Sin ventas)' : `${dias.toLocaleString('es-AR', {minimumFractionDigits: 1})} días`;
        
        switch (estado) {
            case 'CRITICO_SIN_STOCK':
                return `<span class="badge-status status-critico-sin-stock" title="Quiebre inmediato: stock neto <= 0 o sin stock físico con ventas">🔴 Quiebre Total (0 días)</span>`;
            case 'CRITICO':
                return `<span class="badge-status status-critico" title="Cobertura crítica menor a 5 días">🔴 Crítico (${diasText})</span>`;
            case 'ARMABLE_EN_DEPOSITO':
                return `<span class="badge-status" style="background: rgba(147, 51, 234, 0.2); color: #c084fc; border: 1px solid rgba(147, 51, 234, 0.4);" title="Pack armable en depósito: hay unidades hijas disponibles">📦 Armable Depo (${armables}u)</span>`;
            case 'ATENCION':
                return `<span class="badge-status status-atencion" title="Cobertura en alerta (5 a 12 días)">🟡 Atención (${diasText})</span>`;
            case 'PLANIFICADO':
                return `<span class="badge-status" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4);" title="Planificado para cubrir horizonte objetivo (${diasText})">🔵 Planificado (${diasText})</span>`;
            case 'OPTIMO':
                return `<span class="badge-status status-optimo" title="Stock equilibrado con cobertura suficiente">🟢 Óptimo (${diasText})</span>`;
            case 'SOBRE_STOCK':
                return `<span class="badge-status status-sobre-stock" title="Sobre-stock superior al objetivo">🔵 Sobre-stock (${diasText})</span>`;
            default:
                return `<span class="badge-status status-sin-rotacion" title="Sin ventas registradas en la ventana">⚪ Sin Rotación</span>`;
        }
    }

    function getBadgeLDN(ldn) {
        switch (ldn) {
            case 1: return `<span class="badge-ldn ldn-1" title="Línea 1: Comercialización Directa sin receta">[LDN 1] Directo</span>`;
            case 2: return `<span class="badge-ldn ldn-2" title="Línea 2: Fraccionados Mono-Ingrediente">[LDN 2] Fraccionado</span>`;
            case 3: return `<span class="badge-ldn ldn-3" title="Línea 3: Mixes y Mezclas Internas">[LDN 3] Mix Taller</span>`;
            case 4: return `<span class="badge-ldn ldn-4" title="Línea 4: Tostaderos (UP Simple)">[LDN 4] Tostadero</span>`;
            case 5: return `<span class="badge-ldn ldn-5" title="Línea 5: Barritas (Bi-fásico)">[LDN 5] Barritas</span>`;
            case 6: return `<span class="badge-ldn ldn-6" title="Línea 6: Granolas (Doble Mezcla)">[LDN 6] Granolas</span>`;
            default: return `<span class="badge-ldn">[LDN ${ldn}]</span>`;
        }
    }

    function getBadgeAccion(art) {
        if (art.es_padre) {
            if (art.estado_alarma === 'ARMABLE_EN_DEPOSITO') {
                return `
                    <div>
                        <span class="accion-badge" style="background: rgba(147, 51, 234, 0.2); color: #c084fc; border: 1px solid rgba(147, 51, 234, 0.4); font-size: 0.78rem;">
                            📦 Armar en depósito
                        </span>
                        <div class="cell-submeta" style="color: #c084fc; margin-top: 3px; font-size: 0.72rem; line-height: 1.2;">
                            ${art.accion_requerida}
                        </div>
                    </div>
                `;
            } else if (art.estado_alarma === 'CRITICO_SIN_STOCK') {
                return `
                    <div>
                        <span class="accion-badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-size: 0.78rem;">
                            🔴 Faltan unidades hijas
                        </span>
                        <div class="cell-submeta" style="color: #f87171; margin-top: 3px; font-size: 0.72rem; line-height: 1.2;">
                            ${art.accion_requerida}
                        </div>
                    </div>
                `;
            } else {
                return `<span style="color: var(--text-muted); font-size: 0.76rem;">✓ Packs suficientes (${art.packs_armables || 0} armables)</span>`;
            }
        }

        const cant = art.cantidad_sugerida;
        if (cant <= 0) {
            return `<span style="color: var(--text-muted); font-size: 0.76rem;">✓ Cobertura suficiente</span>`;
        }

        let clase = 'accion-produccion';
        let icono = '🏭';
        if (art.ldn === 1) {
            clase = 'accion-compra';
            icono = '📦 Pedir';
        } else if (art.ldn >= 4) {
            clase = 'accion-despacho';
            icono = '🚚 Despachar';
        } else {
            icono = '⚙️ Producir';
        }

        const factClass = art.factibilidad.factible ? 'factibilidad-ok' : (art.factibilidad.cuello_botella ? 'factibilidad-bloqueo' : 'factibilidad-alerta');

        return `
            <div>
                <span class="accion-badge ${clase}">
                    ${icono} <strong>+${cant.toLocaleString('es-AR')} u.</strong> (${art.kilos_sugeridos.toLocaleString('es-AR')} kg)
                </span>
                <div class="cell-submeta" style="color: #cbd5e1; margin-top: 3px; font-size: 0.72rem;">
                    ${art.accion_requerida}
                </div>
                <div class="factibilidad-tag ${factClass}" title="${art.factibilidad.detalle}">
                    ${art.factibilidad.factible ? '✓ Insumos disponibles' : '⚠️ ' + (art.factibilidad.cuello_botella ? 'Bloqueado por: ' + art.factibilidad.cuello_botella : 'Faltan insumos')}
                </div>
            </div>
        `;
    }

    function getBarraCobertura(dias) {
        if (dias === 999) return '';
        let porcentaje = Math.min(100, Math.max(0, (dias / 30) * 100));
        let clase = 'optimo';
        if (dias <= 5) clase = 'critico';
        else if (dias <= 12) clase = 'atencion';
        else if (dias > 45) clase = 'sobres';

        return `
            <div class="coverage-bar-container" title="Cobertura: ${dias.toFixed(1)} días">
                <div class="coverage-bar ${clase}" style="width: ${porcentaje}%;"></div>
            </div>
        `;
    }

    // =========================================================================
    // FILTRADO DETERMINISTA DE REGISTROS
    // =========================================================================
    function filtrarItems(items) {
        if (!Array.isArray(items)) return [];
        const searchTerms = normalizarTexto(queryBusqueda).split(/\s+/).filter(Boolean);

        return items.filter(art => {
            // Filtro por semáforo
            if (filtroSemaforo === 'criticos') {
                if (art.estado_alarma !== 'CRITICO' && art.estado_alarma !== 'CRITICO_SIN_STOCK') return false;
            } else if (filtroSemaforo === 'atencion') {
                if (art.estado_alarma !== 'ATENCION' && art.estado_alarma !== 'ARMABLE_EN_DEPOSITO') return false;
            } else if (filtroSemaforo === 'optimos') {
                if (art.estado_alarma !== 'OPTIMO' && art.estado_alarma !== 'PLANIFICADO') return false;
            } else if (filtroSemaforo === 'sobre_stock') {
                if (art.estado_alarma !== 'SOBRE_STOCK') return false;
            } else if (filtroSemaforo === 'con_sugerencia') {
                if (art.cantidad_sugerida <= 0 && !(art.es_padre && (art.packs_a_armar || 0) > 0)) return false;
            }

            // Filtro por búsqueda unificada
            return coincideBusqueda(art, searchTerms);
        });
    }

    // =========================================================================
    // RENDERIZADO DE LAS PESTAÑAS
    // =========================================================================
    function renderizarVistaActiva() {
        if (!dataMaster) return;

        if (tabActiva === 'tab-produccion-interna') {
            renderizarTabProduccionInterna();
        } else if (tabActiva === 'tab-abastecimiento') {
            renderizarTabAbastecimiento();
        } else if (tabActiva === 'tab-prod-externa') {
            renderizarTabProduccionExterna();
        } else if (tabActiva === 'tab-frecuencias') {
            renderizarTabFrecuencias();
        } else if (tabActiva === 'tab-plan-semanal') {
            renderizarTabPlanSemanal();
        } else if (tabActiva === 'tab-fraccionado') {
            renderizarTabFraccionado();
        } else if (tabActiva === 'tab-mixes') {
            renderizarTabMixes();
        }
    }

    // =========================================================================
    // PESTAÑA PRINCIPAL: INFORME DE PRODUCCIÓN INTERNA (TALLER / DEPÓSITO)
    // Consolidación LDN 2 (Fraccionados Puros) + LDN 3 (Mixes) + Packs Armables
    // =========================================================================
    function renderizarTabProduccionInterna() {
        const kpisContainer = document.getElementById('kpis-resumen-taller');
        const containerMixes = document.getElementById('container-carros-mixes-taller');
        const subtitleMixes = document.getElementById('resumen-carros-mix-subtitulo');
        const tbodyEnvasado = document.getElementById('tbody-produccion-interna-taller');
        const subtitleEnvasado = document.getElementById('resumen-envasado-subtitulo');

        if (!dataMaster) return;

        const itemsTaller = dataMaster.produccion_interna_taller || [];
        const carros = dataMaster.carros_mixes_detallados || [];

        // 1. Mini-KPIs en Cabecera
        if (kpisContainer) {
            const itemsConAccion = itemsTaller.filter(a => a.cantidad_sugerida > 0 || (a.es_padre && (a.packs_a_armar || 0) > 0));
            const totalKgEnvasar = itemsConAccion.reduce((sum, a) => sum + (a.kilos_sugeridos || 0), 0);
            const quiebres = itemsTaller.filter(a => a.estado_alarma === 'CRITICO_SIN_STOCK' || (a.stock_neto_disponible !== undefined ? a.stock_neto_disponible <= 0 : a.stock_actual <= 0));
            const criticos = itemsTaller.filter(a => a.estado_alarma === 'CRITICO');
            const packsArmables = itemsTaller.filter(a => a.es_padre && (a.packs_a_armar || 0) > 0);
            const carrosRequierenMezcla = carros.filter(c => !c.granel_suficiente && (c.kilos_carro_sugeridos || 0) > 0);
            const totalKgCarros = carrosRequierenMezcla.reduce((sum, c) => sum + (c.kilos_carro_sugeridos || 0), 0);

            kpisContainer.innerHTML = `
                <div style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.25); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #34d399; font-weight: 700; text-transform: uppercase;">A Envasar (Mesa)</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #34d399;">${itemsConAccion.length} ítems</div>
                    <div style="font-size: 0.70rem; color: #94a3b8;">${totalKgEnvasar.toFixed(1)} kg tot.</div>
                </div>
                <div style="background: rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.25); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #22d3ee; font-weight: 700; text-transform: uppercase;">Carros a Mezclar</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #22d3ee;">${carrosRequierenMezcla.length} carros</div>
                    <div style="font-size: 0.70rem; color: #94a3b8;">${totalKgCarros.toFixed(1)} kg granel (${tandaMixKg}k/tanda)</div>
                </div>
                <div style="background: rgba(147, 51, 234, 0.1); border: 1px solid rgba(147, 51, 234, 0.25); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #c084fc; font-weight: 700; text-transform: uppercase;">📦 Packs Armables</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #c084fc;">${packsArmables.length} packs</div>
                    <div style="font-size: 0.70rem; color: #94a3b8;">Armar en depósito</div>
                </div>
                <div style="background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #f87171; font-weight: 700; text-transform: uppercase;">🔴 Quiebre (Stock 0)</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #f87171;">${quiebres.length}</div>
                    <div style="font-size: 0.70rem; color: #94a3b8;">Atención inmediata</div>
                </div>
                <div style="background: rgba(249,115,22,0.12); border: 1px solid rgba(249,115,22,0.3); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #fb923c; font-weight: 700; text-transform: uppercase;">🟠 Críticos (≤5d)</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #fb923c;">${criticos.length}</div>
                    <div style="font-size: 0.70rem; color: #94a3b8;">Riesgo esta semana</div>
                </div>
            `;
        }

        // 2. BLOQUE A: CARROS DE MEZCLA A GRANEL (LDN 3 - ARTÍCULOS PUENTE)
        if (containerMixes) {
            const carrosRequierenMezcla = carros.filter(c => !c.granel_suficiente && (c.kilos_carro_sugeridos || 0) > 0);
            const totalKgCarros = carrosRequierenMezcla.reduce((sum, c) => sum + (c.kilos_carro_sugeridos || 0), 0);
            const carrosGranelListo = carros.filter(c => c.granel_suficiente);

            if (subtitleMixes) {
                subtitleMixes.innerHTML = `<span style="color: #22d3ee; font-weight: 700;">🥣 ${carrosRequierenMezcla.length} carros</span> a mezclar (${totalKgCarros.toFixed(1)} kg) &bull; <span style="color: #34d399; font-weight: 700;">🟢 ${carrosGranelListo.length} mixes</span> con granel suficiente`;
            }

            // Filtrado de carros según semáforo y búsqueda
            const searchTerms = normalizarTexto(queryBusqueda).split(/\s+/).filter(Boolean);
            const carrosFiltrados = carros.filter(c => {
                if (filtroSemaforo === 'criticos') {
                    if (c.urgencia_maxima !== 1 && c.urgencia_maxima !== 2) return false;
                } else if (filtroSemaforo === 'con_sugerencia') {
                    const tieneEnvase = c.presentaciones && c.presentaciones.some(p => p.cantidad_sugerida > 0 || (p.es_padre && (p.packs_a_armar || 0) > 0));
                    if ((c.kilos_carro_sugeridos || 0) <= 0 && !tieneEnvase) return false;
                } else if (filtroSemaforo === 'atencion') {
                    if (c.urgencia_maxima !== 3) return false;
                } else if (filtroSemaforo === 'optimos') {
                    if (c.urgencia_maxima < 4) return false;
                }

                if (searchTerms.length > 0) {
                    const searchStr = normalizarTexto([
                        c.ap_sku,
                        c.mix_nombre,
                        c.factibilidad?.cuello_botella || '',
                        ...(c.receta_pesaje || []).map(r => r.componente_nombre),
                        ...(c.presentaciones || []).map(p => p.articulo_id + ' ' + p.descripcion)
                    ].join(' '));
                    if (!searchTerms.every(term => searchStr.includes(term))) return false;
                }

                return true;
            });

            if (carrosFiltrados.length === 0) {
                containerMixes.innerHTML = `<div class="empty-state" style="padding: 24px; text-align: center; color: #94a3b8;">No hay carros de mezcla que coincidan con los filtros seleccionados.</div>`;
            } else {
                containerMixes.innerHTML = carrosFiltrados.map(carro => {
                    let urgBadge = '';
                    if (carro.urgencia_maxima === 1) {
                        urgBadge = `<span class="badge-status status-critico-sin-stock" style="font-size: 0.72rem; padding: 3px 8px;">🔴 Quiebre Inmediato</span>`;
                    } else if (carro.urgencia_maxima === 2) {
                        urgBadge = `<span class="badge-status status-critico" style="font-size: 0.72rem; padding: 3px 8px;">🟠 Crítico (≤5d)</span>`;
                    } else if (carro.urgencia_maxima === 3) {
                        urgBadge = `<span class="badge-status status-atencion" style="font-size: 0.72rem; padding: 3px 8px;">🟡 Atención</span>`;
                    } else {
                        urgBadge = `<span class="badge-status status-optimo" style="font-size: 0.72rem; padding: 3px 8px;">🟢 Óptimo / Planificado</span>`;
                    }

                    const estadoCardClass = carro.granel_suficiente 
                        ? 'listo' 
                        : (carro.factibilidad?.factible ? 'listo' : 'bloqueado');

                    let badgeFactible = '';
                    if (carro.granel_suficiente) {
                        badgeFactible = `<span class="badge-status status-optimo" style="font-size: 0.72rem; padding: 3px 8px;">🟢 GRANEL DISPONIBLE (${(carro.stock_granel_taller_kg || 0).toFixed(1)} kg) &bull; DIRECTO A ENVASAR</span>`;
                    } else if ((carro.kilos_carro_sugeridos || 0) > 0) {
                        const factibleHtml = carro.factibilidad?.factible 
                            ? `<span class="badge-status status-optimo" style="font-size: 0.72rem; padding: 3px 8px;">🟢 LISTO PARA ARMAR</span>`
                            : `<span class="badge-status status-critico" style="font-size: 0.72rem; padding: 3px 8px;" title="Insumo faltante: ${carro.factibilidad?.cuello_botella}">🔴 BLOQUEADO: Falta ${carro.factibilidad?.cuello_botella}</span>`;
                        const tandasHtml = `<span class="badge-status" style="background: rgba(59,130,246,0.2); color: #60a5fa; font-size: 0.72rem; padding: 3px 8px; font-weight: 700;">🥣 MEZCLAR CARRO: ${carro.tandas_carro} tanda(s) de ${carro.tanda_kg || tandaMixKg} kg = ${(carro.kilos_carro_sugeridos || 0).toFixed(1)} kg</span>`;
                        badgeFactible = `${factibleHtml} ${tandasHtml}`;
                    } else {
                        badgeFactible = `<span class="badge-status status-optimo" style="font-size: 0.72rem; padding: 3px 8px;">🟢 STOCK CUBIERTO</span>`;
                    }

                    let kpiHeaderHtml = '';
                    if (carro.granel_suficiente) {
                        kpiHeaderHtml = `
                            <div style="text-align: right;">
                                <div style="font-size: 0.70rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Granel en Depósito</div>
                                <div style="font-size: 1.25rem; font-weight: 800; color: #34d399;">${(carro.stock_granel_taller_kg || 0).toFixed(1)} kg</div>
                                <div style="font-size: 0.70rem; color: #94a3b8;">Demanda envasado: ${(carro.kilos_totales_solicitados || 0).toFixed(1)} kg</div>
                            </div>
                        `;
                    } else {
                        kpiHeaderHtml = `
                            <div style="text-align: right;">
                                <div style="font-size: 0.70rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Lote Carro Sugerido</div>
                                <div style="font-size: 1.25rem; font-weight: 800; color: #22d3ee;">${(carro.kilos_carro_sugeridos || 0).toFixed(1)} kg</div>
                                <div style="font-size: 0.70rem; color: #94a3b8;">${carro.tandas_carro} tanda(s) de ${carro.tanda_kg || tandaMixKg} kg ${(carro.stock_granel_taller_kg || 0) > 0 ? `(+${carro.stock_granel_taller_kg.toFixed(1)}k disp.)` : ''}</div>
                            </div>
                        `;
                    }

                    let contenidoPesajeHtml = '';
                    if (carro.granel_suficiente) {
                        contenidoPesajeHtml = `
                            <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px; padding: 12px 16px; display: flex; align-items: center; gap: 14px;">
                                <span style="font-size: 1.5rem;">✅</span>
                                <div>
                                    <div style="color: #34d399; font-weight: 800; font-size: 0.88rem;">
                                        No requiere pesaje ni mezclado de materias primas
                                    </div>
                                    <div style="color: #94a3b8; font-size: 0.78rem; margin-top: 2px;">
                                        Hay <strong>${(carro.stock_granel_taller_kg || 0).toFixed(1)} kg</strong> de granel disponible en depósito. Cubre los <strong>${(carro.kilos_totales_solicitados || 0).toFixed(1)} kg</strong> necesarios. Fraccionar directamente en la <strong>Mesa de Envasado</strong> (Fase 2 abajo).
                                    </div>
                                </div>
                            </div>
                        `;
                    } else if ((carro.kilos_carro_sugeridos || 0) > 0) {
                        const filasPesaje = (carro.receta_pesaje || []).map(comp => {
                            const stockStr = `${comp.stock_disponible_kg} kg disp.`;
                            const dispClass = comp.alcanza ? 'color: #34d399; font-weight: 700;' : 'color: #f87171; font-weight: 700;';
                            const dispBadge = comp.alcanza
                                ? `<span style="color: #34d399; font-size: 0.74rem;">✓ OK</span>`
                                : `<span style="color: #f87171; font-size: 0.74rem;">⚠️ Falta</span>`;

                            return `
                                <tr>
                                    <td style="text-align: center;"><span class="check-item-box"></span></td>
                                    <td><strong>${comp.componente_nombre}</strong></td>
                                    <td style="text-align: right; color: var(--text-secondary);">${comp.proporcion_pct}%</td>
                                    <td style="text-align: right; background: rgba(59, 130, 246, 0.08);">
                                        <strong style="color: #60a5fa; font-size: 0.88rem;">${comp.kilos_a_pesar.toFixed(2)} kg</strong>
                                    </td>
                                    <td style="text-align: right; ${dispClass}">${stockStr}</td>
                                    <td style="text-align: center;">${dispBadge}</td>
                                </tr>
                            `;
                        }).join('');

                        contenidoPesajeHtml = `
                            <div class="table-responsive">
                                <table class="carro-pesaje-table">
                                    <thead>
                                        <tr>
                                            <th style="width: 32px; text-align: center;">✓</th>
                                            <th>Componente / Materia Prima</th>
                                            <th style="text-align: right; width: 80px;">% Receta</th>
                                            <th style="text-align: right; width: 130px; background: rgba(59, 130, 246, 0.1);">KILOS A PESAR</th>
                                            <th style="text-align: right; width: 120px;">Stock Disponible</th>
                                            <th style="width: 100px; text-align: center;">Disponibilidad</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${filasPesaje}
                                    </tbody>
                                </table>
                            </div>
                        `;
                    } else {
                        contenidoPesajeHtml = `
                            <div style="background: rgba(148, 163, 184, 0.08); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 6px; padding: 10px 14px; color: #94a3b8; font-size: 0.78rem;">
                                Sin requerimiento de mezclado en este ciclo.
                            </div>
                        `;
                    }

                    const presCount = (carro.presentaciones || []).length;
                    const presConSugerencia = (carro.presentaciones || []).filter(p => p.cantidad_sugerida > 0 || (p.es_padre && (p.packs_a_armar || 0) > 0));

                    return `
                        <div class="carro-mix-card ${estadoCardClass}" style="margin-bottom: 0;">
                            <div class="carro-mix-header" style="padding: 10px 14px;">
                                <div class="carro-mix-title-box">
                                    <span class="carro-mix-badge-sku">${carro.ap_sku}</span>
                                    <span class="carro-mix-name" style="font-size: 1rem;">${carro.mix_nombre}</span>
                                    ${urgBadge}
                                    ${badgeFactible}
                                </div>
                                <div class="carro-mix-kpis">
                                    ${kpiHeaderHtml}
                                </div>
                            </div>
                            <div class="carro-mix-body" style="padding: 12px 14px;">
                                ${contenidoPesajeHtml}
                                <div style="margin-top: 8px; font-size: 0.74rem; color: #94a3b8; display: flex; justify-content: space-between; align-items: center;">
                                    <span>Alimenta a <strong>${presCount}</strong> presentaciones comerciales (${presConSugerencia.length} a envasar).</span>
                                    <span style="color: #60a5fa;">Ver filas en Mesa de Envasado &darr;</span>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // 3. BLOQUE B: TABLA MAESTRA DE ENVASADO AGRUPADA (LDN 2 + LDN 3 + PACKS AL FINAL)
        if (tbodyEnvasado) {
            const itemsFiltrados = filtrarItems(itemsTaller);

            // Separación canónica en 3 grupos deterministas:
            // 1) LDN 2: Fraccionados Puros agrupados por Ingrediente/Materia Prima (sin padre)
            // 2) LDN 3: Mixes Comerciales (sin padre)
            // 3) Packs Armables en Depósito (Artículos Padre al final)
            const ldn2Items = agruparYOrdenarPorIngrediente(itemsFiltrados.filter(a => a.ldn === 2 && !a.es_padre));
            const ldn3Items = itemsFiltrados.filter(a => a.ldn === 3 && !a.es_padre).sort(ordenarPorUrgenciaYCantidad);
            const packsItems = itemsFiltrados.filter(a => a.es_padre).sort(ordenarPorUrgenciaYCantidad);

            const conAccionTotales = itemsFiltrados.filter(a => a.cantidad_sugerida > 0 || (a.es_padre && (a.packs_a_armar || 0) > 0));

            if (subtitleEnvasado) {
                subtitleEnvasado.innerHTML = `Mostrando <strong style="color: #f8fafc;">${itemsFiltrados.length}</strong> ítems (${ldn2Items.length} Puros &bull; ${ldn3Items.length} Mixes &bull; ${packsItems.length} Packs) &bull; <strong style="color: #34d399;">${conAccionTotales.length} con acción inmediata</strong>`;
            }

            if (itemsFiltrados.length === 0) {
                tbodyEnvasado.innerHTML = `<tr><td colspan="9" class="empty-state">No se encontraron artículos de producción interna bajo los filtros activos.</td></tr>`;
                return;
            }

            function renderFilaTallerWeb(art) {
                const cobStr = art.dias_cobertura === 999 ? '∞' : `${art.dias_cobertura.toFixed(1)}d`;
                const rowClass = (art.estado_alarma === 'CRITICO' || art.estado_alarma === 'CRITICO_SIN_STOCK') ? 'row-critico' : '';

                // Badges LDN y Padre/Hijo
                const ldnBadge = art.ldn === 2
                    ? `<span class="badge-ldn ldn-2" style="font-size: 0.65rem; padding: 1px 4px; margin-right: 4px;">[LDN 2] Fracc.</span>`
                    : `<span class="badge-ldn ldn-3" style="font-size: 0.65rem; padding: 1px 4px; margin-right: 4px;">[LDN 3] Mix</span>`;

                let relBadge = '';
                if (art.es_padre) {
                    relBadge = `<span class="badge-status" style="background: rgba(147, 51, 234, 0.2); color: #c084fc; font-size: 0.65rem; padding: 1px 4px; margin-right: 4px;">PACK x${art.pack_unidades}</span>`;
                } else if (art.es_hijo) {
                    relBadge = `<span class="badge-status" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; font-size: 0.65rem; padding: 1px 4px; margin-right: 4px;">FRACCIÓN</span>`;
                }

                // A Envasar HTML
                let aEnvasarHtml = '';
                if (art.es_padre) {
                    if (art.packs_a_armar && art.packs_a_armar > 0) {
                        aEnvasarHtml = `
                            <span class="accion-badge" style="background: rgba(147, 51, 234, 0.2); color: #c084fc; border: 1px solid rgba(147, 51, 234, 0.4); font-size: 0.78rem;">
                                📦 Armar ${art.packs_a_armar} packs
                            </span>
                            <div class="cell-submeta" style="color: #c084fc; margin-top: 2px;">
                                Armar para pedidos con ${art.pack_hijo_codigo || 'hijo'}
                            </div>
                        `;
                    } else if (art.estado_alarma === 'CRITICO_SIN_STOCK') {
                        aEnvasarHtml = `
                            <span class="accion-badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-size: 0.78rem;">
                                🔴 Faltan bolsas hijas
                            </span>
                            <div class="cell-submeta" style="color: #f87171; margin-top: 2px;">
                                Envasar primero hijo [${art.pack_hijo_codigo || ''}]
                            </div>
                        `;
                    } else {
                        aEnvasarHtml = `
                            <span class="badge-status" style="background: rgba(16, 185, 129, 0.12); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.75rem; padding: 2px 6px;">
                                ✓ ${formatearBolsas(art.packs_armables || 0)} packs disponibles
                            </span>
                            <div class="cell-submeta" style="color: #94a3b8; margin-top: 2px;">En stock de depósito (${art.pack_hijo_codigo || ''})</div>
                        `;
                    }
                } else if (art.cantidad_sugerida > 0) {
                    aEnvasarHtml = `
                        <span class="accion-badge accion-produccion" style="font-size: 0.82rem; padding: 4px 8px;">
                            ⚙️ <strong>+${formatearBolsas(art.cantidad_sugerida)} bolsas</strong>
                        </span>
                        <div class="cell-submeta" style="color: #cbd5e1; margin-top: 2px;">
                            ${art.kilos_sugeridos.toFixed(1)} kg (${art.kilos_unidad} kg/u)
                        </div>
                    `;
                } else {
                    aEnvasarHtml = `<span style="color: var(--text-muted); font-size: 0.76rem;">✓ Cobertura suficiente</span>`;
                }

                // Ubicación e insumo de materia prima
                let ubicacionHtml = '';
                if (art.es_padre) {
                    ubicacionHtml = `
                        <div style="color: #c084fc; font-weight: 700; font-size: 0.78rem;">
                            📦 Armar con unidades de [${art.pack_hijo_codigo || art.hijo_vinculado || 'Hijo'}]
                        </div>
                        <div class="cell-submeta" style="color: #94a3b8;">Depósito: ${formatearBolsas(art.packs_armables || 0)} packs armables listos</div>
                    `;
                } else if (art.ldn === 3) {
                    // Mix comercial
                    if (art.mix_granel_suficiente) {
                        ubicacionHtml = `
                            <div style="color: #34d399; font-weight: 700; font-size: 0.78rem;">
                                🟢 Granel listo en taller (${(art.mix_granel_disponible_kg || 0).toFixed(1)} kg disp.)
                            </div>
                            <div class="cell-submeta" style="color: #94a3b8;">Mix base: ${art.materia_prima_nombre || ''}</div>
                        `;
                    } else if ((art.mix_carro_requerido_kg || 0) > 0) {
                        ubicacionHtml = `
                            <div style="color: #22d3ee; font-weight: 700; font-size: 0.78rem;">
                                🥣 Requiere Carro (${art.mix_carro_requerido_kg.toFixed(1)} kg en ${art.mix_tandas_requeridas || 1} tanda/s)
                            </div>
                            <div class="cell-submeta" style="color: #94a3b8;">Ver receta de pesaje en Fase 1 arriba</div>
                        `;
                    } else {
                        ubicacionHtml = `<div style="font-size: 0.74rem; color: var(--text-muted);">${art.materia_prima_nombre || ''} &bull; Granel suficiente</div>`;
                    }
                } else {
                    // Fraccionado puro (LDN 2)
                    const kgSueltos = parseFloat(art.stock_taller_kg || 0);
                    const bultosTaller = parseFloat(art.bultos_taller || 0);
                    const bultosDepo = parseFloat(art.bultos_deposito || 0);
                    const reqKg = parseFloat(art.kilos_sugeridos || 0);

                    if (reqKg > 0) {
                        if (kgSueltos >= reqKg) {
                            ubicacionHtml = `
                                <div style="color: #34d399; font-weight: 700; font-size: 0.78rem;">
                                    🟢 Bolsa abierta en taller (${kgSueltos.toFixed(1)} kg disp.)
                                </div>
                                <div class="cell-submeta" style="color: #94a3b8;">Insumo: ${art.materia_prima_nombre || '-'}</div>
                            `;
                        } else if (bultosTaller > 0) {
                            ubicacionHtml = `
                                <div style="color: #38bdf8; font-weight: 700; font-size: 0.78rem;">
                                    📦 Taller: Abrir bulto cerrado (${bultosTaller} cj disp.)
                                </div>
                                <div class="cell-submeta" style="color: #94a3b8;">Insumo: ${art.materia_prima_nombre || '-'} ${kgSueltos > 0 ? `(+${kgSueltos.toFixed(1)} kg abiertos)` : ''}</div>
                            `;
                        } else if (bultosDepo > 0) {
                            ubicacionHtml = `
                                <div style="color: #60a5fa; font-weight: 700; font-size: 0.78rem;">
                                    🏢 Depósito: Pedir bulto cerrado (${bultosDepo} cj disp.)
                                </div>
                                <div class="cell-submeta" style="color: #94a3b8;">Insumo: ${art.materia_prima_nombre || '-'} ${kgSueltos > 0 ? `(+${kgSueltos.toFixed(1)} kg en taller)` : ''}</div>
                            `;
                        } else {
                            ubicacionHtml = `
                                <div style="color: #f87171; font-weight: 700; font-size: 0.78rem;">
                                    🔴 Sin materia prima en stock
                                </div>
                                <div class="cell-submeta" style="color: #fca5a5;">Insumo: ${art.materia_prima_nombre || '-'} &bull; Pedir a proveedor</div>
                            `;
                        }
                    } else {
                        ubicacionHtml = `<div style="font-size: 0.74rem; color: var(--text-muted);">${art.materia_prima_nombre || '-'} &bull; Stock en rango</div>`;
                    }
                }

                // Submetas de stock
                let stockMeta = `<div class="cell-submeta">${(art.stock_kilos || 0).toFixed(1)} kg</div>`;
                if (art.comprometido_presupuestos > 0) {
                    stockMeta += `<div class="cell-submeta" style="color: #fb923c;">📋 Pedidos: ${formatearBolsas(art.comprometido_presupuestos)}u (${art.presupuestos_cant || 0} ped.)</div>`;
                    stockMeta += `<div class="cell-submeta" style="color: ${art.stock_neto_disponible < 0 ? '#f87171' : '#34d399'}; font-weight: 700;">Neto: ${formatearUnidadesStock(art.stock_neto_disponible)}u</div>`;
                }
                if (art.es_padre && art.packs_armables > 0) {
                    stockMeta += `<div class="cell-submeta" style="color: #c084fc;">📦 ${formatearBolsas(art.packs_armables)} armables</div>`;
                }

                return `
                    <tr class="${rowClass}">
                        <td>${getBadgeSemaforo(art.estado_alarma, art.dias_cobertura, art.packs_armables)}</td>
                        <td class="cell-sku">
                            ${ldnBadge}
                            ${relBadge}
                            <span>${art.articulo_id}</span>
                        </td>
                        <td class="cell-desc">
                            <strong>${art.descripcion}</strong>
                            <div class="cell-submeta">${art.familia_nombre || ''} &bull; ${art.kilos_unidad} kg/u.</div>
                        </td>
                        <td class="cell-num">
                            <strong style="color: ${art.stock_actual <= 0 ? '#f87171' : '#fff'};">
                                ${formatearUnidadesStock(art.stock_actual)} u.
                            </strong>
                            ${stockMeta}
                        </td>
                        <td class="cell-num">
                            <strong>${art.demanda_diaria_promedio.toFixed(2)}/d</strong>
                            <div class="cell-submeta">${art.ventas_ventana.toLocaleString('es-AR')} en ${ventanaDiasDemanda}d</div>
                            ${art.es_esporadico 
                                ? `<div class="cell-submeta" style="color: #94a3b8; font-size: 0.68rem;" title="Demanda esporádica: ${art.ventas_90d || 0}u vendidas en ${art.semanas_activas_90d || 0} de las últimas 13 semanas">⏳ Esporádico (${art.semanas_activas_90d || 0} sem/90d)</div>` 
                                : (art.es_rotacion_semanal 
                                    ? `<div class="cell-submeta" style="color: #34d399; font-size: 0.68rem; font-weight: 600;" title="Rotación regular semanal: se vendió en ${art.semanas_activas_90d || 0} de las últimas 13 semanas">🔄 Semanal (${art.semanas_activas_90d || 0} sem/90d)</div>` 
                                    : '')}
                        </td>
                        <td class="cell-num">
                            <strong>${cobStr}</strong>
                            <div>${getBarraCobertura(art.dias_cobertura)}</div>
                        </td>
                        <td class="cell-num" style="background-color: rgba(16, 185, 129, 0.06);">
                            ${aEnvasarHtml}
                        </td>
                        <td>${ubicacionHtml}</td>
                        <td style="text-align: center;">
                            <button onclick="window.abrirModalDetalle('${art.articulo_id}')" class="btn-action btn-secondary" style="padding: 4px 8px; font-size: 0.72rem;" title="Ver desglose completo de stock, ventas y recetas">
                                🔍 Info
                            </button>
                        </td>
                    </tr>
                `;
            }

            let htmlCompleto = '';

            // SECCIÓN 1: LDN 2 FRACCIONADOS PUROS (MONO-INGREDIENTES 100% PUROS)
            if (filtroGrupoTaller === 'todos' || filtroGrupoTaller === 'ldn2') {
                const conAccionLdn2 = ldn2Items.filter(a => a.cantidad_sugerida > 0);
                const kgLdn2 = conAccionLdn2.reduce((sum, a) => sum + (a.kilos_sugeridos || 0), 0);
                const quiebresLdn2 = ldn2Items.filter(a => (a.stock_neto_disponible !== undefined ? a.stock_neto_disponible <= 0 : a.stock_actual <= 0)).length;

                htmlCompleto += `
                    <tr class="seccion-header-row ldn-2-header">
                        <td colspan="9">
                            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 1.15rem;">🌾</span>
                                    <span style="font-size: 0.88rem; font-weight: 800; color: #34d399;">LÍNEA DE NEGOCIO 2: FRACCIONADOS PUROS (MONO-INGREDIENTES 100% PUROS)</span>
                                    <span class="badge-status status-optimo" style="font-size: 0.70rem; padding: 2px 7px;">${ldn2Items.length} ítems</span>
                                </div>
                                <div style="font-size: 0.76rem; color: #cbd5e1; font-weight: normal;">
                                    A envasar: <strong style="color: #34d399; font-weight: 700;">${kgLdn2.toFixed(1)} kg</strong> (${conAccionLdn2.length} con acción) ${quiebresLdn2 > 0 ? `&bull; <span style="color: #f87171; font-weight: 700;">🔴 ${quiebresLdn2} quiebre(s)</span>` : ''}
                                </div>
                            </div>
                        </td>
                    </tr>
                `;

                if (ldn2Items.length === 0) {
                    htmlCompleto += `<tr><td colspan="9" style="text-align: center; color: #94a3b8; padding: 12px; font-style: italic;">Sin artículos de LDN 2 bajo los filtros seleccionados.</td></tr>`;
                } else {
                    htmlCompleto += ldn2Items.map(renderFilaTallerWeb).join('');
                }
            }

            // SECCIÓN 2: LDN 3 MIXES (PRESENTACIONES COMERCIALES)
            if (filtroGrupoTaller === 'todos' || filtroGrupoTaller === 'ldn3') {
                const conAccionLdn3 = ldn3Items.filter(a => a.cantidad_sugerida > 0);
                const kgLdn3 = conAccionLdn3.reduce((sum, a) => sum + (a.kilos_sugeridos || 0), 0);
                const quiebresLdn3 = ldn3Items.filter(a => (a.stock_neto_disponible !== undefined ? a.stock_neto_disponible <= 0 : a.stock_actual <= 0)).length;

                htmlCompleto += `
                    <tr class="seccion-header-row ldn-3-header">
                        <td colspan="9">
                            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 1.15rem;">🥣</span>
                                    <span style="font-size: 0.88rem; font-weight: 800; color: #22d3ee;">LÍNEA DE NEGOCIO 3: MIXES (PRESENTACIONES COMERCIALES)</span>
                                    <span class="badge-status" style="background: rgba(6, 182, 212, 0.2); color: #22d3ee; font-size: 0.70rem; padding: 2px 7px;">${ldn3Items.length} ítems</span>
                                </div>
                                <div style="font-size: 0.76rem; color: #cbd5e1; font-weight: normal;">
                                    A envasar: <strong style="color: #22d3ee; font-weight: 700;">${kgLdn3.toFixed(1)} kg</strong> (${conAccionLdn3.length} con acción) ${quiebresLdn3 > 0 ? `&bull; <span style="color: #f87171; font-weight: 700;">🔴 ${quiebresLdn3} quiebre(s)</span>` : ''}
                                </div>
                            </div>
                        </td>
                    </tr>
                `;

                if (ldn3Items.length === 0) {
                    htmlCompleto += `<tr><td colspan="9" style="text-align: center; color: #94a3b8; padding: 12px; font-style: italic;">Sin artículos de LDN 3 bajo los filtros seleccionados.</td></tr>`;
                } else {
                    htmlCompleto += ldn3Items.map(renderFilaTallerWeb).join('');
                }
            }

            // SECCIÓN 3: ARMAR EN DEPÓSITO (ARTÍCULOS PADRE / PACKS AL FINAL)
            if (filtroGrupoTaller === 'todos' || filtroGrupoTaller === 'packs') {
                const totalPacksArmables = packsItems.reduce((sum, a) => sum + (a.packs_armables || 0), 0);
                const packsConAccion = packsItems.filter(a => a.packs_armables > 0 || (a.stock_neto_disponible !== undefined ? a.stock_neto_disponible <= 0 : a.stock_actual <= 0));
                const quiebresPacks = packsItems.filter(a => (a.stock_neto_disponible !== undefined ? a.stock_neto_disponible <= 0 : a.stock_actual <= 0)).length;

                htmlCompleto += `
                    <tr class="seccion-header-row packs-header">
                        <td colspan="9">
                            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 1.15rem;">📦</span>
                                    <span style="font-size: 0.88rem; font-weight: 800; color: #c084fc;">ARMAR EN DEPÓSITO: PACKS (ARTÍCULOS PADRE CON HIJOS ASOCIADOS)</span>
                                    <span class="badge-status" style="background: rgba(147, 51, 234, 0.2); color: #c084fc; font-size: 0.70rem; padding: 2px 7px;">${packsItems.length} packs</span>
                                </div>
                                <div style="font-size: 0.76rem; color: #cbd5e1; font-weight: normal;">
                                    Armables en depósito: <strong style="color: #c084fc; font-weight: 700;">${totalPacksArmables} packs</strong> (${packsConAccion.length} activos) ${quiebresPacks > 0 ? `&bull; <span style="color: #f87171; font-weight: 700;">🔴 ${quiebresPacks} quiebre(s)</span>` : ''}
                                </div>
                            </div>
                        </td>
                    </tr>
                `;

                if (packsItems.length === 0) {
                    htmlCompleto += `<tr><td colspan="9" style="text-align: center; color: #94a3b8; padding: 12px; font-style: italic;">Sin artículos padre / packs bajo los filtros seleccionados.</td></tr>`;
                } else {
                    htmlCompleto += packsItems.map(renderFilaTallerWeb).join('');
                }
            }

            tbodyEnvasado.innerHTML = htmlCompleto;
        }
    }

    // TAB 1: PLAN SEMANAL PRIORIZADO (EL LUNES A LA MAÑANA)
    function renderizarTabPlanSemanal() {
        const container = document.getElementById('tbody-plan-semanal');
        if (!container) return;

        const items = filtrarItems(dataMaster.plan_semanal_priorizado);
        if (items.length === 0) {
            container.innerHTML = `<tr><td colspan="8" class="empty-state">No se encontraron artículos que coincidan con los filtros seleccionados.</td></tr>`;
            return;
        }

        container.innerHTML = items.map(art => {
            const rowClass = (art.estado_alarma === 'CRITICO' || art.estado_alarma === 'CRITICO_SIN_STOCK') ? 'row-critico' : '';
            
            // Badges Padre/Hijo
            let relBadge = '';
            if (art.es_padre) {
                relBadge = `<span class="badge-status" style="background: rgba(147, 51, 234, 0.2); color: #c084fc; font-size: 0.68rem; margin-right: 4px;">📦 PACK x${art.pack_unidades}</span>`;
            } else if (art.es_hijo) {
                relBadge = `<span class="badge-status" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; font-size: 0.68rem; margin-right: 4px;">🧒 FRACCIÓN</span>`;
            }

            // Submetas de Stock
            let stockMeta = `<div class="cell-submeta">${art.stock_kilos.toFixed(1)} kg</div>`;
            if (art.comprometido_presupuestos > 0) {
                stockMeta += `<div class="cell-submeta" style="color: #fb923c;">📋 Pedidos: ${art.comprometido_presupuestos}u (${art.presupuestos_cant} ped.)</div>`;
                stockMeta += `<div class="cell-submeta" style="color: ${art.stock_neto_disponible < 0 ? '#f87171' : '#34d399'}; font-weight: 700;">Neto: ${art.stock_neto_disponible}u</div>`;
            }
            if (art.es_padre && art.packs_armables > 0) {
                stockMeta += `<div class="cell-submeta" style="color: #c084fc;">📦 ${art.packs_armables} armables</div>`;
            }

            return `
                <tr class="${rowClass}">
                    <td class="cell-sku">
                        ${relBadge}
                        <span>${art.articulo_id}</span>
                    </td>
                    <td class="cell-desc">
                        <strong>${art.descripcion}</strong>
                        <div class="cell-submeta">${art.familia_nombre} &bull; ${art.kilos_unidad} kg/u.</div>
                    </td>
                    <td>${getBadgeLDN(art.ldn)}</td>
                    <td class="cell-num">
                        <strong style="color: ${art.stock_actual <= 0 ? '#f87171' : '#fff'}; font-size: 0.92rem;">
                            ${formatearUnidadesStock(art.stock_actual)} u.
                        </strong>
                        ${stockMeta}
                    </td>
                    <td class="cell-num">
                        <strong>${art.demanda_diaria_promedio.toFixed(2)}/día</strong>
                        <div class="cell-submeta">${art.ventas_ventana.toLocaleString('es-AR')} en ${ventanaDiasDemanda}d</div>
                    </td>
                    <td>
                        ${getBadgeSemaforo(art.estado_alarma, art.dias_cobertura, art.packs_armables)}
                        <div>${getBarraCobertura(art.dias_cobertura)}</div>
                    </td>
                    <td>${getBadgeAccion(art)}</td>
                    <td style="text-align: center;">
                        <button onclick="window.abrirModalDetalle('${art.articulo_id}')" class="btn-action btn-secondary" style="padding: 4px 8px; font-size: 0.72rem;" title="Ver desglose completo de stock, ventas y recetas">
                            🔍 Info
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // TAB 2: FRACCIONAMIENTO PURO (LDN 2 - MONO-INGREDIENTES 100% PUROS)
    function renderizarTabFraccionado() {
        const tbody = document.getElementById('tbody-fraccionado-puro');
        const kpisContainer = document.getElementById('kpis-resumen-fraccionado-tab');
        if (!tbody || !dataMaster) return;

        const ldn = dataMaster.lineas_de_negocio || {};
        const itemsPuros = ldn.ldn2_fraccionados || [];

        // 1. Mini-KPIs de la cabecera
        if (kpisContainer) {
            const itemsConSugerencia = itemsPuros.filter(a => a.cantidad_sugerida > 0);
            const totalKgSugeridos = itemsConSugerencia.reduce((sum, a) => sum + (a.kilos_sugeridos || 0), 0);
            const quiebres = itemsPuros.filter(a => a.estado_alarma === 'CRITICO_SIN_STOCK' || a.stock_actual <= 0);
            const criticos = itemsPuros.filter(a => a.estado_alarma === 'CRITICO');
            const tallerListos = itemsConSugerencia.filter(a => (a.stock_taller_kg || 0) >= a.kilos_sugeridos || (a.bultos_taller || 0) > 0);
            const depositoListos = itemsConSugerencia.filter(a => (a.stock_taller_kg || 0) < a.kilos_sugeridos && (a.bultos_taller || 0) <= 0 && (a.bultos_deposito || 0) > 0);
            const sinInsumo = itemsConSugerencia.filter(a => (a.stock_taller_kg || 0) < a.kilos_sugeridos && (a.bultos_taller || 0) <= 0 && (a.bultos_deposito || 0) <= 0);

            kpisContainer.innerHTML = `
                <div style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.25); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #34d399; font-weight: 700; text-transform: uppercase;">A Fraccionar</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #34d399;">${itemsConSugerencia.length} ítems</div>
                </div>
                <div style="background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.25); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #60a5fa; font-weight: 700; text-transform: uppercase;">Kilos Totales</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #60a5fa;">${totalKgSugeridos.toFixed(1)} kg</div>
                </div>
                <div style="background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #f87171; font-weight: 700; text-transform: uppercase;">🔴 Quiebre (Stock 0)</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #f87171;">${quiebres.length}</div>
                </div>
                <div style="background: rgba(249,115,22,0.12); border: 1px solid rgba(249,115,22,0.3); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #fb923c; font-weight: 700; text-transform: uppercase;">🟠 Críticos (≤5d)</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #fb923c;">${criticos.length}</div>
                </div>
                <div style="background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #34d399; font-weight: 700; text-transform: uppercase;">🟢 Abierto en Taller</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #34d399;">${tallerListos.length}</div>
                </div>
                <div style="background: rgba(147,197,253,0.12); border: 1px solid rgba(147,197,253,0.3); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #93c5fd; font-weight: 700; text-transform: uppercase;">📦 Bulto en Depósito</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #93c5fd;">${depositoListos.length}</div>
                </div>
                <div style="background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #fca5a5; font-weight: 700; text-transform: uppercase;">⚠️ Sin Materia Prima</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #fca5a5;">${sinInsumo.length}</div>
                </div>
            `;
        }

        // 2. Filtrar items
        const items = filtrarItems(itemsPuros);
        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No se encontraron artículos de fraccionamiento puro bajo los filtros activos.</td></tr>`;
            return;
        }

        tbody.innerHTML = items.map(art => {
            const cobStr = art.dias_cobertura === 999 ? '∞' : `${art.dias_cobertura.toFixed(1)}d`;
            const rowClass = (art.estado_alarma === 'CRITICO' || art.estado_alarma === 'CRITICO_SIN_STOCK') ? 'row-critico' : '';

            // Badges Padre/Hijo
            let relBadge = '';
            if (art.es_padre) {
                relBadge = `<span class="badge-status" style="background: rgba(147, 51, 234, 0.2); color: #c084fc; font-size: 0.68rem; margin-right: 4px;">📦 PACK x${art.pack_unidades}</span>`;
            } else if (art.es_hijo) {
                relBadge = `<span class="badge-status" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; font-size: 0.68rem; margin-right: 4px;">🧒 FRACCIÓN</span>`;
            }

            // Sugerencia a envasar
            let aEnvasarHtml = '';
            if (art.es_padre) {
                if (art.estado_alarma === 'ARMABLE_EN_DEPOSITO') {
                    aEnvasarHtml = `
                        <span class="accion-badge" style="background: rgba(147, 51, 234, 0.2); color: #c084fc; border: 1px solid rgba(147, 51, 234, 0.4); font-size: 0.78rem;">
                            📦 Armar en depósito
                        </span>
                        <div class="cell-submeta" style="color: #c084fc; margin-top: 2px;">
                            ${art.accion_requerida}
                        </div>
                    `;
                } else if (art.estado_alarma === 'CRITICO_SIN_STOCK') {
                    aEnvasarHtml = `
                        <span class="accion-badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-size: 0.78rem;">
                            🔴 Faltan bolsas hijas
                        </span>
                        <div class="cell-submeta" style="color: #f87171; margin-top: 2px;">
                            ${art.accion_requerida}
                        </div>
                    `;
                } else {
                    aEnvasarHtml = `
                        <span style="color: var(--text-muted); font-size: 0.76rem;">✓ Packs suficientes</span>
                        <div class="cell-submeta" style="color: #94a3b8;">${formatearBolsas(art.packs_armables || 0)} packs armables</div>
                    `;
                }
            } else if (art.cantidad_sugerida > 0) {
                aEnvasarHtml = `
                    <span class="accion-badge accion-produccion" style="font-size: 0.82rem; padding: 4px 8px;">
                        ⚙️ <strong>+${formatearBolsas(art.cantidad_sugerida)} bolsas</strong>
                    </span>
                    <div class="cell-submeta" style="color: #94a3b8; margin-top: 2px;">
                        ${art.kilos_sugeridos.toFixed(1)} kg (${art.kilos_unidad} kg/u)
                    </div>
                `;
            } else {
                aEnvasarHtml = `<span style="color: var(--text-muted); font-size: 0.76rem;">✓ Cobertura suficiente</span>`;
            }

            // Ubicación / Estado materia prima
            let ubicacionHtml = '';
            if (art.es_padre) {
                ubicacionHtml = `
                    <div style="color: #c084fc; font-weight: 700; font-size: 0.78rem;">
                        📦 Pack armable desde unidades de [${art.hijo_vinculado || 'Hijo'}]
                    </div>
                    <div class="cell-submeta" style="color: #94a3b8;">Disponible en depósito: ${formatearBolsas(art.packs_armables || 0)} packs listos para embolsar</div>
                `;
            } else {
                const kgSueltos = parseFloat(art.stock_taller_kg || 0);
                const bultosTaller = parseFloat(art.bultos_taller || 0);
                const bultosDepo = parseFloat(art.bultos_deposito || 0);
                const reqKg = parseFloat(art.kilos_sugeridos || 0);

                if (reqKg > 0) {
                    if (kgSueltos >= reqKg) {
                        ubicacionHtml = `
                            <div style="color: #34d399; font-weight: 700; font-size: 0.78rem;">
                                🟢 Bolsa abierta en taller (${kgSueltos.toFixed(1)} kg disp.)
                            </div>
                            <div class="cell-submeta" style="color: #94a3b8;">Insumo: ${art.materia_prima_nombre || '-'}</div>
                        `;
                    } else if (bultosTaller > 0) {
                        ubicacionHtml = `
                            <div style="color: #38bdf8; font-weight: 700; font-size: 0.78rem;">
                                📦 Taller: Abrir bulto cerrado (${bultosTaller} cj disp.)
                            </div>
                            <div class="cell-submeta" style="color: #94a3b8;">Insumo: ${art.materia_prima_nombre || '-'} ${kgSueltos > 0 ? `(+${kgSueltos.toFixed(1)} kg abiertos)` : ''}</div>
                        `;
                    } else if (bultosDepo > 0) {
                        ubicacionHtml = `
                            <div style="color: #60a5fa; font-weight: 700; font-size: 0.78rem;">
                                🏢 Depósito: Pedir bulto cerrado (${bultosDepo} cj disp.)
                            </div>
                            <div class="cell-submeta" style="color: #94a3b8;">Insumo: ${art.materia_prima_nombre || '-'} ${kgSueltos > 0 ? `(+${kgSueltos.toFixed(1)} kg en taller)` : ''}</div>
                        `;
                    } else {
                        ubicacionHtml = `
                            <div style="color: #f87171; font-weight: 700; font-size: 0.78rem;">
                                🔴 Sin materia prima en stock
                            </div>
                            <div class="cell-submeta" style="color: #fca5a5;">Insumo: ${art.materia_prima_nombre || '-'} &bull; Pedir a proveedor</div>
                        `;
                    }
                } else {
                    ubicacionHtml = `<div style="font-size: 0.74rem; color: var(--text-muted);">${art.materia_prima_nombre || '-'} &bull; Stock estable</div>`;
                }
            }

            // Metas de stock
            let stockMeta = `<div class="cell-submeta">${(art.stock_kilos || 0).toFixed(1)} kg</div>`;
            if (art.comprometido_presupuestos > 0) {
                stockMeta += `<div class="cell-submeta" style="color: #fb923c;">📋 Pedidos: ${formatearBolsas(art.comprometido_presupuestos)}u</div>`;
                stockMeta += `<div class="cell-submeta" style="color: ${art.stock_neto_disponible < 0 ? '#f87171' : '#34d399'}; font-weight: 700;">Neto: ${formatearUnidadesStock(art.stock_neto_disponible)}u</div>`;
            }
            if (art.es_padre && art.packs_armables > 0) {
                stockMeta += `<div class="cell-submeta" style="color: #c084fc;">📦 ${formatearBolsas(art.packs_armables)} armables</div>`;
            }

            return `
                <tr class="${rowClass}">
                    <td>${getBadgeSemaforo(art.estado_alarma, art.dias_cobertura, art.packs_armables)}</td>
                    <td class="cell-sku">
                        ${relBadge}
                        <span>${art.articulo_id}</span>
                    </td>
                    <td class="cell-desc">
                        <strong>${art.descripcion}</strong>
                        <div class="cell-submeta">${art.familia_nombre} &bull; ${art.kilos_unidad} kg/u.</div>
                    </td>
                    <td class="cell-num">
                        <strong style="color: ${art.stock_actual <= 0 ? '#f87171' : '#fff'};">
                            ${formatearUnidadesStock(art.stock_actual)} u.
                        </strong>
                        ${stockMeta}
                    </td>
                    <td class="cell-num">
                        <strong>${art.demanda_diaria_promedio.toFixed(2)}/d</strong>
                        <div class="cell-submeta">${art.ventas_ventana.toLocaleString('es-AR')} en ${ventanaDiasDemanda}d</div>
                    </td>
                    <td class="cell-num">
                        <strong>${cobStr}</strong>
                        <div>${getBarraCobertura(art.dias_cobertura)}</div>
                    </td>
                    <td class="cell-num" style="background-color: rgba(16, 185, 129, 0.06);">
                        ${aEnvasarHtml}
                    </td>
                    <td>${ubicacionHtml}</td>
                </tr>
            `;
        }).join('');
    }

    // TAB 3: CARROS DE MIX Y MEZCLAS (LDN 3 - ARTÍCULOS PUENTE AP)
    function renderizarTabMixes() {
        const container = document.getElementById('container-carros-mixes');
        const kpisContainer = document.getElementById('kpis-resumen-mixes-tab');
        if (!container || !dataMaster) return;

        const carros = dataMaster.carros_mixes_detallados || [];

        // 1. Mini-KPIs en cabecera
        if (kpisContainer) {
            const carrosRequierenMezcla = carros.filter(c => !c.granel_suficiente && (c.kilos_carro_sugeridos || 0) > 0);
            const carrosGranelListo = carros.filter(c => c.granel_suficiente && ((c.kilos_totales_solicitados || 0) > 0 || (c.presentaciones && c.presentaciones.some(p => p.cantidad_sugerida > 0))));
            const totalKgCarros = carrosRequierenMezcla.reduce((sum, c) => sum + (c.kilos_carro_sugeridos || 0), 0);
            const listos = carrosRequierenMezcla.filter(c => c.factibilidad?.factible);
            const bloqueados = carrosRequierenMezcla.filter(c => !c.factibilidad?.factible);

            kpisContainer.innerHTML = `
                <div style="background: rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.25); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #22d3ee; font-weight: 700; text-transform: uppercase;">Carros a Mezclar</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #22d3ee;">${carrosRequierenMezcla.length} carros</div>
                    <div style="font-size: 0.70rem; color: #94a3b8;">${totalKgCarros.toFixed(1)} kg (${tandaMixKg}k/tanda)</div>
                </div>
                <div style="background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #34d399; font-weight: 700; text-transform: uppercase;">🟢 Granel Listo</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #34d399;">${carrosGranelListo.length} mixes</div>
                    <div style="font-size: 0.70rem; color: #94a3b8;">No requiere mezclado</div>
                </div>
                <div style="background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.25); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #60a5fa; font-weight: 700; text-transform: uppercase;">Insumos Disponibles</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #60a5fa;">${listos.length} listos</div>
                    <div style="font-size: 0.70rem; color: #94a3b8;">100% materias primas</div>
                </div>
                <div style="background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #f87171; font-weight: 700; text-transform: uppercase;">Insumo Bloqueante</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #f87171;">${bloqueados.length} faltantes</div>
                    <div style="font-size: 0.70rem; color: #94a3b8;">Pedir a proveedor</div>
                </div>
            `;
        }

        // 2. Filtrado de carros
        const searchTerms = normalizarTexto(queryBusqueda).split(/\s+/).filter(Boolean);
        const carrosFiltrados = carros.filter(c => {
            if (filtroSemaforo === 'criticos') {
                if (c.urgencia_maxima !== 1 && c.urgencia_maxima !== 2) return false;
            } else if (filtroSemaforo === 'con_sugerencia') {
                const tieneEnvase = c.presentaciones && c.presentaciones.some(p => p.cantidad_sugerida > 0 || (p.es_padre && p.packs_armables > 0));
                if ((c.kilos_carro_sugeridos || 0) <= 0 && !tieneEnvase) return false;
            } else if (filtroSemaforo === 'atencion') {
                if (c.urgencia_maxima !== 3) return false;
            } else if (filtroSemaforo === 'optimos') {
                if (c.urgencia_maxima < 4) return false;
            }

            if (searchTerms.length > 0) {
                const searchStr = normalizarTexto([
                    c.ap_sku,
                    c.mix_nombre,
                    c.factibilidad?.cuello_botella || '',
                    ...(c.receta_pesaje || []).map(r => r.componente_nombre),
                    ...(c.presentaciones || []).map(p => p.articulo_id + ' ' + p.descripcion)
                ].join(' '));
                if (!searchTerms.every(term => searchStr.includes(term))) return false;
            }

            return true;
        });

        if (carrosFiltrados.length === 0) {
            container.innerHTML = `<div class="empty-state" style="padding: 40px; text-align: center;">No se encontraron carros de mix que coincidan con los filtros seleccionados.</div>`;
            return;
        }

        // 3. Renderizar cada Carro Mix
        container.innerHTML = carrosFiltrados.map(carro => {
            let urgBadge = '';
            if (carro.urgencia_maxima === 1) {
                urgBadge = `<span class="badge-status status-critico-sin-stock" style="font-size: 0.72rem; padding: 3px 8px;">🔴 Quiebre Inmediato</span>`;
            } else if (carro.urgencia_maxima === 2) {
                urgBadge = `<span class="badge-status status-critico" style="font-size: 0.72rem; padding: 3px 8px;">🟠 Crítico (≤5d)</span>`;
            } else if (carro.urgencia_maxima === 3) {
                urgBadge = `<span class="badge-status status-atencion" style="font-size: 0.72rem; padding: 3px 8px;">🟡 Atención</span>`;
            } else {
                urgBadge = `<span class="badge-status status-optimo" style="font-size: 0.72rem; padding: 3px 8px;">🟢 Óptimo / Planificado</span>`;
            }

            const estadoCardClass = carro.granel_suficiente 
                ? 'listo' 
                : (carro.factibilidad?.factible ? 'listo' : 'bloqueado');

            let badgeFactible = '';
            if (carro.granel_suficiente) {
                badgeFactible = `<span class="badge-status status-optimo" style="font-size: 0.72rem; padding: 3px 8px;">🟢 GRANEL DISPONIBLE (${(carro.stock_granel_taller_kg || 0).toFixed(1)} kg) &bull; DIRECTO A ENVASAR</span>`;
            } else if ((carro.kilos_carro_sugeridos || 0) > 0) {
                const factibleHtml = carro.factibilidad?.factible 
                    ? `<span class="badge-status status-optimo" style="font-size: 0.72rem; padding: 3px 8px;">🟢 LISTO PARA ARMAR</span>`
                    : `<span class="badge-status status-critico" style="font-size: 0.72rem; padding: 3px 8px;" title="Insumo faltante: ${carro.factibilidad?.cuello_botella}">🔴 BLOQUEADO: Falta ${carro.factibilidad?.cuello_botella}</span>`;
                const tandasHtml = `<span class="badge-status" style="background: rgba(59,130,246,0.2); color: #60a5fa; font-size: 0.72rem; padding: 3px 8px; font-weight: 700;">🥣 MEZCLAR CARRO: ${carro.tandas_carro} tanda(s) de ${carro.tanda_kg || tandaMixKg} kg = ${(carro.kilos_carro_sugeridos || 0).toFixed(1)} kg</span>`;
                badgeFactible = `${factibleHtml} ${tandasHtml}`;
            } else {
                badgeFactible = `<span class="badge-status status-optimo" style="font-size: 0.72rem; padding: 3px 8px;">🟢 STOCK CUBIERTO</span>`;
            }

            // Filas de pesaje (Fase 1)
            let fase1Html = '';
            if (carro.granel_suficiente) {
                fase1Html = `
                    <div>
                        <div class="carro-section-title">
                            <span>⚖️ FASE 1: Pesaje de Materias Primas</span>
                        </div>
                        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px; padding: 14px 16px; display: flex; align-items: center; gap: 14px;">
                            <span style="font-size: 1.7rem;">✅</span>
                            <div>
                                <div style="color: #34d399; font-weight: 800; font-size: 0.92rem;">
                                    No requiere pesaje ni mezclado de materias primas
                                </div>
                                <div style="color: #94a3b8; font-size: 0.82rem; margin-top: 3px; line-height: 1.4;">
                                    Hay <strong>${(carro.stock_granel_taller_kg || 0).toFixed(1)} kg</strong> de mix a granel disponible en ingredientes. Cubre los <strong>${(carro.kilos_totales_solicitados || 0).toFixed(1)} kg</strong> requeridos para las presentaciones comerciales. Proceder directamente a la <strong>Fase 2: Envasado</strong>.
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            } else if ((carro.kilos_carro_sugeridos || 0) > 0) {
                const filasPesaje = (carro.receta_pesaje || []).map(comp => {
                    const stockStr = `${comp.stock_disponible_kg} kg disp.`;
                    const dispClass = comp.alcanza ? 'color: #34d399; font-weight: 700;' : 'color: #f87171; font-weight: 700;';
                    const dispBadge = comp.alcanza
                        ? `<span style="color: #34d399; font-size: 0.74rem;">✓ Disponible</span>`
                        : `<span style="color: #f87171; font-size: 0.74rem;">⚠️ Faltante</span>`;

                    return `
                        <tr>
                            <td style="text-align: center;"><span class="check-item-box"></span></td>
                            <td>
                                <strong>${comp.componente_nombre}</strong>
                            </td>
                            <td style="text-align: right; color: var(--text-secondary);">${comp.proporcion_pct}%</td>
                            <td style="text-align: right; background: rgba(59, 130, 246, 0.08);">
                                <strong style="color: #60a5fa; font-size: 0.88rem;">${comp.kilos_a_pesar.toFixed(2)} kg</strong>
                            </td>
                            <td style="text-align: right; ${dispClass}">${stockStr}</td>
                            <td style="text-align: center;">${dispBadge}</td>
                        </tr>
                    `;
                }).join('');

                const subGranelNota = (carro.stock_granel_taller_kg || 0) > 0 
                    ? `<span style="font-size: 0.74rem; color: #38bdf8; font-weight: 400; margin-left: 8px;">(Granel existente: ${carro.stock_granel_taller_kg.toFixed(1)} kg &bull; Carro aporta +${carro.kilos_carro_sugeridos.toFixed(1)} kg)</span>` 
                    : '';

                fase1Html = `
                    <div>
                        <div class="carro-section-title">
                            <span>⚖️ FASE 1: Pesaje de Materias Primas para el Carro Granel (${(carro.kilos_carro_sugeridos || 0).toFixed(1)} kg en ${carro.tandas_carro} tanda(s) de ${carro.tanda_kg || tandaMixKg} kg)</span>
                            ${subGranelNota}
                        </div>
                        <div class="table-responsive">
                            <table class="carro-pesaje-table">
                                <thead>
                                    <tr>
                                        <th style="width: 32px; text-align: center;">✓</th>
                                        <th>Componente / Materia Prima</th>
                                        <th style="text-align: right; width: 90px;">% Receta</th>
                                        <th style="text-align: right; width: 130px; background: rgba(59, 130, 246, 0.1);">KILOS A PESAR</th>
                                        <th style="text-align: right; width: 130px;">Stock Disponible</th>
                                        <th style="width: 120px; text-align: center;">Disponibilidad</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${filasPesaje}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            } else {
                fase1Html = `
                    <div>
                        <div class="carro-section-title">
                            <span>⚖️ FASE 1: Pesaje de Materias Primas</span>
                        </div>
                        <div style="background: rgba(148, 163, 184, 0.08); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 6px; padding: 12px 16px; color: #94a3b8; font-size: 0.82rem;">
                            Sin requerimientos de mezclado pendientes en este ciclo.
                        </div>
                    </div>
                `;
            }

            // Filas de envasado comercial (Fase 2)
            const filasEnvasado = (carro.presentaciones || []).map(art => {
                const cobStr = art.dias_cobertura === 999 ? '∞' : `${art.dias_cobertura.toFixed(1)}d`;

                let cantBolsas = '';
                let kgTot = '-';

                if (art.es_padre) {
                    if (art.packs_a_armar && art.packs_a_armar > 0) {
                        cantBolsas = `<strong style="color: #c084fc; font-size: 0.82rem;">📦 Armar ${formatearBolsas(art.packs_a_armar)} packs</strong><div class="cell-submeta" style="color: #e9d5ff;">p/ pedidos (${art.pack_hijo_codigo || ''})</div>`;
                    } else if (art.packs_armables > 0) {
                        cantBolsas = `<span style="color: #34d399; font-size: 0.78rem; font-weight: 700;">✓ ${formatearBolsas(art.packs_armables)} packs en depósito</span><div class="cell-submeta" style="color: #94a3b8;">(${art.pack_hijo_codigo || ''})</div>`;
                    } else {
                        cantBolsas = `<span style="color: var(--text-muted); font-size: 0.74rem;">✓ Sin pedidos</span>`;
                    }
                } else if (art.cantidad_sugerida > 0) {
                    cantBolsas = `<strong style="color: #34d399; font-size: 0.88rem;">+${formatearBolsas(art.cantidad_sugerida)} bolsas</strong>`;
                    kgTot = `${art.kilos_sugeridos.toFixed(1)} kg`;
                } else {
                    cantBolsas = `<span style="color: var(--text-muted); font-size: 0.74rem;">✓ Suficiente</span>`;
                }

                let relBadge = '';
                if (art.es_padre) {
                    relBadge = `<span class="badge-status" style="background: rgba(168,85,247,0.2); color: #c084fc; font-size: 0.65rem; padding: 1px 5px; margin-right: 4px;">PACK x${art.pack_unidades}</span>`;
                } else if (art.es_hijo) {
                    relBadge = `<span class="badge-status" style="background: rgba(56,189,248,0.2); color: #38bdf8; font-size: 0.65rem; padding: 1px 5px; margin-right: 4px;">FRACCIÓN</span>`;
                }

                let stockMeta = `<div class="cell-submeta">${(art.stock_kilos || 0).toFixed(1)} kg</div>`;
                if (art.comprometido_presupuestos > 0) {
                    stockMeta += `<div class="cell-submeta" style="color: #fb923c;">📋 Pedidos: ${formatearBolsas(art.comprometido_presupuestos)}u</div>`;
                    stockMeta += `<div class="cell-submeta" style="color: ${art.stock_neto_disponible < 0 ? '#f87171' : '#34d399'}; font-weight: 700;">Neto: ${formatearUnidadesStock(art.stock_neto_disponible)}u</div>`;
                }
                if (art.es_padre && art.packs_armables > 0) {
                    stockMeta += `<div class="cell-submeta" style="color: #c084fc;">📦 ${formatearBolsas(art.packs_armables)} armables</div>`;
                }

                return `
                    <tr>
                        <td style="text-align: center;"><span class="check-item-box"></span></td>
                        <td class="cell-sku">${relBadge}${art.articulo_id}</td>
                        <td>
                            <strong>${art.descripcion}</strong>
                            <div class="cell-submeta">${art.kilos_unidad} kg/u.</div>
                        </td>
                        <td class="cell-num">
                            <strong style="color: ${art.stock_actual <= 0 ? '#f87171' : '#fff'};">${formatearUnidadesStock(art.stock_actual)}</strong>
                            ${stockMeta}
                        </td>
                        <td class="cell-num"><strong>${art.demanda_diaria_promedio.toFixed(2)}</strong>/d</td>
                        <td>${getBadgeSemaforo(art.estado_alarma, art.dias_cobertura, art.packs_armables)}</td>
                        <td class="cell-num" style="background: rgba(16, 185, 129, 0.08);">${cantBolsas}</td>
                        <td class="cell-num">${kgTot}</td>
                    </tr>
                `;
            }).join('');

            // KPI derecha en header del carro
            let kpiHeaderHtml = '';
            if (carro.granel_suficiente) {
                kpiHeaderHtml = `
                    <div style="text-align: right;">
                        <div style="font-size: 0.70rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Granel en Depósito</div>
                        <div style="font-size: 1.3rem; font-weight: 800; color: #34d399;">${(carro.stock_granel_taller_kg || 0).toFixed(1)} kg</div>
                        <div style="font-size: 0.70rem; color: #94a3b8;">Demanda envasado: ${(carro.kilos_totales_solicitados || 0).toFixed(1)} kg</div>
                    </div>
                `;
            } else {
                kpiHeaderHtml = `
                    <div style="text-align: right;">
                        <div style="font-size: 0.70rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Lote Carro Sugerido</div>
                        <div style="font-size: 1.3rem; font-weight: 800; color: #22d3ee;">${(carro.kilos_carro_sugeridos || 0).toFixed(1)} kg</div>
                        <div style="font-size: 0.70rem; color: #94a3b8;">${carro.tandas_carro} tanda(s) de ${carro.tanda_kg || tandaMixKg} kg ${(carro.stock_granel_taller_kg || 0) > 0 ? `(+${carro.stock_granel_taller_kg.toFixed(1)}k disp.)` : ''}</div>
                    </div>
                `;
            }

            return `
                <div class="carro-mix-card ${estadoCardClass}">
                    <div class="carro-mix-header">
                        <div class="carro-mix-title-box">
                            <span class="carro-mix-badge-sku">${carro.ap_sku}</span>
                            <span class="carro-mix-name">${carro.mix_nombre}</span>
                            ${urgBadge}
                            ${badgeFactible}
                        </div>
                        <div class="carro-mix-kpis">
                            ${kpiHeaderHtml}
                        </div>
                    </div>

                    <div class="carro-mix-body">
                        <!-- FASE 1: PESAJE O GRANEL SUFICIENTE -->
                        ${fase1Html}

                        <!-- FASE 2: PRESENTACIONES COMERCIALES -->
                        <div>
                            <div class="carro-section-title">
                                <span>📦 FASE 2: Envasado en Presentaciones Comerciales</span>
                            </div>
                            <div class="table-responsive">
                                <table class="carro-envase-table">
                                    <thead>
                                        <tr>
                                            <th style="width: 32px; text-align: center;">✓</th>
                                            <th style="width: 130px;">Código SKU</th>
                                            <th>Presentación Comercial</th>
                                            <th style="text-align: right; width: 100px;">Stock Actual</th>
                                            <th style="text-align: right; width: 90px;">Demanda</th>
                                            <th style="width: 120px;">Cobertura</th>
                                            <th style="text-align: right; width: 140px; background: rgba(16, 185, 129, 0.1);">A ENVASAR</th>
                                            <th style="text-align: right; width: 90px;">Kilos</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${filasEnvasado}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // =========================================================================
    // PESTAÑA 2: PRODUCCIÓN EXTERNA (LDN 4 TOSTADEROS + LDN 5 BARRITAS + LDN 6 GRANOLAS)
    // =========================================================================
    function renderizarTabProduccionExterna() {
        const kpisContainer = document.getElementById('kpis-resumen-externa-tab');
        const subtituloLDN4 = document.getElementById('resumen-ldn4-subtitulo');
        const containerLDN4 = document.getElementById('container-tostaderos-agrupados');
        const subtituloLDN56 = document.getElementById('resumen-ldn56-subtitulo');
        const tbodyLDN56 = document.getElementById('tbody-prod-ldn56');

        if (!dataMaster) return;

        const extData = dataMaster.produccion_externa_ups || {};
        const ldn = dataMaster.lineas_de_negocio || {};
        const itemsTostaderos = extData.tostaderos || ldn.ldn4_tostaderos || [];
        const itemsBarritas = extData.barritas || ldn.ldn5_barritas || [];
        const itemsGranolas = extData.granolas || ldn.ldn6_granolas || [];
        const itemsLDN56Master = [...itemsBarritas, ...itemsGranolas];

        const resumen = extData.resumen || {};

        // 1. Mini-KPIs en Cabecera de Producción Externa
        if (kpisContainer) {
            const kgCrudos = resumen.kilos_crudos_a_despachar || itemsTostaderos.reduce((sum, a) => sum + (a.kilos_crudos_requeridos || 0), 0);
            const bultosCrudos = itemsTostaderos.reduce((sum, a) => sum + (a.bultos_crudos_despachar || 0), 0);
            const kgTerm = resumen.kilos_terminados_sugeridos || [...itemsTostaderos, ...itemsLDN56Master].reduce((sum, a) => sum + (a.kilos_sugeridos || a.kilos_tostados_sugeridos || 0), 0);
            const quiebres = resumen.quiebres_count || [...itemsTostaderos, ...itemsLDN56Master].filter(a => a.estado_alarma === 'CRITICO_SIN_STOCK' || a.stock_actual <= 0).length;
            const criticos = resumen.criticos_count || [...itemsTostaderos, ...itemsLDN56Master].filter(a => a.estado_alarma === 'CRITICO').length;
            const aProducirCount = resumen.a_producir_count || [...itemsTostaderos, ...itemsLDN56Master].filter(a => (a.cantidad_sugerida > 0 || (a.kilos_tostados_sugeridos || 0) > 0)).length;
            const totalItems = resumen.total_items || (itemsTostaderos.length + itemsLDN56Master.length);

            kpisContainer.innerHTML = `
                <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #fbbf24; font-weight: 700; text-transform: uppercase;">A Despachar a UPs</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #fbbf24;">${kgCrudos.toFixed(1)} kg crudos</div>
                    <div style="font-size: 0.70rem; color: #94a3b8;">${bultosCrudos} bultos industriales</div>
                </div>
                <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #34d399; font-weight: 700; text-transform: uppercase;">Retorno Terminado</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #34d399;">${kgTerm.toFixed(1)} kg</div>
                    <div style="font-size: 0.70rem; color: #94a3b8;">${aProducirCount} de ${totalItems} ítems</div>
                </div>
                <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #f87171; font-weight: 700; text-transform: uppercase;">🔴 Quiebre en UPs</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #f87171;">${quiebres}</div>
                    <div style="font-size: 0.70rem; color: #94a3b8;">Sin stock disponible</div>
                </div>
                <div style="background: rgba(249, 115, 22, 0.12); border: 1px solid rgba(249, 115, 22, 0.3); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #fb923c; font-weight: 700; text-transform: uppercase;">🟠 Críticos (≤5d)</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #fb923c;">${criticos}</div>
                    <div style="font-size: 0.70rem; color: #94a3b8;">Atención esta semana</div>
                </div>
            `;
        }

        // 2. Sub-sección LDN 4: Tostaderos Agrupados por Producción
        const itemsLDN4Filtrados = filtrarItems(itemsTostaderos);

        // Agrupación determinista
        const gruposTostaderos = {};
        itemsLDN4Filtrados.forEach(art => {
            const grupoInfo = obtenerGrupoTostadero(art);
            if (!gruposTostaderos[grupoInfo.id]) {
                gruposTostaderos[grupoInfo.id] = {
                    meta: grupoInfo,
                    items: []
                };
            }
            gruposTostaderos[grupoInfo.id].items.push(art);
        });

        // Ordenar los grupos por orden canónico (1 a 7)
        const gruposArray = Object.values(gruposTostaderos).sort((a, b) => a.meta.orden - b.meta.orden);

        // Ordenar los ítems dentro de cada grupo (Granel UP primero, luego por tamaño de presentación)
        gruposArray.forEach(g => {
            g.items.sort((a, b) => {
                const aIsUP = a.articulo_id.includes('UP') ? 0 : 1;
                const bIsUP = b.articulo_id.includes('UP') ? 0 : 1;
                if (aIsUP !== bIsUP) return aIsUP - bIsUP;
                return (a.kilos_unidad || 0) - (b.kilos_unidad || 0);
            });
        });

        if (subtituloLDN4) {
            const tostConDespacho = itemsLDN4Filtrados.filter(a => (a.bultos_crudos_despachar || 0) > 0 || (a.kilos_tostados_sugeridos || 0) > 0 || a.cantidad_sugerida > 0);
            const gruposConDespacho = gruposArray.filter(g => {
                const totKg = g.items.reduce((sum, a) => sum + parseFloat(a.kilos_tostados_sugeridos || a.kilos_sugeridos || 0), 0);
                const totBultos = g.items.reduce((sum, a) => sum + parseInt(a.bultos_crudos_despachar || 0), 0);
                return totKg > 0 || totBultos > 0;
            });
            subtituloLDN4.innerHTML = `Mostrando <strong style="color: #f8fafc;">${gruposArray.length}</strong> producciones (${itemsLDN4Filtrados.length} fracciones) &bull; <strong style="color: #fbbf24;">${gruposConDespacho.length} con despacho</strong>`;
        }

        if (containerLDN4) {
            if (gruposArray.length === 0) {
                containerLDN4.innerHTML = `<div class="empty-state" style="padding: 24px; text-align: center; color: #94a3b8; font-style: italic;">No se encontraron productos de tostadero bajo los filtros activos.</div>`;
            } else {
                containerLDN4.innerHTML = gruposArray.map(g => {
                    const totalKgTostados = g.items.reduce((sum, a) => sum + parseFloat(a.kilos_tostados_sugeridos || a.kilos_sugeridos || 0), 0);
                    const totalBolsas = g.items.reduce((sum, a) => sum + parseInt(a.cantidad_sugerida || 0), 0);
                    let kgCrudos = g.items.reduce((sum, a) => sum + parseFloat(a.kilos_crudos_requeridos || 0), 0);
                    if (kgCrudos === 0 && totalKgTostados > 0) {
                        kgCrudos = totalKgTostados / (1 - (g.meta.mermaPct / 100));
                    }
                    let bultosCrudos = g.items.reduce((sum, a) => sum + parseInt(a.bultos_crudos_despachar || 0), 0);
                    if (bultosCrudos === 0 && kgCrudos > 0) {
                        const bultoKgRef = (g.meta.materiaPrimaCodigo && g.meta.materiaPrimaCodigo.includes('10')) ? 10 : 22.68;
                        bultosCrudos = Math.ceil(kgCrudos / bultoKgRef);
                    }

                    const stockCrudoDisp = g.items.find(a => parseFloat(a.stock_crudo_disponible_kg || 0) > 0)?.stock_crudo_disponible_kg || g.items[0]?.stock_crudo_disponible_kg || 0;
                    const tieneQuiebre = g.items.some(a => a.estado_alarma === 'CRITICO_SIN_STOCK' || a.stock_actual <= 0);
                    const tieneCritico = g.items.some(a => a.estado_alarma === 'CRITICO');
                    const hayDespacho = totalKgTostados > 0 || kgCrudos > 0 || bultosCrudos > 0;
                    const factible = hayDespacho ? (stockCrudoDisp >= kgCrudos) : true;

                    // Estado CSS y persistencia del acordeón: por default REPLEGADOS (colapsados)
                    let cardClass = 'cubierto';
                    if (tieneQuiebre) cardClass = 'quiebre';
                    else if (hayDespacho) cardClass = 'con-despacho';

                    if (estadoAcordeonesTostadero[g.meta.id] === undefined) {
                        estadoAcordeonesTostadero[g.meta.id] = false;
                    }
                    const estaAbierto = !!estadoAcordeonesTostadero[g.meta.id];
                    if (estaAbierto) cardClass += ' abierto';

                    const stockTerminadoTotal = g.items.reduce((sum, a) => sum + parseFloat(a.stock_kilos || (a.stock_actual * (a.kilos_unidad || 1)) || 0), 0);

                    // Badges de Cabecera
                    let badgeAlarma = '';
                    if (tieneQuiebre) {
                        badgeAlarma = `<span class="badge-status status-critico-sin-stock" style="font-size: 0.68rem; padding: 2px 6px;">🔴 Quiebre en presentación</span>`;
                    } else if (tieneCritico) {
                        badgeAlarma = `<span class="badge-status status-critico" style="font-size: 0.68rem; padding: 2px 6px;">🟠 Crítico (≤5d)</span>`;
                    }

                    let badgeFactibilidad = '';
                    if (hayDespacho) {
                        badgeFactibilidad = factible 
                            ? `<span class="badge-status status-optimo" style="font-size: 0.68rem; padding: 2px 6px;">🟢 Insumo Crudo OK</span>` 
                            : `<span class="badge-status status-critico" style="font-size: 0.68rem; padding: 2px 6px;" title="Stock crudo insuficiente para cubrir el despacho con merma">🔴 Falta Crudo</span>`;
                    } else if (stockTerminadoTotal > 0 && !tieneQuiebre) {
                        badgeFactibilidad = `<span class="badge-status" style="background: rgba(16,185,129,0.12); color: #34d399; font-size: 0.68rem; padding: 2px 6px;">✓ Stock Cubierto (${stockTerminadoTotal.toFixed(1)} kg)</span>`;
                    } else {
                        badgeFactibilidad = `<span class="badge-status" style="background: rgba(148,163,184,0.12); color: #94a3b8; font-size: 0.68rem; padding: 2px 6px;">⚪ Sin demanda activa</span>`;
                    }

                    // Filas de fracciones comerciales dentro del acordeón
                    const filasFraccionesHtml = g.items.map(art => {
                        const cobStr = art.dias_cobertura === 999 ? '∞' : `${art.dias_cobertura.toFixed(1)}d`;
                        const rowClass = (art.estado_alarma === 'CRITICO' || art.estado_alarma === 'CRITICO_SIN_STOCK') ? 'row-critico' : '';
                        const artKgTostados = parseFloat(art.kilos_tostados_sugeridos || art.kilos_sugeridos || 0);
                        const artBultosCrudos = parseInt(art.bultos_crudos_despachar || 0);
                        const artKgCrudos = parseFloat(art.kilos_crudos_requeridos || 0);

                        let aObtenerHtml = '';
                        if (artKgTostados > 0) {
                            if (art.demanda_derivada_mixes && art.demanda_derivada_mixes.length > 0) {
                                aObtenerHtml = `
                                    <strong style="color: #fbbf24; font-size: 0.88rem;">+${artKgTostados.toFixed(1)} kg</strong>
                                    <div class="cell-submeta" style="color: #38bdf8; font-size: 0.70rem;">🥣 Insumo p/ ${art.demanda_derivada_mixes.join(', ')}</div>
                                `;
                            } else {
                                aObtenerHtml = `
                                    <strong style="color: #fbbf24; font-size: 0.88rem;">+${artKgTostados.toFixed(1)} kg</strong>
                                    <div class="cell-submeta">${art.articulo_id.includes('UP') ? `${art.bultos_crudos_despachar || 1} bulto(s) crudo` : `${art.cantidad_sugerida || 0} bolsas (${art.kilos_unidad} kg/u)`}</div>
                                `;
                            }
                        } else if (art.stock_actual > 0) {
                            aObtenerHtml = `<span style="color: var(--text-muted); font-size: 0.74rem;">✓ Cubierto</span>`;
                        } else {
                            aObtenerHtml = `<span style="color: var(--text-muted); font-size: 0.74rem;">- Sin consumo</span>`;
                        }

                        let despachoHtml = '';
                        if (artBultosCrudos > 0 || artKgCrudos > 0) {
                            despachoHtml = `
                                <span class="accion-badge accion-despacho" style="font-size: 0.78rem; padding: 3px 6px;">
                                    🚚 <strong>${artBultosCrudos || 1} b.</strong> (${artKgCrudos.toFixed(1)} kg)
                                </span>
                            `;
                        } else {
                            despachoHtml = `<span style="color: var(--text-muted); font-size: 0.74rem;">-</span>`;
                        }

                        let stockMeta = `<div class="cell-submeta">${(art.stock_kilos || 0).toFixed(1)} kg</div>`;
                        if (art.comprometido_presupuestos > 0) {
                            stockMeta += `<div class="cell-submeta" style="color: #fb923c;">📋 Pedidos: ${formatearBolsas(art.comprometido_presupuestos)}u</div>`;
                            stockMeta += `<div class="cell-submeta" style="color: ${art.stock_neto_disponible < 0 ? '#f87171' : '#34d399'}; font-weight: 700;">Neto: ${formatearUnidadesStock(art.stock_neto_disponible)}u</div>`;
                        }

                        let tipoBadge = art.articulo_id.includes('UP')
                            ? `<span class="badge-status" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; font-size: 0.65rem; padding: 1px 4px; margin-right: 4px;">GRANEL UP</span>`
                            : `<span class="badge-status" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; font-size: 0.65rem; padding: 1px 4px; margin-right: 4px;">FRACCIÓN</span>`;

                        return `
                            <tr class="${rowClass}">
                                <td>${getBadgeSemaforo(art.estado_alarma, art.dias_cobertura)}</td>
                                <td class="cell-sku">${tipoBadge}<span>${art.articulo_id}</span></td>
                                <td class="cell-desc">
                                    <strong>${art.descripcion}</strong>
                                    <div class="cell-submeta">${art.familia_nombre || ''} &bull; ${art.kilos_unidad} kg/u.</div>
                                </td>
                                <td class="cell-num">
                                    <strong style="color: ${art.stock_actual <= 0 ? '#f87171' : '#fff'};">
                                        ${formatearUnidadesStock(art.stock_actual)} u.
                                    </strong>
                                    ${stockMeta}
                                </td>
                                <td class="cell-num">
                                    <strong>${art.demanda_diaria_promedio.toFixed(2)}/d</strong>
                                    <div class="cell-submeta">${art.ventas_ventana.toLocaleString('es-AR')} en ${ventanaDiasDemanda}d</div>
                                </td>
                                <td class="cell-num">
                                    <strong>${cobStr}</strong>
                                    <div>${getBarraCobertura(art.dias_cobertura)}</div>
                                </td>
                                <td class="cell-num" style="background-color: rgba(245, 158, 11, 0.06);">
                                    ${aObtenerHtml}
                                </td>
                                <td class="cell-num" style="background-color: rgba(59, 130, 246, 0.06);">
                                    ${despachoHtml}
                                </td>
                                <td style="text-align: center;">
                                    <button onclick="window.abrirModalDetalle('${art.articulo_id}')" class="btn-action btn-secondary" style="padding: 4px 8px; font-size: 0.72rem;" title="Ver desglose completo de stock, ventas y recetas">
                                        🔍 Info
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join('');

                    // Banner de resumen de lote si hay despacho
                    const bannerLoteHtml = hayDespacho ? `
                        <div style="background: rgba(245, 158, 11, 0.08); border-bottom: 1px solid rgba(245, 158, 11, 0.2); padding: 8px 16px; font-size: 0.76rem; color: #fbbf24; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                            <span>📦 Lote consolidado: Despachar <strong>${bultosCrudos} bulto(s) (${kgCrudos.toFixed(1)} kg)</strong> de <strong>${g.meta.materiaPrimaNombre} [${g.meta.materiaPrimaCodigo}]</strong> &bull; Rendimiento esperado: <strong>+${totalKgTostados.toFixed(1)} kg</strong> tostados (Merma ${g.meta.mermaPct}%)</span>
                            <span style="color: ${factible ? '#34d399' : '#f87171'}; font-weight: 700;">${factible ? '✓ Stock disponible en depósito' : '⚠️ Crudo insuficiente en depósito'}</span>
                        </div>
                    ` : '';

                    return `
                        <div class="acordeon-tostadero-card ${cardClass}" id="acordeon-tostadero-${g.meta.id}" data-grupo-id="${g.meta.id}">
                            <div class="acordeon-tostadero-header" onclick="window.toggleAcordeonTostadero('${g.meta.id}')">
                                <div class="acordeon-tostadero-title-box">
                                    <span class="acordeon-arrow">▼</span>
                                    <span style="font-size: 1.3rem;">${g.meta.icono}</span>
                                    <div>
                                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                            <strong style="font-size: 0.98rem; color: #f8fafc;">${g.meta.titulo}</strong>
                                            <span class="badge-status status-optimo" style="font-size: 0.68rem; padding: 1px 6px;">${g.items.length} fracciones</span>
                                            ${badgeAlarma}
                                            ${badgeFactibilidad}
                                        </div>
                                        <div style="font-size: 0.73rem; color: #94a3b8; margin-top: 3px;">
                                            Materia prima: <strong style="color: #cbd5e1;">${g.meta.materiaPrimaNombre}</strong> [${g.meta.materiaPrimaCodigo}] &bull; Merma proceso: <strong>${g.meta.mermaPct}%</strong>
                                        </div>
                                    </div>
                                </div>
                                <div class="acordeon-tostadero-kpis">
                                    <div style="text-align: right;">
                                        <div style="font-size: 0.68rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Total a Tostar</div>
                                        <div style="font-size: 1.15rem; font-weight: 800; color: ${hayDespacho ? '#fbbf24' : (stockTerminadoTotal > 0 && !tieneQuiebre ? '#34d399' : '#94a3b8')};">
                                            ${totalKgTostados > 0 ? '+' + totalKgTostados.toFixed(1) + ' kg' : (stockTerminadoTotal > 0 && !tieneQuiebre ? '0 kg (Cubierto)' : '0 kg (Sin consumo)')}
                                        </div>
                                        <div style="font-size: 0.68rem; color: #94a3b8;">
                                            ${totalBolsas > 0 ? (bultosCrudos > 0 ? `${bultosCrudos} bulto(s) crudos` : `${totalBolsas} bolsas`) : (stockTerminadoTotal > 0 && !tieneQuiebre ? `${g.items.length} presentaciones` : 'Sin consumo activo')}
                                        </div>
                                    </div>
                                    <div style="text-align: right;">
                                        <div style="font-size: 0.68rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Despacho Crudo</div>
                                        <div style="font-size: 1.15rem; font-weight: 800; color: ${hayDespacho ? '#60a5fa' : '#94a3b8'};">
                                            ${bultosCrudos > 0 ? bultosCrudos + ' bulto(s)' : (kgCrudos > 0 ? kgCrudos.toFixed(1) + ' kg' : '-')}
                                        </div>
                                        <div style="font-size: 0.68rem; color: #94a3b8;">
                                            ${kgCrudos > 0 ? kgCrudos.toFixed(1) + ' kg c/merma' : 'Sin despacho'}
                                        </div>
                                    </div>
                                    <div style="text-align: right;">
                                        <div style="font-size: 0.68rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Stock Crudo Depo</div>
                                        <div style="font-size: 1.15rem; font-weight: 800; color: ${stockCrudoDisp > 0 ? '#34d399' : '#f87171'};">
                                            ${stockCrudoDisp.toFixed(1)} kg
                                        </div>
                                        <div style="font-size: 0.68rem; color: #94a3b8;">[${g.meta.materiaPrimaCodigo}]</div>
                                    </div>
                                </div>
                            </div>
                            <div class="acordeon-tostadero-body">
                                ${bannerLoteHtml}
                                <div class="table-responsive">
                                    <table class="data-table" style="margin-bottom: 0;">
                                        <thead>
                                            <tr>
                                                <th style="width: 140px;">Prioridad / Semáforo</th>
                                                <th style="width: 110px;">Código SKU</th>
                                                <th>Presentación / Fracción</th>
                                                <th style="text-align: right; width: 110px;">Stock Actual</th>
                                                <th style="text-align: right; width: 95px;">Demanda</th>
                                                <th style="width: 110px;">Cobertura</th>
                                                <th style="text-align: right; width: 140px; background-color: rgba(245, 158, 11, 0.08);">A OBTENER</th>
                                                <th style="text-align: right; width: 130px; background-color: rgba(59, 130, 246, 0.08);">DESPACHO CRUDO</th>
                                                <th style="width: 80px; text-align: center;">Acción</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${filasFraccionesHtml}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // 3. Sub-sección LDN 5 y 6: Barritas y Granolas
        const itemsLDN56Filtrados = filtrarItems(itemsLDN56Master);
        if (subtituloLDN56) {
            const prodSugeridaCount = itemsLDN56Filtrados.filter(a => a.cantidad_sugerida > 0);
            subtituloLDN56.innerHTML = `Mostrando <strong style="color: #f8fafc;">${itemsLDN56Filtrados.length}</strong> de ${itemsLDN56Master.length} productos &bull; <strong style="color: #c084fc;">${prodSugeridaCount.length} a elaborar</strong>`;
        }

        if (tbodyLDN56) {
            if (itemsLDN56Filtrados.length === 0) {
                tbodyLDN56.innerHTML = `<tr><td colspan="9" class="empty-state">No se encontraron barritas ni granolas bajo los filtros activos.</td></tr>`;
            } else {
                tbodyLDN56.innerHTML = itemsLDN56Filtrados.map(art => {
                    const cobStr = art.dias_cobertura === 999 ? '∞' : `${art.dias_cobertura.toFixed(1)}d`;
                    const rowClass = (art.estado_alarma === 'CRITICO' || art.estado_alarma === 'CRITICO_SIN_STOCK') ? 'row-critico' : '';
                    const badgeLdn = art.ldn === 5
                        ? `<span class="badge-ldn ldn-5" style="font-size: 0.65rem; padding: 1px 4px;">[LDN 5] Barritas</span>`
                        : `<span class="badge-ldn ldn-6" style="font-size: 0.65rem; padding: 1px 4px;">[LDN 6] Granolas</span>`;

                    let prodSugeridaHtml = '';
                    if (art.cantidad_sugerida > 0) {
                        prodSugeridaHtml = `
                            <span class="accion-badge" style="background: rgba(139, 92, 246, 0.15); color: #c084fc; border: 1px solid rgba(139, 92, 246, 0.3); font-size: 0.80rem; padding: 4px 8px;">
                                🏭 <strong>+${formatearBolsas(art.cantidad_sugerida)} u.</strong>
                            </span>
                            <div class="cell-submeta" style="color: #cbd5e1; margin-top: 2px;">
                                ${(art.kilos_sugeridos || 0).toFixed(1)} kg (${art.kilos_unidad} kg/u)
                            </div>
                        `;
                    } else {
                        prodSugeridaHtml = `<span style="color: var(--text-muted); font-size: 0.74rem;">✓ Suficiente</span>`;
                    }

                    return `
                        <tr class="${rowClass}">
                            <td>${getBadgeSemaforo(art.estado_alarma, art.dias_cobertura)}</td>
                            <td class="cell-sku">${art.articulo_id}</td>
                            <td class="cell-desc">
                                <strong>${art.descripcion}</strong>
                                <div class="cell-submeta">${art.familia_nombre || ''} &bull; ${art.kilos_unidad} kg/u</div>
                            </td>
                            <td>${badgeLdn}</td>
                            <td class="cell-num">
                                <strong style="color: ${art.stock_actual <= 0 ? '#f87171' : '#fff'};">
                                    ${formatearUnidadesStock(art.stock_actual)} u.
                                </strong>
                                <div class="cell-submeta">${(art.stock_kilos || 0).toFixed(1)} kg</div>
                            </td>
                            <td class="cell-num">
                                <strong>${art.demanda_diaria_promedio.toFixed(2)}/d</strong>
                                <div class="cell-submeta">${art.ventas_ventana.toLocaleString('es-AR')} en ${ventanaDiasDemanda}d</div>
                            </td>
                            <td class="cell-num">
                                <strong>${cobStr}</strong>
                                <div>${getBarraCobertura(art.dias_cobertura)}</div>
                            </td>
                            <td class="cell-num" style="background-color: rgba(139, 92, 246, 0.06);">
                                ${prodSugeridaHtml}
                            </td>
                            <td style="font-size: 0.74rem; color: ${art.factibilidad && art.factibilidad.factible ? 'var(--text-secondary)' : '#f87171'};">
                                ${art.factibilidad ? art.factibilidad.detalle : '-'}
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }
    }

    // =========================================================================
    // FILTRADO DE ÍTEMS DE COMPRAS A PROVEEDORES (MRP)
    // =========================================================================
    function filtrarItemsCompras(items) {
        if (!Array.isArray(items)) return [];
        const searchTerms = normalizarTexto(queryBusqueda).split(/\s+/).filter(Boolean);

        return items.filter(item => {
            // Filtro por semáforo
            if (filtroSemaforo === 'criticos') {
                if (item.urgencia !== 1 && item.urgencia !== 2) return false;
            } else if (filtroSemaforo === 'atencion') {
                if (item.urgencia !== 3) return false;
            } else if (filtroSemaforo === 'con_sugerencia') {
                if (!item.cantidad_sugerida_bultos || item.cantidad_sugerida_bultos <= 0) return false;
            } else if (filtroSemaforo === 'optimos') {
                if (item.urgencia !== 4 && item.cobertura_dias < 15) return false;
            } else if (filtroSemaforo === 'sobre_stock') {
                if (item.cobertura_dias <= 45) return false;
            }

            // Filtro de búsqueda acumulativo (AND) - Política Universal LAMDA
            if (searchTerms.length > 0) {
                const kgBulto = item.kilos_por_bulto || item.unidad_bulto_kg;
                const tokens = [
                    item.articulo_codigo || '',
                    item.descripcion || '',
                    item.tipo_origen || '',
                    item.categoria_item || '',
                    item.nombre_ingrediente_fabrica || '',
                    item.productos_afectados || '',
                    kgBulto ? `${kgBulto}kg ${kgBulto} kg` : ''
                ];
                const textoBuscable = normalizarTexto(tokens.join(' '));
                const coincide = searchTerms.every(term => textoBuscable.includes(term));
                if (!coincide) return false;
            }

            return true;
        });
    }

    // TAB 4: COMPRAS A PROVEEDORES CONSOLIDADAS (MRP PURO DESPIECE A MATERIAS PRIMAS)
    function renderizarTabAbastecimiento() {
        const kpiContainer = document.getElementById('kpis-resumen-compras-tab');
        const tbody = document.getElementById('tbody-compras-proveedores-tab');
        if (!tbody) return;

        if (!datosCompras || !Array.isArray(datosCompras.items_compras)) {
            tbody.innerHTML = `<tr><td colspan="10" class="empty-state">Consultando orden consolidada de compras a proveedores...</td></tr>`;
            return;
        }

        const kpis = datosCompras.resumen_kpi || {};
        const items = datosCompras.items_compras || [];

        // 1. Renderizar Mini KPIs en la cabecera de la pestaña
        if (kpiContainer) {
            kpiContainer.innerHTML = `
                <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Total Ítems</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #fff;">${kpis.total_items_a_pedir || items.length}</div>
                </div>
                <div style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #f87171; font-weight: 700; text-transform: uppercase;">🔴 Quiebres</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #f87171;">${kpis.quiebres_inmediatos_count || 0}</div>
                </div>
                <div style="background: rgba(249,115,22,0.1); border: 1px solid rgba(249,115,22,0.25); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #fb923c; font-weight: 700; text-transform: uppercase;">🟠 Críticos (≤7d)</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #fb923c;">${kpis.criticos_semana_count || 0}</div>
                </div>
                <div style="background: rgba(234,179,8,0.1); border: 1px solid rgba(234,179,8,0.25); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #facc15; font-weight: 700; text-transform: uppercase;">🟡 Atención (8-15d)</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #facc15;">${kpis.atencion_quincenal_count || 0}</div>
                </div>
                <div style="background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.25); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #60a5fa; font-weight: 700; text-transform: uppercase;">Total Bultos</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #60a5fa;">${(kpis.total_bultos_estimados || 0).toLocaleString('es-AR')}</div>
                </div>
                <div style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.25); border-radius: 6px; padding: 8px 12px; text-align: center;">
                    <div style="font-size: 0.68rem; color: #34d399; font-weight: 700; text-transform: uppercase;">Kilos Totales</div>
                    <div style="font-size: 1.25rem; font-weight: 800; color: #34d399;">${(kpis.total_kilos_estimados || 0).toLocaleString('es-AR', {minimumFractionDigits: 1, maximumFractionDigits: 1})} kg</div>
                </div>
            `;
        }

        // 2. Filtrar items de compras según selector y buscador
        const itemsFiltrados = filtrarItemsCompras(items);

        if (itemsFiltrados.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="empty-state">No se encontraron ítems de compras que coincidan con los filtros seleccionados.</td></tr>`;
            return;
        }

        // 3. Renderizar filas
        tbody.innerHTML = itemsFiltrados.map(item => {
            let urgBadge = '';
            let rowClass = '';
            if (item.urgencia === 1) {
                urgBadge = `<span class="badge-status status-critico-sin-stock" style="font-size: 0.72rem; padding: 3px 8px;">🔴 Quiebre Inmediato</span>`;
                rowClass = 'row-critico';
            } else if (item.urgencia === 2) {
                urgBadge = `<span class="badge-status status-critico" style="font-size: 0.72rem; padding: 3px 8px;">🟠 Crítico (≤7d)</span>`;
                rowClass = 'row-critico';
            } else if (item.urgencia === 3) {
                urgBadge = `<span class="badge-status status-atencion" style="font-size: 0.72rem; padding: 3px 8px;">🟡 Atención (8-15d)</span>`;
            } else {
                urgBadge = `<span class="badge-status status-optimo" style="font-size: 0.72rem; padding: 3px 8px;">⚪ Planificado</span>`;
            }

            const cobStr = item.cobertura_dias === 999 ? '∞' : `${parseFloat(item.cobertura_dias || 0).toFixed(1)}d`;
            let stockBultosStr = '';
            const bIng = item.stock_taller_bultos || 0;
            const bDepo = item.stock_deposito_bultos || 0;
            const kgTerm = item.stock_terminado_kg || 0;
            const kgSuelto = item.stock_suelto_fabrica_kg || 0;
            const kgSat = item.stock_satelite_kg || 0;

            const desglosePartes = [];
            if (kgTerm > 0) desglosePartes.push(`${kgTerm} kg term.`);
            if (kgSuelto > 0) desglosePartes.push(`${kgSuelto} kg suelto`);
            if (kgSat > 0) desglosePartes.push(`${kgSat} kg UP`);
            if (bIng > 0) desglosePartes.push(`${bIng} b. ingred.`);
            if (bDepo > 0) desglosePartes.push(`${bDepo} b. dep.`);

            if (desglosePartes.length > 0) {
                stockBultosStr = desglosePartes.join(' + ');
            } else if (item.stock_actual_bultos !== undefined) {
                stockBultosStr = `${item.stock_actual_bultos} bultos`;
            }

            let badgeNegativo = '';
            if (item.deposito_negativo) {
                badgeNegativo = `<div class="cell-submeta" style="color: #f59e0b; font-weight: 700;">⚠️ Depósito en negativo</div>`;
            }
            const prodAfectados = item.productos_afectados || '';

            return `
                <tr class="${rowClass}">
                    <td>${urgBadge}</td>
                    <td style="font-size: 0.72rem; color: var(--text-secondary); white-space: nowrap;">
                        ${item.categoria_item || item.tipo_origen}
                    </td>
                    <td class="cell-sku">${item.articulo_codigo || 'S/CÓD'}</td>
                    <td class="cell-desc">
                        <strong>${item.descripcion}</strong>
                        ${item.nombre_ingrediente_fabrica ? `<div class="cell-submeta" style="color: #93c5fd;">Insumo ingredientes: ${item.nombre_ingrediente_fabrica}</div>` : ''}
                        ${item.deficit_comprometido_kg > 0 ? `<div class="cell-submeta" style="color: #f87171; font-weight: 700;">🚨 ${parseFloat(item.deficit_comprometido_kg).toFixed(1)} kg pedidos activos comprometidos</div>` : ''}
                    </td>
                    <td class="cell-num">
                        <strong style="color: ${item.stock_actual_kg <= 0 ? '#f87171' : '#fff'};">
                            ${item.stock_actual_kg.toLocaleString('es-AR')} kg
                        </strong>
                        <div class="cell-submeta">${stockBultosStr}</div>
                        ${badgeNegativo}
                    </td>
                    <td class="cell-num">
                        <strong>${parseFloat(item.demanda_diaria || 0).toFixed(2)} kg/d</strong>
                        <div class="cell-submeta">Base 90d</div>
                    </td>
                    <td class="cell-num">
                        <strong>${cobStr}</strong>
                        <div>${getBarraCobertura(item.cobertura_dias)}</div>
                    </td>
                    <td class="cell-num">
                        <strong style="color: #f87171;">${parseFloat(item.kilos_faltantes || item.kilos_sugeridos || 0).toFixed(1)} kg</strong>
                        ${item.deficit_comprometido_kg > 0 ? `<div class="cell-submeta" style="color: #fb923c;">(Déficit pedidos)</div>` : ''}
                    </td>
                    <td class="cell-num" style="background-color: rgba(59, 130, 246, 0.08);">
                        <span class="accion-badge accion-compra" style="font-size: 0.80rem; padding: 4px 8px;">
                            📦 <strong>+${item.cantidad_sugerida_bultos} bultos</strong>
                        </span>
                        <div class="cell-submeta" style="color: #94a3b8; margin-top: 2px;">
                            ${item.kilos_sugeridos} kg (${item.kilos_por_bulto || item.unidad_bulto_kg || 1} kg/b)
                        </div>
                    </td>
                    <td>
                        <div style="font-size: 0.72rem; color: var(--text-secondary); max-width: 280px; line-height: 1.3;" title="${prodAfectados}">
                            ${prodAfectados ? (prodAfectados.length > 70 ? prodAfectados.slice(0, 67) + '...' : prodAfectados) : '-'}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // TAB 5: HISTORIAL Y FRECUENCIAS DE PRODUCCIÓN REAL
    function renderizarTabFrecuencias() {
        const tbody = document.getElementById('tbody-frecuencias-produccion');
        if (!tbody) return;

        const items = filtrarItems(dataMaster.plan_semanal_priorizado);
        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Sin registros bajo los filtros activos.</td></tr>`;
            return;
        }

        tbody.innerHTML = items.map(art => {
            const ultimaProdStr = art.ultima_produccion_fecha 
                ? new Date(art.ultima_produccion_fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                : 'Sin registro';

            const diasProdStr = art.dias_desde_ultima_produccion !== null
                ? `${art.dias_desde_ultima_produccion} días atrás`
                : '-';

            return `
                <tr>
                    <td class="cell-sku">${art.articulo_id}</td>
                    <td class="cell-desc">
                        <strong>${art.descripcion}</strong>
                        <div class="cell-submeta">${getBadgeLDN(art.ldn)}</div>
                    </td>
                    <td class="cell-num"><strong>${formatearUnidadesStock(art.stock_actual)}</strong></td>
                    <td style="text-align: center;"><strong>${ultimaProdStr}</strong></td>
                    <td style="text-align: center; font-size: 0.78rem; color: ${art.dias_desde_ultima_produccion > 30 ? '#f87171' : 'var(--text-secondary)'};">
                        ${diasProdStr}
                    </td>
                    <td class="cell-num"><strong>${art.carros_realizados_90d}</strong> carros</td>
                    <td class="cell-num">~<strong>${art.lote_promedio_historico}</strong> u./carro</td>
                    <td>${getBadgeSemaforo(art.estado_alarma, art.dias_cobertura)}</td>
                </tr>
            `;
        }).join('');
    }

    // =========================================================================
    // MODAL DETALLE DETERMINISTA (SWEETALERT2)
    // =========================================================================
    window.abrirModalDetalle = function (sku) {
        if (!dataMaster || !Array.isArray(dataMaster.plan_semanal_priorizado)) return;
        const art = dataMaster.plan_semanal_priorizado.find(a => a.articulo_id === sku);
        if (!art) return;

        const ultimaVentaStr = art.ultima_venta_fecha 
            ? new Date(art.ultima_venta_fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : 'Sin ventas recientes';

        const ultimaProdStr = art.ultima_produccion_fecha
            ? new Date(art.ultima_produccion_fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : 'Sin producción registrada';

        Swal.fire({
            title: `<span style="font-size: 1.15rem; color: #fff;">[${art.articulo_id}] ${art.descripcion}</span>`,
            html: `
                <div style="text-align: left; font-size: 0.82rem; color: #d1d5db; line-height: 1.5; display: flex; flex-direction: column; gap: 10px;">
                    <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);">
                        <div><strong>Línea de Negocio:</strong> ${art.tipo_proceso} (LDN ${art.ldn})</div>
                        <div><strong>Familia / Rubro:</strong> ${art.familia_nombre} &bull; ${art.rubro} / ${art.sub_rubro}</div>
                        <div><strong>Peso por Unidad:</strong> ${art.kilos_unidad} kg</div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <div style="background: rgba(59, 130, 246, 0.1); padding: 8px; border-radius: 6px; border: 1px solid rgba(59, 130, 246, 0.3);">
                            <div style="font-size: 0.70rem; color: #60a5fa; font-weight: 700;">STOCK CONSOLIDADO</div>
                            <div style="font-size: 1.2rem; font-weight: 800; color: #fff;">${formatearUnidadesStock(art.stock_actual)} u.</div>
                            <div style="font-size: 0.72rem; color: #9ca3af;">${art.stock_kilos.toFixed(1)} kg totales</div>
                        </div>
                        <div style="background: rgba(16, 185, 129, 0.1); padding: 8px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.3);">
                            <div style="font-size: 0.70rem; color: #34d399; font-weight: 700;">DEMANDA DIARIA (${ventanaDiasDemanda}d)</div>
                            <div style="font-size: 1.2rem; font-weight: 800; color: #fff;">${art.demanda_diaria_promedio.toFixed(2)}/día</div>
                            <div style="font-size: 0.72rem; color: #9ca3af;">${art.ventas_ventana.toLocaleString('es-AR')} vendidas</div>
                        </div>
                    </div>

                    <div style="background: rgba(255,255,255,0.03); padding: 8px; border-radius: 6px;">
                        <div><strong>Cobertura Restante:</strong> ${art.dias_cobertura === 999 ? '∞ días' : art.dias_cobertura.toFixed(1) + ' días'}</div>
                        <div><strong>Última Venta:</strong> ${ultimaVentaStr}</div>
                        <div><strong>Última Producción en Carro:</strong> ${ultimaProdStr} (${art.carros_realizados_90d} carros en 90d)</div>
                    </div>

                    <div style="background: ${art.factibilidad.factible ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; border: 1px solid ${art.factibilidad.factible ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}; padding: 10px; border-radius: 6px;">
                        <div style="font-weight: 700; color: ${art.factibilidad.factible ? '#34d399' : '#f87171'};">
                            ${art.factibilidad.factible ? '✓ Factibilidad Operativa Asegurada' : '⚠️ Alerta de Insumo Bloqueante'}
                        </div>
                        <div style="margin-top: 4px;">${art.factibilidad.detalle}</div>
                    </div>
                </div>
            `,
            background: '#151e2e',
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#3b82f6'
        });
    };

    // =========================================================================
    // EVENTOS Y ENLACE CON DOM
    // =========================================================================
    window.cambiarTab = function (tabId, options = {}) {
        const resetFiltros = options.resetFiltros !== false;
        const autoScroll = options.autoScroll !== false;

        tabActiva = tabId;
        document.querySelectorAll('.tab-btn').forEach(btn => {
            if (btn.dataset.tab === tabId) btn.classList.add('active');
            else btn.classList.remove('active');
        });

        document.querySelectorAll('.tab-pane').forEach(pane => {
            if (pane.id === tabId) pane.classList.add('active');
            else pane.classList.remove('active');
        });

        // Si se cambia de solapa principal y había un filtro restrictivo de semáforo (ej: 'criticos'),
        // resetearlo a 'todos' para que la solapa de destino no se renderice vacía o mutilada
        if (resetFiltros && filtroSemaforo !== 'todos') {
            filtroSemaforo = 'todos';
            const selectSemaforo = document.getElementById('select-semaforo');
            if (selectSemaforo) {
                selectSemaforo.value = 'todos';
                selectSemaforo.style.borderColor = '';
                selectSemaforo.style.background = '';
                selectSemaforo.style.color = '';
            }
        }

        renderizarVistaActiva();

        // Evitar que el scroll quede atrapado en el fondo si la solapa previa era más alta
        if (autoScroll) {
            const controlsBar = document.querySelector('.controls-bar');
            if (controlsBar && window.scrollY > (controlsBar.offsetTop - 50)) {
                window.scrollTo({ top: controlsBar.offsetTop - 75, behavior: 'smooth' });
            }
        }
    };

    window.cambiarVentanaDemanda = function (dias) {
        ventanaDiasDemanda = parseInt(dias) || 14;
        try {
            localStorage.setItem('lamda_planificacion_demanda_dias', String(ventanaDiasDemanda));
        } catch (e) {
            console.warn('No se pudo guardar demanda en localStorage:', e);
        }
        const modalDemanda = document.getElementById('modal-select-demanda');
        if (modalDemanda && modalDemanda.value !== String(ventanaDiasDemanda)) {
            modalDemanda.value = String(ventanaDiasDemanda);
        }
        const selVentana = document.getElementById('select-ventana');
        if (selVentana && selVentana.value !== String(ventanaDiasDemanda)) {
            selVentana.value = String(ventanaDiasDemanda);
        }
        cargarPlanificacion();
    };

    /**
     * Asegura que exista una opción en el selector con el valor numérico (útil para días manuales/personalizados)
     */
    function asegurarOpcionPersonalizada(selectId, diasNum, textoPrefijo = '') {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        
        const valorStr = String(diasNum);
        let optExistente = sel.querySelector(`option[value="${valorStr}"]`);
        if (!optExistente) {
            const estandares = ['7', '14', '21', '30', '60', '90', 'manual'];
            // Limpiar opciones manuales anteriores que no sean estándares
            Array.from(sel.options).forEach(opt => {
                if (!estandares.includes(opt.value)) {
                    sel.removeChild(opt);
                }
            });

            const optManual = sel.querySelector('option[value="manual"]');
            const nuevaOpt = document.createElement('option');
            nuevaOpt.value = valorStr;
            nuevaOpt.text = textoPrefijo ? `${textoPrefijo}: ${diasNum} días (Manual)` : `${diasNum} días (Manual / Personalizado)`;
            nuevaOpt.selected = true;
            if (optManual) {
                sel.insertBefore(nuevaOpt, optManual);
            } else {
                sel.appendChild(nuevaOpt);
            }
        } else {
            optExistente.selected = true;
        }
        sel.value = valorStr;
    }

    /**
     * Sincroniza todos los selectores de objetivo de cobertura del DOM
     */
    function sincronizarSelectoresObjetivo() {
        asegurarOpcionPersonalizada('select-objetivo', diasObjetivoCobertura);
        asegurarOpcionPersonalizada('modal-select-objetivo', diasObjetivoCobertura);
        asegurarOpcionPersonalizada('select-horizonte-compras', diasObjetivoCompras, 'Proyección');
    }

    /**
     * Abre un cuadro de diálogo para ingresar manualmente cualquier cantidad de días para adelante
     */
    window.ingresarDiasObjetivoManual = async function (origen = 'header') {
        const valorActual = (origen === 'compras') ? (diasObjetivoCompras || 30) : (diasObjetivoCobertura || 21);
        
        if (typeof Swal !== 'undefined') {
            const { value: dias } = await Swal.fire({
                title: '🎯 Configurar Horizonte a Cubrir',
                html: `Ingresá la cantidad de <b>días hacia adelante</b> a proyectar para calcular necesidades de producción y stock:`,
                input: 'number',
                inputValue: valorActual,
                inputAttributes: {
                    min: '1',
                    max: '365',
                    step: '1',
                    style: 'text-align: center; font-size: 1.3rem; font-weight: bold; width: 140px; margin: 0 auto;'
                },
                showCancelButton: true,
                confirmButtonText: '⚡ Aplicar y Recalcular',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#10b981',
                cancelButtonColor: '#64748b',
                inputValidator: (value) => {
                    const num = parseInt(value);
                    if (!value || isNaN(num) || num <= 0) {
                        return 'Ingresá un número de días válido (mayor a 0)';
                    }
                    if (num > 365) {
                        return 'El máximo permitido es 365 días (1 año)';
                    }
                    return null;
                }
            });

            if (dias) {
                const diasNum = parseInt(dias);
                aplicarDiasObjetivoPersonalizado(diasNum, origen);
            } else {
                sincronizarSelectoresObjetivo();
            }
        } else {
            const respuesta = prompt('Ingresá la cantidad de días hacia adelante a proyectar:', String(valorActual));
            const num = parseInt(respuesta);
            if (num > 0 && num <= 365) {
                aplicarDiasObjetivoPersonalizado(num, origen);
            } else {
                sincronizarSelectoresObjetivo();
            }
        }
    };

    /**
     * Intercepta la selección de "manual" en el modal de impresión
     */
    window.verificarObjetivoModal = function (val) {
        if (val === 'manual') {
            window.ingresarDiasObjetivoManual('modal');
        }
    };

    /**
     * Aplica el valor numérico personalizado al estado global, sincroniza selectores y recalcula
     */
    function aplicarDiasObjetivoPersonalizado(diasNum, origen = 'header') {
        if (origen === 'compras') {
            diasObjetivoCompras = diasNum;
            asegurarOpcionPersonalizada('select-horizonte-compras', diasNum, 'Proyección');
            window.cambiarHorizonteCompras(diasNum);
            return;
        }

        // Para header o modal: aplica al objetivo general de producción y sincroniza compras
        diasObjetivoCobertura = diasNum;
        diasObjetivoCompras = diasNum; // Sincroniza compras con la proyección general

        try {
            localStorage.setItem('lamda_planificacion_objetivo_dias', String(diasObjetivoCobertura));
        } catch (e) {
            console.warn('No se pudo guardar objetivo en localStorage:', e);
        }

        sincronizarSelectoresObjetivo();
        cargarPlanificacion();
    }

    /**
     * Cambia los días objetivo desde el selector del header
     */
    window.cambiarDiasObjetivo = function (dias) {
        if (dias === 'manual') {
            window.ingresarDiasObjetivoManual('header');
            return;
        }
        const diasNum = parseInt(dias) || 21;
        aplicarDiasObjetivoPersonalizado(diasNum, 'header');
    };

    window.cambiarFiltroSemaforo = function (estado) {
        filtroSemaforo = estado;
        const selectSemaforo = document.getElementById('select-semaforo');
        if (selectSemaforo) {
            selectSemaforo.value = estado;
            if (estado !== 'todos') {
                selectSemaforo.style.borderColor = '#f59e0b';
                selectSemaforo.style.background = 'rgba(245, 158, 11, 0.15)';
                selectSemaforo.style.color = '#fbbf24';
            } else {
                selectSemaforo.style.borderColor = '';
                selectSemaforo.style.background = '';
                selectSemaforo.style.color = '';
            }
        }
        renderizarVistaActiva();
    };

    window.filtrarBusqueda = function () {
        const input = document.getElementById('search-global');
        queryBusqueda = input ? input.value : '';
        renderizarVistaActiva();
    };

    window.filtrarPorTexto = function (txt) {
        const input = document.getElementById('search-global');
        if (input) {
            input.value = txt;
            queryBusqueda = txt;
            renderizarVistaActiva();
        }
    };

    // =========================================================================
    // GESTIÓN DE EMISIÓN DE INFORMES Y VISOR DE COMPRAS A PROVEEDORES
    // =========================================================================

    let tipoReporteSeleccionado = 'compras';
    let datosUltimoReporteCompras = null;

    /**
     * Abre el modal selector de tipos de informe
     */
    window.imprimirReporte = function () {
        // Sincronizar selectores del modal según el tipo seleccionado actualmente
        const modalDemanda = document.getElementById('modal-select-demanda');
        const modalObjetivo = document.getElementById('modal-select-objetivo');
        
        if (tipoReporteSeleccionado === 'compras') {
            if (modalDemanda) modalDemanda.value = '90';
            asegurarOpcionPersonalizada('modal-select-objetivo', diasObjetivoCompras || 30);
        } else {
            if (modalDemanda) modalDemanda.value = String(ventanaDiasDemanda);
            asegurarOpcionPersonalizada('modal-select-objetivo', diasObjetivoCobertura);
        }

        const modal = document.getElementById('modal-selector-impresion');
        if (modal) {
            modal.style.display = 'flex';
        } else {
            window.print();
        }
    };

    /**
     * Despliega de inmediato el visor imprimible de compras con los datos actuales
     */
    window.abrirVisorCompras = async function () {
        if (datosCompras && Array.isArray(datosCompras.items_compras)) {
            datosUltimoReporteCompras = datosCompras;
            renderizarVisorReporteCompras(datosCompras);
        } else {
            await cargarYMostrarReporteCompras();
        }
    };

    // Alias para compatibilidad de botones en pestaña Compras
    window.abrirModalSelectorReporte = window.abrirVisorCompras;

    /**
     * Cierra el modal selector de tipos de informe
     */
    window.cerrarModalSelectorImpresion = function () {
        const modal = document.getElementById('modal-selector-impresion');
        if (modal) modal.style.display = 'none';
    };

    /**
     * Selecciona una opción en el modal de reportes
     */
    window.seleccionarTipoReporte = function (tipo) {
        tipoReporteSeleccionado = tipo;
        
        // Actualizar visualización de tarjetas
        document.querySelectorAll('.report-card').forEach(card => {
            card.classList.remove('selected');
            const radio = card.querySelector('input[type="radio"]');
            if (radio && radio.value === tipo) {
                card.classList.add('selected');
                radio.checked = true;
            }
        });

        // Adaptar dinámicamente los parámetros por defecto del modal según el tipo de informe
        const modalDemanda = document.getElementById('modal-select-demanda');
        if (tipo === 'compras') {
            if (modalDemanda) modalDemanda.value = '90';
            asegurarOpcionPersonalizada('modal-select-objetivo', diasObjetivoCompras || 30);
        } else {
            if (modalDemanda) modalDemanda.value = String(ventanaDiasDemanda);
            asegurarOpcionPersonalizada('modal-select-objetivo', diasObjetivoCobertura);
        }
    };

    /**
     * Genera el informe seleccionado
     */
    window.generarReporteSeleccionado = async function () {
        const demandaSelect = document.getElementById('modal-select-demanda');
        const objetivoSelect = document.getElementById('modal-select-objetivo');
        const diasDemandaModal = demandaSelect ? (parseInt(demandaSelect.value) || 14) : ventanaDiasDemanda;
        const diasObjetivoModal = objetivoSelect ? (parseInt(objetivoSelect.value) || 21) : diasObjetivoCobertura;

        if (tipoReporteSeleccionado === 'compras') {
            cerrarModalSelectorImpresion();
            await cargarYMostrarReporteCompras();
            return;
        }

        // Para reportes de taller (fraccionado, mixes, taller, externa o general)
        // Persistir la configuración elegida por el usuario para Taller
        ventanaDiasDemanda = diasDemandaModal;
        diasObjetivoCobertura = diasObjetivoModal;
        try {
            localStorage.setItem('lamda_planificacion_demanda_dias', String(ventanaDiasDemanda));
            localStorage.setItem('lamda_planificacion_objetivo_dias', String(diasObjetivoCobertura));
        } catch (e) {
            console.warn('No se pudo guardar en localStorage:', e);
        }

        // Sincronizar selectores del header
        const selVentana = document.getElementById('select-ventana');
        if (selVentana && selVentana.value !== String(ventanaDiasDemanda)) {
            selVentana.value = String(ventanaDiasDemanda);
        }
        const selObjetivo = document.getElementById('select-objetivo');
        if (selObjetivo && selObjetivo.value !== String(diasObjetivoCobertura)) {
            selObjetivo.value = String(diasObjetivoCobertura);
        }

        cerrarModalSelectorImpresion();

        // Recalculamos la planificación determinista con la demanda y objetivo elegidos
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                title: 'Calculando Planificación...',
                text: `Generando directiva de producción (${ventanaDiasDemanda >= 999 ? 'Histórico completo' : ventanaDiasDemanda + ' días base'} / Objetivo ${diasObjetivoCobertura} días)...`,
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });
        }
        await cargarPlanificacion();
        if (typeof Swal !== 'undefined') {
            Swal.close();
        }

        if (tipoReporteSeleccionado === 'fraccionado') {
            window.abrirVisorTaller('fraccionado');
        } else if (tipoReporteSeleccionado === 'mixes') {
            window.abrirVisorTaller('mixes');
        } else if (tipoReporteSeleccionado === 'taller') {
            window.abrirVisorTaller('taller');
        } else if (tipoReporteSeleccionado === 'externa') {
            window.abrirVisorExterna();
        } else {
            window.cambiarTab('tab-plan-semanal');
            setTimeout(() => window.print(), 300);
        }
    };

    /**
     * Consulta el backend y despliega el visor de compras
     */
    async function cargarYMostrarReporteCompras() {
        const demandaSelect = document.getElementById('modal-select-demanda');
        const objetivoSelect = document.getElementById('modal-select-objetivo');
        const soloFaltantesCheck = document.getElementById('modal-check-solo-faltantes');

        const diasDemanda = demandaSelect ? (parseInt(demandaSelect.value) || 90) : 90;
        const diasObjetivo = objetivoSelect ? (parseInt(objetivoSelect.value) || 30) : (diasObjetivoCompras || 30);
        const soloFaltantes = soloFaltantesCheck ? soloFaltantesCheck.checked : true;

        // Si los parámetros coinciden exactamente con la base activa de Compras (90 días y objetivo actual)
        // y ya contamos con los datos cargados en pantalla, renderizamos directamente sin latencia
        if (diasDemanda === 90 && diasObjetivo === (diasObjetivoCompras || 30) && soloFaltantes && datosCompras && Array.isArray(datosCompras.items_compras)) {
            datosUltimoReporteCompras = datosCompras;
            renderizarVisorReporteCompras(datosCompras);
            return;
        }

        if (typeof Swal !== 'undefined') {
            Swal.fire({
                title: 'Consolidando Compras...',
                html: `Calculando demanda sobre ventas de los últimos <b>${diasDemanda >= 999 ? 'Histórico completo' : diasDemanda + ' días (Trimestre)'}</b> y proyectando necesidades a <b>${diasObjetivo} días</b>...`,
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });
        }

        try {
            const url = `/api/produccion/informe/compras-proveedores?demanda=${diasDemanda}&objetivo=${diasObjetivo}&solo_faltantes=${soloFaltantes}`;
            const res = await fetch(url);
            
            if (!res.ok) {
                throw new Error(`Error en el servidor al generar informe de compras (HTTP ${res.status})`);
            }

            const data = await res.json();
            datosUltimoReporteCompras = data;

            if (typeof Swal !== 'undefined') {
                Swal.close();
            }

            renderizarVisorReporteCompras(data);

        } catch (error) {
            console.error('❌ Error generando informe de compras:', error);
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'error',
                    title: 'Error de Comunicación',
                    text: error.message || 'No se pudo generar el informe de compras.'
                });
            } else {
                alert('Error al generar informe de compras: ' + error.message);
            }
        }
    }

    /**
     * Renderiza los datos en la hoja imprimible del modal visor
     */
    function renderizarVisorReporteCompras(data) {
        const modalVisor = document.getElementById('modal-visor-compras');
        if (!modalVisor) return;

        const kpis = data.resumen_kpi || {};
        const params = data.parametros || {};
        const items = data.items_compras || [];

        // Metadatos
        const now = new Date();
        const fechaStr = now.toLocaleDateString('es-AR') + ' ' + now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        
        document.getElementById('sheet-meta-fecha').innerText = fechaStr;
        document.getElementById('sheet-meta-demanda').innerText = `${params.base_estadistica || 'Último Trimestre (90 días)'}`;
        document.getElementById('sheet-meta-objetivo').innerText = `${params.horizonte_proyectado || '30 días (Mes Completo)'}`;
        
        const visorSub = document.getElementById('visor-subtitle-meta');
        if (visorSub) {
            visorSub.innerText = `Base Demanda: ${params.ventana_dias_demanda}d | Proyección: ${params.dias_objetivo_cobertura}d | Ítems: ${items.length}`;
        }

        // KPIs
        document.getElementById('sheet-kpi-total-items').innerText = kpis.total_items_a_pedir || items.length;
        document.getElementById('sheet-kpi-quiebres').innerText = kpis.quiebres_inmediatos_count || 0;
        document.getElementById('sheet-kpi-criticos').innerText = kpis.criticos_semana_count || 0;
        document.getElementById('sheet-kpi-atencion').innerText = kpis.atencion_quincenal_count || 0;
        document.getElementById('sheet-kpi-bultos').innerText = (kpis.total_bultos_estimados || 0).toLocaleString('es-AR');
        document.getElementById('sheet-kpi-kilos').innerText = `${(kpis.total_kilos_estimados || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;

        // Tabla
        const tbody = document.getElementById('sheet-tbody-compras');
        if (tbody) {
            tbody.innerHTML = '';

            if (items.length === 0) {
                tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 24px; color: #64748b;">No se detectaron necesidades de compra para el horizonte seleccionado.</td></tr>`;
            } else {
                items.forEach(item => {
                    const tr = document.createElement('tr');

                    let urgClass = 'urg-planificado';
                    let urgLabel = 'Planificado';
                    if (item.urgencia === 1) {
                        urgClass = 'urg-quiebre';
                        urgLabel = '🔴 QUIEBRE INMEDIATO';
                    } else if (item.urgencia === 2) {
                        urgClass = 'urg-critico';
                        urgLabel = '🟠 CRÍTICO (≤7d)';
                    } else if (item.urgencia === 3) {
                        urgClass = 'urg-atencion';
                        urgLabel = '🟡 ATENCIÓN (8-15d)';
                    }

                    const cobStr = item.cobertura_dias === 999 ? 'Sin rotación' : `${item.cobertura_dias} d`;
                    let stockStr = `${item.stock_actual_kg} kg`;
                    const bIng = item.stock_taller_bultos || 0;
                    const bDepo = item.stock_deposito_bultos || 0;
                    const kgTerm = item.stock_terminado_kg || 0;
                    const kgSuelto = item.stock_suelto_fabrica_kg || 0;
                    const kgSat = item.stock_satelite_kg || 0;

                    const desglosePartes = [];
                    if (kgTerm > 0) desglosePartes.push(`${kgTerm}kg term.`);
                    if (kgSuelto > 0) desglosePartes.push(`${kgSuelto}kg suelto`);
                    if (kgSat > 0) desglosePartes.push(`${kgSat}kg UP`);
                    if (bIng > 0) desglosePartes.push(`${bIng}b ingred.`);
                    if (bDepo > 0) desglosePartes.push(`${bDepo}b dep.`);
                    if (item.deposito_negativo) desglosePartes.push('⚠️ dep. neg.');

                    if (desglosePartes.length > 0) {
                        stockStr += ` (${desglosePartes.join(' + ')})`;
                    } else if (item.stock_actual_bultos !== undefined) {
                        stockStr += ` (${item.stock_actual_bultos} b)`;
                    }
                    const ddpStr = `${item.demanda_diaria} kg/d`;
                    const faltanteStr = `${item.kilos_sugeridos} kg`;
                    
                    const sugerenciaPedido = `<strong>${item.cantidad_sugerida_bultos} Bultos</strong> <span style="font-size: 0.72rem; color: #475569;">(${item.kilos_sugeridos} kg)</span>`;

                    tr.innerHTML = `
                        <td><span class="urgencia-badge-print ${urgClass}">${urgLabel}</span></td>
                        <td style="font-size: 0.72rem; color: #475569;">${item.categoria_item || item.tipo_origen}</td>
                        <td style="font-family: monospace; font-weight: 600;">${item.articulo_codigo || 'S/CÓDIGO'}</td>
                        <td>
                            <strong>${item.descripcion}</strong>
                            ${item.nombre_ingrediente_fabrica ? `<div style="font-size: 0.7rem; color: #64748b;">Insumo ingredientes: ${item.nombre_ingrediente_fabrica}</div>` : ''}
                        </td>
                        <td style="text-align: right;">${stockStr}</td>
                        <td style="text-align: right;">${ddpStr}</td>
                        <td style="text-align: right; font-weight: 600;">${cobStr}</td>
                        <td style="text-align: right; color: #b91c1c; font-weight: 700;">${faltanteStr}</td>
                        <td style="text-align: right; background-color: #f8fafc;" class="col-pedir">${sugerenciaPedido}</td>
                        <td style="font-size: 0.7rem; color: #475569;">${item.productos_afectados || '-'}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        }

        modalVisor.style.display = 'flex';
    }

    /**
     * Cierra el modal visor de compras
     */
    window.cerrarModalVisorCompras = function () {
        const modalVisor = document.getElementById('modal-visor-compras');
        if (modalVisor) modalVisor.style.display = 'none';
    };

    /**
     * Ejecuta la impresión formal de la hoja de compras
     */
    window.ejecutarImpresionLimpia = function () {
        const modal = document.getElementById('modal-visor-compras');
        if (modal) modal.classList.add('is-printing');
        window.print();
        setTimeout(() => {
            if (modal) modal.classList.remove('is-printing');
        }, 1500);
    };

    /**
     * Copia al portapapeles el pedido estructurado para WhatsApp o Email
     */
    window.copiarReporteWhatsApp = function () {
        if (!datosUltimoReporteCompras || !datosUltimoReporteCompras.items_compras) {
            alert('No hay datos disponibles para copiar.');
            return;
        }

        const items = datosUltimoReporteCompras.items_compras;
        const kpis = datosUltimoReporteCompras.resumen_kpi || {};
        const params = datosUltimoReporteCompras.parametros || {};
        const now = new Date();
        const fechaStr = now.toLocaleDateString('es-AR');

        let txt = `📦 *ORDEN DE NECESIDADES DE COMPRAS A PROVEEDORES — LAMDA*\n`;
        txt += `📅 *Fecha:* ${fechaStr} | 🎯 *Objetivo:* ${params.horizonte_proyectado || '30 días'}\n`;
        txt += `📊 *Base de Demanda:* ${params.base_estadistica || 'Último Trimestre (90 días)'}\n`;
        txt += `🔢 *Resumen:* ${items.length} ítems a comprar | ${kpis.total_bultos_estimados || 0} bultos | ${kpis.total_kilos_estimados || 0} kg\n`;
        txt += `----------------------------------------------------\n\n`;

        const quiebres = items.filter(i => i.urgencia === 1);
        if (quiebres.length > 0) {
            txt += `🚨 *QUIEBRE INMEDIATO (Stock 0 / Frenante):*\n`;
            quiebres.forEach(i => {
                txt += `• *[${i.articulo_codigo}]* ${i.descripcion}: *Pedir ${i.cantidad_sugerida_bultos} Bultos* (${i.kilos_sugeridos} kg)\n`;
            });
            txt += `\n`;
        }

        const criticos = items.filter(i => i.urgencia === 2);
        if (criticos.length > 0) {
            txt += `🟠 *ALERTA CRÍTICA (Cobertura ≤ 7 días - Pedir esta semana):*\n`;
            criticos.forEach(i => {
                txt += `• *[${i.articulo_codigo}]* ${i.descripcion}: *Pedir ${i.cantidad_sugerida_bultos} Bultos* (${i.kilos_sugeridos} kg) [Cob: ${i.cobertura_dias}d]\n`;
            });
            txt += `\n`;
        }

        const atencion = items.filter(i => i.urgencia === 3);
        if (atencion.length > 0) {
            txt += `🟡 *ATENCIÓN QUINCENAL (Cobertura 8 a 15 días):*\n`;
            atencion.forEach(i => {
                txt += `• *[${i.articulo_codigo}]* ${i.descripcion}: *Pedir ${i.cantidad_sugerida_bultos} Bultos* (${i.kilos_sugeridos} kg)\n`;
            });
            txt += `\n`;
        }

        const planificados = items.filter(i => i.urgencia === 4);
        if (planificados.length > 0) {
            txt += `⚪ *PLANIFICADOS MES (Reposición 16 a 30 días):*\n`;
            planificados.forEach(i => {
                txt += `• *[${i.articulo_codigo}]* ${i.descripcion}: *Pedir ${i.cantidad_sugerida_bultos} Bultos* (${i.kilos_sugeridos} kg)\n`;
            });
            txt += `\n`;
        }

        txt += `----------------------------------------------------\n`;
        txt += `_Generado por Sistema LAMDA Operaciones_`;

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt).then(() => {
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'success',
                        title: '¡Copiado al Portapapeles!',
                        text: 'El listado de compras ordenado por urgencia está listo para pegar en WhatsApp o enviar por Email.',
                        timer: 2500,
                        showConfirmButton: false
                    });
                } else {
                    alert('Listado copiado al portapapeles.');
                }
            }).catch(err => {
                console.error('Error al copiar:', err);
                copiarFallback(txt);
            });
        } else {
            copiarFallback(txt);
        }
    };

    function copiarFallback(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'success',
                    title: '¡Copiado al Portapapeles!',
                    timer: 2000,
                    showConfirmButton: false
                });
            } else {
                alert('Listado copiado al portapapeles.');
            }
        } catch (e) {
            alert('No se pudo copiar automáticamente. Por favor copia manualmente.');
        }
        document.body.removeChild(textarea);
    }

    // =========================================================================
    // VISOR DE DIRECTIVA Y CHECKLIST DE TALLER (A4 IMPRIMIBLE + WHATSAPP)
    // =========================================================================
    let tipoDirectivaTallerActiva = 'taller';

    window.abrirVisorTaller = function (tipo = 'taller') {
        tipoDirectivaTallerActiva = tipo;
        const modal = document.getElementById('modal-visor-taller');
        if (!modal || !dataMaster) return;

        const now = new Date();
        const fechaStr = now.toLocaleDateString('es-AR') + ' ' + now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        
        const elFecha = document.getElementById('sheet-taller-meta-fecha');
        const elTitle = document.getElementById('sheet-taller-doc-title');
        const elSector = document.getElementById('sheet-taller-meta-sector');
        const elResp = document.getElementById('sheet-taller-meta-responsable');
        const elMetaDemanda = document.getElementById('sheet-taller-meta-demanda');
        const elMetaObjetivo = document.getElementById('sheet-taller-meta-objetivo');
        const visorTitle = document.getElementById('visor-taller-titulo');
        const visorSubtitle = document.getElementById('visor-taller-subtitle');

        const baseDemandaTxt = ventanaDiasDemanda >= 999 ? 'Todas las facturas (Histórico Completo)' : (ventanaDiasDemanda === 90 ? 'Último Trimestre (90 días)' : `Últimos ${ventanaDiasDemanda} días`);
        const objetivoTxt = `${diasObjetivoCobertura} días de stock cubierto`;

        if (elFecha) elFecha.innerText = fechaStr;
        if (elResp) elResp.innerText = 'Equipo de Taller';
        if (elMetaDemanda) elMetaDemanda.innerText = baseDemandaTxt;
        if (elMetaObjetivo) elMetaObjetivo.innerText = objetivoTxt;
        if (visorSubtitle) visorSubtitle.innerText = `Base: ${baseDemandaTxt} • Objetivo: ${objetivoTxt}`;

        const ldn = dataMaster.lineas_de_negocio || {};
        const puros = ldn.ldn2_fraccionados || [];
        const purosConSugerencia = puros.filter(a => (a.cantidad_sugerida > 0) || (a.es_padre && ((a.packs_a_armar || 0) > 0)));
        const carros = dataMaster.carros_mixes_detallados || [];
        const carrosConDemanda = carros.filter(c => (c.kilos_carro_sugeridos || 0) > 0 || (c.granel_suficiente && c.presentaciones && c.presentaciones.some(p => (p.cantidad_sugerida > 0) || (p.es_padre && (p.packs_a_armar || 0) > 0))));

        const itemsTaller = dataMaster.produccion_interna_taller || [];
        const itemsTallerConAccion = itemsTaller.filter(a => (a.cantidad_sugerida > 0) || (a.es_padre && ((a.packs_a_armar || 0) > 0)));

        let kgPuros = purosConSugerencia.reduce((sum, a) => sum + (a.kilos_sugeridos || 0), 0);
        let kgCarros = carrosConDemanda.reduce((sum, c) => sum + (c.kilos_carro_sugeridos || 0), 0);
        let kgTallerTotal = itemsTallerConAccion.reduce((sum, a) => sum + (a.kilos_sugeridos || 0), 0);

        let quiebresPuros = purosConSugerencia.filter(a => (a.stock_neto_disponible !== undefined ? a.stock_neto_disponible <= 0 : a.stock_actual <= 0)).length;
        let quiebresCarros = carrosConDemanda.filter(c => c.urgencia_maxima === 1).length;
        let quiebresTallerTotal = itemsTallerConAccion.filter(a => (a.stock_neto_disponible !== undefined ? a.stock_neto_disponible <= 0 : a.stock_actual <= 0)).length;

        // KPIs
        const elTareas = document.getElementById('sheet-taller-kpi-tareas');
        const elQuiebres = document.getElementById('sheet-taller-kpi-quiebres');
        const elFracKg = document.getElementById('sheet-taller-kpi-fraccionados');
        const elMixesVal = document.getElementById('sheet-taller-kpi-mixes');
        const elKilosTot = document.getElementById('sheet-taller-kpi-kilos');

        if (tipo === 'fraccionado') {
            if (elTitle) elTitle.innerText = 'DIRECTIVA DE FRACCIONAMIENTO: MONO-INGREDIENTES';
            if (elSector) elSector.innerText = 'Planta de Envasado &bull; Unidades Únicas (LDN 2)';
            if (visorTitle) visorTitle.innerText = '🌾 Previsualización: Hoja de Fraccionamiento Puro (LDN 2)';
            if (elTareas) elTareas.innerText = `${purosConSugerencia.length} ítems`;
            if (elQuiebres) elQuiebres.innerText = quiebresPuros;
            if (elFracKg) elFracKg.innerText = `${kgPuros.toFixed(1)} kg`;
            if (elMixesVal) elMixesVal.innerText = '-';
            if (elKilosTot) elKilosTot.innerText = `${kgPuros.toFixed(1)} kg`;
        } else if (tipo === 'mixes') {
            if (elTitle) elTitle.innerText = 'DIRECTIVA DE TALLER: CARROS DE MIX Y MEZCLAS';
            if (elSector) elSector.innerText = 'Planta de Mezclado & Envasado de Mixes (LDN 3)';
            if (visorTitle) visorTitle.innerText = '🧪 Previsualización: Hoja de Carros de Mix (LDN 3)';
            if (elTareas) elTareas.innerText = `${carrosConDemanda.length} carros`;
            if (elQuiebres) elQuiebres.innerText = quiebresCarros;
            if (elFracKg) elFracKg.innerText = '-';
            if (elMixesVal) elMixesVal.innerText = `${carrosConDemanda.length} carros`;
            if (elKilosTot) elKilosTot.innerText = `${kgCarros.toFixed(1)} kg`;
        } else {
            if (elTitle) elTitle.innerText = 'DIRECTIVA OPERATIVA INTEGRAL DE PRODUCCIÓN Y TALLER';
            if (elSector) elSector.innerText = 'Taller Local &bull; Envasado y Mezclas (LDN 2 & 3)';
            if (visorTitle) visorTitle.innerText = '🏭 Previsualización: Hoja Completa de Taller (Puros + Carros)';
            if (elTareas) elTareas.innerText = `${itemsTallerConAccion.length} envasar + ${carrosConDemanda.length} carros`;
            if (elQuiebres) elQuiebres.innerText = quiebresTallerTotal;
            if (elFracKg) elFracKg.innerText = `${kgPuros.toFixed(1)} kg`;
            if (elMixesVal) elMixesVal.innerText = `${carrosConDemanda.length} carros`;
            if (elKilosTot) elKilosTot.innerText = `${(kgTallerTotal + kgCarros).toFixed(1)} kg`;
        }

        // Renderizado del contenido imprimible
        const container = document.getElementById('sheet-taller-contenido-print');
        if (!container) return;
        container.innerHTML = '';

        // Helper para renderizar filas de envasado
        function generarFilasEnvasadoPrint(items) {
            if (!items || items.length === 0) {
                return `<tr><td colspan="8" style="text-align: center; padding: 14px; color: #64748b;">No hay artículos pendientes de envasado.</td></tr>`;
            }
            return items.map(art => {
                let urgLabel = 'Planificado';
                let urgClass = 'urg-planificado';

                if (art.es_padre) {
                    if (art.packs_a_armar && art.packs_a_armar > 0) {
                        urgLabel = '📦 ARMAR PACK';
                        urgClass = 'urg-atencion';
                    } else {
                        urgLabel = '🟢 DISPONIBLE';
                        urgClass = 'urg-planificado';
                    }
                } else if ((art.stock_neto_disponible !== undefined ? art.stock_neto_disponible <= 0 : art.stock_actual <= 0)) {
                    urgLabel = '🔴 QUIEBRE';
                    urgClass = 'urg-quiebre';
                } else if (art.estado_alarma === 'CRITICO') {
                    urgLabel = '🟠 CRÍTICO';
                    urgClass = 'urg-critico';
                } else if (art.estado_alarma === 'ATENCION' || art.estado_alarma === 'ARMABLE_EN_DEPOSITO') {
                    urgLabel = '🟡 ATENCIÓN';
                    urgClass = 'urg-atencion';
                }

                const cob = art.dias_cobertura === 999 ? 'Sin rotación' : `${art.dias_cobertura.toFixed(1)} d`;
                
                let aEnvasarHtml = '';
                let ubicacionTxt = '';

                if (art.es_padre) {
                    if (art.packs_a_armar && art.packs_a_armar > 0) {
                        aEnvasarHtml = `<strong>📦 Armar ${formatearBolsas(art.packs_a_armar)} packs</strong><div style="font-size: 0.70rem; color: #7c3aed; font-weight: 700;">p/ pedidos (${art.pack_hijo_codigo || 'hijo'})</div>`;
                        ubicacionTxt = `📦 Depósito: Armar con unidades de ${art.pack_hijo_codigo || ''}`;
                    } else if (art.packs_armables > 0) {
                        aEnvasarHtml = `<strong style="color: #15803d; font-size: 0.78rem;">✓ ${formatearBolsas(art.packs_armables)} packs en depósito</strong><div style="font-size: 0.68rem; color: #64748b;">(${art.pack_hijo_codigo || ''})</div>`;
                        ubicacionTxt = `🟢 Depósito: ${formatearBolsas(art.packs_armables)} packs disponibles en depósito`;
                    } else {
                        aEnvasarHtml = `<span style="color: #64748b; font-size: 0.74rem;">✓ Sin pedidos</span>`;
                        ubicacionTxt = `🟢 Depósito: Stock cubierto`;
                    }
                } else if (art.ldn === 3) {
                    aEnvasarHtml = `<strong>+${formatearBolsas(art.cantidad_sugerida)} bolsas</strong><div style="font-size: 0.72rem; color: #0f172a; font-weight: 700;">${(art.kilos_sugeridos || 0).toFixed(1)} kg</div>`;
                    if (art.mix_granel_suficiente) {
                        ubicacionTxt = `🟢 Taller: Granel listo (${(art.mix_granel_disponible_kg || 0).toFixed(1)} kg)`;
                    } else if ((art.mix_carro_requerido_kg || 0) > 0) {
                        ubicacionTxt = `🥣 Requiere Carro (${(art.mix_carro_requerido_kg || 0).toFixed(1)} kg en Fase 1)`;
                    } else {
                        ubicacionTxt = `🟢 Granel en depósito`;
                    }
                } else {
                    aEnvasarHtml = `<strong>+${formatearBolsas(art.cantidad_sugerida)} bolsas</strong><div style="font-size: 0.72rem; color: #0f172a; font-weight: 700;">${(art.kilos_sugeridos || 0).toFixed(1)} kg</div>`;
                    const mpLabel = art.materia_prima_nombre && art.materia_prima_nombre !== 'Insumo Puro' ? ` &bull; <strong>${art.materia_prima_nombre}</strong>` : '';
                    if ((art.stock_taller_kg || 0) >= art.kilos_sugeridos) {
                        ubicacionTxt = `🟢 Taller: Bolsa abierta (${(art.stock_taller_kg || 0).toFixed(1)} kg disp.)${mpLabel}`;
                    } else if ((art.bultos_taller || 0) > 0) {
                        ubicacionTxt = `📦 Taller: Abrir bulto (${art.bultos_taller} cj en taller / ${(art.stock_total_materia_prima_kg || 0).toFixed(1)} kg tot.)${mpLabel}`;
                    } else if ((art.bultos_deposito || 0) > 0) {
                        ubicacionTxt = `🏢 Depósito: Pedir bulto (${art.bultos_deposito} bulto/s disp. / ${(art.stock_total_materia_prima_kg || 0).toFixed(1)} kg tot.)${mpLabel}`;
                    } else {
                        ubicacionTxt = `🔴 Faltante: Sin stock insumo (${art.materia_prima_nombre || ''})`;
                    }
                }

                // Stock meta
                let stockMeta = `${formatearUnidadesStock(art.stock_actual)} u.`;
                if (art.comprometido_presupuestos > 0) {
                    stockMeta += ` <span style="font-size: 0.68rem; color: #c2410c;">(📋 ${formatearBolsas(art.comprometido_presupuestos)}u ped.)</span>`;
                }
                if (art.es_padre && art.packs_armables > 0) {
                    stockMeta += ` <span style="font-size: 0.68rem; color: #7c3aed;">(📦 ${formatearBolsas(art.packs_armables)} arm.)</span>`;
                }

                const ldnTag = art.ldn === 3 ? '<span style="font-size: 0.65rem; color: #0284c7; font-weight: 700;">[MIX] </span>' : '';
                const packTag = art.es_padre ? '<span style="color: #7c3aed; font-size: 0.65rem; font-weight: 700;">[PACK] </span>' : '';

                return `
                    <tr>
                        <td style="text-align: center; width: 32px;"><span class="check-item-box"></span></td>
                        <td style="width: 105px;"><span class="urgencia-badge-print ${urgClass}">${urgLabel}</span></td>
                        <td style="font-family: monospace; font-weight: 600; width: 105px;">
                            ${ldnTag}${packTag}${art.articulo_id}
                        </td>
                        <td>
                            <strong>${art.descripcion}</strong>
                            <div style="font-size: 0.70rem; color: #475569;">${art.familia_nombre || ''} &bull; ${art.kilos_unidad} kg/bolsa</div>
                        </td>
                        <td style="text-align: right; width: 110px;">${stockMeta}</td>
                        <td style="text-align: right; width: 70px; font-weight: 600;">${cob}</td>
                        <td style="text-align: right; width: 140px; background-color: #f1f5f9;">
                            ${aEnvasarHtml}
                        </td>
                        <td style="font-size: 0.72rem;">${ubicacionTxt}</td>
                    </tr>
                `;
            }).join('');
        }

        // 1. Si es modo 'taller' (Integral), desplegar primero Carros de Mezcla a Granel (Fase 1)
        if (tipo === 'taller' || tipo === 'mixes') {
            let bloquesMixes = '';
            if (carrosConDemanda.length === 0) {
                bloquesMixes = `<div style="text-align: center; padding: 14px; color: #64748b; font-size: 0.8rem; border: 1px solid #cbd5e1; border-radius: 4px;">No hay carros de mix requeridos en este período.</div>`;
            } else {
                bloquesMixes = carrosConDemanda.map(carro => {
                    let factibleClass = '';
                    let factibleTxt = '';

                    if (carro.granel_suficiente) {
                        factibleClass = 'color: #15803d; font-weight: 700;';
                        factibleTxt = `🟢 GRANEL EN DEPÓSITO (${(carro.stock_granel_taller_kg || 0).toFixed(1)} kg) &bull; No requiere pesaje de componentes`;
                    } else if (carro.factibilidad?.factible) {
                        factibleClass = 'color: #15803d; font-weight: 700;';
                        factibleTxt = `🟢 LISTO PARA ARMAR (Insumos 100% disponibles)`;
                    } else {
                        factibleClass = 'color: #b91c1c; font-weight: 700;';
                        factibleTxt = `🔴 BLOQUEADO (Falta insumo: ${carro.factibilidad?.cuello_botella || ''})`;
                    }

                    // Filas de pesaje (Fase 1)
                    let fase1PrintHtml = '';
                    if (carro.granel_suficiente) {
                        fase1PrintHtml = `
                            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px; padding: 10px 12px; font-size: 0.78rem; color: #166534;">
                                <strong>✅ Granel listo en depósito:</strong> Hay <strong>${(carro.stock_granel_taller_kg || 0).toFixed(1)} kg</strong> disponibles en ingredientes. Cubre los <strong>${(carro.kilos_totales_solicitados || 0).toFixed(1)} kg</strong> necesarios. <u>No requiere pesar materias primas</u>. Pasar directo a Fase 2 (Envasado).
                            </div>
                        `;
                    } else {
                        const filasPesaje = (carro.receta_pesaje || []).map(comp => `
                            <tr>
                                <td style="text-align: center; width: 28px;"><span class="check-item-box"></span></td>
                                <td><strong>${comp.componente_nombre}</strong></td>
                                <td style="text-align: right; width: 70px;">${comp.proporcion_pct}%</td>
                                <td style="text-align: right; width: 105px; background-color: #f1f5f9; font-weight: 800; font-size: 0.82rem;">${comp.kilos_a_pesar.toFixed(2)} kg</td>
                                <td style="text-align: right; width: 95px;">${comp.stock_disponible_kg} kg disp.</td>
                                <td style="text-align: center; width: 70px; font-size: 0.72rem; ${comp.alcanza ? 'color: #15803d;' : 'color: #b91c1c; font-weight: 700;'}">
                                    ${comp.alcanza ? '✓ OK' : '⚠️ Faltante'}
                                </td>
                            </tr>
                        `).join('');

                        fase1PrintHtml = `
                            <table class="sheet-table">
                                <thead>
                                    <tr>
                                        <th style="width: 28px; text-align: center;">✓</th>
                                        <th>Materia Prima</th>
                                        <th style="text-align: right; width: 60px;">%</th>
                                        <th style="text-align: right; width: 100px;">A PESAR</th>
                                        <th style="text-align: right; width: 90px;">Stock</th>
                                        <th style="text-align: center; width: 65px;">Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${filasPesaje}
                                </tbody>
                            </table>
                        `;
                    }

                    // Filas de envasado (si es solo reporte de mixes)
                    let fase2MixPrintHtml = '';
                    if (tipo === 'mixes') {
                        const filasEnvasado = (carro.presentaciones || []).map(art => {
                            let aEnvasarHtml = '';
                            let kgStr = '-';

                            if (art.es_padre) {
                                if (art.packs_a_armar && art.packs_a_armar > 0) {
                                    aEnvasarHtml = `<strong>📦 Armar ${formatearBolsas(art.packs_a_armar)} packs</strong><div style="font-size: 0.68rem; color: #7c3aed;">p/ pedidos (${art.pack_hijo_codigo || 'hijo'})</div>`;
                                } else if (art.packs_armables > 0) {
                                    aEnvasarHtml = `<strong style="color: #15803d; font-size: 0.76rem;">✓ ${formatearBolsas(art.packs_armables)} packs disponibles</strong><div style="font-size: 0.68rem; color: #64748b;">(${art.pack_hijo_codigo || 'hijo'})</div>`;
                                } else {
                                    aEnvasarHtml = `<span style="color: #64748b; font-size: 0.72rem;">✓ Sin pedidos</span>`;
                                }
                            } else if (art.cantidad_sugerida > 0) {
                                aEnvasarHtml = `+${formatearBolsas(art.cantidad_sugerida)} bolsas`;
                                kgStr = `${(art.kilos_sugeridos || 0).toFixed(1)} kg`;
                            } else {
                                aEnvasarHtml = `<span style="color: #64748b; font-size: 0.72rem;">✓ Suficiente</span>`;
                            }

                            let stockMeta = `${formatearUnidadesStock(art.stock_actual)} u.`;
                            if (art.comprometido_presupuestos > 0) {
                                stockMeta += ` <span style="font-size: 0.68rem; color: #c2410c;">(📋 ${formatearBolsas(art.comprometido_presupuestos)}u)</span>`;
                            }

                            return `
                                <tr>
                                    <td style="text-align: center; width: 28px;"><span class="check-item-box"></span></td>
                                    <td style="font-family: monospace; font-weight: 600; width: 95px;">
                                        ${art.es_padre ? '<span style="color: #7c3aed; font-size: 0.65rem;">[PACK] </span>' : ''}${art.articulo_id}
                                    </td>
                                    <td><strong>${art.descripcion}</strong> (${art.kilos_unidad} kg/u)</td>
                                    <td style="text-align: right; width: 95px;">${stockMeta}</td>
                                    <td style="text-align: right; width: 60px;">${art.dias_cobertura === 999 ? '∞' : art.dias_cobertura.toFixed(1) + 'd'}</td>
                                    <td style="text-align: right; width: 130px; background-color: #f8fafc; font-weight: 800;">${aEnvasarHtml}</td>
                                    <td style="text-align: right; width: 70px; font-weight: 700;">${kgStr}</td>
                                </tr>
                            `;
                        }).join('');

                        fase2MixPrintHtml = `
                            <div>
                                <div style="font-size: 0.72rem; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;">
                                    📦 Fase 2: Envasado de Presentaciones
                                </div>
                                <table class="sheet-table">
                                    <thead>
                                        <tr>
                                            <th style="width: 28px; text-align: center;">✓</th>
                                            <th style="width: 95px;">SKU</th>
                                            <th>Presentación</th>
                                            <th style="text-align: right; width: 95px;">Stock</th>
                                            <th style="text-align: right; width: 60px;">Cob.</th>
                                            <th style="text-align: right; width: 130px;">A ENVASAR / ACCIÓN</th>
                                            <th style="text-align: right; width: 70px;">Kilos</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${filasEnvasado}
                                    </tbody>
                                </table>
                            </div>
                        `;
                    }

                    let loteHeaderTxt = '';
                    if (carro.granel_suficiente) {
                        loteHeaderTxt = `Granel a envasar: <span style="color: #16a34a;">${(carro.kilos_totales_solicitados || 0).toFixed(1)} kg</span> (Disp: ${(carro.stock_granel_taller_kg || 0).toFixed(1)}k)`;
                    } else {
                        loteHeaderTxt = `Lote Carro: <span style="color: #0284c7;">${(carro.kilos_carro_sugeridos || 0).toFixed(1)} kg</span> (${carro.tandas_carro} tanda(s) de ${carro.tanda_kg || tandaMixKg} kg)`;
                    }

                    const gridStyle = tipo === 'mixes' ? 'display: grid; grid-template-columns: 1fr 1.15fr; gap: 14px;' : '';

                    return `
                        <div style="border: 1px solid #94a3b8; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; background-color: #fff; page-break-inside: avoid;">
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 10px;">
                                <div>
                                    <span style="font-family: monospace; background: #e2e8f0; padding: 2px 6px; border-radius: 3px; font-weight: 700;">${carro.ap_sku}</span>
                                    <strong style="font-size: 0.95rem; margin-left: 6px;">${carro.mix_nombre}</strong>
                                    <span style="margin-left: 10px; font-size: 0.74rem; ${factibleClass}">${factibleTxt}</span>
                                </div>
                                <div style="font-size: 0.88rem; font-weight: 800;">
                                    ${loteHeaderTxt}
                                </div>
                            </div>

                            <div style="${gridStyle}">
                                <div>
                                    <div style="font-size: 0.72rem; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;">
                                        ⚖️ Fase 1: Pesaje de Materias Primas
                                    </div>
                                    ${fase1PrintHtml}
                                </div>
                                ${fase2MixPrintHtml}
                            </div>
                        </div>
                    `;
                }).join('');
            }

            container.innerHTML += `
                <div style="margin-bottom: 24px;">
                    <div style="font-size: 0.88rem; font-weight: 800; color: #0f172a; text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                        <span>🥣 1. FASE 1: CARROS DE MEZCLA A GRANEL (LDN 3 - PREPARACIÓN)</span>
                    </div>
                    ${bloquesMixes}
                </div>
            `;
        }

        // 2. Sección de Envasado Imprimible
        if (tipo === 'fraccionado') {
            const purosSinPadre = agruparYOrdenarPorIngrediente(purosConSugerencia.filter(a => !a.es_padre));
            const purosPacks = purosConSugerencia.filter(a => a.es_padre).sort(ordenarPorUrgenciaYCantidad);

            container.innerHTML += `
                <div style="margin-bottom: 24px;">
                    <div style="font-size: 0.88rem; font-weight: 800; color: #0f172a; text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; border-bottom: 2px solid #10b981; padding-bottom: 4px;">
                        <span>🌾 1. FRACCIONAMIENTO DE MONO-INGREDIENTES 100% PUROS (LDN 2)</span>
                    </div>
                    <table class="sheet-table">
                        <thead>
                            <tr>
                                <th style="width: 32px; text-align: center;">✓</th>
                                <th style="width: 105px;">Prioridad</th>
                                <th style="width: 100px;">Código SKU</th>
                                <th>Artículo / Presentación</th>
                                <th style="text-align: right; width: 110px;">Stock</th>
                                <th style="text-align: right; width: 70px;">Cobertura</th>
                                <th style="text-align: right; width: 140px; background-color: #e2e8f0; color: #000;">A ENVASAR / ACCIÓN</th>
                                <th>Insumo / Ubicación Materia Prima</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${generarFilasEnvasadoPrint(purosSinPadre)}
                        </tbody>
                    </table>
                </div>
            `;

            if (purosPacks.length > 0) {
                container.innerHTML += `
                    <div style="margin-bottom: 24px; page-break-inside: avoid;">
                        <div style="font-size: 0.88rem; font-weight: 800; color: #0f172a; text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; border-bottom: 2px solid #a855f7; padding-bottom: 4px;">
                            <span>📦 2. PACKS PARA ARMAR EN DEPÓSITO (ARTÍCULOS PADRE)</span>
                        </div>
                        <table class="sheet-table">
                            <thead>
                                <tr>
                                    <th style="width: 32px; text-align: center;">✓</th>
                                    <th style="width: 105px;">Prioridad</th>
                                    <th style="width: 100px;">Código SKU</th>
                                    <th>Artículo / Presentación</th>
                                    <th style="text-align: right; width: 110px;">Stock</th>
                                    <th style="text-align: right; width: 70px;">Cobertura</th>
                                    <th style="text-align: right; width: 140px; background-color: #e2e8f0; color: #000;">A ARMAR / ACCIÓN</th>
                                    <th>Insumo / Ubicación Materia Prima</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${generarFilasEnvasadoPrint(purosPacks)}
                            </tbody>
                        </table>
                    </div>
                `;
            }
        } else if (tipo === 'taller') {
            // MODO TALLER INTEGRAL: 3 Tablas claramente agrupadas (LDN 2 Puros agrupados por ingrediente, LDN 3 Mixes, Packs al final)
            // Cada sección ordenada por Urgencia y Cantidad descendente
            const purosPrint = agruparYOrdenarPorIngrediente(itemsTallerConAccion.filter(a => a.ldn === 2 && !a.es_padre));
            const mixesPrint = itemsTallerConAccion.filter(a => a.ldn === 3 && !a.es_padre).sort(ordenarPorUrgenciaYCantidad);
            const packsPrint = itemsTallerConAccion.filter(a => a.es_padre).sort(ordenarPorUrgenciaYCantidad);

            const kgPurosTot = purosPrint.reduce((sum, a) => sum + (a.kilos_sugeridos || 0), 0);
            const kgMixesTot = mixesPrint.reduce((sum, a) => sum + (a.kilos_sugeridos || 0), 0);
            const totPacksArm = packsPrint.reduce((sum, a) => sum + (a.packs_armables || 0), 0);

            container.innerHTML += `
                <!-- 2.1 FRACCIONADOS PUROS LDN 2 -->
                <div style="margin-bottom: 22px; page-break-inside: avoid;">
                    <div style="font-size: 0.86rem; font-weight: 800; color: #0f172a; text-transform: uppercase; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #10b981; padding-bottom: 4px;">
                        <span>🌾 2.1. LÍNEA DE NEGOCIO 2: FRACCIONAMIENTO MONO-INGREDIENTES (${purosPrint.length} ÍTEMS)</span>
                        <span style="font-size: 0.78rem; font-weight: 700; color: #15803d;">A Envasar: ${kgPurosTot.toFixed(1)} kg</span>
                    </div>
                    <table class="sheet-table">
                        <thead>
                            <tr>
                                <th style="width: 32px; text-align: center;">✓</th>
                                <th style="width: 105px;">Prioridad</th>
                                <th style="width: 105px;">Código SKU</th>
                                <th>Artículo / Presentación</th>
                                <th style="text-align: right; width: 110px;">Stock</th>
                                <th style="text-align: right; width: 70px;">Cobertura</th>
                                <th style="text-align: right; width: 140px; background-color: #e2e8f0; color: #000;">A ENVASAR / ACCIÓN</th>
                                <th>Insumo / Ubicación Materia Prima</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${generarFilasEnvasadoPrint(purosPrint)}
                        </tbody>
                    </table>
                </div>

                <!-- 2.2 MIXES COMERCIALES LDN 3 -->
                <div style="margin-bottom: 22px; page-break-inside: avoid;">
                    <div style="font-size: 0.86rem; font-weight: 800; color: #0f172a; text-transform: uppercase; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #06b6d4; padding-bottom: 4px;">
                        <span>🥣 2.2. LÍNEA DE NEGOCIO 3: MIXES COMERCIALES (${mixesPrint.length} ÍTEMS)</span>
                        <span style="font-size: 0.78rem; font-weight: 700; color: #0284c7;">A Envasar: ${kgMixesTot.toFixed(1)} kg</span>
                    </div>
                    <table class="sheet-table">
                        <thead>
                            <tr>
                                <th style="width: 32px; text-align: center;">✓</th>
                                <th style="width: 105px;">Prioridad</th>
                                <th style="width: 105px;">Código SKU</th>
                                <th>Artículo / Presentación</th>
                                <th style="text-align: right; width: 110px;">Stock</th>
                                <th style="text-align: right; width: 70px;">Cobertura</th>
                                <th style="text-align: right; width: 140px; background-color: #e2e8f0; color: #000;">A ENVASAR / ACCIÓN</th>
                                <th>Insumo / Ubicación Materia Prima</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${generarFilasEnvasadoPrint(mixesPrint)}
                        </tbody>
                    </table>
                </div>

                <!-- 2.3 PACKS ARMABLES EN DEPÓSITO (ARTÍCULOS PADRE AL FINAL) -->
                <div style="margin-bottom: 16px; page-break-inside: avoid;">
                    <div style="font-size: 0.86rem; font-weight: 800; color: #0f172a; text-transform: uppercase; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #a855f7; padding-bottom: 4px;">
                        <span>📦 2.3. ARMAR EN DEPÓSITO: PACKS (${packsPrint.length} PACKS AL FINAL)</span>
                        <span style="font-size: 0.78rem; font-weight: 700; color: #7c3aed;">Armables: ${totPacksArm} packs</span>
                    </div>
                    <table class="sheet-table">
                        <thead>
                            <tr>
                                <th style="width: 32px; text-align: center;">✓</th>
                                <th style="width: 105px;">Prioridad</th>
                                <th style="width: 105px;">Código SKU</th>
                                <th>Artículo / Presentación</th>
                                <th style="text-align: right; width: 110px;">Stock</th>
                                <th style="text-align: right; width: 70px;">Cobertura</th>
                                <th style="text-align: right; width: 140px; background-color: #e2e8f0; color: #000;">A ARMAR / ACCIÓN</th>
                                <th>Insumo / Ubicación Materia Prima</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${generarFilasEnvasadoPrint(packsPrint)}
                        </tbody>
                    </table>
                </div>
            `;
        }

        modal.style.display = 'flex';
    };

    window.cerrarModalVisorTaller = function () {
        const modal = document.getElementById('modal-visor-taller');
        if (modal) modal.style.display = 'none';
    };

    window.ejecutarImpresionTaller = function () {
        const modal = document.getElementById('modal-visor-taller');
        if (modal) modal.classList.add('is-printing');
        window.print();
        setTimeout(() => {
            if (modal) modal.classList.remove('is-printing');
        }, 1000);
    };

    window.copiarFraccionadoWhatsApp = function () {
        if (!dataMaster || !dataMaster.lineas_de_negocio) return;
        const puros = (dataMaster.lineas_de_negocio.ldn2_fraccionados || []).filter(a => (a.cantidad_sugerida > 0) || (a.es_padre && a.packs_armables > 0));
        const now = new Date();
        const fechaStr = now.toLocaleDateString('es-AR');

        let txt = `🌾 *DIRECTIVA DE TALLER: FRACCIONAMIENTO MONO-INGREDIENTES (LDN 2)*\n`;
        txt += `📅 *Fecha:* ${fechaStr} | 🎯 *Objetivo:* Cobertura prioritaria\n`;
        txt += `🔢 *Total Ítems:* ${puros.length} presentaciones a producir/armar\n`;
        txt += `----------------------------------------------------\n\n`;

        // 1. Quiebres inmediatos
        const quiebres = puros.filter(a => !a.es_padre && (a.stock_neto_disponible !== undefined ? a.stock_neto_disponible <= 0 : a.stock_actual <= 0));
        if (quiebres.length > 0) {
            txt += `🚨 *QUIEBRE INMEDIATO (Stock Neto ≤ 0 / Pedidos en espera):*\n`;
            quiebres.forEach(art => {
                let ubi = (art.stock_taller_kg || 0) >= art.kilos_sugeridos 
                    ? `🟢 Bolsa abierta taller (${(art.stock_taller_kg || 0).toFixed(1)}k)` 
                    : ((art.bultos_taller || 0) > 0 
                        ? `📦 Abrir bulto taller (${art.bultos_taller} cj)`
                        : ((art.bultos_deposito || 0) > 0 ? `🏢 Pedir bulto depósito (${art.bultos_deposito} bulto/s)` : `🔴 Sin insumo`));
                let pedStr = art.comprometido_presupuestos > 0 ? ` [📋 ${art.comprometido_presupuestos}u pedidos / Neto: ${art.stock_neto_disponible}u]` : '';
                txt += `• *[${art.articulo_id}]* ${art.descripcion}:\n`;
                txt += `   👉 *Envasar ${art.cantidad_sugerida} bolsas* (${art.kilos_sugeridos.toFixed(1)} kg)${pedStr} &bull; ${ubi}\n`;
            });
            txt += `\n`;
        }

        // 2. Packs armables en depósito
        const packs = puros.filter(a => a.es_padre && a.packs_armables > 0);
        if (packs.length > 0) {
            txt += `📦 *PACKS ARMABLES EN DEPÓSITO (Con stock de unidades hijas):*\n`;
            packs.forEach(art => {
                let pedStr = art.comprometido_presupuestos > 0 ? ` [📋 ${art.comprometido_presupuestos}u pedidos / Neto: ${art.stock_neto_disponible}u]` : '';
                txt += `• *[${art.articulo_id}]* ${art.descripcion}:\n`;
                txt += `   👉 *Armar ${art.packs_armables} packs* en depósito con SKU hijo [${art.pack_hijo_codigo}]${pedStr}\n`;
            });
            txt += `\n`;
        }

        // 3. Críticos y Atención
        const otros = puros.filter(a => !a.es_padre && (a.stock_neto_disponible === undefined || a.stock_neto_disponible > 0));
        if (otros.length > 0) {
            txt += `📋 *REPOSICIÓN POR DEMANDA (Cobertura programada):*\n`;
            otros.forEach(art => {
                let ubi = (art.stock_taller_kg || 0) >= art.kilos_sugeridos 
                    ? `🟢 Bolsa abierta taller (${(art.stock_taller_kg || 0).toFixed(1)}k)` 
                    : ((art.bultos_taller || 0) > 0 
                        ? `📦 Abrir bulto taller (${art.bultos_taller} cj)`
                        : ((art.bultos_deposito || 0) > 0 ? `🏢 Pedir bulto depósito (${art.bultos_deposito} bulto/s)` : `🔴 Sin insumo`));
                let cobStr = art.dias_cobertura === 999 ? '∞' : `${art.dias_cobertura.toFixed(1)}d`;
                txt += `• *[${art.articulo_id}]* ${art.descripcion}: *Envasar ${art.cantidad_sugerida} bolsas* (${art.kilos_sugeridos.toFixed(1)} kg) [Cob: ${cobStr}] &bull; ${ubi}\n`;
            });
            txt += `\n`;
        }

        txt += `----------------------------------------------------\n`;
        txt += `_Sistema LAMDA &bull; Producción Interna_`;

        copiarAlPortapapeles(txt, 'Directiva de Fraccionamiento Puro');
    };

    window.copiarCarrosWhatsApp = function () {
        if (!dataMaster || !dataMaster.carros_mixes_detallados) return;
        const carros = (dataMaster.carros_mixes_detallados || []).filter(c => (c.kilos_carro_sugeridos || 0) > 0 || (c.granel_suficiente && c.presentaciones && c.presentaciones.some(p => (p.cantidad_sugerida > 0) || (p.es_padre && p.packs_armables > 0))));
        const now = new Date();
        const fechaStr = now.toLocaleDateString('es-AR');

        let txt = `🧪 *DIRECTIVA DE TALLER: CARROS DE MIX Y MEZCLAS (LDN 3)*\n`;
        txt += `📅 *Fecha:* ${fechaStr}\n`;
        txt += `🔢 *Total Mixes:* ${carros.length} requeridos\n`;
        txt += `----------------------------------------------------\n\n`;

        carros.forEach(carro => {
            if (carro.granel_suficiente) {
                txt += `🥣 *MIX [${carro.ap_sku}] ${carro.mix_nombre}*\n`;
                txt += `  ✅ *GRANEL LISTO EN DEPÓSITO:* ${(carro.stock_granel_taller_kg || 0).toFixed(1)} kg disponibles (No requiere pesaje)\n`;
                txt += `  *Fase 2 - Envasar Bolsas:*\n`;
                (carro.presentaciones || []).forEach(p => {
                    if (p.es_padre && p.packs_armables > 0) {
                        txt += `    - 📦 [${p.articulo_id}] ${p.descripcion}: *Armar ${p.packs_armables} packs* con hijo [${p.pack_hijo_codigo}]\n`;
                    } else if (p.cantidad_sugerida > 0) {
                        let pedStr = p.comprometido_presupuestos > 0 ? ` [📋 ${p.comprometido_presupuestos}u pedidos]` : '';
                        txt += `    - [${p.articulo_id}] ${p.descripcion}: *${p.cantidad_sugerida} bolsas* (${p.kilos_sugeridos.toFixed(1)} kg)${pedStr}\n`;
                    }
                });
                txt += `\n`;
            } else {
                const estado = carro.factibilidad?.factible ? `🟢 LISTO PARA ARMAR` : `🔴 BLOQUEADO (${carro.factibilidad?.cuello_botella || 'insumo'})`;
                txt += `🥣 *CARRO [${carro.ap_sku}] ${carro.mix_nombre} - ${(carro.kilos_carro_sugeridos || 0).toFixed(1)} kg* (${carro.tandas_carro} tanda(s) de ${carro.tanda_kg || tandaMixKg} kg) [${estado}]\n`;
                txt += `  *Fase 1 - Pesar Insumos:*\n`;
                (carro.receta_pesaje || []).forEach(r => {
                    txt += `    - ${r.componente_nombre}: *${r.kilos_a_pesar.toFixed(2)} kg* (${r.proporcion_pct}%)\n`;
                });
                txt += `  *Fase 2 - Envasar Bolsas:*\n`;
                (carro.presentaciones || []).forEach(p => {
                    if (p.es_padre && p.packs_armables > 0) {
                        txt += `    - 📦 [${p.articulo_id}] ${p.descripcion}: *Armar ${p.packs_armables} packs* con hijo [${p.pack_hijo_codigo}]\n`;
                    } else if (p.cantidad_sugerida > 0) {
                        let pedStr = p.comprometido_presupuestos > 0 ? ` [📋 ${p.comprometido_presupuestos}u pedidos]` : '';
                        txt += `    - [${p.articulo_id}] ${p.descripcion}: *${p.cantidad_sugerida} bolsas* (${p.kilos_sugeridos.toFixed(1)} kg)${pedStr}\n`;
                    }
                });
                txt += `\n`;
            }
        });

        txt += `----------------------------------------------------\n`;
        txt += `_Sistema LAMDA &bull; Producción Interna_`;

        copiarAlPortapapeles(txt, 'Directiva de Carros Mix');
    };

    window.copiarReporteTallerWhatsApp = function () {
        if (tipoDirectivaTallerActiva === 'fraccionado') {
            window.copiarFraccionadoWhatsApp();
        } else if (tipoDirectivaTallerActiva === 'mixes') {
            window.copiarCarrosWhatsApp();
            // MODO INTEGRAL: Fase 1 Carros Granel + Fase 2 Mesa de Envasado por orden de apuro
            if (!dataMaster) return;
            const now = new Date();
            const fechaStr = now.toLocaleDateString('es-AR');
            let txt = `🏭 *DIRECTIVA INTEGRAL DE PRODUCCIÓN Y TALLER — LAMDA*\n`;
            txt += `📅 *Fecha:* ${fechaStr} | 🎯 *Objetivo:* ${diasObjetivoCobertura} días cubiertos\n\n`;
            
            // FASE 1: Carros de Mezcla
            const carros = (dataMaster.carros_mixes_detallados || []).filter(c => (c.kilos_carro_sugeridos || 0) > 0 || (c.granel_suficiente && c.presentaciones && c.presentaciones.some(p => (p.cantidad_sugerida > 0) || (p.es_padre && p.packs_armables > 0))));
            const carrosAMezclar = carros.filter(c => !c.granel_suficiente && (c.kilos_carro_sugeridos || 0) > 0);
            
            txt += `🥣 *1. FASE 1: CARROS DE MEZCLA A GRANEL (${carrosAMezclar.length} carros)*\n`;
            if (carrosAMezclar.length === 0) {
                txt += `  ✓ No hay carros de mezcla pendientes. Granel suficiente en depósito.\n`;
            } else {
                carrosAMezclar.forEach(carro => {
                    const estado = carro.factibilidad?.factible ? `🟢 LISTO PARA ARMAR` : `🔴 BLOQUEADO: ${carro.factibilidad?.cuello_botella || 'insumo'}`;
                    txt += `• *[${carro.ap_sku}] ${carro.mix_nombre} - ${(carro.kilos_carro_sugeridos || 0).toFixed(1)} kg* (${carro.tandas_carro} tanda(s) de ${carro.tanda_kg || tandaMixKg} kg) [${estado}]\n`;
                    (carro.receta_pesaje || []).forEach(r => {
                        txt += `   - Pesar ${r.componente_nombre}: *${r.kilos_a_pesar.toFixed(2)} kg* (${r.proporcion_pct}%)\n`;
                    });
                });
            }

            // FASE 2: Mesa de Envasado (Consolidación Taller por Grupos y Urgencia)
            const itemsTaller = (dataMaster.produccion_interna_taller || []).filter(a => (a.cantidad_sugerida > 0) || (a.es_padre && a.packs_armables > 0));
            const purosWs = agruparYOrdenarPorIngrediente(itemsTaller.filter(a => a.ldn === 2 && !a.es_padre));
            const mixesWs = itemsTaller.filter(a => a.ldn === 3 && !a.es_padre).sort(ordenarPorUrgenciaYCantidad);
            const packsWs = itemsTaller.filter(a => a.es_padre).sort(ordenarPorUrgenciaYCantidad);

            const kgPurosWs = purosWs.reduce((sum, a) => sum + (a.kilos_sugeridos || 0), 0);
            const kgMixesWs = mixesWs.reduce((sum, a) => sum + (a.kilos_sugeridos || 0), 0);
            const totPacksWs = packsWs.reduce((sum, a) => sum + (a.packs_armables || 0), 0);

            txt += `\n📋 *2. FASE 2: MESA DE ENVASADO Y FRACCIONAMIENTO (${itemsTaller.length} ítems)*\n`;

            // 2.1 Puros
            if (purosWs.length > 0) {
                txt += `\n🌾 *2.1. FRACCIONADOS PUROS (LDN 2 - ${purosWs.length} ítems / ${kgPurosWs.toFixed(1)} kg):*\n`;
                purosWs.forEach(art => {
                    let pedStr = art.comprometido_presupuestos > 0 ? ` [📋 ${art.comprometido_presupuestos}u pedidos / Neto: ${art.stock_neto_disponible}u]` : '';
                    let ubi = (art.stock_taller_kg || 0) >= art.kilos_sugeridos 
                        ? `🟢 Bolsa abierta taller` 
                        : ((art.bultos_taller || 0) > 0 
                            ? `📦 Abrir bulto taller (${art.bultos_taller} cj)` 
                            : ((art.bultos_deposito || 0) > 0 ? `🏢 Pedir bulto depósito (${art.bultos_deposito} bulto/s)` : `🔴 Sin insumo`));
                    let urgTag = (art.stock_neto_disponible !== undefined ? art.stock_neto_disponible <= 0 : art.stock_actual <= 0) ? '🔴 *QUIEBRE* ' : '';
                    txt += `• ${urgTag}*[${art.articulo_id}]* ${art.descripcion}:\n`;
                    txt += `   👉 *Envasar ${art.cantidad_sugerida} bolsas* (${(art.kilos_sugeridos || 0).toFixed(1)} kg)${pedStr} &bull; ${ubi}\n`;
                });
            }

            // 2.2 Mixes
            if (mixesWs.length > 0) {
                txt += `\n🥣 *2.2. MIXES PRESENTACIONES (LDN 3 - ${mixesWs.length} ítems / ${kgMixesWs.toFixed(1)} kg):*\n`;
                mixesWs.forEach(art => {
                    let pedStr = art.comprometido_presupuestos > 0 ? ` [📋 ${art.comprometido_presupuestos}u pedidos / Neto: ${art.stock_neto_disponible}u]` : '';
                    let ubi = art.mix_granel_suficiente ? `🟢 Granel listo en taller` : `🥣 Requiere Carro (Fase 1)`;
                    let urgTag = (art.stock_neto_disponible !== undefined ? art.stock_neto_disponible <= 0 : art.stock_actual <= 0) ? '🔴 *QUIEBRE* ' : '';
                    txt += `• ${urgTag}*[${art.articulo_id}]* ${art.descripcion}:\n`;
                    txt += `   👉 *Envasar ${art.cantidad_sugerida} bolsas* (${(art.kilos_sugeridos || 0).toFixed(1)} kg)${pedStr} &bull; ${ubi}\n`;
                });
            }

            // 2.3 Packs al final
            if (packsWs.length > 0) {
                txt += `\n📦 *2.3. ARMAR EN DEPÓSITO: PACKS (${packsWs.length} packs / ${totPacksWs} armables):*\n`;
                packsWs.forEach(art => {
                    let pedStr = art.comprometido_presupuestos > 0 ? ` [📋 ${art.comprometido_presupuestos}u pedidos]` : '';
                    let urgTag = (art.stock_neto_disponible !== undefined ? art.stock_neto_disponible <= 0 : art.stock_actual <= 0) ? '🔴 *QUIEBRE* ' : '';
                    txt += `• ${urgTag}*[${art.articulo_id}]* ${art.descripcion}: 👉 *Armar ${art.packs_armables} packs* con SKU hijo [${art.pack_hijo_codigo}]${pedStr}\n`;
                });
            }

            txt += `\n----------------------------------------------------\n`;
            txt += `_Sistema LAMDA &bull; Inteligencia Determinista de Producción_`;

            copiarAlPortapapeles(txt, 'Directiva Completa de Taller');
        }
    };

    // =========================================================================
    // VISOR DE DESPACHO Y PRODUCCIÓN EXTERNA (A4 IMPRIMIBLE + WHATSAPP)
    // =========================================================================
    window.abrirVisorExterna = function () {
        const modal = document.getElementById('modal-visor-externa');
        if (!modal || !dataMaster) return;

        const now = new Date();
        const fechaStr = now.toLocaleDateString('es-AR') + ' ' + now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const elFecha = document.getElementById('sheet-externa-meta-fecha');
        if (elFecha) elFecha.innerText = fechaStr;
        const elMetaObj = document.getElementById('sheet-externa-meta-objetivo');
        if (elMetaObj) elMetaObj.innerText = `${diasObjetivoCobertura} días de cobertura`;

        const extData = dataMaster.produccion_externa_ups || {};
        const resumen = extData.resumen || {};
        const tostaderos = extData.tostaderos || (dataMaster.lineas_de_negocio?.ldn4_tostaderos || []);
        const barritas = extData.barritas || (dataMaster.lineas_de_negocio?.ldn5_barritas || []);
        const granolas = extData.granolas || (dataMaster.lineas_de_negocio?.ldn6_granolas || []);

        // Agrupar tostaderos por tipo de producción
        const gruposTostPrint = {};
        tostaderos.forEach(art => {
            const g = obtenerGrupoTostadero(art);
            if (!gruposTostPrint[g.id]) {
                gruposTostPrint[g.id] = { meta: g, items: [] };
            }
            gruposTostPrint[g.id].items.push(art);
        });
        const gruposPrintArray = Object.values(gruposTostPrint).sort((a, b) => a.meta.orden - b.meta.orden);
        const gruposConDespachoPrint = gruposPrintArray.filter(g => {
            const kgTot = g.items.reduce((sum, a) => sum + parseFloat(a.kilos_tostados_sugeridos || a.kilos_sugeridos || 0), 0);
            const bultosTot = g.items.reduce((sum, a) => sum + parseInt(a.bultos_crudos_despachar || 0), 0);
            const kgCrudosTot = g.items.reduce((sum, a) => sum + parseFloat(a.kilos_crudos_requeridos || 0), 0);
            return kgTot > 0 || bultosTot > 0 || kgCrudosTot > 0;
        });

        const barritasConProd = barritas.filter(b => b.cantidad_sugerida > 0);
        const granolasConProd = granolas.filter(g => g.cantidad_sugerida > 0);

        const kgCrudosTot = tostaderos.reduce((sum, t) => sum + (t.kilos_crudos_requeridos || 0), 0);
        const bultosCrudosTot = tostaderos.reduce((sum, t) => sum + (t.bultos_crudos_despachar || 0), 0);
        const kgTermTot = resumen.kilos_terminados_sugeridos || [...tostaderos, ...barritas, ...granolas].reduce((sum, a) => sum + (a.kilos_sugeridos || a.kilos_tostados_sugeridos || 0), 0);

        // Resumen KPIs
        const kpisSummary = document.getElementById('sheet-externa-kpis-summary');
        if (kpisSummary) {
            kpisSummary.innerHTML = `
                <div class="sheet-kpi-box">
                    <span class="kpi-box-lbl">🚚 Bultos Crudos a Despachar</span>
                    <span class="kpi-box-val">${bultosCrudosTot} bultos (${kgCrudosTot.toFixed(1)} kg)</span>
                </div>
                <div class="sheet-kpi-box">
                    <span class="kpi-box-lbl">🥜 Tostaderos a Ejecutar</span>
                    <span class="kpi-box-val">${gruposConDespachoPrint.length} producciones</span>
                </div>
                <div class="sheet-kpi-box">
                    <span class="kpi-box-lbl">🍫 Barritas & Granolas</span>
                    <span class="kpi-box-val">${barritasConProd.length + granolasConProd.length} productos</span>
                </div>
                <div class="sheet-kpi-box box-alerta">
                    <span class="kpi-box-lbl">⚖️ Kilos Terminados a Retornar</span>
                    <span class="kpi-box-val">${kgTermTot.toFixed(1)} kg</span>
                </div>
            `;
        }

        // Tablas del reporte imprimible
        const container = document.getElementById('sheet-externa-contenido-print');
        if (container) {
            let htmlTost = '';
            if (gruposConDespachoPrint.length === 0) {
                htmlTost = `<div style="text-align: center; padding: 14px; color: #64748b; font-size: 0.8rem; border: 1px solid #cbd5e1; border-radius: 4px;">No hay despachos pendientes a tostaderos para este período.</div>`;
            } else {
                const filasTost = gruposConDespachoPrint.map(g => {
                    const kgTostTot = g.items.reduce((sum, a) => sum + parseFloat(a.kilos_tostados_sugeridos || a.kilos_sugeridos || 0), 0);
                    let kgCrudosTot = g.items.reduce((sum, a) => sum + parseFloat(a.kilos_crudos_requeridos || 0), 0);
                    if (kgCrudosTot === 0 && kgTostTot > 0) {
                        kgCrudosTot = kgTostTot / (1 - (g.meta.mermaPct / 100));
                    }
                    let bultosTot = g.items.reduce((sum, a) => sum + parseInt(a.bultos_crudos_despachar || 0), 0);
                    if (bultosTot === 0 && kgCrudosTot > 0) {
                        const bultoKgRef = (g.meta.materiaPrimaCodigo && g.meta.materiaPrimaCodigo.includes('10')) ? 10 : 22.68;
                        bultosTot = Math.ceil(kgCrudosTot / bultoKgRef);
                    }
                    
                    const stockCrudo = g.items.find(a => parseFloat(a.stock_crudo_disponible_kg || 0) > 0)?.stock_crudo_disponible_kg || g.items[0]?.stock_crudo_disponible_kg || 0;
                    const factible = stockCrudo >= kgCrudosTot;

                    const tieneQuiebre = g.items.some(a => a.estado_alarma === 'CRITICO_SIN_STOCK' || a.stock_actual <= 0);
                    const tieneCritico = g.items.some(a => a.estado_alarma === 'CRITICO');

                    let urgLabel = 'Planificado';
                    let urgClass = 'urg-planificado';
                    if (tieneQuiebre) {
                        urgLabel = '🔴 QUIEBRE';
                        urgClass = 'urg-quiebre';
                    } else if (tieneCritico) {
                        urgLabel = '🟠 CRÍTICO (≤5d)';
                        urgClass = 'urg-critico';
                    }

                    const estadoDepo = factible 
                        ? `<span style="color: #15803d; font-weight: 700;">🟢 Stock crudo OK (${stockCrudo.toFixed(1)}k)</span>` 
                        : `<span style="color: #b91c1c; font-weight: 700;">🔴 Falta crudo (${stockCrudo.toFixed(1)}k disp.)</span>`;

                    const fraccionesDesglose = g.items
                        .filter(a => (a.cantidad_sugerida > 0 || (a.kilos_tostados_sugeridos || 0) > 0))
                        .map(a => a.articulo_id.includes('UP') 
                            ? `Granel p/ mix: +${(a.kilos_tostados_sugeridos || a.kilos_sugeridos || 0).toFixed(1)}kg (${a.bultos_crudos_despachar || 1} bulto crudo)`
                            : `${a.kilos_unidad}kg: +${formatearBolsas(a.cantidad_sugerida)}u (${(a.kilos_tostados_sugeridos || a.kilos_sugeridos || 0).toFixed(1)}kg)`
                        )
                        .join(' &bull; ');

                    return `
                        <tr>
                            <td style="text-align: center; width: 32px;"><span class="check-item-box"></span></td>
                            <td style="width: 105px;"><span class="urgencia-badge-print ${urgClass}">${urgLabel}</span></td>
                            <td style="font-family: monospace; font-weight: 600; width: 100px;">${g.meta.materiaPrimaCodigo}</td>
                            <td style="text-align: right; width: 140px; background-color: #f1f5f9; font-weight: 800;">
                                <strong>${bultosTot} bulto(s)</strong> (${kgCrudosTot.toFixed(1)} kg)
                            </td>
                            <td>
                                <strong style="color: #0f172a; font-size: 0.82rem;">${g.meta.icono} ${g.meta.titulo}</strong>
                                <div style="font-size: 0.70rem; color: #475569; margin-top: 2px;">
                                    Materia prima: ${g.meta.materiaPrimaNombre}
                                </div>
                                ${fraccionesDesglose ? `<div style="font-size: 0.69rem; color: #0369a1; margin-top: 2px;">Fracciones: ${fraccionesDesglose}</div>` : ''}
                            </td>
                            <td style="text-align: right; width: 65px;">${g.meta.mermaPct}%</td>
                            <td style="text-align: right; width: 110px; font-weight: 800; color: #0284c7;">+${kgTostTot.toFixed(1)} kg</td>
                            <td style="font-size: 0.72rem;">${estadoDepo}</td>
                        </tr>
                    `;
                }).join('');

                htmlTost = `
                    <table class="sheet-table">
                        <thead>
                            <tr>
                                <th style="width: 32px; text-align: center;">✓</th>
                                <th style="width: 105px;">Prioridad</th>
                                <th style="width: 100px;">SKU Crudo</th>
                                <th style="text-align: right; width: 140px; background-color: #e2e8f0;">A DESPACHAR (CRUDO)</th>
                                <th>Producción Tostadero y Fracciones</th>
                                <th style="text-align: right; width: 65px;">Merma</th>
                                <th style="text-align: right; width: 110px;">A RETORNAR</th>
                                <th>Estado Crudo en Depósito</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filasTost}
                        </tbody>
                    </table>
                `;
            }

            let htmlBarritasGranolas = '';
            const prodComp = [...barritasConProd, ...granolasConProd];
            if (prodComp.length > 0) {
                const filasComp = prodComp.map(b => {
                    let urgLabel = 'Planificado';
                    let urgClass = 'urg-planificado';
                    if (b.estado_alarma === 'CRITICO_SIN_STOCK' || b.stock_actual <= 0) {
                        urgLabel = '🔴 QUIEBRE';
                        urgClass = 'urg-quiebre';
                    } else if (b.estado_alarma === 'CRITICO') {
                        urgLabel = '🟠 CRÍTICO (≤5d)';
                        urgClass = 'urg-critico';
                    }
                    const ldnNom = b.ldn === 5 ? 'Barritas' : 'Granolas';
                    return `
                        <tr>
                            <td style="text-align: center; width: 32px;"><span class="check-item-box"></span></td>
                            <td style="width: 105px;"><span class="urgencia-badge-print ${urgClass}">${urgLabel}</span></td>
                            <td style="font-family: monospace; font-weight: 600; width: 105px;">${b.articulo_id}</td>
                            <td>
                                <strong>${b.descripcion}</strong>
                                <div style="font-size: 0.70rem; color: #475569;">Línea: ${ldnNom} &bull; ${b.kilos_unidad} kg/u</div>
                            </td>
                            <td style="text-align: right; width: 110px;">${formatearUnidadesStock(b.stock_actual)} u. (${(b.stock_kilos || 0).toFixed(1)}k)</td>
                            <td style="text-align: right; width: 60px;">${b.dias_cobertura === 999 ? '∞' : b.dias_cobertura.toFixed(1) + 'd'}</td>
                            <td style="text-align: right; width: 130px; background-color: #f1f5f9; font-weight: 800;">
                                +${formatearBolsas(b.cantidad_sugerida)} u. (${(b.kilos_sugeridos || 0).toFixed(1)} kg)
                            </td>
                            <td style="font-size: 0.72rem; color: #475569;">${b.factibilidad ? b.factibilidad.detalle : '-'}</td>
                        </tr>
                    `;
                }).join('');

                htmlBarritasGranolas = `
                    <div style="margin-top: 24px;">
                        <div style="font-size: 0.88rem; font-weight: 800; color: #0f172a; text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                            <span>🍫 2. ELABORACIÓN EXTERNA: BARRITAS Y GRANOLAS (LDN 5 & 6)</span>
                        </div>
                        <table class="sheet-table">
                            <thead>
                                <tr>
                                    <th style="width: 32px; text-align: center;">✓</th>
                                    <th style="width: 105px;">Prioridad</th>
                                    <th style="width: 105px;">Código SKU</th>
                                    <th>Producto / Variedad</th>
                                    <th style="text-align: right; width: 110px;">Stock</th>
                                    <th style="text-align: right; width: 60px;">Cob.</th>
                                    <th style="text-align: right; width: 130px; background-color: #e2e8f0;">A ELABORAR</th>
                                    <th>Circuito y Factibilidad</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${filasComp}
                            </tbody>
                        </table>
                    </div>
                `;
            }

            container.innerHTML = `
                <div>
                    <div style="font-size: 0.88rem; font-weight: 800; color: #0f172a; text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                        <span>🥜 1. DESPACHO A TOSTADEROS (LDN 4 — SALIDA DE CRUDOS Y RETORNO TOSTADO)</span>
                    </div>
                    ${htmlTost}
                </div>
                ${htmlBarritasGranolas}
            `;
        }

        modal.style.display = 'flex';
    };

    window.cerrarModalVisorExterna = function () {
        const modal = document.getElementById('modal-visor-externa');
        if (modal) modal.style.display = 'none';
    };

    window.ejecutarImpresionExterna = function () {
        const modal = document.getElementById('modal-visor-externa');
        if (modal) modal.classList.add('is-printing');
        window.print();
        setTimeout(() => {
            if (modal) modal.classList.remove('is-printing');
        }, 1000);
    };

    window.copiarExternaWhatsApp = function () {
        if (!dataMaster) return;
        const extData = dataMaster.produccion_externa_ups || {};
        const tostaderos = extData.tostaderos || (dataMaster.lineas_de_negocio?.ldn4_tostaderos || []);
        const barritas = (extData.barritas || []).filter(b => b.cantidad_sugerida > 0);
        const granolas = (extData.granolas || []).filter(g => g.cantidad_sugerida > 0);

        // Agrupar tostaderos por tipo de producción
        const gruposTostPrint = {};
        tostaderos.forEach(art => {
            const g = obtenerGrupoTostadero(art);
            if (!gruposTostPrint[g.id]) {
                gruposTostPrint[g.id] = { meta: g, items: [] };
            }
            gruposTostPrint[g.id].items.push(art);
        });
        const gruposPrintArray = Object.values(gruposTostPrint).sort((a, b) => a.meta.orden - b.meta.orden);
        const gruposConDespachoPrint = gruposPrintArray.filter(g => {
            const kgTot = g.items.reduce((sum, a) => sum + parseFloat(a.kilos_tostados_sugeridos || a.kilos_sugeridos || 0), 0);
            const bultosTot = g.items.reduce((sum, a) => sum + parseInt(a.bultos_crudos_despachar || 0), 0);
            const kgCrudosTot = g.items.reduce((sum, a) => sum + parseFloat(a.kilos_crudos_requeridos || 0), 0);
            return kgTot > 0 || bultosTot > 0 || kgCrudosTot > 0;
        });

        const now = new Date();
        const fechaStr = now.toLocaleDateString('es-AR');

        let txt = `🚚 *DIRECTIVA DE DESPACHO A UNIDADES PRODUCTIVAS EXTERNAS (UPs) — LAMDA*\n`;
        txt += `📅 *Fecha:* ${fechaStr} | 🎯 *Objetivo:* ${diasObjetivoCobertura} días cubiertos\n`;
        txt += `🔢 *Órdenes Activas:* ${gruposConDespachoPrint.length} producciones de tostadero | ${barritas.length + granolas.length} elaboraciones\n`;
        txt += `----------------------------------------------------\n\n`;

        if (gruposConDespachoPrint.length > 0) {
            txt += `🥜 *1. DESPACHO A TOSTADEROS (LDN 4 — CONSOLIDADO POR PRODUCCIÓN):*\n`;
            gruposConDespachoPrint.forEach(g => {
                const kgTostTot = g.items.reduce((sum, a) => sum + parseFloat(a.kilos_tostados_sugeridos || a.kilos_sugeridos || 0), 0);
                let kgCrudosTot = g.items.reduce((sum, a) => sum + parseFloat(a.kilos_crudos_requeridos || 0), 0);
                if (kgCrudosTot === 0 && kgTostTot > 0) {
                    kgCrudosTot = kgTostTot / (1 - (g.meta.mermaPct / 100));
                }
                let bultosTot = g.items.reduce((sum, a) => sum + parseInt(a.bultos_crudos_despachar || 0), 0);
                if (bultosTot === 0 && kgCrudosTot > 0) {
                    const bultoKgRef = (g.meta.materiaPrimaCodigo && g.meta.materiaPrimaCodigo.includes('10')) ? 10 : 22.68;
                    bultosTot = Math.ceil(kgCrudosTot / bultoKgRef);
                }
                
                const stockCrudo = g.items.find(a => parseFloat(a.stock_crudo_disponible_kg || 0) > 0)?.stock_crudo_disponible_kg || g.items[0]?.stock_crudo_disponible_kg || 0;
                const fact = stockCrudo >= kgCrudosTot ? `🟢 Stock crudo OK (${stockCrudo.toFixed(1)}k)` : `🔴 Falta crudo en depo (${stockCrudo.toFixed(1)}k)`;

                const fracTxt = g.items
                    .filter(a => a.cantidad_sugerida > 0 || (a.kilos_tostados_sugeridos || 0) > 0)
                    .map(a => a.articulo_id.includes('UP')
                        ? `Granel p/ mix (+${(a.kilos_tostados_sugeridos || a.kilos_sugeridos || 0).toFixed(1)}kg)`
                        : `${a.kilos_unidad}kg (+${formatearBolsas(a.cantidad_sugerida)}u)`
                    )
                    .join(', ');

                txt += `• *[${g.meta.materiaPrimaCodigo}]* -> *${g.meta.icono} ${g.meta.titulo}*:\n`;
                txt += `   👉 *Despachar ${bultosTot} bulto(s) crudo (${kgCrudosTot.toFixed(1)} kg)* &bull; ${fact} &bull; Merma: ${g.meta.mermaPct}%\n`;
                txt += `   👉 *Retorno esperado:* +${kgTostTot.toFixed(1)} kg tostados\n`;
                if (fracTxt) {
                    txt += `   👉 *Fracciones a envasar:* ${fracTxt}\n`;
                }
            });
            txt += `\n`;
        }

        if (barritas.length > 0 || granolas.length > 0) {
            txt += `🍫 *2. BARRITAS Y GRANOLAS (LDN 5 & 6):*\n`;
            [...barritas, ...granolas].forEach(b => {
                const ldnNom = b.ldn === 5 ? 'Barritas' : 'Granolas';
                txt += `• *[${b.articulo_id}]* ${b.descripcion} (${ldnNom}):\n`;
                txt += `   👉 *Elaborar ${b.cantidad_sugerida} u.* (${(b.kilos_sugeridos || 0).toFixed(1)} kg)\n`;
            });
            txt += `\n`;
        }

        txt += `----------------------------------------------------\n`;
        txt += `_Sistema LAMDA &bull; Inteligencia Determinista de Producción_`;

        copiarAlPortapapeles(txt, 'Directiva de Despacho a UPs');
    };

    function copiarAlPortapapeles(txt, titulo) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt).then(() => {
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'success',
                        title: '¡Copiado al Portapapeles!',
                        text: `${titulo} listo para pegar en WhatsApp o enviar al equipo de taller.`,
                        timer: 2500,
                        showConfirmButton: false
                    });
                } else {
                    alert(`${titulo} copiado al portapapeles.`);
                }
            }).catch(err => {
                copiarFallback(txt);
            });
        } else {
            copiarFallback(txt);
        }
    }

    // Manejadores automáticos para impresión física / atajos de teclado (Ctrl+P)
    window.addEventListener('beforeprint', () => {
        const modalCompras = document.getElementById('modal-visor-compras');
        const modalTaller = document.getElementById('modal-visor-taller');
        const modalExterna = document.getElementById('modal-visor-externa');
        if (modalCompras && modalCompras.style.display !== 'none') {
            modalCompras.classList.add('is-printing');
        }
        if (modalTaller && modalTaller.style.display !== 'none') {
            modalTaller.classList.add('is-printing');
        }
        if (modalExterna && modalExterna.style.display !== 'none') {
            modalExterna.classList.add('is-printing');
        }
    });

    window.addEventListener('afterprint', () => {
        const modalCompras = document.getElementById('modal-visor-compras');
        const modalTaller = document.getElementById('modal-visor-taller');
        const modalExterna = document.getElementById('modal-visor-externa');
        if (modalCompras) modalCompras.classList.remove('is-printing');
        if (modalTaller) modalTaller.classList.remove('is-printing');
        if (modalExterna) modalExterna.classList.remove('is-printing');
    });

    window.cargarPlanificacion = cargarPlanificacion;

    // Inicialización automática
    document.addEventListener('DOMContentLoaded', () => {
        console.log('🚀 [CLIENTE-LUNES] Módulo inicializado con selector de impresión y compras.');
        try {
            const guardadoDemanda = localStorage.getItem('lamda_planificacion_demanda_dias');
            if (guardadoDemanda) {
                ventanaDiasDemanda = parseInt(guardadoDemanda) || 14;
            }
            const guardadoObjetivo = localStorage.getItem('lamda_planificacion_objetivo_dias');
            if (guardadoObjetivo) {
                diasObjetivoCobertura = parseInt(guardadoObjetivo) || 21;
                diasObjetivoCompras = diasObjetivoCobertura;
            }
        } catch (e) {
            console.warn('Error leyendo localStorage:', e);
        }

        // Sincronizar selectores del DOM
        const selVentana = document.getElementById('select-ventana');
        if (selVentana) selVentana.value = String(ventanaDiasDemanda);
        const selModalDemanda = document.getElementById('modal-select-demanda');
        if (selModalDemanda) selModalDemanda.value = String(ventanaDiasDemanda);

        sincronizarSelectoresObjetivo();

        cargarPlanificacion();
    });

})();

