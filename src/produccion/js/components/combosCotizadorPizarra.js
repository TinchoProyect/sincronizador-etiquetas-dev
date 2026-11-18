/**
 * ============================================================================
 * COMPONENTE UNIFICADO: COMBOS Y PACKS COMPUESTOS (LDN 8 + COTIZADOR TIENDAS)
 * ============================================================================
 * Punto único de lógica y UI montable tanto en:
 *   1) Pestaña superior [LDN 8] Combos (#combos-ldn8-container)
 *   2) 4ª Sub-pestaña "4. Combos y Packs" dentro de Cotizador Nodos (#nodos-combos-subtab-mount)
 */
(function () {
    const ESTADO_COMBOS = {
        cargando: false,
        inicializado: false,
        ultimoTargetId: 'combos-ldn8-container',
        combos: [],
        propuestas_combos: [],
        pendientes_count: 0,
        articulos_elegibles: [],
        insumos_empaque: [],
        tarifas_colaboradores: [],
        nodos_activos: [],
        listas_mayoristas: [],
        busquedaArticulos: '',
        propuestaActivaId: null,
        catalogoEditandoId: null,
        skuEditando: '',
        definicionCombo: '',
        abreviaturaDefinicion: '',
        modoPrecioCombo: 'COSTO_MAS_MARGEN', // 'COSTO_MAS_MARGEN' | 'SUMA_BASES_HIJOS_AJUSTADA'
        margenLamdaPct: 25,
        ajusteComercialPct: -5,
        cargoPackCombo: 0,
        insumoEnvaseId: '',
        segundosArmado: 25,
        tarifaColaboradorId: '',
        ivaPct: 21,
        iibbLamdaPct: 4,
        precioManualOverride: '',
        notasTecnicas: '',
        respuestaLamda: '',
        nodosHabilitadosIds: [],
        listasMayoristasIds: [],
        componentesSeleccionados: [], // [{ sku, cantidad }]
        previewServidor: null
    };

    function esc(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function fmt(val, dec = 0) {
        const n = Number(val) || 0;
        return '$' + n.toLocaleString('es-AR', {
            minimumFractionDigits: dec,
            maximumFractionDigits: dec
        });
    }

    function fmtKg(kg) {
        const k = Number(kg || 0);
        const g = Math.round(k * 1000);
        if (g >= 1000 && g % 1000 === 0) return `${g / 1000} kg`;
        if (g >= 1000) return `${Number(k.toFixed(2))} kg`;
        return `${g} g`;
    }

    function cumpleBusquedaAcumulativa(texto, query) {
        const q = String(query || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (!q) return true;
        const hay = String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return q.split(/\s+/).filter(Boolean).every(t => hay.includes(t));
    }

    /**
     * Si hay una simulación en memoria activa en Pizarra, toma el costo vivo simulado del SKU hijo
     */
    function obtenerCostoUnitarioVivoHijo(artObj) {
        const sku = String(artObj?.sku || '').trim();
        const kilos = Math.max(0.001, Number(artObj?.kilos_unidad || 0.25));
        if (window.listasArticulosSim && window.pizarraSimulacionMaster) {
            const listaNodos = (window.pizarraSimulacionMaster.listasPrecios || []).find(l => l.canal_comercial === 'NODOS');
            const lid = listaNodos ? listaNodos.id : 8;
            const laSim = window.listasArticulosSim[`${lid}_${sku}`] || window.listasArticulosSim[`1_${sku}`];
            if (laSim && Number(laSim.costo_base_simulado) > 0) {
                const mo = laSim.mano_obra_activa !== false ? Number(laSim.costo_tiempo || 0) : 0;
                return Number((Number(laSim.costo_base_simulado) + mo).toFixed(2));
            }
        }
        return Number(artObj?.costo_unitario || 0);
    }

    function obtenerPrecioBaseVivoHijo(artObj) {
        const sku = String(artObj?.sku || '').trim();
        if (window.listasArticulosSim && window.pizarraSimulacionMaster) {
            const listaNodos = (window.pizarraSimulacionMaster.listasPrecios || []).find(l => l.canal_comercial === 'NODOS');
            if (listaNodos) {
                const laSim = window.listasArticulosSim[`${listaNodos.id}_${sku}`];
                if (laSim && Number(laSim.precio_simulado) > 0) {
                    return Math.round(Number(laSim.precio_simulado));
                }
            }
        }
        return Number(artObj?.precio_base_nodo || 0);
    }

    function sincronizarBadgesPendientesGlobal() {
        const pend = Number(ESTADO_COMBOS.pendientes_count || 0);
        const b8 = document.getElementById('ldn-badge-8');
        if (b8) {
            if (pend > 0) {
                b8.style.display = 'inline-flex';
                b8.textContent = `${pend} prop.`;
                b8.style.background = 'rgba(245, 158, 11, 0.22)';
                b8.style.color = '#fbbf24';
                b8.style.border = '1px solid rgba(245, 158, 11, 0.45)';
            } else {
                b8.style.display = 'none';
            }
        }
        const bSub = document.getElementById('nodos-subtab-combos-badge');
        if (bSub) {
            if (pend > 0) {
                bSub.style.display = 'inline-block';
                bSub.textContent = `${pend} pend.`;
            } else {
                bSub.style.display = 'none';
            }
        }
    }

    async function inicializar(targetContainerId = 'combos-ldn8-container', forzar = false) {
        if (targetContainerId) {
            ESTADO_COMBOS.ultimoTargetId = targetContainerId;
        }
        if (ESTADO_COMBOS.inicializado && !forzar) {
            sincronizarBadgesPendientesGlobal();
            renderizarEnContenedor(ESTADO_COMBOS.ultimoTargetId);
            return;
        }
        if (ESTADO_COMBOS.cargando) return;
        ESTADO_COMBOS.cargando = true;
        try {
            const resp = await fetch('/api/produccion/nodos/combos/estado');
            const data = await resp.json();
            if (!resp.ok || !data.ok) {
                throw new Error(data.error || 'Error cargando estado de Combos');
            }
            aplicarDatosEstado(data);
            sincronizarBadgesPendientesGlobal();
            renderizarEnContenedor(ESTADO_COMBOS.ultimoTargetId);
        } catch (err) {
            console.error('❌ [CombosPizarra] Error inicializando:', err);
            const el = document.getElementById(ESTADO_COMBOS.ultimoTargetId);
            if (el) {
                el.innerHTML = `<div style="padding:22px; background:#1e293b; border:1px solid #ef4444; border-radius:10px; color:#fecaca;">⚠️ ${esc(err.message)}</div>`;
            }
        } finally {
            ESTADO_COMBOS.cargando = false;
        }
    }

    function aplicarDatosEstado(data) {
        ESTADO_COMBOS.combos = Array.isArray(data.combos) ? data.combos : [];
        ESTADO_COMBOS.propuestas_combos = Array.isArray(data.propuestas_combos) ? data.propuestas_combos : [];
        ESTADO_COMBOS.pendientes_count = Number(data.pendientes_count || 0);
        ESTADO_COMBOS.articulos_elegibles = Array.isArray(data.articulos_elegibles) ? data.articulos_elegibles : [];
        ESTADO_COMBOS.insumos_empaque = Array.isArray(data.insumos_empaque) ? data.insumos_empaque : [];
        ESTADO_COMBOS.tarifas_colaboradores = Array.isArray(data.tarifas_colaboradores) ? data.tarifas_colaboradores : [];
        ESTADO_COMBOS.nodos_activos = Array.isArray(data.nodos_activos) ? data.nodos_activos : [];
        ESTADO_COMBOS.listas_mayoristas = Array.isArray(data.listas_mayoristas) ? data.listas_mayoristas : [];
        if (!ESTADO_COMBOS.tarifaColaboradorId && ESTADO_COMBOS.tarifas_colaboradores[0]) {
            ESTADO_COMBOS.tarifaColaboradorId = String(ESTADO_COMBOS.tarifas_colaboradores[0].id);
        }
        if (ESTADO_COMBOS.nodosHabilitadosIds.length === 0 && ESTADO_COMBOS.nodos_activos.length > 0) {
            ESTADO_COMBOS.nodosHabilitadosIds = ESTADO_COMBOS.nodos_activos.map(n => Number(n.id));
        }
        ESTADO_COMBOS.inicializado = true;
    }

    function calcularPreviewLocalDeterminista() {
        const mapaElegibles = new Map(ESTADO_COMBOS.articulos_elegibles.map(a => [String(a.sku).toUpperCase(), a]));
        const compsEnriq = [];
        for (const item of ESTADO_COMBOS.componentesSeleccionados) {
            const skuUp = String(item.sku || '').toUpperCase();
            const base = mapaElegibles.get(skuUp);
            if (!base) continue;
            const cant = Math.max(1, Math.floor(Number(item.cantidad || 1)));
            const costoU = obtenerCostoUnitarioVivoHijo(base);
            const precioBaseU = obtenerPrecioBaseVivoHijo(base);
            const kgU = Number(base.kilos_unidad || 0.25);
            const stockH = Math.floor(Math.max(0, Number(base.stock_consolidado || 0)));
            compsEnriq.push({
                sku: base.sku,
                etiqueta_oficial_lamda: base.etiqueta_oficial_lamda,
                nombre_oficial_lamda: base.nombre_oficial_lamda,
                cantidad: cant,
                kilos_unidad: kgU,
                kilos_subtotal: Number((kgU * cant).toFixed(4)),
                costo_unitario: costoU,
                costo_subtotal: Number((costoU * cant).toFixed(2)),
                precio_base_unitario: precioBaseU,
                precio_base_subtotal: Number((precioBaseU * cant).toFixed(2)),
                stock_hijo: stockH,
                armables_hijo: Math.floor(stockH / cant)
            });
        }

        const firma = compsEnriq
            .slice()
            .sort((a, b) => a.sku.toUpperCase().localeCompare(b.sku.toUpperCase(), 'en'))
            .map(c => `${c.sku.toUpperCase()}:${c.cantidad}`)
            .join('|');

        const kilosTotales = Number(compsEnriq.reduce((s, c) => s + c.kilos_subtotal, 0).toFixed(4));
        const stockArmable = compsEnriq.length >= 2
            ? Math.min(...compsEnriq.map(c => c.armables_hijo))
            : 0;

        const costoComponentes = Number(compsEnriq.reduce((s, c) => s + c.costo_subtotal, 0).toFixed(2));
        const sumaBasesHijos = Number(compsEnriq.reduce((s, c) => s + c.precio_base_subtotal, 0).toFixed(2));

        const envObj = ESTADO_COMBOS.insumos_empaque.find(e => String(e.id) === String(ESTADO_COMBOS.insumoEnvaseId));
        const costoEnvase = envObj ? Number(envObj.costo_patron || 0) : 0;

        const tarObj = ESTADO_COMBOS.tarifas_colaboradores.find(t => String(t.id) === String(ESTADO_COMBOS.tarifaColaboradorId))
            || ESTADO_COMBOS.tarifas_colaboradores[0];
        const valorHora = tarObj ? Number(tarObj.valor_hora || 4500) : 4500;
        const segs = Math.max(0, Number(ESTADO_COMBOS.segundosArmado || 0));
        const costoMo = Number(((segs / 3600) * valorHora).toFixed(2));

        const costoPuroTotal = Number((costoComponentes + costoEnvase + costoMo).toFixed(2));
        const ivaPct = Math.max(0, Number(ESTADO_COMBOS.ivaPct ?? 21));
        const iibbPct = Math.max(0, Number(ESTADO_COMBOS.iibbLamdaPct ?? 4));
        const margenPct = Number(ESTADO_COMBOS.margenLamdaPct ?? 25);
        const ajustePct = Number(ESTADO_COMBOS.ajusteComercialPct ?? 0);
        const cargoPack = Math.max(0, Number(ESTADO_COMBOS.cargoPackCombo ?? 0));

        let precioSugerido = 0;
        if (ESTADO_COMBOS.modoPrecioCombo === 'SUMA_BASES_HIJOS_AJUSTADA') {
            precioSugerido = Math.round((sumaBasesHijos + cargoPack) * (1 + ajustePct / 100));
        } else {
            precioSugerido = Math.round(costoPuroTotal * (1 + margenPct / 100) * (1 + ivaPct / 100));
        }

        const manVal = String(ESTADO_COMBOS.precioManualOverride ?? '').trim();
        const tieneManual = manVal !== '' && Number(manVal) > 0;
        const precioBaseFinal = tieneManual ? Math.round(Number(manVal)) : Math.max(0, precioSugerido);

        const netoSinIva = precioBaseFinal > 0 ? Number((precioBaseFinal / (1 + ivaPct / 100)).toFixed(2)) : 0;
        const iibbRetenido = Number((netoSinIva * (iibbPct / 100)).toFixed(2));
        const ingresoLimpio = Number((netoSinIva - iibbRetenido).toFixed(2));
        const utilidadNetaReal = Number((ingresoLimpio - costoPuroTotal).toFixed(2));
        const margenMarkupEf = costoPuroTotal > 0 ? Number((((netoSinIva - costoPuroTotal) / costoPuroTotal) * 100).toFixed(2)) : 0;
        const margenNetoRealPostIibb = costoPuroTotal > 0 ? Number(((utilidadNetaReal / costoPuroTotal) * 100).toFixed(2)) : 0;
        const difVsHijosPct = sumaBasesHijos > 0 ? Number((((precioBaseFinal - sumaBasesHijos) / sumaBasesHijos) * 100).toFixed(2)) : 0;

        // Sugerencia determinista de nombre oficial y SKU bajo FAM-COMBOS (CMB)
        const defBase = String(ESTADO_COMBOS.definicionCombo || '').trim() || (
            compsEnriq.length >= 2
                ? compsEnriq.slice(0, 3).map(c => c.nombre_oficial_lamda.replace(/\s+x\s*\d+.*$/i, '').split(/\s+/).slice(0, 2).join(' ')).join(' + ')
                : 'Selección'
        );
        const gramos = Math.round(Math.max(0.001, kilosTotales) * 1000);
        const pesoTxt = (gramos >= 1000 && gramos % 1000 === 0) ? `${gramos / 1000}kg` : `${gramos}g`;
        const abDef = (String(ESTADO_COMBOS.abreviaturaDefinicion || '').trim() ||
            defBase.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 3).map(w => w.slice(0, 2)).join('')
        ).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 5) || 'SEL';
        const skuSugerido = ESTADO_COMBOS.skuEditando || `CMB${abDef}x${(gramos >= 1000 && gramos % 1000 === 0) ? `${gramos / 1000}kg` : gramos}`;
        const descSugerida = `Combo ${defBase.replace(/^combo\s+/i, '')} x ${pesoTxt}`;

        return {
            valido: compsEnriq.length >= 2,
            componentes: compsEnriq,
            firma,
            kilosTotales,
            stockArmable,
            skuSugerido,
            descSugerida,
            costoComponentes,
            costoEnvase,
            costoMo,
            costoPuroTotal,
            sumaBasesHijos,
            precioSugerido,
            precioBaseFinal,
            netoSinIva,
            iibbRetenido,
            utilidadNetaReal,
            margenMarkupEf,
            margenNetoRealPostIibb,
            difVsHijosPct
        };
    }

    function agregarQuitarComponente(sku, delta) {
        const skuClean = String(sku || '').trim();
        if (!skuClean) return;
        const idx = ESTADO_COMBOS.componentesSeleccionados.findIndex(x => x.sku.toUpperCase() === skuClean.toUpperCase());
        if (idx >= 0) {
            const nueva = ESTADO_COMBOS.componentesSeleccionados[idx].cantidad + Number(delta || 0);
            if (nueva <= 0) {
                ESTADO_COMBOS.componentesSeleccionados.splice(idx, 1);
            } else {
                ESTADO_COMBOS.componentesSeleccionados[idx].cantidad = nueva;
            }
        } else if (delta > 0) {
            ESTADO_COMBOS.componentesSeleccionados.push({ sku: skuClean, cantidad: Number(delta) });
        }
        renderizarEnContenedor(ESTADO_COMBOS.ultimoTargetId);
    }

    function fijarCantidadComponente(sku, valor) {
        const cant = Math.floor(Number(valor || 0));
        const idx = ESTADO_COMBOS.componentesSeleccionados.findIndex(x => x.sku.toUpperCase() === String(sku || '').toUpperCase());
        if (idx < 0) return;
        if (cant <= 0) {
            ESTADO_COMBOS.componentesSeleccionados.splice(idx, 1);
        } else {
            ESTADO_COMBOS.componentesSeleccionados[idx].cantidad = cant;
        }
        actualizarPanelRadiografiaComboDom();
    }

    function cargarPropuestaComboEnMesa(propId) {
        const pr = ESTADO_COMBOS.propuestas_combos.find(p => Number(p.id) === Number(propId));
        if (!pr) return;
        ESTADO_COMBOS.propuestaActivaId = Number(pr.id);
        ESTADO_COMBOS.catalogoEditandoId = null;
        ESTADO_COMBOS.skuEditando = '';
        ESTADO_COMBOS.componentesSeleccionados = (pr.items || []).map(it => ({
            sku: it.componente_articulo_id,
            cantidad: Number(it.cantidad || 1)
        }));
        ESTADO_COMBOS.definicionCombo = pr.alias_vidriera_sugerido
            ? String(pr.alias_vidriera_sugerido).replace(/^combo\s+/i, '').trim()
            : '';
        ESTADO_COMBOS.abreviaturaDefinicion = '';
        ESTADO_COMBOS.precioManualOverride = '';
        ESTADO_COMBOS.notasTecnicas = pr.comentario_gestor || '';
        ESTADO_COMBOS.nodosHabilitadosIds = Array.from(new Set([
            Number(pr.nodo_solicitante_id),
            ...ESTADO_COMBOS.nodos_activos.map(n => Number(n.id))
        ]));
        renderizarEnContenedor(ESTADO_COMBOS.ultimoTargetId);
    }

    function editarComboExistente(skuCombo) {
        const c = ESTADO_COMBOS.combos.find(x => String(x.sku_combo).toUpperCase() === String(skuCombo || '').toUpperCase());
        if (!c) return;
        ESTADO_COMBOS.propuestaActivaId = null;
        ESTADO_COMBOS.catalogoEditandoId = c.catalogo_id ? Number(c.catalogo_id) : null;
        ESTADO_COMBOS.skuEditando = c.sku_combo;
        ESTADO_COMBOS.componentesSeleccionados = (c.componentes || []).map(it => ({
            sku: it.sku,
            cantidad: Number(it.cantidad || 1)
        }));
        ESTADO_COMBOS.definicionCombo = String(c.nombre_oficial_lamda || '')
            .replace(/^combo\s+/i, '')
            .replace(/\s+x\s*\d+.*$/i, '')
            .trim();
        ESTADO_COMBOS.modoPrecioCombo = c.modo_precio_combo || 'COSTO_MAS_MARGEN';
        ESTADO_COMBOS.margenLamdaPct = Number(c.margen_lamda_pct ?? 25);
        ESTADO_COMBOS.ajusteComercialPct = Number(c.ajuste_comercial_combo_pct ?? -5);
        ESTADO_COMBOS.cargoPackCombo = Number(c.cargo_pack_combo ?? 0);
        ESTADO_COMBOS.insumoEnvaseId = c.insumo_envase_id ? String(c.insumo_envase_id) : '';
        ESTADO_COMBOS.segundosArmado = Number(c.segundos_fraccionamiento ?? 25);
        ESTADO_COMBOS.tarifaColaboradorId = c.tarifa_colaborador_id ? String(c.tarifa_colaborador_id) : ESTADO_COMBOS.tarifaColaboradorId;
        ESTADO_COMBOS.ivaPct = Number(c.porcentaje_iva ?? 21);
        ESTADO_COMBOS.precioManualOverride = c.precio_manual_override ? String(Math.round(Number(c.precio_manual_override))) : '';
        ESTADO_COMBOS.listasMayoristasIds = Array.isArray(c.listas_mayoristas_compartidas)
            ? c.listas_mayoristas_compartidas.map(Number)
            : [];
        ESTADO_COMBOS.nodosHabilitadosIds = Array.isArray(c.tiendas_vinculadas) && c.tiendas_vinculadas.length > 0
            ? c.tiendas_vinculadas.map(t => Number(t.nodo_id))
            : ESTADO_COMBOS.nodos_activos.map(n => Number(n.id));
        renderizarEnContenedor(ESTADO_COMBOS.ultimoTargetId);
    }

    function limpiarMesaCombo() {
        ESTADO_COMBOS.propuestaActivaId = null;
        ESTADO_COMBOS.catalogoEditandoId = null;
        ESTADO_COMBOS.skuEditando = '';
        ESTADO_COMBOS.componentesSeleccionados = [];
        ESTADO_COMBOS.definicionCombo = '';
        ESTADO_COMBOS.abreviaturaDefinicion = '';
        ESTADO_COMBOS.modoPrecioCombo = 'COSTO_MAS_MARGEN';
        ESTADO_COMBOS.margenLamdaPct = 25;
        ESTADO_COMBOS.ajusteComercialPct = -5;
        ESTADO_COMBOS.cargoPackCombo = 0;
        ESTADO_COMBOS.insumoEnvaseId = '';
        ESTADO_COMBOS.segundosArmado = 25;
        ESTADO_COMBOS.precioManualOverride = '';
        ESTADO_COMBOS.notasTecnicas = '';
        ESTADO_COMBOS.listasMayoristasIds = [];
        ESTADO_COMBOS.nodosHabilitadosIds = ESTADO_COMBOS.nodos_activos.map(n => Number(n.id));
        renderizarEnContenedor(ESTADO_COMBOS.ultimoTargetId);
    }

    async function descartarPropuestaCombo(propId) {
        let motivo = 'Descartada por Administración LAMDA.';
        if (typeof Swal !== 'undefined') {
            const r = await Swal.fire({
                title: '¿Descartar solicitud de Combo?',
                input: 'text',
                inputLabel: 'Motivo para informar a la tienda (opcional)',
                inputPlaceholder: 'Ej: Uno de los componentes está discontinuado temporalmente',
                showCancelButton: true,
                confirmButtonText: 'Descartar',
                cancelButtonText: 'Cancelar',
                background: '#1e293b',
                color: '#f8fafc'
            });
            if (!r.isConfirmed) return;
            if (r.value) motivo = r.value;
        }
        const resp = await fetch(`/api/produccion/nodos/propuestas-combos/${Number(propId)}/descartar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo })
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
            alert('Error al descartar solicitud: ' + (data.error || 'Error interno'));
            return;
        }
        if (ESTADO_COMBOS.propuestaActivaId === Number(propId)) {
            ESTADO_COMBOS.propuestaActivaId = null;
        }
        await inicializar(ESTADO_COMBOS.ultimoTargetId, true);
        if (window.NodosPizarra && typeof window.NodosPizarra.inicializar === 'function') {
            window.NodosPizarra.inicializar(true);
        }
    }

    async function guardarYAprobarCombo() {
        const calc = calcularPreviewLocalDeterminista();
        if (!calc.valido) {
            if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'warning', title: 'Faltan componentes', text: 'Seleccioná al menos 2 artículos distintos para crear el Combo.', background: '#1e293b', color: '#f8fafc' });
            } else {
                alert('Seleccioná al menos 2 artículos distintos para crear el Combo.');
            }
            return;
        }

        const payload = {
            propuesta_combo_id: ESTADO_COMBOS.propuestaActivaId || null,
            catalogo_id: ESTADO_COMBOS.catalogoEditandoId || null,
            sku_solicitud: ESTADO_COMBOS.skuEditando || '',
            definicion_combo: ESTADO_COMBOS.definicionCombo || '',
            abreviatura_definicion: ESTADO_COMBOS.abreviaturaDefinicion || '',
            componentes: ESTADO_COMBOS.componentesSeleccionados.map((c, idx) => ({
                componente_articulo_id: c.sku,
                cantidad: Number(c.cantidad || 1),
                orden: idx + 1
            })),
            modo_precio_combo: ESTADO_COMBOS.modoPrecioCombo,
            margen_lamda_pct: Number(ESTADO_COMBOS.margenLamdaPct || 25),
            ajuste_comercial_combo_pct: Number(ESTADO_COMBOS.ajusteComercialPct || 0),
            cargo_pack_combo: Number(ESTADO_COMBOS.cargoPackCombo || 0),
            insumo_envase_id: ESTADO_COMBOS.insumoEnvaseId ? Number(ESTADO_COMBOS.insumoEnvaseId) : null,
            segundos_fraccionamiento: Number(ESTADO_COMBOS.segundosArmado || 0),
            tarifa_colaborador_id: ESTADO_COMBOS.tarifaColaboradorId ? Number(ESTADO_COMBOS.tarifaColaboradorId) : null,
            iva_pct: Number(ESTADO_COMBOS.ivaPct ?? 21),
            alicuota_iibb_lamda_pct: Number(ESTADO_COMBOS.iibbLamdaPct ?? 4),
            precio_manual_override: String(ESTADO_COMBOS.precioManualOverride || '').trim() !== ''
                ? Number(ESTADO_COMBOS.precioManualOverride)
                : null,
            notas_tecnicas: ESTADO_COMBOS.notasTecnicas || '',
            nodos_habilitados_ids: ESTADO_COMBOS.nodosHabilitadosIds,
            compartido_mayorista: ESTADO_COMBOS.listasMayoristasIds.length > 0,
            listas_mayoristas_compartidas: ESTADO_COMBOS.listasMayoristasIds
        };

        try {
            const resp = await fetch('/api/produccion/nodos/combos/cotizar-aprobar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (!resp.ok || !data.ok) {
                throw new Error(data.error || 'Error aprobando Combo');
            }
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'success',
                    title: `Combo [${data.sku_oficial}] aprobado`,
                    html: `<div style="font-size:0.9rem; line-height:1.5;">
                        <strong>${esc(data.descripcion_oficial)}</strong><br>
                        Precio Base Tienda: <strong style="color:#34d399;">${fmt(data.estructura_costos.precio_base_nodo_final)}</strong><br>
                        Utilidad Neta Real LAMDA (post IIBB 4%): <strong>${fmt(data.estructura_costos.utilidad_neta_real_lamda)}</strong> (${data.estructura_costos.margen_neto_real_post_iibb_pct}%)
                    </div>`,
                    background: '#1e293b',
                    color: '#f8fafc'
                });
            }
            limpiarMesaCombo();
            await inicializar(ESTADO_COMBOS.ultimoTargetId, true);
            if (window.NodosPizarra && typeof window.NodosPizarra.inicializar === 'function') {
                window.NodosPizarra.inicializar(true);
            }
        } catch (err) {
            if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'error', title: 'No se pudo guardar el Combo', text: err.message, background: '#1e293b', color: '#f8fafc' });
            } else {
                alert('No se pudo guardar el Combo: ' + err.message);
            }
        }
    }

    function renderizarRadiografiaComboHtml(calc) {
        if (!calc.valido) {
            return `
                <div style="padding:14px; border-radius:9px; border:1px dashed #475569; color:#94a3b8; font-size:0.82rem; text-align:center;">
                    Agregá al menos <strong>2 artículos distintos</strong> del catálogo oficial para calcular costos elaborados, margen real post-IIBB y Precio Base.
                </div>
            `;
        }
        const utilPositiva = calc.utilidadNetaReal >= 0;
        const difSigno = calc.difVsHijosPct > 0 ? `+${calc.difVsHijosPct}%` : `${calc.difVsHijosPct}%`;
        return `
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap:10px;">
                <div style="padding:10px 12px; border-radius:8px; background:#0f172a; border:1px solid #334155;">
                    <div style="font-size:0.7rem; color:#94a3b8; text-transform:uppercase; font-weight:700;">SKU / Nomenclatura FAM-COMBOS</div>
                    <div style="font-family:monospace; font-size:0.9rem; font-weight:900; color:#c4b5fd; margin-top:2px;">[${esc(calc.skuSugerido)}]</div>
                    <div style="font-size:0.78rem; color:#f8fafc; font-weight:700;">${esc(calc.descSugerida)}</div>
                    <div style="font-size:0.71rem; color:#94a3b8; margin-top:2px;">Peso postal: <strong>${fmtKg(calc.kilosTotales)}</strong> · Stock armable: <strong style="color:${calc.stockArmable > 0 ? '#34d399' : '#fbbf24'};">${calc.stockArmable} u.</strong></div>
                </div>

                <div style="padding:10px 12px; border-radius:8px; background:#0f172a; border:1px solid #334155;">
                    <div style="font-size:0.7rem; color:#94a3b8; text-transform:uppercase; font-weight:700;">Costo Elaborado Total LAMDA</div>
                    <div style="font-size:1.05rem; font-weight:900; color:#f8fafc; margin-top:2px;">${fmt(calc.costoPuroTotal, 2)}</div>
                    <div style="font-size:0.71rem; color:#94a3b8; margin-top:2px;">
                        Hijos: ${fmt(calc.costoComponentes)} + Empaque: ${fmt(calc.costoEnvase)} + MO: ${fmt(calc.costoMo)}
                    </div>
                </div>

                <div style="padding:10px 12px; border-radius:8px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.45);">
                    <div style="font-size:0.7rem; color:#6ee7b7; text-transform:uppercase; font-weight:800;">Precio Base Final (c/IVA ${ESTADO_COMBOS.ivaPct}%)</div>
                    <div style="font-size:1.22rem; font-weight:900; color:#34d399; margin-top:2px;">${fmt(calc.precioBaseFinal)}</div>
                    <div style="font-size:0.71rem; color:#cbd5e1; margin-top:2px;">
                        Suma bases individuales: <strong>${fmt(calc.sumaBasesHijos)}</strong> (${difSigno})
                    </div>
                </div>

                <div style="padding:10px 12px; border-radius:8px; background:${utilPositiva ? 'rgba(56,189,248,0.1)' : 'rgba(239,68,68,0.14)'}; border:1px solid ${utilPositiva ? 'rgba(56,189,248,0.4)' : '#ef4444'};">
                    <div style="font-size:0.7rem; color:${utilPositiva ? '#7dd3fc' : '#fca5a5'}; text-transform:uppercase; font-weight:800;">Utilidad Neta Real LAMDA (post IIBB ${ESTADO_COMBOS.iibbLamdaPct}%)</div>
                    <div style="font-size:1.08rem; font-weight:900; color:${utilPositiva ? '#38bdf8' : '#f87171'}; margin-top:2px;">
                        ${fmt(calc.utilidadNetaReal)} (${calc.margenNetoRealPostIibb}%)
                    </div>
                    <div style="font-size:0.71rem; color:#94a3b8; margin-top:2px;">
                        Neto s/IVA: ${fmt(calc.netoSinIva)} · IIBB: -${fmt(calc.iibbRetenido)}
                    </div>
                </div>
            </div>
        `;
    }

    function actualizarPanelRadiografiaComboDom() {
        const calc = calcularPreviewLocalDeterminista();
        const box = document.getElementById('combos-radiografia-live-box');
        if (box) box.innerHTML = renderizarRadiografiaComboHtml(calc);
    }

    function renderizarListaElegiblesHtml() {
        const selSet = new Set(ESTADO_COMBOS.componentesSeleccionados.map(c => c.sku.toUpperCase()));
        const filtrados = ESTADO_COMBOS.articulos_elegibles.filter(a => {
            const bolsa = `${a.sku} ${a.nombre_oficial_lamda} ${a.familia_nombre} ${a.etiqueta_oficial_lamda}`;
            return cumpleBusquedaAcumulativa(bolsa, ESTADO_COMBOS.busquedaArticulos);
        });
        if (filtrados.length === 0) {
            return `<div style="padding:12px; color:#94a3b8; font-size:0.78rem; text-align:center;">Sin artículos coincidentes.</div>`;
        }
        return filtrados.slice(0, 60).map(a => {
            const yaEsta = selSet.has(String(a.sku).toUpperCase());
            const costoV = obtenerCostoUnitarioVivoHijo(a);
            const baseV = obtenerPrecioBaseVivoHijo(a);
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 9px; border-radius:7px; background:${yaEsta ? 'rgba(168,85,247,0.14)' : 'rgba(15,23,42,0.75)'}; border:1px solid ${yaEsta ? 'rgba(168,85,247,0.45)' : '#263244'};">
                    <div style="min-width:0;">
                        <div style="font-size:0.78rem; color:#f8fafc; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                            <code style="color:#7dd3fc;">[${esc(a.sku)}]</code> ${esc(a.nombre_oficial_lamda)}
                        </div>
                        <div style="font-size:0.69rem; color:#94a3b8;">
                            Costo elab.: <strong>${fmt(costoV)}</strong>${baseV > 0 ? ` · Base Tienda: <strong style="color:#6ee7b7;">${fmt(baseV)}</strong>` : ''} · Stock: ${Number(a.stock_consolidado || 0)} u.
                        </div>
                    </div>
                    <button type="button" data-testid="btn-add-comp-${esc(a.sku)}"
                        onclick="window.CombosPizarra.agregarQuitarComponente('${esc(a.sku)}', 1)"
                        style="padding:4px 9px; border-radius:6px; font-size:0.73rem; font-weight:800; cursor:pointer; border:1px solid #a855f7; background:rgba(168,85,247,0.2); color:#e9d5ff; flex-shrink:0;">
                        + Sumar
                    </button>
                </div>
            `;
        }).join('');
    }

    function renderizarEnContenedor(targetId) {
        const container = document.getElementById(targetId || ESTADO_COMBOS.ultimoTargetId);
        if (!container) return;

        const calc = calcularPreviewLocalDeterminista();
        const pendientes = ESTADO_COMBOS.propuestas_combos.filter(p => p.estado === 'PENDIENTE_COTIZACION');

        const envasesOpts = [
            `<option value="">Sin empaque extra ($0 — bolsas individuales ya costeadas)</option>`,
            ...ESTADO_COMBOS.insumos_empaque.map(e =>
                `<option value="${e.id}" ${String(ESTADO_COMBOS.insumoEnvaseId) === String(e.id) ? 'selected' : ''}>[${esc(e.codigo || e.id)}] ${esc(e.nombre)} (${fmt(e.costo_patron)})</option>`
            )
        ].join('');

        const tarifasOpts = ESTADO_COMBOS.tarifas_colaboradores.map(t =>
            `<option value="${t.id}" ${String(ESTADO_COMBOS.tarifaColaboradorId) === String(t.id) ? 'selected' : ''}>${esc(t.colaborador_nombre)} (${fmt(t.valor_hora)}/h)</option>`
        ).join('');

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:14px;">
                <!-- CABECERA LDN 8 -->
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding:12px 16px; border-radius:12px; background:linear-gradient(135deg, rgba(30,27,75,0.92), rgba(15,23,42,0.95)); border:1px solid rgba(168,85,247,0.45);">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div style="width:40px; height:40px; border-radius:10px; background:rgba(168,85,247,0.22); border:1px solid rgba(168,85,247,0.5); display:flex; align-items:center; justify-content:center; font-size:1.3rem;">🎁</div>
                        <div>
                            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                <h3 style="margin:0; font-size:1.02rem; color:#f8fafc; font-weight:800;">[LDN 8] Combos y Packs Compuestos</h3>
                                <span style="font-size:0.71rem; padding:2px 8px; border-radius:999px; background:rgba(168,85,247,0.2); color:#e9d5ff; border:1px solid rgba(168,85,247,0.4); font-weight:700;">Familia Oficial FAM-COMBOS (CMB)</span>
                            </div>
                            <div style="font-size:0.77rem; color:#cbd5e1; margin-top:2px;">
                                Composición determinista multi-SKU con explosión automática de stock físico al despachar y cascada reactiva ante variaciones de costos hijos.
                            </div>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <button type="button" onclick="window.CombosPizarra.limpiarMesaCombo()"
                            style="padding:7px 12px; border-radius:8px; font-size:0.78rem; font-weight:700; cursor:pointer; border:1px solid #475569; background:#0f172a; color:#e2e8f0;">
                            ✨ Nuevo Combo en Blanco
                        </button>
                        <button type="button" onclick="window.CombosPizarra.inicializar('${esc(targetId || ESTADO_COMBOS.ultimoTargetId)}', true)"
                            style="padding:7px 12px; border-radius:8px; font-size:0.78rem; font-weight:700; cursor:pointer; border:1px solid rgba(56,189,248,0.45); background:rgba(56,189,248,0.14); color:#bae6fd;">
                            🔄 Actualizar
                        </button>
                    </div>
                </div>

                <!-- GRILLA PRINCIPAL: BANDEJA PROPUESTAS + MESA COTIZADORA -->
                <div style="display:grid; grid-template-columns: 360px 1fr; gap:14px; align-items:start;">
                    <!-- COLUMNA IZQUIERDA: BANDEJA DE SOLICITUDES DE TIENDAS + BUSCADOR DE SKUs HIJOS -->
                    <div style="display:flex; flex-direction:column; gap:12px;">
                        <div style="background:#1e293b; border:1px solid #334155; border-radius:12px; padding:12px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <strong style="font-size:0.86rem; color:#f8fafc;">📥 Solicitudes de Tiendas (${pendientes.length})</strong>
                                ${pendientes.length > 0 ? `<span style="font-size:0.7rem; background:#f59e0b; color:#0f172a; font-weight:900; padding:1px 7px; border-radius:999px;">Pendientes</span>` : ''}
                            </div>
                            ${pendientes.length === 0 ? `
                                <div style="padding:12px; border-radius:8px; border:1px dashed #334155; color:#94a3b8; font-size:0.77rem; text-align:center;">
                                    No hay solicitudes de combos pendientes de cotización.
                                </div>
                            ` : `
                                <div style="display:flex; flex-direction:column; gap:8px; max-height:270px; overflow-y:auto;">
                                    ${pendientes.map(pr => {
                                        const activa = Number(ESTADO_COMBOS.propuestaActivaId) === Number(pr.id);
                                        return `
                                            <div data-testid="card-propuesta-combo-${pr.id}" style="padding:10px; border-radius:9px; background:${activa ? 'rgba(168,85,247,0.18)' : '#0f172a'}; border:1px solid ${activa ? '#a855f7' : '#334155'};">
                                                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                                                    <span style="font-family:monospace; font-size:0.74rem; font-weight:900; color:#fcd34d;">${esc(pr.codigo_propuesta)}</span>
                                                    <span style="font-size:0.71rem; padding:1px 7px; border-radius:999px; background:rgba(56,189,248,0.16); color:#7dd3fc; font-weight:700;">${esc(pr.nodo_solicitante_nombre)}</span>
                                                </div>
                                                ${pr.alias_vidriera_sugerido ? `<div style="font-size:0.82rem; font-weight:800; color:#f8fafc; margin-top:4px;">🏪 "${esc(pr.alias_vidriera_sugerido)}"</div>` : ''}
                                                <div style="font-size:0.73rem; color:#cbd5e1; margin-top:4px; line-height:1.35;">
                                                    ${(pr.items || []).map(it => `• <strong>${it.cantidad}x</strong> [${esc(it.componente_articulo_id)}] ${esc(it.nombre_oficial_lamda)}`).join('<br>')}
                                                </div>
                                                ${pr.comentario_gestor ? `<div style="font-size:0.71rem; color:#94a3b8; margin-top:4px;">💬 ${esc(pr.comentario_gestor)}</div>` : ''}
                                                <div style="display:flex; gap:6px; margin-top:8px;">
                                                    <button type="button" data-testid="btn-cargar-prop-combo-${pr.id}"
                                                        onclick="window.CombosPizarra.cargarPropuestaComboEnMesa(${pr.id})"
                                                        style="flex:1; padding:5px 8px; border-radius:6px; font-size:0.74rem; font-weight:800; cursor:pointer; border:1px solid #10b981; background:rgba(16,185,129,0.2); color:#6ee7b7;">
                                                        Cotizar en Mesa →
                                                    </button>
                                                    <button type="button" onclick="window.CombosPizarra.descartarPropuestaCombo(${pr.id})"
                                                        style="padding:5px 8px; border-radius:6px; font-size:0.73rem; font-weight:700; cursor:pointer; border:1px solid rgba(239,68,68,0.45); background:rgba(239,68,68,0.12); color:#fca5a5;">
                                                        ✕
                                                    </button>
                                                </div>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            `}
                        </div>

                        <div style="background:#1e293b; border:1px solid #334155; border-radius:12px; padding:12px;">
                            <strong style="display:block; font-size:0.85rem; color:#f8fafc; margin-bottom:6px;">🔎 Agregar Artículos Hijos al Combo</strong>
                            <input type="text" id="combos-search-elegibles"
                                value="${esc(ESTADO_COMBOS.busquedaArticulos)}"
                                placeholder="Buscar SKU o nombre oficial (ej. GDFX500 BF6)..."
                                oninput="window.CombosPizarra.filtrarElegibles(this.value)"
                                style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #475569; background:#0f172a; color:#f8fafc; font-size:0.8rem; margin-bottom:8px;">
                            <div id="combos-lista-elegibles-box" style="display:flex; flex-direction:column; gap:6px; max-height:360px; overflow-y:auto;">
                                ${renderizarListaElegiblesHtml()}
                            </div>
                        </div>
                    </div>

                    <!-- COLUMNA DERECHA: CONSTRUCTOR Y COTIZADOR DETERMINISTA -->
                    <div style="display:flex; flex-direction:column; gap:14px;">
                        <div style="background:#1e293b; border:1px solid #334155; border-radius:12px; padding:16px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
                                <div style="font-size:0.95rem; font-weight:800; color:#f8fafc;">
                                    ${ESTADO_COMBOS.catalogoEditandoId
                                        ? `✏️ Editando Combo Oficial [${esc(ESTADO_COMBOS.skuEditando)}]`
                                        : ESTADO_COMBOS.propuestaActivaId
                                            ? `🧮 Cotizando Solicitud #${ESTADO_COMBOS.propuestaActivaId}`
                                            : `🧮 Constructor y Cotizador Determinista de Combo`}
                                </div>
                                ${calc.firma ? `<code style="font-size:0.72rem; padding:3px 8px; border-radius:6px; background:#0f172a; color:#c4b5fd; border:1px solid #334155;">Firma: ${esc(calc.firma)}</code>` : ''}
                            </div>

                            <!-- 1. TABLA DE COMPONENTES SELECCIONADOS -->
                            <div style="margin-bottom:14px;">
                                <div style="font-size:0.76rem; font-weight:800; color:#cbd5e1; margin-bottom:6px;">
                                    1. Composición Oficial del Combo (${calc.componentes.length} SKUs hijos):
                                </div>
                                ${calc.componentes.length === 0 ? `
                                    <div style="padding:14px; border-radius:9px; background:#0f172a; border:1px dashed #475569; color:#94a3b8; font-size:0.8rem;">
                                        Elegí 2 o más artículos desde el buscador izquierdo o cargá una solicitud pendiente.
                                    </div>
                                ` : `
                                    <div style="display:flex; flex-direction:column; gap:6px;">
                                        ${calc.componentes.map(c => `
                                            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 10px; border-radius:8px; background:#0f172a; border:1px solid #334155;">
                                                <div style="min-width:0; flex:1;">
                                                    <div style="font-size:0.82rem; font-weight:800; color:#f8fafc;">${esc(c.etiqueta_oficial_lamda)}</div>
                                                    <div style="font-size:0.71rem; color:#94a3b8;">
                                                        Costo elab. unit.: ${fmt(c.costo_unitario)} (sub: <strong>${fmt(c.costo_subtotal)}</strong>)
                                                        · Base Tienda unit.: ${fmt(c.precio_base_unitario)} (sub: <strong>${fmt(c.precio_base_subtotal)}</strong>)
                                                        · Peso: ${fmtKg(c.kilos_subtotal)}
                                                    </div>
                                                </div>
                                                <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                                                    <button type="button" onclick="window.CombosPizarra.agregarQuitarComponente('${esc(c.sku)}', -1)"
                                                        style="width:26px; height:26px; border-radius:6px; border:1px solid #475569; background:#1e293b; color:#f8fafc; font-weight:900; cursor:pointer;">−</button>
                                                    <input type="number" min="1" step="1" value="${c.cantidad}"
                                                        onchange="window.CombosPizarra.fijarCantidadComponente('${esc(c.sku)}', this.value)"
                                                        style="width:48px; text-align:center; padding:4px; border-radius:6px; border:1px solid #475569; background:#0f172a; color:#38bdf8; font-weight:900;">
                                                    <button type="button" onclick="window.CombosPizarra.agregarQuitarComponente('${esc(c.sku)}', 1)"
                                                        style="width:26px; height:26px; border-radius:6px; border:1px solid #475569; background:#1e293b; color:#f8fafc; font-weight:900; cursor:pointer;">+</button>
                                                    <button type="button" onclick="window.CombosPizarra.agregarQuitarComponente('${esc(c.sku)}', -999)"
                                                        title="Quitar componente"
                                                        style="padding:4px 7px; border-radius:6px; border:1px solid rgba(239,68,68,0.4); background:rgba(239,68,68,0.12); color:#fca5a5; font-size:0.74rem; cursor:pointer;">✕</button>
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>
                                `}
                            </div>

                            <!-- 2. IDENTIDAD OFICIAL DICCIONARIO BÚNKER (FAM-COMBOS) -->
                            <div style="display:grid; grid-template-columns: 1.5fr 0.7fr; gap:10px; margin-bottom:12px;">
                                <div>
                                    <label style="display:block; font-size:0.74rem; color:#cbd5e1; font-weight:700; margin-bottom:4px;">2. Definición Oficial en Diccionario Búnker (FAM-COMBOS)</label>
                                    <input type="text" id="combo-definicion-input"
                                        value="${esc(ESTADO_COMBOS.definicionCombo)}"
                                        placeholder="Ej: Desayuno Energético (genera 'Combo Desayuno Energético x ...')"
                                        oninput="window.CombosPizarra.actualizarCampo('definicionCombo', this.value)"
                                        style="width:100%; padding:8px 10px; border-radius:7px; border:1px solid #475569; background:#0f172a; color:#f8fafc; font-size:0.82rem;">
                                </div>
                                <div>
                                    <label style="display:block; font-size:0.74rem; color:#cbd5e1; font-weight:700; margin-bottom:4px;">Sigla SKU (opc.)</label>
                                    <input type="text" id="combo-abrev-input" maxlength="5"
                                        value="${esc(ESTADO_COMBOS.abreviaturaDefinicion)}"
                                        placeholder="Auto (ej. DE)"
                                        oninput="window.CombosPizarra.actualizarCampo('abreviaturaDefinicion', this.value)"
                                        style="width:100%; padding:8px 10px; border-radius:7px; border:1px solid #475569; background:#0f172a; color:#c4b5fd; font-family:monospace; font-size:0.82rem; text-transform:uppercase;">
                                </div>
                            </div>

                            <!-- 3. EMPAQUE ADICIONAL Y MANO DE OBRA DE ARMADO -->
                            <div style="display:grid; grid-template-columns: 1.4fr 0.7fr 1fr; gap:10px; margin-bottom:12px;">
                                <div>
                                    <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Insumo Contenedor / Presentación Extra</label>
                                    <select onchange="window.CombosPizarra.actualizarCampo('insumoEnvaseId', this.value)"
                                        style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.8rem;">
                                        ${envasesOpts}
                                    </select>
                                </div>
                                <div>
                                    <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Segundos Armado</label>
                                    <input type="number" min="0" step="5" value="${ESTADO_COMBOS.segundosArmado}"
                                        oninput="window.CombosPizarra.actualizarCampo('segundosArmado', this.value)"
                                        style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.82rem;">
                                </div>
                                <div>
                                    <label style="display:block; font-size:0.74rem; color:#cbd5e1; margin-bottom:4px;">Tarifa Operario</label>
                                    <select onchange="window.CombosPizarra.actualizarCampo('tarifaColaboradorId', this.value)"
                                        style="width:100%; padding:8px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc; font-size:0.8rem;">
                                        ${tarifasOpts}
                                    </select>
                                </div>
                            </div>

                            <!-- 4. MODO DE CÁLCULO DE COSTO_BASE_LAMDA -->
                            <div style="padding:11px 12px; border-radius:10px; background:rgba(15,23,42,0.85); border:1px solid #334155; margin-bottom:12px;">
                                <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
                                    <button type="button" onclick="window.CombosPizarra.cambiarModoPrecio('COSTO_MAS_MARGEN')"
                                        style="flex:1; min-width:210px; padding:8px 12px; border-radius:8px; font-size:0.79rem; font-weight:800; cursor:pointer; border:1px solid ${ESTADO_COMBOS.modoPrecioCombo === 'COSTO_MAS_MARGEN' ? '#10b981' : '#334155'}; background:${ESTADO_COMBOS.modoPrecioCombo === 'COSTO_MAS_MARGEN' ? 'rgba(16,185,129,0.2)' : '#1e293b'}; color:${ESTADO_COMBOS.modoPrecioCombo === 'COSTO_MAS_MARGEN' ? '#6ee7b7' : '#cbd5e1'};">
                                        🧮 Modo 1: Costo Elaborado Hijos + Margen LAMDA % (Recomendado)
                                    </button>
                                    <button type="button" onclick="window.CombosPizarra.cambiarModoPrecio('SUMA_BASES_HIJOS_AJUSTADA')"
                                        style="flex:1; min-width:210px; padding:8px 12px; border-radius:8px; font-size:0.79rem; font-weight:800; cursor:pointer; border:1px solid ${ESTADO_COMBOS.modoPrecioCombo === 'SUMA_BASES_HIJOS_AJUSTADA' ? '#38bdf8' : '#334155'}; background:${ESTADO_COMBOS.modoPrecioCombo === 'SUMA_BASES_HIJOS_AJUSTADA' ? 'rgba(56,189,248,0.2)' : '#1e293b'}; color:${ESTADO_COMBOS.modoPrecioCombo === 'SUMA_BASES_HIJOS_AJUSTADA' ? '#bae6fd' : '#cbd5e1'};">
                                        🏷️ Modo 2: Suma de Precios Base Hijos ± Ajuste % / Cargo Pack
                                    </button>
                                </div>

                                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap:10px;">
                                    ${ESTADO_COMBOS.modoPrecioCombo === 'COSTO_MAS_MARGEN' ? `
                                        <div>
                                            <label style="display:block; font-size:0.72rem; color:#34d399; font-weight:800; margin-bottom:3px;">Margen LAMDA (%)</label>
                                            <input type="number" step="0.5" value="${ESTADO_COMBOS.margenLamdaPct}"
                                                oninput="window.CombosPizarra.actualizarCampo('margenLamdaPct', this.value)"
                                                style="width:100%; padding:7px; border-radius:7px; border:1px solid #10b981; background:#0f172a; color:#34d399; font-weight:800;">
                                        </div>
                                    ` : `
                                        <div>
                                            <label style="display:block; font-size:0.72rem; color:#7dd3fc; font-weight:800; margin-bottom:3px;">Ajuste Comercial (%)</label>
                                            <input type="number" step="0.5" value="${ESTADO_COMBOS.ajusteComercialPct}"
                                                oninput="window.CombosPizarra.actualizarCampo('ajusteComercialPct', this.value)"
                                                style="width:100%; padding:7px; border-radius:7px; border:1px solid #38bdf8; background:#0f172a; color:#7dd3fc; font-weight:800;">
                                        </div>
                                        <div>
                                            <label style="display:block; font-size:0.72rem; color:#cbd5e1; font-weight:700; margin-bottom:3px;">Cargo Pack ($)</label>
                                            <input type="number" step="10" min="0" value="${ESTADO_COMBOS.cargoPackCombo}"
                                                oninput="window.CombosPizarra.actualizarCampo('cargoPackCombo', this.value)"
                                                style="width:100%; padding:7px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc;">
                                        </div>
                                    `}
                                    <div>
                                        <label style="display:block; font-size:0.72rem; color:#cbd5e1; margin-bottom:3px;">IVA (%)</label>
                                        <select onchange="window.CombosPizarra.actualizarCampo('ivaPct', this.value)"
                                            style="width:100%; padding:7px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc;">
                                            <option value="21" ${Number(ESTADO_COMBOS.ivaPct) === 21 ? 'selected' : ''}>21%</option>
                                            <option value="10.5" ${Number(ESTADO_COMBOS.ivaPct) === 10.5 ? 'selected' : ''}>10.5%</option>
                                            <option value="0" ${Number(ESTADO_COMBOS.ivaPct) === 0 ? 'selected' : ''}>0%</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style="display:block; font-size:0.72rem; color:#cbd5e1; margin-bottom:3px;">IIBB LAMDA (%)</label>
                                        <input type="number" step="0.1" value="${ESTADO_COMBOS.iibbLamdaPct}"
                                            oninput="window.CombosPizarra.actualizarCampo('iibbLamdaPct', this.value)"
                                            style="width:100%; padding:7px; border-radius:7px; border:1px solid #334155; background:#0f172a; color:#f8fafc;">
                                    </div>
                                    <div>
                                        <label style="display:block; font-size:0.72rem; color:#fcd34d; font-weight:700; margin-bottom:3px;">Precio Base Manual ($ opc.)</label>
                                        <input type="number" step="10" min="0" value="${esc(ESTADO_COMBOS.precioManualOverride)}"
                                            placeholder="Auto (${fmt(calc.precioSugerido)})"
                                            oninput="window.CombosPizarra.actualizarCampo('precioManualOverride', this.value)"
                                            style="width:100%; padding:7px; border-radius:7px; border:1px solid rgba(245,158,11,0.5); background:#0f172a; color:#fcd34d; font-weight:800;">
                                    </div>
                                </div>
                            </div>

                            <!-- 5. DESTINOS COMERCIALES: TIENDAS (LISTA 8) + LISTAS MAYORISTAS B2B (1..7) -->
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:12px;">
                                <div style="padding:9px 11px; border-radius:8px; background:#0f172a; border:1px solid #334155;">
                                    <div style="font-size:0.73rem; font-weight:800; color:#6ee7b7; margin-bottom:6px;">🏪 Habilitar en Tiendas (Lista 8):</div>
                                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                        ${ESTADO_COMBOS.nodos_activos.map(n => {
                                            const chk = ESTADO_COMBOS.nodosHabilitadosIds.includes(Number(n.id));
                                            return `
                                                <label style="display:inline-flex; align-items:center; gap:5px; font-size:0.77rem; color:#f8fafc; cursor:pointer;">
                                                    <input type="checkbox" ${chk ? 'checked' : ''} onchange="window.CombosPizarra.toggleNodoDestino(${n.id}, this.checked)">
                                                    <span>${esc(n.nombre_marca)}</span>
                                                </label>
                                            `;
                                        }).join('')}
                                    </div>
                                </div>
                                <div style="padding:9px 11px; border-radius:8px; background:#0f172a; border:1px solid #334155;">
                                    <div style="font-size:0.73rem; font-weight:800; color:#93c5fd; margin-bottom:6px;">🏢 Compartir en Listas Mayoristas B2B (opc.):</div>
                                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                        ${ESTADO_COMBOS.listas_mayoristas.map(l => {
                                            const chk = ESTADO_COMBOS.listasMayoristasIds.includes(Number(l.id));
                                            return `
                                                <label style="display:inline-flex; align-items:center; gap:4px; font-size:0.74rem; color:#cbd5e1; cursor:pointer;">
                                                    <input type="checkbox" ${chk ? 'checked' : ''} onchange="window.CombosPizarra.toggleListaMayorista(${l.id}, this.checked)">
                                                    <span>${esc(l.nombre)}</span>
                                                </label>
                                            `;
                                        }).join('')}
                                    </div>
                                </div>
                            </div>

                            <!-- 6. RADIOGRAFÍA EN VIVO -->
                            <div id="combos-radiografia-live-box" style="margin-bottom:12px;">
                                ${renderizarRadiografiaComboHtml(calc)}
                            </div>

                            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
                                <input type="text" value="${esc(ESTADO_COMBOS.notasTecnicas)}"
                                    placeholder="Nota técnica interna o indicación de armado..."
                                    oninput="window.CombosPizarra.actualizarCampo('notasTecnicas', this.value)"
                                    style="flex:1; min-width:220px; padding:9px 12px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#e2e8f0; font-size:0.8rem;">
                                <button type="button" data-testid="btn-aprobar-combo-lamda"
                                    onclick="window.CombosPizarra.guardarYAprobarCombo()"
                                    style="padding:10px 18px; border-radius:8px; font-weight:900; font-size:0.86rem; cursor:pointer; border:none; background:linear-gradient(135deg, #a855f7, #059669); color:#ffffff; box-shadow:0 4px 14px rgba(168,85,247,0.32);">
                                    🎁 Crear / Aprobar Combo Oficial en LAMDA
                                </button>
                            </div>
                        </div>

                        <!-- LISTADO DE COMBOS ACTIVOS EN CATÁLOGO MAESTRO LAMDA -->
                        <div style="background:#1e293b; border:1px solid #334155; border-radius:12px; padding:14px;">
                            <strong style="display:block; font-size:0.9rem; color:#f8fafc; margin-bottom:10px;">
                                📦 Combos Oficiales Activos en Catálogo LAMDA (${ESTADO_COMBOS.combos.length})
                            </strong>
                            ${ESTADO_COMBOS.combos.length === 0 ? `
                                <div style="padding:16px; border-radius:9px; border:1px dashed #334155; color:#94a3b8; font-size:0.8rem; text-align:center;">
                                    Aún no hay Combos creados en el catálogo maestro. Aprobá una solicitud de tienda o creá uno arriba.
                                </div>
                            ` : `
                                <div style="display:flex; flex-direction:column; gap:8px;">
                                    ${ESTADO_COMBOS.combos.map(c => {
                                        const ev = c.estructura_viva || {};
                                        return `
                                            <div data-testid="row-combo-activo-${esc(c.sku_combo)}" style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; padding:10px 12px; border-radius:9px; background:#0f172a; border:1px solid #334155;">
                                                <div style="min-width:240px; flex:1;">
                                                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                                        <code style="font-weight:900; color:#c4b5fd; background:rgba(168,85,247,0.16); padding:2px 7px; border-radius:5px;">[${esc(c.sku_combo)}]</code>
                                                        <strong style="font-size:0.88rem; color:#f8fafc;">${esc(c.nombre_oficial_lamda)}</strong>
                                                        <span style="font-size:0.71rem; color:#34d399; font-weight:800;">Stock armable: ${c.stock_armable} u.</span>
                                                    </div>
                                                    <div style="font-size:0.74rem; color:#94a3b8; margin-top:4px;">
                                                        ${(c.componentes || []).map(h => `${h.cantidad}x [${esc(h.sku)}] ${esc(h.nombre_oficial_lamda)}`).join(' + ')}
                                                    </div>
                                                    <div style="font-size:0.72rem; color:#cbd5e1; margin-top:3px;">
                                                        Costo Elab.: <strong>${fmt(ev.costo_puro_total)}</strong> · Precio Base: <strong style="color:#6ee7b7;">${fmt(c.precio_base_nodo_final)}</strong> · Utilidad Real post-IIBB: <strong style="color:#38bdf8;">${fmt(ev.utilidad_neta_real_lamda)} (${ev.margen_neto_real_post_iibb_pct}%)</strong>
                                                    </div>
                                                </div>
                                                <button type="button" onclick="window.CombosPizarra.editarComboExistente('${esc(c.sku_combo)}')"
                                                    style="padding:6px 12px; border-radius:7px; font-size:0.76rem; font-weight:800; cursor:pointer; border:1px solid #38bdf8; background:rgba(56,189,248,0.14); color:#bae6fd;">
                                                    ✏️ Editar / Recotizar
                                                </button>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            `}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    window.CombosPizarra = {
        inicializar,
        obtenerEstado: () => ESTADO_COMBOS,
        calcularPreview: calcularPreviewLocalDeterminista,
        aplicarDatosEstado,
        sincronizarBadgesPendientesGlobal,
        renderizarEnContenedor,
        agregarQuitarComponente,
        fijarCantidadComponente,
        cargarPropuestaComboEnMesa,
        editarComboExistente,
        limpiarMesaCombo,
        descartarPropuestaCombo,
        guardarYAprobarCombo,
        cambiarModoPrecio: (modo) => {
            ESTADO_COMBOS.modoPrecioCombo = modo;
            renderizarEnContenedor(ESTADO_COMBOS.ultimoTargetId);
        },
        actualizarCampo: (campo, val) => {
            ESTADO_COMBOS[campo] = val;
            actualizarPanelRadiografiaComboDom();
        },
        filtrarElegibles: (val) => {
            ESTADO_COMBOS.busquedaArticulos = val;
            const box = document.getElementById('combos-lista-elegibles-box');
            if (box) box.innerHTML = renderizarListaElegiblesHtml();
        },
        toggleNodoDestino: (nodoId, checked) => {
            const nid = Number(nodoId);
            if (checked && !ESTADO_COMBOS.nodosHabilitadosIds.includes(nid)) {
                ESTADO_COMBOS.nodosHabilitadosIds.push(nid);
            } else if (!checked) {
                ESTADO_COMBOS.nodosHabilitadosIds = ESTADO_COMBOS.nodosHabilitadosIds.filter(x => x !== nid);
            }
        },
        toggleListaMayorista: (listaId, checked) => {
            const lid = Number(listaId);
            if (checked && !ESTADO_COMBOS.listasMayoristasIds.includes(lid)) {
                ESTADO_COMBOS.listasMayoristasIds.push(lid);
            } else if (!checked) {
                ESTADO_COMBOS.listasMayoristasIds = ESTADO_COMBOS.listasMayoristasIds.filter(x => x !== lid);
            }
        },
        refrescarSiVisible: () => {
            const box8 = document.getElementById('combos-ldn8-container');
            const boxSub = document.getElementById('nodos-combos-subtab-mount');
            if ((box8 && box8.style.display !== 'none') || boxSub) {
                actualizarPanelRadiografiaComboDom();
            }
        }
    };
})();
