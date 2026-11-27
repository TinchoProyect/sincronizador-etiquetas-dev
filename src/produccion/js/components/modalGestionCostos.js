/**
 * MÓDULO PANTALLA COMPLETA: CONCILIACIÓN DE ENTIDADES (PRODUCT MATCHING) CON IA
 * Solapa: [LDN 1] Comercialización Directa sin Receta — Pizarra Inteligente de Costos LAMDA
 * Conexión Concreta con Single Source of Truth: public.bunker_articulos.costo_base
 * Muestra el Costo Actual del Taller en la cabecera y sobrescribe costo_base al impactar.
 */

let articuloIdActualConciliacion = null;
let datosEstadoActualConciliacion = null;
let tagsActivosMemoria = [];
let tagEnEdicionIndex = null;
let criterioOrdenMemoria = 'FECHA';
let excluirCeroMemoria = true;
let opcionesConciliacionActual = {};
let estadoSimulacionPropiaModal = null;
let lotesRenderizadosActuales = [];

function inicializarEstadoSimulacionPropia(capaPropia) {
    if (!capaPropia || !capaPropia.habilitada || capaPropia.tipo_ficha !== 'LDN4_TOSTADERO') {
        estadoSimulacionPropiaModal = null;
        return;
    }
    const p = capaPropia.parametros_iniciales || {};
    estadoSimulacionPropiaModal = {
        up_codigo: capaPropia.up_codigo,
        ap_codigo: capaPropia.ap_codigo,
        crudo_sku: p.crudo_sku || capaPropia.crudo_actual?.sku || '',
        crudo_detalle: capaPropia.crudo_actual || null,
        fuente_costo_crudo: p.fuente_costo_crudo || 'REPO',
        costo_crudo_kg: Number(p.costo_crudo_kg || 0),
        colaborador_id: p.colaborador_id || null,
        servicio_id: p.servicio_id || null,
        tarifa_kg: Number(p.tarifa_kg || 0),
        merma_pct: Number(p.merma_pct ?? capaPropia.merma_promedio ?? 0),
        cargando_crudo: false
    };
}

function calcularValoresVivosPropia(capaPropia) {
    if (!capaPropia || !capaPropia.habilitada) return null;
    if (capaPropia.tipo_ficha === 'LDN4_TOSTADERO') {
        const sim = estadoSimulacionPropiaModal || capaPropia.parametros_iniciales || {};
        const merma = Math.max(0, Math.min(95, parseFloat(sim.merma_pct) || 0));
        const factorRend = 1 - (merma / 100);
        const crudoKg = Math.max(0, parseFloat(sim.costo_crudo_kg) || 0);
        const tarifaKg = Math.max(0, parseFloat(sim.tarifa_kg) || 0);
        const crudoAjustadoRend = factorRend > 0 ? Number((crudoKg / factorRend).toFixed(2)) : 0;
        const costoBaseAp = factorRend > 0 ? Number(((crudoKg / factorRend) + tarifaKg).toFixed(2)) : 0;
        const moAp = Number(capaPropia.mo_ap_kilo || 0);
        const costoIng = Number((costoBaseAp + moAp).toFixed(2));
        return {
            crudoKg,
            tarifaKg,
            merma,
            factorRend,
            crudoAjustadoRend,
            costoBaseAp,
            moAp,
            costoIng,
            costoKiloBadge: costoIng
        };
    }
    if (capaPropia.tipo_ficha === 'LDN2_FRACCIONADO') {
        return {
            costoBultoSinMo: Number(capaPropia.costo_sin_mo_bulto || 0),
            costoBultoConMo: Number(capaPropia.costo_total_elaborado_bulto || 0),
            costoKiloConMo: Number(capaPropia.costo_total_elaborado_kilo || capaPropia.costo_kilo_elaborado || 0),
            costoKiloBadge: Number(capaPropia.costo_total_elaborado_kilo || capaPropia.costo_kilo_elaborado || 0)
        };
    }
    return {
        costoKiloBadge: Number(capaPropia.costo_kilo_elaborado || 0)
    };
}

async function abrirModuloConciliacionIA(articuloId, tagsOpcionales = null, opcionesOver = {}) {
    if (!articuloId) {
        Swal.fire('Atención', 'Debe seleccionar un artículo válido.', 'warning');
        return;
    }

    const optsNorm = (opcionesOver && typeof opcionesOver === 'object') ? opcionesOver : {};
    const esMismoArticuloConservar = Boolean(optsNorm.conservar_tab && articuloIdActualConciliacion === articuloId);

    articuloIdActualConciliacion = articuloId;
    tagEnEdicionIndex = null;
    opcionesConciliacionActual = optsNorm;

    if (optsNorm.tab_inicial) {
        window.tabConciliacionActiva = optsNorm.tab_inicial;
    } else if (!esMismoArticuloConservar) {
        window.tabConciliacionActiva = null;
        estadoSimulacionPropiaModal = null;
    }

    if (window.VigíaPizarra) {
        window.VigíaPizarra.logEvent('CONCILIACION_IA', `🤖 Modal Conciliación IA ABIERTO para SKU [${articuloId}]`, {
            articuloId: articuloId,
            tagsOpcionales: tagsOpcionales,
            opcionesOver: opcionesOver
        });
    }

    if (opcionesOver.criterio_orden) criterioOrdenMemoria = opcionesOver.criterio_orden;
    if (opcionesOver.excluir_cero !== undefined) excluirCeroMemoria = opcionesOver.excluir_cero;

    // 1. Remover overlay previo
    const modalExistente = document.getElementById('modulo-conciliacion-full-screen');
    if (modalExistente) modalExistente.remove();

    // 2. Crear overlay de pantalla completa
    const overlay = document.createElement('div');
    overlay.id = 'modulo-conciliacion-full-screen';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: #0f172a;
        z-index: 999999;
        display: flex;
        flex-direction: column;
        color: #f8fafc;
        font-family: system-ui, -apple-system, sans-serif;
        overflow: hidden;
    `;

    overlay.innerHTML = `
        <!-- HEADER PANTALLA COMPLETA -->
        <div style="background: #1e293b; padding: 10px 20px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
            <div style="display: flex; align-items: center; gap: 12px; flex: 1 1 420px; min-width: 0;">
                <div style="background: linear-gradient(135deg, #6366f1, #0284c7); padding: 7px 10px; border-radius: 8px; font-size: 1.15rem; flex-shrink: 0;">🤖</div>
                <div style="min-width: 0;">
                    <h2 style="margin: 0; font-size: 1.02rem; font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span>Mesa Integrada de Fuentes de Costo y Trazabilidad</span>
                        <span style="font-size: 0.70rem; background: #0284c7; color: white; padding: 2px 8px; border-radius: 12px; white-space: nowrap;">Pizarra Inteligente</span>
                    </h2>
                    <div id="art-target-header-info" style="font-size: 0.80rem; color: #94a3b8; margin-top: 2px;">
                        Cargando información del artículo <strong style="color: #38bdf8;">${articuloId}</strong>...
                    </div>
                </div>
            </div>

            <!-- UNIFIED CONVERSATIONAL BAR WITH AI CHOFER -->
            <div style="display: flex; align-items: center; gap: 8px; flex: 1 1 360px; max-width: 560px;">
                <div style="position: relative; width: 100%; min-width: 170px;">
                    <input type="text" id="input-instruccion-chofer" 
                        placeholder="💬 Instruir al Chofer IA (ej: 'solo bavosi', 'de 22.68kg', 'solo vigentes')..."
                        style="width: 100%; padding: 8px 12px; background: #0f172a; border: 1px solid #0284c7; border-radius: 8px; color: white; font-size: 0.84rem; outline: none; box-shadow: 0 0 10px rgba(2, 132, 199, 0.2);"
                        onkeyup="if(event.key==='Enter') enviarInstruccionChoferIA();" />
                </div>
                <button onclick="enviarInstruccionChoferIA()" style="background: linear-gradient(135deg, #0284c7, #6366f1); color: white; border: none; padding: 8px 13px; border-radius: 8px; font-size: 0.81rem; font-weight: 700; cursor: pointer; white-space: nowrap; box-shadow: 0 2px 8px rgba(2, 132, 199, 0.3);">
                    ⚡ Enviar a Chofer IA
                </button>
                <button onclick="restaurarChoferIA()" title="Restaurar todas las ofertas originales del Chofer IA" style="background: #0f172a; color: #94a3b8; border: 1px solid #475569; padding: 8px 10px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; cursor: pointer; white-space: nowrap;">
                    🔄 Todo
                </button>
            </div>

            <button onclick="cerrarModuloConciliacionIA()" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); padding: 7px 14px; border-radius: 6px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: all 0.2s;">
                ✖️ Cerrar Escenario
            </button>
        </div>

        <!-- CONTENIDO PRINCIPAL -->
        <div style="flex: 1; padding: 16px 26px; overflow-y: auto; background: #0f172a;" id="conciliacion-content-area">
            <div style="display: flex; justify-content: center; align-items: center; height: 300px; flex-direction: column; gap: 16px;">
                <div style="width: 44px; height: 44px; border: 4px solid #38bdf8; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                <div style="color: #cbd5e1; font-size: 0.92rem;">Escaneando Tabla Maestra de Proveedores (3.581+ ofertas vigentes B4.1)...</div>
            </div>
        </div>

        <style>
            .swal2-container { z-index: 1000000 !important; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            .prov-card {
                background: #1e293b;
                border: 1px solid #334155;
                border-radius: 10px;
                padding: 16px;
                transition: all 0.2s;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                box-shadow: 0 2px 6px rgba(0,0,0,0.2);
            }
            .prov-card:hover {
                border-color: #38bdf8;
                transform: translateY(-2px);
                box-shadow: 0 6px 16px rgba(56, 189, 248, 0.15);
            }
            .badge-antiguedad {
                font-size: 0.72rem;
                font-weight: 700;
                padding: 3px 8px;
                border-radius: 6px;
            }
            .badge-antiguedad.ok { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
            .badge-antiguedad.old { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
            .badge-presentacion-destacado {
                background: rgba(14, 165, 233, 0.12);
                color: #38bdf8;
                border: 1.5px solid #0284c7;
                padding: 7px 12px;
                border-radius: 8px;
                font-size: 0.85rem;
                font-weight: 700;
                margin-bottom: 12px;
                display: flex;
                align-items: center;
                gap: 8px;
                box-shadow: 0 2px 6px rgba(0,0,0,0.2);
            }
            .btn-confirm-costo {
                background: #0284c7;
                color: white;
                border: none;
                padding: 8px 14px;
                border-radius: 6px;
                font-weight: 700;
                font-size: 0.82rem;
                cursor: pointer;
                transition: background 0.2s;
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            .btn-confirm-costo:hover { background: #0369a1; }
            
            /* ETIQUETAS VISUALES CON MODO INCLUIR / EXCLUIR Y COLUMNA */
            .tag-tachable-incluir {
                background: rgba(16, 185, 129, 0.15);
                color: #34d399;
                border: 1px solid rgba(16, 185, 129, 0.4);
                padding: 4px 10px;
                border-radius: 8px;
                font-size: 0.82rem;
                font-weight: 700;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.15);
            }
            .tag-tachable-excluir {
                background: rgba(239, 68, 68, 0.15);
                color: #f87171;
                border: 1px solid rgba(239, 68, 68, 0.4);
                padding: 4px 10px;
                border-radius: 8px;
                font-size: 0.82rem;
                font-weight: 700;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.15);
            }
            .tag-col-scope {
                font-size: 0.68rem;
                color: #cbd5e1;
                background: #0f172a;
                padding: 1px 6px;
                border-radius: 4px;
                border: 1px solid #334155;
            }
            .tag-tachable-incluir button, .tag-tachable-excluir button {
                background: none;
                border: none;
                color: inherit;
                cursor: pointer;
                font-weight: bold;
                font-size: 0.85rem;
                padding: 0;
            }
            
            .capa-badge {
                background: #0f172a;
                border: 1px solid #475569;
                color: #cbd5e1;
                padding: 4px 10px;
                border-radius: 6px;
                font-size: 0.75rem;
                font-weight: 600;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }
            .btn-toggle-modo {
                background: #0f172a;
                border: 1px solid #475569;
                color: #94a3b8;
                padding: 3px 8px;
                border-radius: 5px;
                font-size: 0.72rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s;
            }
            .btn-toggle-modo.active {
                background: #0284c7;
                color: white;
                border-color: #38bdf8;
            }
            .btn-toggle-tipo-precio {
                padding: 6px 8px;
                border-radius: 6px;
                font-size: 0.76rem;
                font-weight: 700;
                cursor: pointer;
                border: 1px solid #334155;
                background: #1e293b;
                color: #94a3b8;
                transition: all 0.2s;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 2px;
            }
            .btn-toggle-tipo-precio:hover {
                border-color: #475569;
                color: #f8fafc;
            }
            .btn-toggle-tipo-precio.active-estandar {
                background: rgba(56, 189, 248, 0.18);
                border-color: #38bdf8;
                color: #38bdf8;
                box-shadow: 0 0 8px rgba(56, 189, 248, 0.2);
            }
            .btn-toggle-tipo-precio.active-promo {
                background: rgba(168, 85, 247, 0.22);
                border-color: #c084fc;
                color: #c084fc;
                box-shadow: 0 0 10px rgba(168, 85, 247, 0.25);
            }
            .btn-orden-selector {
                background: #0f172a;
                border: 1px solid #334155;
                color: #94a3b8;
                padding: 5px 10px;
                border-radius: 6px;
                font-size: 0.76rem;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.15s;
                display: inline-flex;
                align-items: center;
                gap: 5px;
            }
            .btn-orden-selector.active {
                background: #0284c7;
                color: white;
                border-color: #38bdf8;
                box-shadow: 0 0 8px rgba(2, 132, 199, 0.4);
            }
            .btn-consolidar-bd {
                background: linear-gradient(135deg, #10b981, #059669);
                color: white;
                border: none;
                padding: 6px 14px;
                border-radius: 6px;
                font-size: 0.78rem;
                font-weight: 700;
                cursor: pointer;
                box-shadow: 0 2px 6px rgba(16, 185, 129, 0.3);
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            .btn-consolidar-bd:hover { background: #059669; }
            .btn-eliminar-bd {
                background: rgba(239, 68, 68, 0.15);
                color: #f87171;
                border: 1px solid rgba(239, 68, 68, 0.3);
                padding: 5px 12px;
                border-radius: 6px;
                font-size: 0.75rem;
                font-weight: 700;
                cursor: pointer;
            }
            .tab-conciliacion-btn {
                background: #1e293b;
                color: #94a3b8;
                border: 1px solid #334155;
                border-bottom: none;
                padding: 11px 20px;
                border-radius: 8px 8px 0 0;
                font-size: 0.88rem;
                font-weight: 700;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: all 0.2s;
            }
            .tab-conciliacion-btn:hover {
                background: #334155;
                color: #f8fafc;
            }
            .tab-conciliacion-btn.active {
                background: #0284c7;
                color: white;
                border-color: #0284c7;
                box-shadow: 0 -2px 10px rgba(2, 132, 199, 0.35);
            }
            .tab-counter-badge {
                background: rgba(0, 0, 0, 0.35);
                color: inherit;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 0.76rem;
                font-weight: 800;
            }
            .tab-conciliacion-btn.active .tab-counter-badge {
                background: rgba(255, 255, 255, 0.25);
                color: white;
            }
            .tab-conciliacion-btn.tab-propia-btn {
                border-color: rgba(16, 185, 129, 0.45);
                color: #6ee7b7;
                background: rgba(16, 185, 129, 0.08);
            }
            .tab-conciliacion-btn.tab-propia-btn:hover {
                background: rgba(16, 185, 129, 0.18);
                color: #ecfdf5;
            }
            .tab-conciliacion-btn.tab-propia-btn.active-propia {
                background: linear-gradient(135deg, #059669, #10b981);
                color: #ffffff;
                border-color: #34d399;
                box-shadow: 0 -2px 12px rgba(16, 185, 129, 0.35);
            }
            .tab-conciliacion-btn.tab-propia-btn.active-propia .tab-counter-badge {
                background: rgba(5, 46, 22, 0.45);
                color: #ecfdf5;
            }
        </style>
    `;

    document.body.appendChild(overlay);

    try {
        const response = await fetch('/api/produccion/conciliacion/articulos/match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                articulo_id: articuloId, 
                filtro_manual: Array.isArray(tagsOpcionales) ? tagsOpcionales : (tagsOpcionales || null),
                criterio_orden: criterioOrdenMemoria,
                excluir_cero: excluirCeroMemoria,
                forzar_refresco: Boolean(opcionesOver && opcionesOver.forzar_refresco)
            })
        });

        const resData = await response.json();
        if (!resData.success) {
            throw new Error(resData.message || 'Error al obtener candidatos');
        }

        datosEstadoActualConciliacion = resData.data;
        if (!esMismoArticuloConservar || !estadoSimulacionPropiaModal) {
            inicializarEstadoSimulacionPropia(datosEstadoActualConciliacion.capa_produccion_propia);
        }
        tagsActivosMemoria = datosEstadoActualConciliacion.articulo_lamda.tags_activos_paso_1 || [];
        renderizarContenidoConciliacion(datosEstadoActualConciliacion);
    } catch (err) {
        console.error('❌ Error en frontend conciliación:', err);
        const contentArea = document.getElementById('conciliacion-content-area');
        if (contentArea) {
            contentArea.innerHTML = `
                <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 8px; padding: 24px; text-align: center; max-width: 600px; margin: 40px auto;">
                    <div style="font-size: 1.8rem; margin-bottom: 8px;">⚠️ Error de Carga</div>
                    <div style="color: #f87171; font-size: 0.95rem;">${err.message}</div>
                    <button onclick="abrirModuloConciliacionIA('${articuloId}')" style="margin-top: 16px; background: #ef4444; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">
                        🔄 Reintentar
                    </button>
                </div>
            `;
        }
    }
}

function tacharEtiqueta(idx) {
    tagsActivosMemoria.splice(idx, 1);
    reprocesarBúsquedaConEtiquetasActivas();
}

function cambiarModoEtiqueta(idx) {
    if (tagsActivosMemoria[idx]) {
        const item = typeof tagsActivosMemoria[idx] === 'object' ? tagsActivosMemoria[idx] : { texto: tagsActivosMemoria[idx], columna: 'DESCRIPCION', modo: 'INCLUIR' };
        item.modo = item.modo === 'EXCLUIR' ? 'INCLUIR' : 'EXCLUIR';
        tagsActivosMemoria[idx] = item;
        reprocesarBúsquedaConEtiquetasActivas();
    }
}

function habilitarEdicionEtiqueta(idx) {
    tagEnEdicionIndex = idx;
    renderizarContenidoConciliacion(datosEstadoActualConciliacion);
    setTimeout(() => {
        const inp = document.getElementById(`input-edit-tag-${idx}`);
        if (inp) inp.focus();
    }, 50);
}

function guardarEdicionEtiqueta(idx) {
    const inp = document.getElementById(`input-edit-tag-${idx}`);
    if (inp) {
        const nuevoVal = inp.value.trim().toLowerCase();
        if (nuevoVal) {
            if (typeof tagsActivosMemoria[idx] === 'object') {
                tagsActivosMemoria[idx].texto = nuevoVal;
            } else {
                tagsActivosMemoria[idx] = { texto: nuevoVal, columna: 'DESCRIPCION', modo: 'INCLUIR' };
            }
        }
    }
    tagEnEdicionIndex = null;
    reprocesarBúsquedaConEtiquetasActivas();
}

function cambiarCriterioOrdenamiento(nuevoCriterio) {
    criterioOrdenMemoria = nuevoCriterio;
    reprocesarBúsquedaConEtiquetasActivas();
}

function toggleExcluirPrecioCero() {
    excluirCeroMemoria = !excluirCeroMemoria;
    reprocesarBúsquedaConEtiquetasActivas();
}

function actualizarPlaceholderInputTag() {
    const sel = document.getElementById('select-col-nuevo-tag');
    const inp = document.getElementById('input-nuevo-tag');
    if (!sel || !inp) return;

    const colVal = sel.value;
    if (colVal === 'CANTIDAD_VALOR') {
        inp.placeholder = 'ej: 10-25 ó < 10';
    } else if (colVal === 'PRECIO') {
        inp.placeholder = 'ej: > 0 ó 1000-5000';
    } else if (colVal === 'CANTIDAD_BULTOS') {
        inp.placeholder = 'ej: 1-10 ó >= 1';
    } else if (colVal === 'UNIDAD') {
        inp.placeholder = 'ej: Kilogramo ó Gramo';
    } else if (colVal === 'RUBRO') {
        inp.placeholder = 'ej: Frutas Desecadas';
    } else if (colVal === 'CODIGO') {
        inp.placeholder = 'ej: SKU o Cód';
    } else {
        inp.placeholder = '+ Tag (ej: pasa)';
    }
}

function agregarNuevaEtiquetaConConfig(modo, columna) {
    const input = document.getElementById('input-nuevo-tag');
    const val = input ? input.value.trim().toLowerCase() : '';
    if (val) {
        tagsActivosMemoria.push({
            texto: val,
            columna: columna || 'DESCRIPCION',
            modo: modo || 'INCLUIR'
        });
        input.value = '';
        reprocesarBúsquedaConEtiquetasActivas();
    }
}

function reprocesarBúsquedaConEtiquetasActivas() {
    if (articuloIdActualConciliacion) {
        abrirModuloConciliacionIA(articuloIdActualConciliacion, tagsActivosMemoria, {
            ...opcionesConciliacionActual,
            criterio_orden: criterioOrdenMemoria,
            excluir_cero: excluirCeroMemoria,
            conservar_tab: true,
            tab_inicial: null
        });
    }
}

async function guardarEstrategiaEnBD() {
    if (!articuloIdActualConciliacion || !datosEstadoActualConciliacion) return;

    try {
        // 1. Si el operador dejó una etiqueta en modo edición sin pulsar el ícono 💾, comitearla automáticamente
        if (tagEnEdicionIndex !== null) {
            const inpEdit = document.getElementById(`input-edit-tag-${tagEnEdicionIndex}`);
            if (inpEdit) {
                const nuevoVal = inpEdit.value.trim().toLowerCase();
                if (nuevoVal) {
                    if (typeof tagsActivosMemoria[tagEnEdicionIndex] === 'object') {
                        tagsActivosMemoria[tagEnEdicionIndex].texto = nuevoVal;
                    } else {
                        tagsActivosMemoria[tagEnEdicionIndex] = { texto: nuevoVal, columna: 'DESCRIPCION', modo: 'INCLUIR' };
                    }
                }
            }
            tagEnEdicionIndex = null;
        }

        // 2. Si el operador escribió un filtro en #input-nuevo-tag y pulsó directo "Consolidar Ruta" sin apretar "+ Incluir", incorporarlo
        const inpNuevo = document.getElementById('input-nuevo-tag');
        const selColNuevo = document.getElementById('select-col-nuevo-tag');
        if (inpNuevo && inpNuevo.value.trim() !== '') {
            const valPendiente = inpNuevo.value.trim().toLowerCase();
            const colPendiente = selColNuevo ? selColNuevo.value : 'DESCRIPCION';
            const yaExiste = tagsActivosMemoria.some(t => {
                const txt = typeof t === 'object' ? t.texto : t;
                const col = typeof t === 'object' ? (t.columna || 'DESCRIPCION') : 'DESCRIPCION';
                return txt === valPendiente && col === colPendiente;
            });
            if (!yaExiste) {
                tagsActivosMemoria.push({
                    texto: valPendiente,
                    columna: colPendiente,
                    modo: 'INCLUIR'
                });
            }
            inpNuevo.value = '';
        }

        Swal.fire({ title: 'Consolidando en BD...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

        const response = await fetch('/api/produccion/conciliacion/articulos/guardar-estrategia', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                articulo_id: articuloIdActualConciliacion,
                tags_consolidados: tagsActivosMemoria,
                historial_capas: datosEstadoActualConciliacion.historial_capas || []
            })
        });

        const resData = await response.json();
        if (!resData.success) throw new Error(resData.message || 'Error al guardar estrategia');

        await abrirModuloConciliacionIA(articuloIdActualConciliacion, null, {
            criterio_orden: criterioOrdenMemoria,
            excluir_cero: excluirCeroMemoria
        });

        Swal.fire('¡Ruta Consolidada!', resData.message, 'success');

    } catch (err) {
        console.error('❌ Error al consolidar estrategia:', err);
        Swal.fire('Error', err.message || 'No se pudo guardar la estrategia.', 'error');
    }
}

async function eliminarEstrategiaDeBD() {
    if (!articuloIdActualConciliacion) return;

    const res = await Swal.fire({
        title: '¿Eliminar Ruta Consolidada?',
        text: 'Se reseteará la ruta guardada en PostgreSQL y el sistema volverá a generar parámetros desde el Nomenclador.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Sí, Eliminar'
    });

    if (!res.isConfirmed) return;

    try {
        const response = await fetch('/api/produccion/conciliacion/articulos/eliminar-estrategia', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articulo_id: articuloIdActualConciliacion })
        });

        const resData = await response.json();
        if (!resData.success) throw new Error(resData.message || 'Error al eliminar estrategia');

        Swal.fire('Ruta Eliminada', resData.message, 'info');
        abrirModuloConciliacionIA(articuloIdActualConciliacion, null);

    } catch (err) {
        console.error('❌ Error al eliminar estrategia:', err);
        Swal.fire('Error', err.message || 'No se pudo eliminar la estrategia.', 'error');
    }
}

async function enviarInstruccionChoferIA() {
    const input = document.getElementById('input-instruccion-chofer');
    const instruccion = input ? input.value.trim() : '';
    
    if (!instruccion || !datosEstadoActualConciliacion) return;

    try {
        const candidatosParaRefinar = (datosEstadoActualConciliacion.capa_chofer_ia && datosEstadoActualConciliacion.capa_chofer_ia.length > 0)
            ? datosEstadoActualConciliacion.capa_chofer_ia
            : [
                ...(datosEstadoActualConciliacion.nivel_1_exacto || []),
                ...(datosEstadoActualConciliacion.nivel_2_sugerencias || [])
            ];

        const response = await fetch('/api/produccion/conciliacion/articulos/refinar-paso', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                articulo_id: articuloIdActualConciliacion,
                candidatos_actuales: candidatosParaRefinar,
                instruccion_operador: instruccion,
                historial_capas: datosEstadoActualConciliacion.historial_capas || []
            })
        });

        const resData = await response.json();
        if (!resData.success) {
            throw new Error(resData.message || 'Error al refinar candidatos con Chofer IA');
        }

        const resRefino = resData.data;
        const candidatosNuevos = resRefino.candidatos_filtrados || [];

        datosEstadoActualConciliacion = {
            ...datosEstadoActualConciliacion,
            capa_chofer_ia: candidatosNuevos,
            historial_capas: resRefino.historial_capas || datosEstadoActualConciliacion.historial_capas
        };

        // Cambiar automáticamente a la pestaña de Chofer IA para visualizar las alternativas refinadas
        window.tabConciliacionActiva = 'CHOFER_IA';

        if (input) input.value = '';
        renderizarContenidoConciliacion(datosEstadoActualConciliacion);

    } catch (err) {
        console.error('❌ Error al comunicarse con Chofer IA:', err);
        Swal.fire('Error', err.message || 'No se pudo procesar la instrucción.', 'error');
    }
}

async function restaurarChoferIA() {
    if (!articuloIdActualConciliacion) return;
    window.tabConciliacionActiva = 'CHOFER_IA';
    await abrirModuloConciliacionIA(articuloIdActualConciliacion, tagsActivosMemoria, {
        ...opcionesConciliacionActual,
        criterio_orden: criterioOrdenMemoria,
        excluir_cero: excluirCeroMemoria
    });
}

async function ejecutarAuditoriaComiteGeminiIA(btn) {
    if (!articuloIdActualConciliacion || !datosEstadoActualConciliacion) return;
    const textoOrig = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Auditando con Gemini IA...';
    }
    try {
        const response = await fetch('/api/produccion/conciliacion/articulos/auditar-ia', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articulo_id: articuloIdActualConciliacion })
        });
        const resData = await response.json();
        if (!resData.success) {
            throw new Error(resData.message || 'No se pudo completar la auditoría con Gemini IA.');
        }
        const audit = resData.data || {};
        datosEstadoActualConciliacion = {
            ...datosEstadoActualConciliacion,
            capa_chofer_ia: Array.isArray(audit.capa_chofer_ia) ? audit.capa_chofer_ia : datosEstadoActualConciliacion.capa_chofer_ia,
            dictamen_gemini_ia: {
                modelo: audit.modelo_ia || 'Gemini Flash',
                veredicto: audit.veredicto_ejecutivo || '',
                alertas: audit.alertas_detectadas || [],
                fecha: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
            }
        };
        window.tabConciliacionActiva = 'CHOFER_IA';
        renderizarContenidoConciliacion(datosEstadoActualConciliacion);
    } catch (err) {
        console.error('❌ Error en auditoría Gemini IA:', err);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = textoOrig || '🧠 Auditar con Comité Gemini IA';
        }
        Swal.fire('Aviso IA Gemini', err.message || 'No se pudo conectar con Gemini IA.', 'warning');
    }
}

function toggleModoPrecioTarjeta(tipoArray, index, nuevoModo) {
    if (!datosEstadoActualConciliacion) return;
    
    let arr = datosEstadoActualConciliacion.nivel_1_exacto;
    if (tipoArray === 'SUGERENCIA') arr = datosEstadoActualConciliacion.nivel_2_sugerencias;
    else if (tipoArray === 'HABITUAL') arr = datosEstadoActualConciliacion.capa_habitual;
    else if (tipoArray === 'CHOFER_IA') arr = datosEstadoActualConciliacion.capa_chofer_ia;
    
    if (arr && arr[index]) {
        arr[index].modo_precio = nuevoModo;
        renderizarContenidoConciliacion(datosEstadoActualConciliacion);
    }
}

function toggleTipoPrecioTarjeta(tipoArray, index, nuevoTipoPrecio) {
    if (!datosEstadoActualConciliacion) return;
    
    let arr = datosEstadoActualConciliacion.nivel_1_exacto;
    if (tipoArray === 'SUGERENCIA') arr = datosEstadoActualConciliacion.nivel_2_sugerencias;
    else if (tipoArray === 'HABITUAL') arr = datosEstadoActualConciliacion.capa_habitual;
    else if (tipoArray === 'CHOFER_IA') arr = datosEstadoActualConciliacion.capa_chofer_ia;
    
    if (arr && arr[index]) {
        arr[index].tipo_precio = nuevoTipoPrecio;
        renderizarContenidoConciliacion(datosEstadoActualConciliacion);
    }
}

window.forzarSincronizacionSupabase = async function(btn) {
    if (!articuloIdActualConciliacion) return;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Sincronizando...';
    }
    try {
        await abrirModuloConciliacionIA(articuloIdActualConciliacion, tagsActivosMemoria, {
            ...opcionesConciliacionActual,
            forzar_refresco: true,
            criterio_orden: criterioOrdenMemoria,
            excluir_cero: excluirCeroMemoria,
            conservar_tab: true,
            tab_inicial: null
        });
    } catch (e) {
        console.error('Error al forzar sincronización con Supabase:', e);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '🔄 Sincronizar Supabase';
        }
    }
};

window.cambiarTabConciliacion = function(tabName) {
    window.tabConciliacionActiva = tabName;
    if (datosEstadoActualConciliacion) {
        renderizarContenidoConciliacion(datosEstadoActualConciliacion);
    }
};

function cerrarModuloConciliacionIA() {
    opcionesConciliacionActual = {};
    const overlay = document.getElementById('modulo-conciliacion-full-screen');
    if (overlay) overlay.remove();
}

function renderizarContenidoConciliacion(data) {
    const art = data.articulo_lamda;
    const totalEscaneadas = data.total_escaneadas || 0;
    const paso1Capturados = data.paso_1_capturados || 0;
    const esConsolidada = art.es_ruta_consolidada_bd || false;
    const provsConteo = data.proveedores_conteo || {};

    // 1. Capa Lotes de Depósito
    const lotesMaster = (window.pizarraSimulacionMaster && Array.isArray(window.pizarraSimulacionMaster.lotes))
        ? window.pizarraSimulacionMaster.lotes
        : [];
    
    const ingVinculado = (window.pizarraSimulacionMaster && Array.isArray(window.pizarraSimulacionMaster.ingredientes))
        ? window.pizarraSimulacionMaster.ingredientes.find(ing => {
            if (art.es_ingrediente && (ing.id === art.ingrediente_id || `ING-${ing.id}` === art.articulo_id)) return true;
            const vinculacionesDirectas = ing.bunker_articulos || [];
            return ing.articulo_vinculado_numero === art.articulo_id || 
                   vinculacionesDirectas.some(b => (b.codigo || b.articulo_id) === art.articulo_id);
        })
        : null;

    const ingIdStr = ingVinculado ? ingVinculado.id.toString() : (art.es_ingrediente ? String(art.ingrediente_id || art.articulo_id.replace(/^ING-?/i, '')) : null);

    const lotesHistoria = (data.capa_lotes && Array.isArray(data.capa_lotes) && data.capa_lotes.length > 0)
        ? data.capa_lotes
        : lotesMaster.filter(l => {
            const dest = (l.destino_id || '').toString();
            return dest === art.articulo_id || (ingIdStr && dest === ingIdStr);
        }).sort((a, b) => new Date(b.fecha_vinculacion || 0) - new Date(a.fecha_vinculacion || 0));
    lotesRenderizadosActuales = lotesHistoria;
    const lotesPendientesCount = lotesHistoria.filter(l => Boolean(l.pendiente_vincular)).length;
    const supabaseEstado = data.supabase_estado || { ok: true, tipo: 'SUPABASE_LIVE', mensaje: null };

    // 2. Capa Proveedor Habitual
    const capaHabitual = data.capa_habitual || [];

    // 3. Capa Operador Manual
    const capaOperadorExactos = (data.capa_operador && data.capa_operador.exactos) || data.nivel_1_exacto || [];
    const capaOperadorSugerencias = (data.capa_operador && data.capa_operador.sugerencias) || data.nivel_2_sugerencias || [];

    // 4. Capa Chofer IA
    const capaChoferIA = data.capa_chofer_ia || [];
    const fichaIA = data.ficha_semantica_ia || {};

    // 5. Capa Determinista de Producción Propia LAMDA (Solo cuando existe vínculo real en BD)
    const capaPropia = (data.capa_produccion_propia && data.capa_produccion_propia.habilitada)
        ? data.capa_produccion_propia
        : null;
    if (capaPropia && capaPropia.tipo_ficha === 'LDN4_TOSTADERO' && (!estadoSimulacionPropiaModal || estadoSimulacionPropiaModal.up_codigo !== capaPropia.up_codigo)) {
        inicializarEstadoSimulacionPropia(capaPropia);
    }
    const valoresPropia = capaPropia ? calcularValoresVivosPropia(capaPropia) : null;
    const mejorRefExterna = obtenerMejorReferenciaExternaModal(data, lotesHistoria);

    // Selección inteligente de pestaña activa por defecto (con resguardo si PRODUCCION_PROPIA no aplica a este SKU)
    if (window.tabConciliacionActiva === 'PRODUCCION_PROPIA' && !capaPropia) {
        window.tabConciliacionActiva = null;
    }
    if (!window.tabConciliacionActiva) {
        if (lotesHistoria.length > 0) window.tabConciliacionActiva = 'LOTES';
        else if (capaHabitual.length > 0) window.tabConciliacionActiva = 'HABITUAL';
        else if (capaOperadorExactos.length > 0) window.tabConciliacionActiva = 'OPERADOR';
        else window.tabConciliacionActiva = 'CHOFER_IA';
    }
    const tabActiva = window.tabConciliacionActiva;

    const costoBaseAct = art.costo_base_actual || 0;
    const costoKiloAct = art.costo_kilo_actual || 0;
    const costoFmt = `$${costoKiloAct.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}/kg ($${costoBaseAct.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}/bulto ${art.kilos_unidad || 1}kg)`;

    const provsStr = Object.keys(provsConteo)
        .map(p => `<span style="background: #0f172a; padding: 2px 7px; border-radius: 6px; border: 1px solid #334155; color: #38bdf8; font-weight: 700;">${p}: ${provsConteo[p]}</span>`)
        .join(' ');

    const headerInfo = document.getElementById('art-target-header-info');
    if (headerInfo) {
        if (art.es_ingrediente) {
            headerInfo.innerHTML = `
                Insumo de Fábrica: <strong style="color: #fbbf24;">[${art.articulo_id}] ${art.descripcion}</strong> 
                | Categoría: <span style="color: #34d399; font-weight: 700;">Insumo Puro (Fábrica / Recetas)</span>
                | 💰 Costo Patrón Actual: <span style="color: #fbbf24; font-weight: 700; background: #0f172a; padding: 2px 8px; border-radius: 6px; border: 1px solid #334155;">$${(costoKiloAct || art.costo_kilo_actual || art.costo_base_actual || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</span>
                <span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; font-weight: 700; border: 1px solid rgba(245, 158, 11, 0.4); margin-left: 6px;">🏭 Materia Prima Sin Oferta Directa</span>
            `;
        } else {
            headerInfo.innerHTML = `
                Artículo: <strong style="color: #38bdf8;">[${art.articulo_id}] ${art.descripcion}</strong> 
                | Familia: <span style="color: #34d399; font-weight: 700;">${art.familia || 'N/D'}</span>
                | 💰 Costo Actual Taller: <span style="color: #fbbf24; font-weight: 700; background: #0f172a; padding: 2px 8px; border-radius: 6px; border: 1px solid #334155;">${costoFmt}</span>
                ${esConsolidada ? `<span style="background: rgba(16, 185, 129, 0.2); color: #34d399; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; font-weight: 700; border: 1px solid rgba(16, 185, 129, 0.3);">⭐ Ruta Consolidada en BD</span>` : ''}
            `;
        }
    }

    const contentArea = document.getElementById('conciliacion-content-area');
    if (!contentArea) return;

    let tabContentHtml = '';

    // =========================================================================
    // CONTENIDO DE CADA PESTAÑA INDEPENDIENTE
    // =========================================================================
    if (tabActiva === 'LOTES') {
        const urlRecepcionLotes = window.LAMDA_RESOLVE_URL
            ? window.LAMDA_RESOLVE_URL('http://localhost:3002/pages/recepcion-lotes.html')
            : '/pages/recepcion-lotes.html';
        const bannerPendientesHtml = lotesPendientesCount > 0 ? `
            <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.45); border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                <div style="font-size: 0.84rem; color: #fde68a; line-height: 1.4;">
                    ⏳ <strong>Hay ${lotesPendientesCount} recepción(es) física(s) ya conformada(s) en depósito (Supabase) pendiente(s) de vincular a stock.</strong><br>
                    <span style="color: #cbd5e1; font-size: 0.78rem;">Podés tomar su costo ahora para la Pizarra de Costos o abrir Recepción de Lotes para asignar los bultos al stock local.</span>
                </div>
                <button type="button" onclick="window.open('${urlRecepcionLotes}', '_blank')" style="background: linear-gradient(135deg, #f59e0b, #d97706); color: #111827; border: none; padding: 7px 14px; border-radius: 6px; font-size: 0.78rem; font-weight: 800; cursor: pointer; white-space: nowrap;">
                    🔗 Ir a Recepción de Lotes ↗
                </button>
            </div>
        ` : '';

        tabContentHtml = `
            <div style="background: rgba(168, 85, 247, 0.03); padding: 18px; border-radius: 12px; border: 1px dashed rgba(168, 85, 247, 0.25);">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <h3 style="margin: 0; font-size: 1.1rem; color: #c084fc; display: flex; align-items: center; gap: 8px;">
                            📦 CAPA 1: Trazabilidad de Depósito (Entradas Físicas por Escáner)
                        </h3>
                        <span style="background: rgba(168, 85, 247, 0.2); color: #c084fc; padding: 2px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: 700;">
                            ${lotesHistoria.length} ${lotesHistoria.length === 1 ? 'lote recepcionado' : 'lotes recepcionados'}
                        </span>
                    </div>
                    <span style="font-size: 0.78rem; color: #94a3b8;">
                        💡 Entradas reales congeladas con costo bruto, proveedor y remito verificados en depósito
                    </span>
                </div>

                ${bannerPendientesHtml}

                ${lotesHistoria.length === 0 ? `
                    <div style="background: #1e293b; border: 1px dashed #475569; padding: 32px; border-radius: 8px; color: #94a3b8; text-align: center; font-size: 0.92rem;">
                        No se encontraron lotes recepcionados en depósito para este insumo.
                    </div>
                ` : `
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(370px, 1fr)); gap: 16px;">
                        ${lotesHistoria.map((lote, idx) => crearTarjetaLote(lote, art.articulo_id, art.kilos_unidad, idx)).join('')}
                    </div>
                `}
            </div>
        `;
    } else if (tabActiva === 'HABITUAL') {
        const hayOfertas = capaHabitual.length > 0;
        const primerOferta = hayOfertas ? capaHabitual[0] : null;
        const v = primerOferta ? primerOferta.variacion_vs_lote : null;

        let bannerVariacionHabitual = '';
        if (v) {
            const esSuba = v.diff_monto > 0;
            const colorVar = esSuba ? '#f87171' : '#34d399';
            const bgVar = esSuba ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)';
            const borderVar = esSuba ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)';
            const signo = esSuba ? '+' : '';
            bannerVariacionHabitual = `
                <div style="background: ${bgVar}; border: 1px solid ${borderVar}; padding: 14px 18px; border-radius: 10px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;">
                    <div>
                        <div style="font-size: 0.90rem; font-weight: 700; color: #f8fafc; margin-bottom: 4px;">
                            🎯 Cotejo Directo de Reposición — Proveedor Habitual: <strong style="color: #38bdf8;">${primerOferta.proveedor_nombre}</strong> (SKU: ${primerOferta.codigo_proveedor})
                        </div>
                        <div style="font-size: 0.80rem; color: #cbd5e1;">
                            Último lote recepcionado: <strong style="color: #38bdf8;">$${v.costo_lote.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong> (Lote #${v.lote_codigo}) ➔ 
                            Lista vigente B4.1: <strong style="color: #fbbf24;">$${v.precio_lista.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <span style="background: ${bgVar}; color: ${colorVar}; padding: 6px 14px; border-radius: 8px; font-weight: 800; font-size: 0.95rem; border: 1px solid ${borderVar};">
                            ${esSuba ? '🔺 Subió' : '🔻 Bajó'} ${signo}${v.diff_pct.toFixed(2)}% (${signo}$${Math.abs(v.diff_monto).toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)
                        </span>
                    </div>
                </div>
            `;
        }

        tabContentHtml = `
            <div style="background: rgba(2, 132, 199, 0.03); padding: 18px; border-radius: 12px; border: 1px dashed rgba(2, 132, 199, 0.25);">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <h3 style="margin: 0; font-size: 1.1rem; color: #38bdf8; display: flex; align-items: center; gap: 8px;">
                            🎯 CAPA 2: Proveedor Habitual (Cotejo Directo de Lista Maestra vs. Último Lote)
                        </h3>
                        <span style="background: rgba(2, 132, 199, 0.2); color: #38bdf8; padding: 2px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: 700;">
                            ${capaHabitual.length} ${capaHabitual.length === 1 ? 'oferta vinculada' : 'ofertas vinculadas'}
                        </span>
                    </div>
                    <span style="font-size: 0.78rem; color: #94a3b8;">
                        💡 Cruce determinista del código del proveedor habitual con su cotización vigente en B4.1
                    </span>
                </div>

                ${bannerVariacionHabitual}

                ${capaHabitual.length === 0 ? `
                    <div style="background: #1e293b; border: 1px dashed #475569; padding: 32px; border-radius: 8px; color: #94a3b8; text-align: center; font-size: 0.92rem;">
                        No se encontró oferta activa en la lista del proveedor habitual para este código en Tabla Maestra B4.1.
                    </div>
                ` : `
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(370px, 1fr)); gap: 16px;">
                        ${capaHabitual.map((item, idx) => crearTarjetaProveedor(item, art.articulo_id, art.kilos_unidad, 'HABITUAL', idx)).join('')}
                    </div>
                `}
            </div>
        `;
    } else if (tabActiva === 'OPERADOR') {
        tabContentHtml = `
            <!-- BANNER DE ETIQUETAS INTERACTIVAS DEL OPERADOR -->
            <div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px 20px; margin-bottom: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
                <div style="font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
                    <span>🛠️ CAPA 3: Mesa Manual del Operador (Filtros Soberanos):</span>
                    ${esConsolidada ? `<button class="btn-eliminar-bd" onclick="eliminarEstrategiaDeBD()">🗑️ Eliminar Ruta Consolidada</button>` : ''}
                </div>

                <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 16px;">
                    ${tagsActivosMemoria.map((t, idx) => {
                        const textStr = typeof t === 'object' ? t.texto : t;
                        const colStr = typeof t === 'object' ? (t.columna || 'DESCRIPCION') : 'DESCRIPCION';
                        const modoStr = typeof t === 'object' ? (t.modo || 'INCLUIR') : 'INCLUIR';
                        const esExcluir = modoStr === 'EXCLUIR';

                        if (tagEnEdicionIndex === idx) {
                            return `
                                <div style="display: inline-flex; align-items: center; gap: 4px;">
                                    <input type="text" id="input-edit-tag-${idx}" value="${textStr}" 
                                        style="width: 90px; padding: 3px 6px; background: #0f172a; border: 1px solid #38bdf8; border-radius: 6px; color: white; font-size: 0.8rem; outline: none;"
                                        onkeyup="if(event.key==='Enter') guardarEdicionEtiqueta(${idx});" />
                                    <button onclick="guardarEdicionEtiqueta(${idx})" style="background: #0284c7; color: white; border: none; padding: 3px 8px; border-radius: 6px; font-size: 0.75rem; cursor: pointer;">
                                        💾
                                    </button>
                                </div>
                            `;
                        }
                        return `
                            <span class="${esExcluir ? 'tag-tachable-excluir' : 'tag-tachable-incluir'}">
                                <span onclick="cambiarModoEtiqueta(${idx})" style="cursor: pointer; font-size: 0.9rem;" title="Haz clic para conmutar entre INCLUIR 🟢 y EXCLUIR 🔴">
                                    ${esExcluir ? '🔴 -' : '🟢 +'}
                                </span>
                                <span onclick="habilitarEdicionEtiqueta(${idx})" style="cursor: pointer;" title="Haz clic para editar">
                                    "${textStr}" ✏️
                                </span>
                                <span class="tag-col-scope">${colStr}</span>
                                <button onclick="tacharEtiqueta(${idx})" title="Eliminar etiqueta">✖</button>
                            </span>
                        `;
                    }).join('')}

                    <!-- BOTONERA DE NUEVA ETIQUETA -->
                    <div style="display: flex; align-items: center; gap: 6px; background: #0f172a; padding: 4px 8px; border-radius: 8px; border: 1px dashed #0284c7;">
                        <input type="text" id="input-nuevo-tag" placeholder="ej: pasa ó 10-25" 
                            style="width: 130px; padding: 4px 8px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; color: white; font-size: 0.78rem; outline: none;"
                            onkeyup="if(event.key==='Enter') agregarNuevaEtiquetaConConfig('INCLUIR', document.getElementById('select-col-nuevo-tag').value);" />

                        <select id="select-col-nuevo-tag" onchange="actualizarPlaceholderInputTag()" style="background: #1e293b; color: #38bdf8; border: 1px solid #334155; padding: 4px 6px; border-radius: 6px; font-size: 0.75rem; outline: none;">
                            <option value="DESCRIPCION">Columna: Descripción</option>
                            <option value="RUBRO">Columna: Rubro</option>
                            <option value="PRECIO">Columna: Precio ($/kg)</option>
                            <option value="UNIDAD">Columna: Unidad de Medida (kg / g)</option>
                            <option value="CANTIDAD_VALOR">Columna: Cantidad Valor (ej: 10-25 ó &lt; 10)</option>
                            <option value="CANTIDAD_BULTOS">Columna: Cantidad Bultos (ej: 1-10)</option>
                            <option value="CODIGO">Columna: Código / SKU</option>
                            <option value="PROVEEDOR">Columna: Proveedor</option>
                        </select>

                        <button onclick="agregarNuevaEtiquetaConConfig('INCLUIR', document.getElementById('select-col-nuevo-tag').value)" 
                            style="background: #10b981; color: white; border: none; padding: 4px 8px; border-radius: 6px; font-size: 0.76rem; font-weight: 700; cursor: pointer;">
                            🟢 + Incluir
                        </button>
                        <button onclick="agregarNuevaEtiquetaConConfig('EXCLUIR', document.getElementById('select-col-nuevo-tag').value)" 
                            style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 6px; font-size: 0.76rem; font-weight: 700; cursor: pointer;">
                            🔴 - Excluir
                        </button>
                    </div>

                    <button onclick="reprocesarBúsquedaConEtiquetasActivas()" 
                        style="background: #0284c7; color: white; border: none; padding: 5px 12px; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">
                        🔄 Reprocesar Búsqueda
                    </button>

                    <button class="btn-consolidar-bd" onclick="guardarEstrategiaEnBD()" title="Guardar permanentemente esta ruta validada en PostgreSQL">
                        💾 Consolidar Ruta de Búsqueda
                    </button>
                </div>

                <!-- CONTROLES DE ORDENAMIENTO -->
                <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center; background: #0f172a; padding: 8px 12px; border-radius: 8px; border: 1px solid #334155;">
                    <span style="font-size: 0.76rem; color: #94a3b8; font-weight: 700;">📊 Criterio de Orden:</span>
                    <button class="btn-orden-selector ${criterioOrdenMemoria === 'FECHA' ? 'active' : ''}" onclick="cambiarCriterioOrdenamiento('FECHA')">
                        🟢 📅 1° Reciencia ➔ 2° Precio
                    </button>
                    <button class="btn-orden-selector ${criterioOrdenMemoria === 'PRECIO' ? 'active' : ''}" onclick="cambiarCriterioOrdenamiento('PRECIO')">
                        💲 💰 1° Menor Precio ➔ 2° Reciencia
                    </button>
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 0.76rem; color: #fbbf24; cursor: pointer; margin-left: auto; font-weight: 700;">
                        <input type="checkbox" id="chk-excluir-cero" ${excluirCeroMemoria ? 'checked' : ''} onchange="toggleExcluirPrecioCero()" style="cursor: pointer; width: 14px; height: 14px; accent-color: #0284c7;" />
                        🚫 Omitir Ofertas sin Precio ($0 / 'A recibir')
                    </label>
                </div>
            </div>

            <!-- RESULTADOS DEL OPERADOR -->
            <div style="margin-bottom: 24px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <h3 style="margin: 0; font-size: 1.1rem; color: #34d399; display: flex; align-items: center; gap: 8px;">
                            🎯 Coincidencias por Filtros del Operador (Tabla Maestra B4.1)
                        </h3>
                        <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; padding: 2px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: 700;">
                            ${capaOperadorExactos.length} ${capaOperadorExactos.length === 1 ? 'oferta' : 'ofertas'}
                        </span>
                    </div>
                </div>

                ${capaOperadorExactos.length === 0 ? `
                    <div style="background: #1e293b; border: 1px dashed #475569; padding: 32px; border-radius: 8px; color: #94a3b8; text-align: center; font-size: 0.92rem;">
                        No se encontraron ofertas con los filtros manuales actuales.
                    </div>
                ` : `
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(370px, 1fr)); gap: 16px;">
                        ${capaOperadorExactos.map((item, idx) => crearTarjetaProveedor(item, art.articulo_id, art.kilos_unidad, 'EXACTO', idx)).join('')}
                    </div>
                `}
            </div>

            ${capaOperadorSugerencias.length > 0 ? `
                <div style="margin-bottom: 24px;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.1rem; color: #fbbf24; display: flex; align-items: center; gap: 8px;">
                        💡 Sugerencias Alternativas de Filtros (${capaOperadorSugerencias.length})
                    </h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(370px, 1fr)); gap: 16px;">
                        ${capaOperadorSugerencias.map((item, idx) => crearTarjetaProveedor(item, art.articulo_id, art.kilos_unidad, 'SUGERENCIA', idx)).join('')}
                    </div>
                </div>
            ` : ''}
        `;
    } else if (tabActiva === 'CHOFER_IA') {
        const entidadStr = (fichaIA.entidad || 'Insumo').toUpperCase();
        const gradoStr = fichaIA.grado || 'Estándar';
        const estadoStr = fichaIA.estado || 'Crudo';
        const empaqueStr = fichaIA.es_target_granel_puro ? 'Granel Puro (Bulto Suelto)' : (fichaIA.es_granel ? 'Bulto Granel >= 5kg' : 'Presentación Regular');
        const calibreTargetStr = fichaIA.calibre_info?.etiqueta_calibre || '';
        const ingVincStr = fichaIA.ingrediente_vinculado_nombre || '';

        let conformacionLabel = '📦 Conformación: Granel Estándar';
        let conformacionBg = 'rgba(56, 189, 248, 0.2)';
        let conformacionColor = '#38bdf8';
        let conformacionBorder = 'rgba(56, 189, 248, 0.3)';

        if (fichaIA.conformacion === 'INDUSTRIA_PARTIDO') {
            conformacionLabel = '🏭 Conformación: Grado Industria / Bakery';
            conformacionBg = 'rgba(251, 146, 60, 0.2)';
            conformacionColor = '#fb923c';
            conformacionBorder = 'rgba(251, 146, 60, 0.4)';
        } else if (fichaIA.conformacion === 'ENTERO_PREMIUM') {
            conformacionLabel = '✨ Conformación: Entero / Premium';
            conformacionBg = 'rgba(192, 132, 252, 0.2)';
            conformacionColor = '#c084fc';
            conformacionBorder = 'rgba(192, 132, 252, 0.4)';
        }

        const bloquesRazonamiento = Array.isArray(fichaIA.bloques_razonamiento) ? fichaIA.bloques_razonamiento : [];

        const itemsConIndice = capaChoferIA.map((item, idx) => ({ item, idx }));
        const itemsNivel1 = itemsConIndice.filter(x => (x.item.prioridad_ia || 1) === 1);
        const itemsNivel2 = itemsConIndice.filter(x => x.item.prioridad_ia === 2);
        const itemsNivel3 = itemsConIndice.filter(x => x.item.prioridad_ia === 3);
        const itemsNivel4 = itemsConIndice.filter(x => x.item.prioridad_ia >= 4);
        const topEntry = itemsNivel1.length > 0 ? itemsNivel1[0] : null;
        const dictamenGemini = data.dictamen_gemini_ia || null;

        let bannerRecomendadaHtml = '';
        if (topEntry && topEntry.item) {
            const topIt = topEntry.item;
            const topKgFmt = topIt.costo_kilo_calculado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const topBultoLamdaFmt = (topIt.costo_kilo_calculado * (parseFloat(art.kilos_unidad) || 1)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const badgeHabTop = topIt.es_proveedor_habitual
                ? `<span style="background: rgba(245, 158, 11, 0.22); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.45); padding: 2px 8px; border-radius: 6px; font-size: 0.74rem; font-weight: 800;">⭐ Proveedor Habitual</span>`
                : '';
            bannerRecomendadaHtml = `
                <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.14), rgba(2, 132, 199, 0.12)); border: 1.5px solid rgba(16, 185, 129, 0.5); border-radius: 12px; padding: 14px 18px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.12);">
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
                            <span style="background: #10b981; color: #052e16; font-weight: 900; font-size: 0.74rem; padding: 2px 9px; border-radius: 6px;">🏆 OFERTA RECOMENDADA #1</span>
                            <strong style="color: #f8fafc; font-size: 0.98rem;">${topIt.proveedor_nombre}</strong>
                            <span style="color: #38bdf8; font-family: monospace; font-size: 0.8rem; font-weight: 700;">[SKU: ${topIt.codigo_proveedor}]</span>
                            ${badgeHabTop}
                            <span style="color: #34d399; font-size: 0.76rem; font-weight: 700;">${topIt.etiqueta_antiguedad || ''}</span>
                        </div>
                        <div style="font-size: 0.85rem; color: #e2e8f0;">
                            <strong>${topIt.descripcion_proveedor}</strong>${topIt.especificacion ? ` • <span style="color:#c084fc;">${topIt.especificacion}</span>` : ''} 
                            • Empaque: <strong style="color:#38bdf8;">${topIt.presentacion_maestra}</strong> 
                            • Costo Reposición: <strong style="color:#34d399; font-size: 0.96rem;">$${topKgFmt}/kg</strong>
                        </div>
                    </div>
                    <button class="btn-confirm-costo" style="background: linear-gradient(135deg, #10b981, #059669); padding: 10px 16px; font-size: 0.84rem;" onclick="seleccionarEImpactarCostoTarjeta('CHOFER_IA', ${topEntry.idx})">
                        ${opcionesConciliacionActual?.ldn4_ap_codigo
                            ? `⚖️ Evaluar en LDN 4 ($${topKgFmt}/kg)`
                            : `✅ Impactar Recomendada ($${topKgFmt}/kg • $${topBultoLamdaFmt}/bulto)`}
                    </button>
                </div>
            `;
        }

        let bannerDictamenGeminiHtml = '';
        if (dictamenGemini && dictamenGemini.veredicto) {
            const alertasHtml = Array.isArray(dictamenGemini.alertas) && dictamenGemini.alertas.length > 0
                ? `<div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">${dictamenGemini.alertas.map(al => `<span style="background: rgba(245, 158, 11, 0.16); color: #fde047; border: 1px solid rgba(245, 158, 11, 0.35); padding: 3px 9px; border-radius: 6px; font-size: 0.75rem; font-weight: 600;">⚠️ ${al}</span>`).join('')}</div>`
                : '';
            bannerDictamenGeminiHtml = `
                <div style="background: rgba(139, 92, 246, 0.12); border: 1px solid rgba(168, 85, 247, 0.45); border-radius: 10px; padding: 14px 18px; margin-bottom: 18px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap; gap: 8px;">
                        <span style="color: #c084fc; font-weight: 800; font-size: 0.88rem;">🧠 Dictamen Verificado por Comité Cognitivo (${dictamenGemini.modelo} • ${dictamenGemini.fecha}):</span>
                        <span style="font-size: 0.73rem; color: #a5b4fc;">Precios 100% deterministas desde Tabla Maestra B4.1</span>
                    </div>
                    <div style="font-size: 0.85rem; color: #f1f5f9; line-height: 1.45;">${dictamenGemini.veredicto}</div>
                    ${alertasHtml}
                </div>
            `;
        }

        tabContentHtml = `
            <!-- INSIGHT Y BLOQUES DE RAZONAMIENTO ESTRUCTURADO DEL CHOFER IA -->
            <div style="background: linear-gradient(135deg, rgba(2, 132, 199, 0.12), rgba(99, 102, 241, 0.12)); border: 1px solid #0284c7; padding: 18px 22px; border-radius: 12px; margin-bottom: 18px; box-shadow: 0 4px 16px rgba(2, 132, 199, 0.15);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: ${bloquesRazonamiento.length > 0 ? '14px' : '0'};">
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px; font-size: 0.98rem; font-weight: 700; color: #38bdf8; margin-bottom: 8px; flex-wrap: wrap;">
                            <span>🧠 Comité de 4 Agentes del Chofer IA (Mercado Completo + Habitual):</span>
                            <span style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; padding: 3px 10px; border-radius: 6px; font-size: 0.76rem; border: 1px solid rgba(56, 189, 248, 0.3);">🌱 Materia Prima: ${entidadStr}</span>
                            ${calibreTargetStr ? `<span style="background: rgba(16, 185, 129, 0.22); color: #34d399; padding: 3px 10px; border-radius: 6px; font-size: 0.76rem; border: 1px solid rgba(16, 185, 129, 0.45); font-weight: 800;">📏 Calibre/Tamaño Objetivo: ${calibreTargetStr}</span>` : ''}
                            ${ingVincStr ? `<span style="background: rgba(99, 102, 241, 0.22); color: #a5b4fc; padding: 3px 10px; border-radius: 6px; font-size: 0.76rem; border: 1px solid rgba(99, 102, 241, 0.45);">🔗 Insumo Fábrica: ${ingVincStr}</span>` : ''}
                            <span style="background: ${conformacionBg}; color: ${conformacionColor}; padding: 3px 10px; border-radius: 6px; font-size: 0.76rem; border: 1px solid ${conformacionBorder}; font-weight: 700;">${conformacionLabel}</span>
                            <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; padding: 3px 10px; border-radius: 6px; font-size: 0.76rem; border: 1px solid rgba(16, 185, 129, 0.3);">🍃 ${estadoStr}</span>
                            <span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; padding: 3px 10px; border-radius: 6px; font-size: 0.76rem; border: 1px solid rgba(245, 158, 11, 0.3);">📦 ${empaqueStr}</span>
                        </div>
                        <div style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.5; max-width: 960px;">
                            💡 <strong>Síntesis de Ordenamiento:</strong>
                            <strong style="color: #34d399;">${itemsNivel1.length} coincidencias fuertes vigentes</strong> en primera línea (incluyendo al Proveedor Habitual si aplica)${itemsNivel2.length > 0 ? `, <strong style="color: #38bdf8;">${itemsNivel2.length} variantes vigentes (otro calibre o caja fraccionada 10x1kg)</strong> en segundo orden` : ''}${itemsNivel3.length > 0 ? `, <strong style="color: #fbbf24;">${itemsNivel3.length} referencias secundarias</strong>` : ''}${itemsNivel4.length > 0 ? ` y <strong style="color: #f87171;">${itemsNivel4.length} ofertas vencidas (> 45 días)</strong> desplazadas al fondo` : ''}.
                        </div>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
                        <button onclick="ejecutarAuditoriaComiteGeminiIA(this)" style="background: linear-gradient(135deg, #7c3aed, #6366f1); color: white; border: 1px solid #a78bfa; padding: 8px 14px; border-radius: 8px; font-size: 0.8rem; font-weight: 800; cursor: pointer; box-shadow: 0 2px 10px rgba(124, 58, 237, 0.35); display: inline-flex; align-items: center; gap: 6px;">
                            🧠 Auditar Ranking con Comité Gemini IA
                        </button>
                        <div style="font-size: 0.72rem; color: #94a3b8; text-align: right;">
                            💬 También podés escribir arriba (ej: <em>"solo bavosi"</em>, <em>"sin villares"</em>)
                        </div>
                    </div>
                </div>

                ${bloquesRazonamiento.length > 0 ? `
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; padding-top: 12px; border-top: 1px solid rgba(56, 189, 248, 0.22);">
                        ${bloquesRazonamiento.map(b => `
                            <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 8px; padding: 10px 12px;">
                                <div style="font-size: 0.73rem; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 4px;">
                                    ${b.icono || '🔹'} ${b.titulo}
                                </div>
                                <div style="font-size: 0.84rem; font-weight: 700; color: #f8fafc; margin-bottom: 4px;">
                                    ${b.valor}
                                </div>
                                <div style="font-size: 0.73rem; color: #94a3b8; line-height: 1.35;">
                                    ${b.explicacion}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>

            ${bannerDictamenGeminiHtml}
            ${bannerRecomendadaHtml}

            <!-- SECCIONES JERÁRQUICAS DE ALTERNATIVAS DE MERCADO -->
            <div style="margin-bottom: 24px;">
                ${capaChoferIA.length === 0 ? `
                    <div style="background: #1e293b; border: 1px dashed #475569; padding: 32px; border-radius: 8px; color: #94a3b8; text-align: center; font-size: 0.92rem;">
                        No se encontraron ofertas alternativas en otros proveedores para este grado y presentación.
                    </div>
                ` : `
                    ${itemsNivel1.length > 0 ? `
                        <div style="margin-bottom: 28px;">
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.35); padding: 10px 16px; border-radius: 10px; flex-wrap: wrap; gap: 8px;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <h3 style="margin: 0; font-size: 1.02rem; color: #34d399; display: flex; align-items: center; gap: 8px;">
                                        🎯 Nivel 1: Coincidencias Fuertes Vigentes (Mismo Producto, Calibre/Tamaño y Granel)
                                    </h3>
                                    <span style="background: rgba(16, 185, 129, 0.25); color: #34d399; padding: 2px 10px; border-radius: 12px; font-size: 0.78rem; font-weight: 800;">
                                        ${itemsNivel1.length} ${itemsNivel1.length === 1 ? 'coincidencia fuerte' : 'coincidencias fuertes'}
                                    </span>
                                </div>
                                <span style="font-size: 0.76rem; color: #a7f3d0; font-weight: 600;">⚡ Prioriza calibre exacto primero, luego tamaño equivalente y menor $/kg</span>
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(370px, 1fr)); gap: 16px;">
                                ${itemsNivel1.map(({ item, idx }) => crearTarjetaProveedor(item, art.articulo_id, art.kilos_unidad, 'CHOFER_IA', idx)).join('')}
                            </div>
                        </div>
                    ` : ''}

                    ${itemsNivel2.length > 0 ? `
                        <div style="margin-bottom: 28px;">
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.3); padding: 10px 16px; border-radius: 10px; flex-wrap: wrap; gap: 8px;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <h3 style="margin: 0; font-size: 0.98rem; color: #38bdf8; display: flex; align-items: center; gap: 8px;">
                                        🔄 Nivel 2: Variantes Vigentes de Calibre, Variedad o Empaque Fraccionado
                                    </h3>
                                    <span style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; padding: 2px 10px; border-radius: 12px; font-size: 0.78rem; font-weight: 800;">
                                        ${itemsNivel2.length} ${itemsNivel2.length === 1 ? 'variante vigente' : 'variantes vigentes'}
                                    </span>
                                </div>
                                <span style="font-size: 0.75rem; color: #94a3b8;">💡 Ej: Otro calibre (9/11, 11/13), caja subdividida en paquetes de 1kg (10 x 1kg) o proceso alternativo</span>
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(370px, 1fr)); gap: 16px;">
                                ${itemsNivel2.map(({ item, idx }) => crearTarjetaProveedor(item, art.articulo_id, art.kilos_unidad, 'CHOFER_IA', idx)).join('')}
                            </div>
                        </div>
                    ` : ''}

                    ${itemsNivel3.length > 0 ? `
                        <div style="margin-top: 16px; margin-bottom: 28px; border-top: 1px dashed #334155; padding-top: 20px;">
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; background: rgba(245, 158, 11, 0.07); border: 1px dashed rgba(245, 158, 11, 0.35); padding: 10px 16px; border-radius: 10px; flex-wrap: wrap; gap: 8px;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <h3 style="margin: 0; font-size: 0.95rem; color: #fbbf24; display: flex; align-items: center; gap: 8px;">
                                        🌾 Nivel 3: Referencias Secundarias (Otra Conformación / Materia Prima Cruda)
                                    </h3>
                                    <span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; padding: 2px 10px; border-radius: 12px; font-size: 0.76rem; font-weight: 800;">
                                        ${itemsNivel3.length} ${itemsNivel3.length === 1 ? 'referencia secundaria' : 'referencias secundarias'}
                                    </span>
                                </div>
                                <span style="font-size: 0.75rem; color: #94a3b8;">🌾 Insumo en estado crudo o grado industria/partido para referencia de base</span>
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(370px, 1fr)); gap: 16px; opacity: 0.92;">
                                ${itemsNivel3.map(({ item, idx }) => crearTarjetaProveedor(item, art.articulo_id, art.kilos_unidad, 'CHOFER_IA', idx)).join('')}
                            </div>
                        </div>
                    ` : ''}

                    ${itemsNivel4.length > 0 ? `
                        <div style="margin-top: 18px; border-top: 1px dashed rgba(239, 68, 68, 0.35); padding-top: 20px;">
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; background: rgba(239, 68, 68, 0.08); border: 1px dashed rgba(239, 68, 68, 0.35); padding: 10px 16px; border-radius: 10px; flex-wrap: wrap; gap: 8px;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <h3 style="margin: 0; font-size: 0.95rem; color: #f87171; display: flex; align-items: center; gap: 8px;">
                                        ⏳ Nivel 4: Ofertas Vencidas / Desactualizadas (&gt; 45 días — Referencia Histórica)
                                    </h3>
                                    <span style="background: rgba(239, 68, 68, 0.2); color: #f87171; padding: 2px 10px; border-radius: 12px; font-size: 0.76rem; font-weight: 800;">
                                        ${itemsNivel4.length} ${itemsNivel4.length === 1 ? 'oferta vencida' : 'ofertas vencidas'}
                                    </span>
                                </div>
                                <span style="font-size: 0.75rem; color: #fca5a5;">⏳ Conservadas al fondo como referencia histórica sin contaminar las ofertas vigentes</span>
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(370px, 1fr)); gap: 16px; opacity: 0.78;">
                                ${itemsNivel4.map(({ item, idx }) => crearTarjetaProveedor(item, art.articulo_id, art.kilos_unidad, 'CHOFER_IA', idx)).join('')}
                            </div>
                        </div>
                    ` : ''}
                `}
            </div>
        `;
    } else if (tabActiva === 'PRODUCCION_PROPIA' && capaPropia) {
        tabContentHtml = construirHtmlTabProduccionPropia(capaPropia, art, valoresPropia, mejorRefExterna);
    }

    const bannerPuenteSolapa5EnTabsExternas = (capaPropia && valoresPropia && tabActiva !== 'PRODUCCION_PROPIA') ? `
        <div style="margin-bottom: 16px; padding: 10px 16px; border-radius: 10px; background: linear-gradient(90deg, rgba(16, 185, 129, 0.12), rgba(15, 23, 42, 0.85)); border: 1px solid rgba(16, 185, 129, 0.38); display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
            <div style="font-size: 0.82rem; color: #d1fae5; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span style="background: rgba(16, 185, 129, 0.22); color: #34d399; padding: 2px 8px; border-radius: 6px; font-weight: 800; font-size: 0.74rem;">🏭 COMPARATIVA INTERNA ACTIVA</span>
                <span>Elaborar / fraccionar este producto en LAMDA cuesta hoy <strong style="color: #34d399; font-size: 0.92rem;">$${valoresPropia.costoKiloBadge.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong>${capaPropia.tipo_ficha === 'LDN2_FRACCIONADO' ? ` <span style="color:#94a3b8;">($${valoresPropia.costoBultoConMo.toLocaleString('es-AR', {minimumFractionDigits: 2})}/bulto ${capaPropia.kilos_unidad}kg)</span>` : ''}.</span>
            </div>
            <button type="button" onclick="cambiarTabConciliacion('PRODUCCION_PROPIA')" style="background: rgba(16, 185, 129, 0.22); color: #6ee7b7; border: 1px solid rgba(52, 211, 153, 0.55); padding: 5px 12px; border-radius: 6px; font-size: 0.77rem; font-weight: 800; cursor: pointer;">
                Abrir ${capaPropia.etiqueta_pestana || '🏭 5. Producción Propia'} →
            </button>
        </div>
    ` : '';

    const alertaSupabaseHtml = (!supabaseEstado.ok) ? `
        <div style="margin-bottom: 14px; padding: 11px 16px; border-radius: 8px; background: ${supabaseEstado.tipo === 'AUTH_ERROR' ? 'rgba(239, 68, 68, 0.14)' : 'rgba(245, 158, 11, 0.14)'}; border: 1px solid ${supabaseEstado.tipo === 'AUTH_ERROR' ? '#ef4444' : '#f59e0b'}; color: ${supabaseEstado.tipo === 'AUTH_ERROR' ? '#fecaca' : '#fde68a'}; font-size: 0.82rem; font-weight: 600; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
            <span>${supabaseEstado.tipo === 'AUTH_ERROR' ? '🔒' : '⚠️'} <strong>${supabaseEstado.tipo === 'AUTH_ERROR' ? 'Error de Autenticación con Supabase:' : 'Aviso de Contingencia Supabase:'}</strong> ${supabaseEstado.mensaje || 'No se pudo consultar la nube de Proveedores.'}</span>
        </div>
    ` : '';

    contentArea.innerHTML = `
        ${alertaSupabaseHtml}
        <!-- RESUMEN DE FLUJOS Y CONTADORES METRICOS -->
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; background: #1e293b; padding: 10px 16px; border-radius: 8px; border: 1px solid #334155;">
            <div style="display: flex; align-items: center; gap: 12px; font-size: 0.8rem; color: #94a3b8;">
                <span>Escaneadas B4.1: <strong style="color: #38bdf8;">${totalEscaneadas.toLocaleString('es-AR')}</strong></span>
                <span>•</span>
                <span>Proveedores en Resultados: <strong style="color: #cbd5e1;">${provsStr || 'Ninguno'}</strong></span>
            </div>
            <div style="font-size: 0.76rem; color: #a78bfa; display: flex; align-items: center; gap: 10px;">
                <span>⚡ Arquitectura de ${capaPropia ? '5 Capas: Depósito • Habitual • Operador • Chofer IA • Producción Propia' : '4 Capas: Depósito • Habitual • Operador • Chofer IA'}</span>
                <button id="btn-sync-supa" onclick="forzarSincronizacionSupabase(this)" style="background: rgba(56, 189, 248, 0.14); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); padding: 3px 10px; border-radius: 6px; font-size: 0.74rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: all 0.2s;" title="Reconsultar inmediatamente Supabase para traer especificaciones y precios recién editados">
                    🔄 Sincronizar Supabase
                </button>
            </div>
        </div>

        <!-- NAVEGACIÓN POR PESTAÑAS (TABS) -->
        <div style="display: flex; gap: 8px; border-bottom: 2px solid #334155; margin-bottom: 18px; overflow-x: auto;">
            <button class="tab-conciliacion-btn ${tabActiva === 'LOTES' ? 'active' : ''}" onclick="cambiarTabConciliacion('LOTES')">
                📦 1. Lotes de Depósito <span class="tab-counter-badge">${lotesHistoria.length}</span>${lotesPendientesCount > 0 ? `<span style="background: rgba(245, 158, 11, 0.28); color: #fde68a; border: 1px solid rgba(245, 158, 11, 0.55); padding: 1px 7px; border-radius: 10px; font-size: 0.7rem; font-weight: 800;">+${lotesPendientesCount} pend.</span>` : ''}
            </button>
            <button class="tab-conciliacion-btn ${tabActiva === 'HABITUAL' ? 'active' : ''}" onclick="cambiarTabConciliacion('HABITUAL')">
                🎯 2. Proveedor Habitual <span class="tab-counter-badge">${capaHabitual.length}</span>
            </button>
            <button class="tab-conciliacion-btn ${tabActiva === 'OPERADOR' ? 'active' : ''}" onclick="cambiarTabConciliacion('OPERADOR')">
                🛠️ 3. Filtros del Operador <span class="tab-counter-badge">${capaOperadorExactos.length + capaOperadorSugerencias.length}</span>
            </button>
            <button class="tab-conciliacion-btn ${tabActiva === 'CHOFER_IA' ? 'active' : ''}" onclick="cambiarTabConciliacion('CHOFER_IA')">
                🤖 4. Chofer IA: Mercado <span class="tab-counter-badge">${capaChoferIA.length}</span>
            </button>
            ${capaPropia && valoresPropia ? `
            <button class="tab-conciliacion-btn tab-propia-btn ${tabActiva === 'PRODUCCION_PROPIA' ? 'active-propia' : ''}" onclick="cambiarTabConciliacion('PRODUCCION_PROPIA')">
                ${capaPropia.etiqueta_pestana || '🏭 5. Producción Propia'}
                <span class="tab-counter-badge">$${valoresPropia.costoKiloBadge.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</span>
            </button>
            ` : ''}
        </div>

        ${bannerPuenteSolapa5EnTabsExternas}

        <!-- CONTENEDOR DE LA PESTAÑA ACTIVA -->
        ${tabContentHtml}
    `;
}

function crearTarjetaProveedor(item, articuloId, kilosUnidadArt, tipoArray, index) {
    const modoActual = item.modo_precio || 'KILO';
    const tipoPrecioActual = item.tipo_precio || 'ESTANDAR'; // 'ESTANDAR' o 'PROMO'
    const tienePromo = Boolean(item.tiene_promo && item.precio_promo_kilo > 0);

    // Precio base según el tipo de precio seleccionado (ESTANDAR vs PROMO)
    const precioKiloBase = (tipoPrecioActual === 'PROMO' && tienePromo)
        ? item.precio_promo_kilo
        : item.costo_kilo_calculado;

    const precioBultoBase = (tipoPrecioActual === 'PROMO' && tienePromo)
        ? (item.precio_promo_bulto || (item.precio_promo_kilo * (item.kilos_empaque || 1)))
        : item.precio_costo_bulto;

    let costoKiloFinal = 0;
    let costoBultoFinal = 0;

    if (modoActual === 'KILO') {
        costoKiloFinal = precioKiloBase;
        costoBultoFinal = costoKiloFinal * (kilosUnidadArt || 1);
    } else {
        costoBultoFinal = precioBultoBase;
        costoKiloFinal = item.kilos_empaque > 0 ? (costoBultoFinal / item.kilos_empaque) : costoBultoFinal;
    }

    const badgeClass = item.es_antigua ? 'badge-antiguedad old' : 'badge-antiguedad ok';
    
    const provNombreClean = (item.proveedor_nombre || '').replace(/'/g, "\\'");
    const codClean = (item.codigo_proveedor || '').replace(/'/g, "\\'");
    const descClean = (item.descripcion_proveedor || '').replace(/'/g, "\\'");
    const justifExtra = (tipoPrecioActual === 'PROMO' && tienePromo) ? ' [PRECIO PROMOCIONAL SELECCIONADO]' : '';
    const justifClean = ((item.justificacion || '') + justifExtra).replace(/'/g, "\\'");
    const presentacionStr = item.presentacion_maestra || `${item.cantidad_bultos || 1} x ${item.kilos_empaque} ${item.unidad_medida || 'kg'}`;

    // Bloque interactivo de Selección de Precio Estándar vs Promocional
    let htmlPromoSelector = '';
    if (tienePromo) {
        const ahorroKilo = item.costo_kilo_calculado - item.precio_promo_kilo;
        const ahorroPct = item.costo_kilo_calculado > 0 ? ((ahorroKilo / item.costo_kilo_calculado) * 100).toFixed(1) : 0;
        const ahorroBadge = ahorroKilo > 0
            ? `<span style="font-size: 0.68rem; background: rgba(168, 85, 247, 0.25); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); padding: 1px 6px; border-radius: 4px; font-weight: 700;">🔥 -${ahorroPct}% (-$${ahorroKilo.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)</span>`
            : `<span style="font-size: 0.68rem; background: rgba(168, 85, 247, 0.25); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); padding: 1px 6px; border-radius: 4px; font-weight: 700;">🔥 Opción Promo</span>`;

        htmlPromoSelector = `
            <!-- SELECTOR DUAL PRECIO ESTÁNDAR VS PROMOCIONAL -->
            <div style="background: #0f172a; padding: 6px 8px; border-radius: 6px; border: 1px solid ${tipoPrecioActual === 'PROMO' ? '#a855f7' : '#334155'}; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <span style="font-size: 0.72rem; color: #94a3b8; font-weight: 600;">Opciones de Precio Tabla Maestra:</span>
                    ${ahorroBadge}
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                    <button type="button" 
                        class="btn-toggle-tipo-precio ${tipoPrecioActual === 'ESTANDAR' ? 'active-estandar' : ''}" 
                        onclick="toggleTipoPrecioTarjeta('${tipoArray}', ${index}, 'ESTANDAR')"
                        title="Seleccionar Precio Estándar / Lista">
                        <span>🏷️ Precio Estándar</span>
                        <span style="font-size: 0.85rem; font-weight: 800; color: ${tipoPrecioActual === 'ESTANDAR' ? '#38bdf8' : '#ffffff'};">$${item.costo_kilo_calculado.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</span>
                    </button>
                    <button type="button" 
                        class="btn-toggle-tipo-precio ${tipoPrecioActual === 'PROMO' ? 'active-promo' : ''}" 
                        onclick="toggleTipoPrecioTarjeta('${tipoArray}', ${index}, 'PROMO')"
                        title="Seleccionar Precio Promocional / Oferta Especial">
                        <span>🔥 Precio Promo</span>
                        <span style="font-size: 0.85rem; font-weight: 800; color: ${tipoPrecioActual === 'PROMO' ? '#f472b6' : '#c084fc'};">$${item.precio_promo_kilo.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</span>
                    </button>
                </div>
            </div>
        `;
    }

    // Bloque de Cotejo vs. Último Lote Entrante (si está presente en item.variacion_vs_lote)
    let htmlVariacionLote = '';
    if (item.variacion_vs_lote) {
        const v = item.variacion_vs_lote;
        const esSuba = v.diff_monto > 0.01;
        const esBaja = v.diff_monto < -0.01;
        const colorVar = esSuba ? '#f87171' : (esBaja ? '#34d399' : '#94a3b8');
        const bgVar = esSuba ? 'rgba(239, 68, 68, 0.12)' : (esBaja ? 'rgba(16, 185, 129, 0.12)' : 'rgba(148, 163, 184, 0.1)');
        const borderVar = esSuba ? 'rgba(239, 68, 68, 0.3)' : (esBaja ? 'rgba(16, 185, 129, 0.3)' : 'rgba(148, 163, 184, 0.2)');
        const signo = esSuba ? '+' : '';
        const icono = esSuba ? '🔺 Subió' : (esBaja ? '🔻 Bajó' : '⚖️ Mismo precio');

        htmlVariacionLote = `
            <div style="background: ${bgVar}; border: 1px solid ${borderVar}; border-radius: 8px; padding: 8px 12px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="font-size: 0.72rem; color: #cbd5e1; font-weight: 700;">⚖️ Cotejo vs. Último Lote Entrante:</span>
                    <span style="font-size: 0.78rem; font-weight: 800; color: ${colorVar};">
                        ${icono} ${signo}${v.diff_pct.toFixed(2)}% (${signo}$${Math.abs(v.diff_monto).toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)
                    </span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: #94a3b8;">
                    <span>Lote #${v.lote_codigo || ''}${v.remito ? ' (Rem: ' + v.remito + ')' : ''}: <strong style="color: #38bdf8;">$${v.costo_lote.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong></span>
                    <span>Lista B4.1: <strong style="color: #fbbf24;">$${v.precio_lista.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong></span>
                </div>
            </div>
        `;
    }

    return `
        <div class="prov-card" style="${item.es_recomendada_top ? 'border: 1.5px solid #10b981; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.18);' : ''}">
            <div>
                <!-- CABECERA TARJETA: PROVEEDOR Y RECIENCIA -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; gap: 6px;">
                    <div>
                        <div style="font-weight: 700; color: #f8fafc; font-size: 0.95rem; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span>${item.proveedor_nombre}</span>
                            ${item.es_recomendada_top ? `<span style="background: #10b981; color: #052e16; font-size: 0.67rem; font-weight: 900; padding: 1px 6px; border-radius: 4px;">🏆 #1</span>` : ''}
                            ${item.es_proveedor_habitual ? `<span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.45); font-size: 0.68rem; font-weight: 800; padding: 1px 6px; border-radius: 4px;">⭐ Habitual</span>` : ''}
                        </div>
                        <div style="font-size: 0.75rem; color: #38bdf8; font-family: monospace; font-weight: 700;">Cód SKU: ${item.codigo_proveedor}</div>
                    </div>
                    <span class="${badgeClass}">${item.etiqueta_antiguedad}</span>
                </div>

                <!-- DESCRIPCIÓN DE LA OFERTA -->
                <div style="font-size: 0.88rem; color: #cbd5e1; margin-bottom: 8px; line-height: 1.35; font-weight: 500;">
                    ${item.descripcion_proveedor}
                    ${item.especificacion ? `<span style="color: #c084fc; font-weight: 700; margin-left: 6px; background: rgba(168, 85, 247, 0.15); padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(168, 85, 247, 0.3);">[🔬 ${item.especificacion}]</span>` : ''}
                </div>

                <!-- BADGE VISUAL PROMINENTE DE PRESENTACIÓN EN TABLA MAESTRA -->
                <div class="badge-presentacion-destacado" style="display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <div style="display: inline-flex; align-items: center; gap: 6px;">
                        <span>📦 Presentación Tabla Maestra:</span>
                        <span style="color: #ffffff; background: #0f172a; padding: 2px 8px; border-radius: 6px; border: 1px solid #334155; font-size: 0.82rem;">${presentacionStr}</span>
                    </div>
                    ${precioBultoBase > 0 ? `<span style="color: #94a3b8; font-size: 0.76rem; font-weight: 600;">Valor Bulto Prov. (${item.kilos_empaque || 1}${item.unidad_medida || 'kg'}): <strong style="color: #e2e8f0;">$${precioBultoBase.toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong></span>` : ''}
                </div>

                <!-- BADGES METADATOS COMPLEMENTARIOS (CONFORMACIÓN, ESPECIFICACIÓN, REGLA, IVA, MARCA, PAIS) -->
                ${(item.conformacion_badge || item.especificacion || item.regla || (item.iva && item.iva !== 'Sin IVA') || item.marca || item.pais_origen) ? `
                    <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;">
                        ${item.conformacion_badge ? `
                            <span style="background: ${item.conformacion_match === 'MATCH_DIRECTO' ? 'rgba(16, 185, 129, 0.2)' : (item.conformacion_match === 'GRADO_SUPERIOR' ? 'rgba(168, 85, 247, 0.2)' : (item.conformacion_match === 'OFERTA_VENCIDA' ? 'rgba(239, 68, 68, 0.18)' : (item.conformacion_match === 'REFERENCIA_CRUDO' ? 'rgba(245, 158, 11, 0.16)' : 'rgba(56, 189, 248, 0.2)')))}; color: ${item.conformacion_match === 'MATCH_DIRECTO' ? '#34d399' : (item.conformacion_match === 'GRADO_SUPERIOR' ? '#c084fc' : (item.conformacion_match === 'OFERTA_VENCIDA' ? '#f87171' : (item.conformacion_match === 'REFERENCIA_CRUDO' ? '#fbbf24' : '#38bdf8')))}; border: 1px solid ${item.conformacion_match === 'MATCH_DIRECTO' ? 'rgba(16, 185, 129, 0.4)' : (item.conformacion_match === 'GRADO_SUPERIOR' ? 'rgba(168, 85, 247, 0.4)' : (item.conformacion_match === 'OFERTA_VENCIDA' ? 'rgba(239, 68, 68, 0.4)' : (item.conformacion_match === 'REFERENCIA_CRUDO' ? 'rgba(245, 158, 11, 0.35)' : 'rgba(56, 189, 248, 0.35)')))}; padding: 3px 8px; border-radius: 6px; font-size: 0.76rem; font-weight: 800; display: inline-flex; align-items: center; gap: 5px;">
                                ${item.conformacion_badge}
                            </span>
                        ` : ''}
                        ${item.especificacion ? `
                            <span style="background: rgba(168, 85, 247, 0.22); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.5); padding: 3px 8px; border-radius: 6px; font-size: 0.76rem; font-weight: 800; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 1px 4px rgba(168,85,247,0.15);">
                                🔬 ${item.especificacion}
                            </span>
                        ` : ''}
                        ${item.regla ? `<span style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">📜 ${item.regla}</span>` : ''}
                        ${item.iva && item.iva !== 'Sin IVA' ? `<span style="background: #0f172a; color: #94a3b8; border: 1px solid #334155; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem;">IVA: ${item.iva}</span>` : ''}
                        ${item.marca ? `<span style="background: #0f172a; color: #38bdf8; border: 1px solid #334155; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem;">🏷️ ${item.marca}</span>` : ''}
                        ${item.pais_origen ? `<span style="background: #0f172a; color: #cbd5e1; border: 1px solid #334155; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem;">🌍 ${item.pais_origen}</span>` : ''}
                    </div>
                ` : ''}

                ${htmlVariacionLote}

                ${htmlPromoSelector}

                <!-- CONMUTADOR INTERACTIVO $/KG VS $/BULTO -->
                <div style="background: #0f172a; padding: 6px 10px; border-radius: 6px; border: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <span style="font-size: 0.72rem; color: #94a3b8;">Interpretación de Precio:</span>
                    <div style="display: flex; gap: 4px;">
                        <button class="btn-toggle-modo ${modoActual === 'KILO' ? 'active' : ''}" 
                            onclick="toggleModoPrecioTarjeta('${tipoArray}', ${index}, 'KILO')">
                            $/kg (Default)
                        </button>
                        <button class="btn-toggle-modo ${modoActual === 'BULTO' ? 'active' : ''}" 
                            onclick="toggleModoPrecioTarjeta('${tipoArray}', ${index}, 'BULTO')">
                            $/bulto
                        </button>
                    </div>
                </div>

                <!-- JUSTIFICACIÓN DETERMINISTA -->
                <div style="background: rgba(15, 23, 42, 0.6); padding: 8px 10px; border-radius: 6px; border-left: 3px solid ${item.conformacion_match === 'MATCH_DIRECTO' ? '#34d399' : (item.conformacion_match === 'GRADO_SUPERIOR' ? '#c084fc' : (item.conformacion_match === 'OFERTA_VENCIDA' ? '#f87171' : (item.conformacion_match === 'REFERENCIA_CRUDO' ? '#fbbf24' : (item.nivel === 'MATCH_EXACTO' ? '#34d399' : (tipoArray === 'CHOFER_IA' ? '#38bdf8' : '#fbbf24')))))}; font-size: 0.78rem; color: #cbd5e1; margin-bottom: 14px;">
                    ${item.justificacion || (item.especificacion ? `🔬 Especificación Técnica: ${item.especificacion} • Alternativa a $${costoKiloFinal.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg.` : (tipoArray === 'CHOFER_IA' ? `🤖 Alternativa de Mercado: ${presentacionStr} a $${costoKiloFinal.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg.` : '🎯 Coincidencia de filtros de búsqueda.'))}
                </div>

            </div>

            <!-- FOOTER CON VALORES RECALCULADOS Y BOTÓN IMPACTAR COSTO -->
            <div style="border-top: 1px solid #334155; padding-top: 12px; margin-top: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px;">
                    <div>
                        <div style="font-size: 0.72rem; color: #94a3b8;">
                            ${tipoPrecioActual === 'PROMO' ? '🔥 Costo Promo / kg' : 'Costo Patron / kg'}
                        </div>
                        <div style="font-size: 1.05rem; font-weight: 700; color: ${tipoPrecioActual === 'PROMO' ? '#c084fc' : '#38bdf8'};">
                            $${costoKiloFinal.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 0.72rem; color: #94a3b8;">
                            ${tipoPrecioActual === 'PROMO' ? '🔥 Equiv. Artículo LAMDA' : 'Equiv. Artículo LAMDA'} (${kilosUnidadArt}kg)
                        </div>
                        <div style="font-size: 1.05rem; font-weight: 700; color: ${tipoPrecioActual === 'PROMO' ? '#f472b6' : '#f59e0b'};">
                            $${costoBultoFinal.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                        </div>
                    </div>
                </div>

                <button class="btn-confirm-costo" 
                    style="width: 100%; justify-content: center; ${tipoPrecioActual === 'PROMO' ? 'background: linear-gradient(135deg, #7c3aed, #a855f7); border: 1px solid #c084fc;' : ''}"
                    onclick="seleccionarEImpactarCostoTarjeta('${tipoArray}', ${index})">
                    ${opcionesConciliacionActual?.ldn4_ap_codigo
                        ? `${tipoPrecioActual === 'PROMO' ? '🔥 Evaluar Promo en LDN 4' : '⚖️ Evaluar en LDN 4'} ($${costoKiloFinal.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)`
                        : `${tipoPrecioActual === 'PROMO' ? '🔥 Impactar Costo Promo' : '✅ Impactar Costo'} ($${costoBultoFinal.toLocaleString('es-AR', {minimumFractionDigits: 2})}/bulto)`}
                </button>
            </div>
        </div>
    `;
}

async function seleccionarEImpactarCostoTarjeta(tipoArray, index) {
    if (!datosEstadoActualConciliacion) return;

    let arr = datosEstadoActualConciliacion.nivel_1_exacto;
    if (tipoArray === 'SUGERENCIA') arr = datosEstadoActualConciliacion.nivel_2_sugerencias;
    else if (tipoArray === 'HABITUAL') arr = datosEstadoActualConciliacion.capa_habitual;
    else if (tipoArray === 'CHOFER_IA') arr = datosEstadoActualConciliacion.capa_chofer_ia;
    else if (tipoArray === 'EXACTO') arr = datosEstadoActualConciliacion.nivel_1_exacto;

    const item = arr ? arr[index] : null;
    if (!item) {
        console.error('❌ Oferta no encontrada para tipoArray:', tipoArray, 'index:', index);
        return;
    }

    const art = datosEstadoActualConciliacion.articulo_lamda;
    const kilosUnidadArt = parseFloat(art.kilos_unidad || 1);
    const modoActual = item.modo_precio || 'KILO';
    const tipoPrecioActual = item.tipo_precio || 'ESTANDAR';
    const tienePromo = Boolean(item.tiene_promo && item.precio_promo_kilo > 0);

    const precioKiloBase = (tipoPrecioActual === 'PROMO' && tienePromo)
        ? item.precio_promo_kilo
        : item.costo_kilo_calculado;

    const precioBultoBase = (tipoPrecioActual === 'PROMO' && tienePromo)
        ? (item.precio_promo_bulto || (item.precio_promo_kilo * (item.kilos_empaque || 1)))
        : item.precio_costo_bulto;

    let costoKiloFinal = 0;
    let costoBultoFinal = 0;

    if (modoActual === 'KILO') {
        costoKiloFinal = precioKiloBase;
        costoBultoFinal = costoKiloFinal * kilosUnidadArt;
    } else {
        costoBultoFinal = precioBultoBase;
        costoKiloFinal = item.kilos_empaque > 0 ? (costoBultoFinal / item.kilos_empaque) : costoBultoFinal;
    }

    const justifExtra = (tipoPrecioActual === 'PROMO' && tienePromo) ? ' [PRECIO PROMOCIONAL SELECCIONADO]' : '';
    const justifFinal = (item.justificacion || `Conciliación desde capa ${tipoArray}`) + justifExtra;

    await confirmarCostoReposicionDesdeIA(
        art.articulo_id,
        costoBultoFinal,
        item.id || item.codigo_proveedor || 0,
        item.proveedor_nombre,
        item.codigo_proveedor,
        item.descripcion_proveedor,
        precioBultoBase,
        costoKiloFinal,
        item.fecha_actualizacion || new Date().toISOString(),
        item.antiguedad_dias || 0,
        item.nivel || (tipoArray === 'CHOFER_IA' ? 'SUGERENCIA_ALTERNATIVA' : 'MATCH_EXACTO'),
        justifFinal
    );
}

async function confirmarCostoReposicionDesdeIA(
    articuloId, nuevoCostoBase, proveedorId, proveedorNombre,
    codigoProveedor, descripcionProveedor, precioCostoBulto,
    costoKiloCalculado, fechaActualizacion, antiguedadDias,
    nivelCoincidencia, justificacion, porcentajeIvaExplicit
) {
    const artLamda = datosEstadoActualConciliacion?.articulo_lamda;
    const esIngrediente = Boolean(artLamda?.es_ingrediente) || String(articuloId).startsWith('ING-');
    const cleanIngId = esIngrediente 
        ? (artLamda?.ingrediente_id || parseInt(String(articuloId).replace(/^ING-?/i, ''), 10))
        : null;

    const porcentajeIvaFinal = porcentajeIvaExplicit !== undefined && porcentajeIvaExplicit !== null
        ? parseFloat(porcentajeIvaExplicit)
        : (artLamda?.porcentaje_iva || 21);

    const capaPropiaActiva = (datosEstadoActualConciliacion?.capa_produccion_propia?.habilitada)
        ? datosEstadoActualConciliacion.capa_produccion_propia
        : null;
    const valoresPropiaActivos = capaPropiaActiva ? calcularValoresVivosPropia(capaPropiaActiva) : null;
    const origenCompraNorm = String(codigoProveedor || '').startsWith('LOTE') || String(proveedorId || '') === 'SUPABASE_LOTE'
        ? 'LOTE'
        : 'TABLA_MAESTRA';

    // CASO A (ANTI-ERROR HUMANO): Se abrió sobre un BULTO COMPRADO (ej. [CCWTX22,68]) vinculado a un Ingrediente con Tostadero LDN 4
    if (
        capaPropiaActiva &&
        capaPropiaActiva.tipo_ficha === 'LDN4_TOSTADERO' &&
        capaPropiaActiva.contexto_origen?.tipo === 'BULTO_COMPRADO_VINCULADO'
    ) {
        const costoPropiaRef = valoresPropiaActivos ? valoresPropiaActivos.costoIng : (capaPropiaActiva.costo_kilo_elaborado || 0);
        const diffVsPropia = costoPropiaRef > 0 ? (costoKiloCalculado - costoPropiaRef) : 0;
        const resDual = await Swal.fire({
            title: '🛡️ Confirmación Desambiguada de Destino',
            width: '680px',
            html: `
                <div style="text-align:left; font-size:0.86rem; color:#cbd5e1; display:flex; flex-direction:column; gap:10px;">
                    <div style="background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px 12px;">
                        <div>Oferta seleccionada: <strong style="color:#38bdf8;">${proveedorNombre || 'Proveedor'}</strong> ${codigoProveedor ? `<code>[${codigoProveedor}]</code>` : ''}</div>
                        <div style="color:#94a3b8; font-size:0.79rem; margin-top:2px;">${descripcionProveedor || '-'}</div>
                        <div style="margin-top:6px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                            <span>Precio Compra Elegido: <strong style="color:#38bdf8;">$${costoKiloCalculado.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong> ($${nuevoCostoBase.toLocaleString('es-AR', {minimumFractionDigits: 2})}/bulto ${artLamda?.kilos_unidad || 1}kg)</span>
                            ${costoPropiaRef > 0 ? `<span>vs Producción Propia LAMDA: <strong style="color:#34d399;">$${costoPropiaRef.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong> (${diffVsPropia > 0 ? '+' : ''}$${diffVsPropia.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)</span>` : ''}
                        </div>
                    </div>

                    <div style="font-size:0.80rem; color:#fde047; font-weight:700;">Elegí explícitamente dónde querés aplicar este costo (podés marcar uno o ambos):</div>

                    <label style="display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border-radius:8px; background:rgba(56,189,248,0.10); border:1px solid rgba(56,189,248,0.38); cursor:pointer;">
                        <input type="checkbox" id="chk-impactar-bulto-ldn1" checked style="margin-top:3px; width:17px; height:17px; accent-color:#0284c7; cursor:pointer;">
                        <div>
                            <div style="font-weight:800; color:#e0f2fe;">📦 1. Actualizar bulto comercial [${articuloId}] (${artLamda?.kilos_unidad || 1}kg)</div>
                            <div style="font-size:0.77rem; color:#94a3b8;">Actualiza <code>costo_base</code> ($${nuevoCostoBase.toLocaleString('es-AR', {minimumFractionDigits: 2})}/bulto) y las listas de venta directa de este bulto cerrado en [LDN 1].</div>
                        </div>
                    </label>

                    <label style="display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border-radius:8px; background:rgba(245,158,11,0.10); border:1px solid rgba(245,158,11,0.38); cursor:pointer;">
                        <input type="checkbox" id="chk-impactar-circuito-ldn4" style="margin-top:3px; width:17px; height:17px; accent-color:#f59e0b; cursor:pointer;">
                        <div>
                            <div style="font-weight:800; color:#fef08a;">🥜 2. Adoptar además como Fuente Rectora (🛒 Compra) en [ING #${capaPropiaActiva.ingrediente_id}] ${capaPropiaActiva.ingrediente_nombre}</div>
                            <div style="font-size:0.77rem; color:#cbd5e1;">Fija Compra Proveedor ($${costoKiloCalculado.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg) sobre AP <code>[${capaPropiaActiva.ap_codigo}]</code> y abre la auditoría de sus <strong>${capaPropiaActiva.fracciones_afectadas?.length || 0} fracciones</strong>${capaPropiaActiva.mixes_afectados?.length ? ` y <strong>${capaPropiaActiva.mixes_afectados.length} mix(es)</strong>` : ''} sin borrar la simulación de Tostadero.</div>
                        </div>
                    </label>
                </div>
            `,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: '✅ Confirmar Selección',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#0284c7',
            cancelButtonColor: '#475569',
            background: '#151e2e',
            color: '#f3f4f6',
            preConfirm: () => {
                const c1 = Boolean(document.getElementById('chk-impactar-bulto-ldn1')?.checked);
                const c2 = Boolean(document.getElementById('chk-impactar-circuito-ldn4')?.checked);
                if (!c1 && !c2) {
                    Swal.showValidationMessage('Seleccioná al menos uno de los dos destinos.');
                    return false;
                }
                return { impactarBulto: c1, impactarCircuitoLdn4: c2 };
            }
        });

        if (!resDual.isConfirmed || !resDual.value) return;
        const { impactarBulto, impactarCircuitoLdn4 } = resDual.value;

        try {
            if (impactarBulto) {
                Swal.fire({
                    title: 'Actualizando bulto comercial...',
                    text: `Impactando [${articuloId}] sin alterar silenciosamente la cadena LDN 4...`,
                    allowOutsideClick: false,
                    didOpen: () => Swal.showLoading()
                });
                const respB = await fetch('/api/produccion/conciliacion/articulos/confirmar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        articulo_id: articuloId,
                        es_ingrediente: false,
                        ingrediente_id: null,
                        nuevo_costo_base: nuevoCostoBase,
                        porcentaje_iva: porcentajeIvaFinal,
                        proveedor_id: proveedorId,
                        proveedor_nombre: proveedorNombre,
                        codigo_proveedor: codigoProveedor,
                        descripcion_proveedor: descripcionProveedor,
                        precio_costo_bulto: precioCostoBulto,
                        costo_kilo_calculado: costoKiloCalculado,
                        fecha_actualizacion_oferta: fechaActualizacion,
                        antiguedad_dias: antiguedadDias,
                        nivel_coincidencia: nivelCoincidencia,
                        justificacion_determinista: justificacion,
                        sincronizar_ingrediente: false
                    })
                });
                const dB = await respB.json();
                if (!dB.success) throw new Error(dB.message || 'Error al actualizar el bulto comercial.');
                if (typeof window.inicializarPizarra === 'function') {
                    await window.inicializarPizarra(true);
                }
            }

            const upTarget = capaPropiaActiva.up_codigo;
            const apTarget = capaPropiaActiva.ap_codigo;
            cerrarModuloConciliacionIA();

            if (impactarCircuitoLdn4) {
                if (typeof window.aplicarOfertaProveedorLdn4 === 'function') {
                    await window.aplicarOfertaProveedorLdn4(upTarget, {
                        compra_origen: 'BULTO_BUNKER',
                        compra_sku_bulto: articuloId,
                        compra_costo_kg: costoKiloCalculado,
                        compra_proveedor_nombre: proveedorNombre || 'Proveedor',
                        compra_proveedor_codigo: codigoProveedor || articuloId,
                        compra_descripcion: descripcionProveedor || artLamda?.descripcion || articuloId,
                        compra_updated_at: fechaActualizacion || new Date().toISOString()
                    }, true);
                    if (typeof window.cambiarContextoLDN === 'function') window.cambiarContextoLDN(4);
                    if (typeof window.actualizarTodasFraccionesDeTostadero === 'function') {
                        await window.actualizarTodasFraccionesDeTostadero(upTarget);
                    }
                } else {
                    await fetch(`/api/produccion/ldn4/fuente-abastecimiento/${encodeURIComponent(apTarget)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            modo_rector: 'COMPRA_PROVEEDOR',
                            compra_origen: 'BULTO_BUNKER',
                            compra_sku_bulto: articuloId,
                            compra_costo_kg: costoKiloCalculado,
                            compra_proveedor_nombre: proveedorNombre || 'Proveedor',
                            compra_proveedor_codigo: codigoProveedor || articuloId,
                            compra_descripcion: descripcionProveedor || articuloId,
                            compra_updated_at: fechaActualizacion || new Date().toISOString()
                        })
                    });
                }
            } else {
                // Guardar únicamente como benchmark informativo en el AP si aún no tenía referencia
                await fetch(`/api/produccion/ldn4/fuente-abastecimiento/${encodeURIComponent(apTarget)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        compra_origen: 'BULTO_BUNKER',
                        compra_sku_bulto: articuloId,
                        compra_costo_kg: costoKiloCalculado,
                        compra_proveedor_nombre: proveedorNombre || 'Proveedor',
                        compra_proveedor_codigo: codigoProveedor || articuloId,
                        compra_descripcion: descripcionProveedor || articuloId,
                        compra_updated_at: fechaActualizacion || new Date().toISOString()
                    })
                }).catch(() => {});
                Swal.fire('¡Bulto Actualizado!', `Se actualizó [${articuloId}] a $${nuevoCostoBase.toLocaleString('es-AR', {minimumFractionDigits: 2})}/bulto manteniendo intacta la Fuente Rectora de [ING #${capaPropiaActiva.ingrediente_id}].`, 'success');
                if (typeof window.renderizarArticulosBunkerLDN1 === 'function') window.renderizarArticulosBunkerLDN1();
            }
        } catch (errDual) {
            console.error('❌ Error en confirmación desambiguada:', errDual);
            Swal.fire('Error', errDual.message || 'No se pudo completar la actualización.', 'error');
        }
        return;
    }

    // CASO B: Circuito [LDN 4] abierto desde Ingrediente (ING-*), Artículo Puente (AP) o botón de [LDN 4]
    if (
        ((opcionesConciliacionActual && opcionesConciliacionActual.ldn4_ap_codigo) ||
         (capaPropiaActiva && capaPropiaActiva.tipo_ficha === 'LDN4_TOSTADERO')) &&
        typeof window.aplicarOfertaProveedorLdn4 === 'function'
    ) {
        const targetUp = opcionesConciliacionActual?.ldn4_up_codigo || capaPropiaActiva?.up_codigo;
        const costoProdRef = valoresPropiaActivos?.costoIng || parseFloat(opcionesConciliacionActual?.costo_prod_ing_kg) || 0;
        const diffVsProd = costoProdRef > 0 ? (costoKiloCalculado - costoProdRef) : 0;
        const diffTexto = costoProdRef > 0
            ? `<div style="margin-top:8px; padding:8px 10px; border-radius:6px; background:${diffVsProd <= 0 ? 'rgba(16,185,129,0.14)' : 'rgba(245,158,11,0.14)'}; border:1px solid ${diffVsProd <= 0 ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)'}; font-size:0.84rem;">
                 ⚖️ Comparado contra <strong>Producción Propia LAMDA ($${costoProdRef.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)</strong>:
                 <strong style="color:${diffVsProd <= 0 ? '#34d399' : '#fbbf24'};">${diffVsProd > 0 ? '+' : ''}$${diffVsProd.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong>
               </div>`
            : '';

        const resLdn4 = await Swal.fire({
            title: '⚖️ Decisión de Abastecimiento [LDN 4]',
            html: `
                <div style="text-align:left; font-size:0.88rem; color:#cbd5e1;">
                    <p>Oferta de proveedor terminado para <strong>${capaPropiaActiva?.ingrediente_nombre || artLamda?.descripcion || articuloId}</strong>:</p>
                    <ul>
                        <li><strong>Proveedor:</strong> ${proveedorNombre || 'Proveedor'} ${codigoProveedor ? `(${codigoProveedor})` : ''}</li>
                        <li><strong>Producto:</strong> ${descripcionProveedor || '-'}</li>
                        <li><strong>Costo Terminado:</strong> <strong style="color:#38bdf8;">$${costoKiloCalculado.toLocaleString('es-AR', {minimumFractionDigits: 2})} / kg</strong></li>
                    </ul>
                    ${diffTexto}
                    <p style="font-size:0.78rem; color:#94a3b8; margin-top:8px;">Si activás Compra como Fuente Rectora, se abrirá la tabla de auditoría de AP + Ingrediente + Fracciones + Mixes (sin borrar los datos del Tostadero).</p>
                </div>
            `,
            icon: 'question',
            showDenyButton: true,
            showCancelButton: true,
            confirmButtonText: '🛒 Activar Compra y Revisar Cadena',
            denyButtonText: '📊 Solo guardar Benchmark',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#0284c7',
            denyButtonColor: '#475569',
            cancelButtonColor: '#334155',
            background: '#151e2e',
            color: '#f3f4f6'
        });

        if (!resLdn4.isConfirmed && !resLdn4.isDenied) return;
        const activarComoRector = Boolean(resLdn4.isConfirmed);
        cerrarModuloConciliacionIA();
        await window.aplicarOfertaProveedorLdn4(targetUp, {
            compra_origen: origenCompraNorm,
            compra_costo_kg: costoKiloCalculado,
            compra_proveedor_nombre: proveedorNombre || 'Proveedor',
            compra_proveedor_codigo: codigoProveedor || null,
            compra_descripcion: descripcionProveedor || null,
            compra_sku_bulto: null,
            compra_updated_at: fechaActualizacion || new Date().toISOString()
        }, activarComoRector);
        if (activarComoRector) {
            if (typeof window.cambiarContextoLDN === 'function') window.cambiarContextoLDN(4);
            if (typeof window.actualizarTodasFraccionesDeTostadero === 'function') {
                await window.actualizarTodasFraccionesDeTostadero(targetUp);
            }
        }
        return;
    }

    const esFraccionConRecetaPropia = Boolean(capaPropiaActiva && capaPropiaActiva.tipo_ficha === 'LDN2_FRACCIONADO');
    const avisoFraccionPropiaHtml = esFraccionConRecetaPropia
        ? `<div style="margin-top:10px; padding:9px 12px; border-radius:6px; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.38); font-size:0.80rem; color:#d1fae5;">
             🏭 <strong>Comparativa Fraccionado Propio (Solapa 5):</strong> Elaborar <code>[${articuloId}]</code> en LAMDA cuesta <strong>$${capaPropiaActiva.costo_total_elaborado_bulto.toLocaleString('es-AR', {minimumFractionDigits: 2})}/bulto ($${capaPropiaActiva.costo_total_elaborado_kilo.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)</strong>.<br>
             <span style="color:#fde68a;">Por seguridad, el tilde de sincronizar ingrediente madre viene desmarcado para no alterar las demás presentaciones que se fraccionan desde bulto grande.</span>
           </div>`
        : '';

    const result = await Swal.fire({
        title: esIngrediente ? '¿Confirmar Costo de Reposición del Insumo?' : '¿Confirmar Costo de Reposición e IVA?',
        html: `
            <div style="text-align: left; font-size: 0.9rem; color: #cbd5e1;">
                <p>Se actualizará el ${esIngrediente ? 'costo patrón del insumo' : 'costo base e IVA del artículo'} <strong>[${articuloId}] ${artLamda?.descripcion || ''}</strong> en ${esIngrediente ? 'public.ingredientes y lotes de depósito' : 'public.bunker_articulos y listas comerciales'}:</p>
                <ul>
                    <li><strong>Proveedor / Origen:</strong> ${proveedorNombre}</li>
                    ${!esIngrediente ? `<li><strong>Nuevo Costo Base (bulto):</strong> $${nuevoCostoBase.toLocaleString('es-AR', {minimumFractionDigits: 2})} / bulto</li>` : ''}
                    <li><strong>Costo Patrón / kg:</strong> $${costoKiloCalculado.toLocaleString('es-AR', {minimumFractionDigits: 2})} / kg</li>
                    <li><strong>IVA Aplicable:</strong> ${porcentajeIvaFinal}%</li>
                </ul>
                ${avisoFraccionPropiaHtml}
                ${!esIngrediente ? `
                <div style="margin-top: 14px; padding: 10px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 6px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: #fde047; font-size: 0.82rem; font-weight: 600; margin: 0;">
                        <input type="checkbox" id="chk-sincronizar-ingrediente-modal" ${esFraccionConRecetaPropia ? '' : 'checked'} style="width: 16px; height: 16px; accent-color: #f59e0b; cursor: pointer;">
                        <span>🌱 Sincronizar automáticamente en el ingrediente vinculado de fábrica (costo_patron: $${costoKiloCalculado.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)</span>
                    </label>
                </div>
                <p style="color: #38bdf8; font-size: 0.82rem; font-weight: 700; margin-top: 10px;">Esta acción recalculará automáticamente los precios de venta de las listas asociadas y actualizará la Pizarra Inteligente en vivo.</p>
                ` : `
                <p style="color: #38bdf8; font-size: 0.82rem; font-weight: 700; margin-top: 10px;">Esta acción actualizará el costo patrón de la materia prima en las recetas de producción y actualizará la Pizarra Inteligente en vivo.</p>
                `}
            </div>
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#0284c7',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, Impactar Costo',
        cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    const chkSync = document.getElementById('chk-sincronizar-ingrediente-modal');
    const sincronizarIngrediente = chkSync ? chkSync.checked : true;

    try {
        Swal.fire({
            title: 'Actualizando costos...',
            text: esIngrediente ? 'Impactando public.ingredientes.costo_patron y lotes...' : 'Impactando public.bunker_articulos.costo_base, porcentaje_iva y recalculando listas...',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        const response = await fetch('/api/produccion/conciliacion/articulos/confirmar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                articulo_id: articuloId,
                es_ingrediente: esIngrediente,
                ingrediente_id: cleanIngId,
                nuevo_costo_base: nuevoCostoBase,
                porcentaje_iva: porcentajeIvaFinal,
                proveedor_id: proveedorId,
                proveedor_nombre: proveedorNombre,
                codigo_proveedor: codigoProveedor,
                descripcion_proveedor: descripcionProveedor,
                precio_costo_bulto: precioCostoBulto,
                costo_kilo_calculado: costoKiloCalculado,
                fecha_actualizacion_oferta: fechaActualizacion,
                antiguedad_dias: antiguedadDias,
                nivel_coincidencia: nivelCoincidencia,
                justificacion_determinista: justificacion,
                sincronizar_ingrediente: sincronizarIngrediente
            })
        });

        const resData = await response.json();
        if (!resData.success) {
            throw new Error(resData.message || 'Error al confirmar costo');
        }

        if (esIngrediente && cleanIngId) {
            if (window.pizarraSimulacionMaster && Array.isArray(window.pizarraSimulacionMaster.ingredientes)) {
                const ingLinked = window.pizarraSimulacionMaster.ingredientes.find(i => i.id === cleanIngId);
                if (ingLinked) {
                    ingLinked.costo_patron = costoKiloCalculado;
                }
            }
            window.ingredienteSeleccionadoId = cleanIngId;
            window.articuloSeleccionadoId = null;
            window.articulosSeleccionadosIds = [];
        } else if (sincronizarIngrediente && window.pizarraSimulacionMaster && Array.isArray(window.pizarraSimulacionMaster.ingredientes)) {
            const ingLinked = window.pizarraSimulacionMaster.ingredientes.find(i => 
                (i.articulo_vinculado_numero || '').trim().toLowerCase() === String(articuloId).trim().toLowerCase()
            );
            if (ingLinked) {
                ingLinked.costo_patron = costoKiloCalculado;
            }
            window.articuloSeleccionadoId = articuloId;
            window.articulosSeleccionadosIds = [articuloId];
        }

        if (window.VigíaPizarra) {
            window.VigíaPizarra.logEvent('CONCILIACION_IA', `🎯 Costo Impactado en BD con éxito: [${articuloId}] -> $${costoKiloCalculado}/kg`, {
                articuloId: articuloId,
                nuevoCostoBase: nuevoCostoBase,
                costoKiloCalculado: costoKiloCalculado,
                proveedorNombre: proveedorNombre,
                codigoProveedor: codigoProveedor
            });
        }

        Swal.fire('¡Costo Actualizado!', resData.message, 'success');
        cerrarModuloConciliacionIA();

        // Refrescar en vivo la Pizarra Inteligente de Costos
        if (typeof window.inicializarPizarra === 'function') {
            await window.inicializarPizarra(true);
        } else if (typeof window.cargarArticulosBunker === 'function') {
            await window.cargarArticulosBunker();
        }
        if (typeof window.renderizarArticulosBunkerLDN1 === 'function') {
            window.renderizarArticulosBunkerLDN1();
        }

        if (esIngrediente && cleanIngId) {
            if (typeof window.auditarIncidenciaLineasNegocio === 'function') {
                window.auditarIncidenciaLineasNegocio(null, cleanIngId);
            }
        } else if (typeof seleccionarArticulo === 'function') {
            seleccionarArticulo(articuloId);
        }

    } catch (err) {
        console.error('❌ Error al confirmar costo:', err);
        Swal.fire('Error', err.message || 'No se pudo actualizar el costo.', 'error');
    }
}

// -------------------------------------------------------------------------
// FUNCIONES AUXILIARES PARA EL NIVEL 3 (HISTORIAL DE LOTES ENTRANTES SUPABASE)
// -------------------------------------------------------------------------
function crearTarjetaLote(lote, articuloId, kilosUnidadArt, index) {
    const kilosUnidad = parseFloat(kilosUnidadArt || 1);
    const costoKilo = parseFloat(lote.costo_kilo_al_momento || lote.costo_kilo_calculado || 0);
    const costoBulto = costoKilo * kilosUnidad;
    const porcentajeIva = parseFloat(lote.impuesto_iva || 21);
    const fechaRaw = lote.fecha_recepcion || lote.fecha_vinculacion;
    const fechaStr = fechaRaw ? new Date(fechaRaw).toLocaleDateString('es-AR') : 'N/D';
    const esPendiente = Boolean(lote.pendiente_vincular);
    
    let diasTranscurridos = 'Reciente';
    if (fechaRaw) {
        const diffMs = new Date() - new Date(fechaRaw);
        const dias = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        diasTranscurridos = dias === 0 ? 'Hoy' : `hace ${dias} día${dias !== 1 ? 's' : ''}`;
    }

    const loteIdClean = (lote.lote_codigo_corto || lote.lote_id_supabase || 'Sin Código').substring(0, 16);
    const provNombre = lote.proveedor_nombre || 'Proveedor Depósito';
    const artDesc = lote.articulo_descripcion || 'Ingreso de mercadería';
    const remito = lote.numero_remito ? ` • Remito: ${lote.numero_remito}` : '';
    const prodCod = lote.producto_codigo ? ` [${lote.producto_codigo}]` : '';
    const cantBultosTxt = (parseFloat(lote.cantidad_asignada || lote.cantidad_recibida || 0) > 0)
        ? ` • ${parseFloat(lote.cantidad_asignada || lote.cantidad_recibida)} cj (${parseFloat(lote.kilos_asignados || lote.cantidad_total_lote || 0)} kg)`
        : '';

    const baseRecepUrl = window.LAMDA_RESOLVE_URL
        ? window.LAMDA_RESOLVE_URL('http://localhost:3002/pages/recepcion-lotes.html')
        : '/pages/recepcion-lotes.html';
    const urlVincularLote = `${baseRecepUrl}?remito=${encodeURIComponent(lote.numero_remito || '')}&lote=${encodeURIComponent(lote.lote_id_supabase || '')}`;

    const borderStyle = esPendiente
        ? 'border: 1.5px solid rgba(245, 158, 11, 0.72); background: linear-gradient(180deg, rgba(245, 158, 11, 0.08), #1e293b);'
        : 'border: 1px solid rgba(168, 85, 247, 0.4); background: #1e293b;';

    const topBadgeHtml = esPendiente
        ? `<span style="background: rgba(245, 158, 11, 0.22); color: #fde68a; font-weight: 800; font-size: 0.74rem; padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.55);">⏳ Recibido en Depósito — Pendiente de vincular a stock (${loteIdClean})</span>`
        : `<span style="background: rgba(168, 85, 247, 0.2); color: #c084fc; font-weight: 700; font-size: 0.76rem; padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(168, 85, 247, 0.4);">🏷️ Lote #${index + 1} (${loteIdClean})</span>`;

    return `
        <div style="${borderStyle} border-radius: 10px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between; gap: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.25);">
            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;">
                    ${topBadgeHtml}
                    <span style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 600; font-size: 0.74rem; padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.3);">
                        📅 ${diasTranscurridos} (${fechaStr})
                    </span>
                </div>
                <div style="font-size: 0.95rem; font-weight: 700; color: #f3f4f6; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                    <span style="color: ${esPendiente ? '#fbbf24' : '#c084fc'};">🏢 Proveedor:</span>
                    <span style="color: #38bdf8;">${provNombre}</span>
                </div>
                <div style="font-size: 0.85rem; font-weight: 600; color: #e2e8f0; margin-bottom: 4px;">
                    📦 Insumo: <span style="color: #fde047;">${artDesc}${prodCod}</span>
                </div>
                <div style="font-size: 0.74rem; color: #94a3b8; line-height: 1.4;">
                    ${esPendiente ? 'Recepción física conformada en Supabase (aún sin vincular a stock Búnker)' : 'Ingreso físico recepcionado por escáner en depósito'}${remito}${cantBultosTxt}
                </div>
            </div>

            <div style="background: #0f172a; padding: 10px; border-radius: 8px; border: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-size: 0.70rem; color: #94a3b8;">Costo Bruto Kilo:</div>
                    <div style="font-size: 1.05rem; font-weight: 800; color: #34d399;">$${costoKilo.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})} /kg</div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 0.70rem; color: #94a3b8;">Costo Total Bulto (${kilosUnidad}kg):</div>
                    <div style="font-size: 0.95rem; font-weight: 700; color: #fbbf24;">$${costoBulto.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})} /bulto</div>
                </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.74rem;">
                <span style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; padding: 2px 7px; border-radius: 4px; border: 1px solid rgba(245, 158, 11, 0.3);">
                    IVA ${porcentajeIva}%
                </span>
                <div style="display: flex; gap: 6px; align-items: center; margin-left: auto;">
                    ${esPendiente ? `
                    <button type="button" onclick="window.open('${urlVincularLote}', '_blank')"
                        style="background: rgba(245, 158, 11, 0.18); color: #fde68a; border: 1px solid rgba(245, 158, 11, 0.5); padding: 6px 10px; border-radius: 6px; font-size: 0.76rem; font-weight: 700; cursor: pointer;"
                        title="Abrir Recepción de Lotes para vincular este ingreso al stock local">
                        🔗 Vincular Stock
                    </button>
                    ` : ''}
                    <button onclick="seleccionarCostoLoteTarjeta(${index})" 
                        style="background: ${esPendiente ? '#d97706' : '#a855f7'}; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s;"
                        title="Actualizar explícitamente el costo de simulación con este lote">
                        📥 Tomar Costo de Lote
                    </button>
                </div>
            </div>
        </div>
    `;
}

async function seleccionarCostoLoteTarjeta(index) {
    const lote = (Array.isArray(lotesRenderizadosActuales) && lotesRenderizadosActuales[index])
        || (datosEstadoActualConciliacion?.capa_lotes?.[index])
        || (datosEstadoActualConciliacion?.historial_lotes_recientes?.[index]);
    if (!lote) return;
    const art = datosEstadoActualConciliacion.articulo_lamda;
    const costoKilo = parseFloat(lote.costo_kilo_al_momento || lote.costo_kilo_calculado || 0);
    const porcentajeIva = parseFloat(lote.impuesto_iva || 21);
    await aplicarCostoLoteSimulacion(
        art.articulo_id,
        costoKilo,
        porcentajeIva,
        lote.lote_id_supabase || '',
        lote.proveedor_nombre || '',
        lote.articulo_descripcion || '',
        Boolean(lote.pendiente_vincular)
    );
}

window.aplicarCostoLoteSimulacion = async function(articuloId, costoKilo, porcentajeIva, loteIdSupabase = '', provNombre = '', artDesc = '', esPendienteVincular = false) {
    const isIng = String(articuloId).startsWith('ING-') || Boolean(datosEstadoActualConciliacion?.articulo_lamda?.es_ingrediente);
    const cleanIngId = isIng ? (datosEstadoActualConciliacion?.articulo_lamda?.ingrediente_id || parseInt(String(articuloId).replace(/^ING-?/i, ''), 10)) : null;

    const art = (window.pizarraSimulacionMaster && Array.isArray(window.pizarraSimulacionMaster.articulosBunker))
        ? window.pizarraSimulacionMaster.articulosBunker.find(a => a.articulo_id === articuloId)
        : null;
    
    const kilosUnidad = isIng ? 1 : (art ? (parseFloat(art.kilos_unidad) || 1) : 1);
    const costoBultoCalculado = costoKilo * kilosUnidad;

    if (isIng && cleanIngId) {
        if (window.pizarraSimulacionMaster && Array.isArray(window.pizarraSimulacionMaster.ingredientes)) {
            const ingObj = window.pizarraSimulacionMaster.ingredientes.find(i => i.id === cleanIngId);
            if (ingObj) {
                ingObj.costo_patron = costoKilo;
            }
        }
    } else {
        // A. Actualizar articulosListas para que obtenerFinanzasBunkerArticulo() devuelva costoKilo inmediatamente
        if (window.pizarraSimulacionMaster && Array.isArray(window.pizarraSimulacionMaster.articulosListas)) {
            let listaPatron = window.pizarraSimulacionMaster.articulosListas.find(la => la.articulo_numero === articuloId && la.es_patron === true) ||
                              window.pizarraSimulacionMaster.articulosListas.find(la => la.articulo_numero === articuloId && la.lista_id === 1) ||
                              window.pizarraSimulacionMaster.articulosListas.find(la => la.articulo_numero === articuloId);
            
            if (listaPatron) {
                listaPatron.costo_base_sobrescrito = costoKilo;
                listaPatron.iva = porcentajeIva;
            } else {
                window.pizarraSimulacionMaster.articulosListas.push({
                    articulo_numero: articuloId,
                    lista_id: 1,
                    es_patron: true,
                    costo_base_sobrescrito: costoKilo,
                    iva: porcentajeIva
                });
            }
        }

        // B. Actualizar objeto en articulosBunker
        if (art) {
            art.costo_base = costoBultoCalculado;
            art.porcentaje_iva = porcentajeIva;
        }
    }

    // C. Re-renderizar LDN 1 inmediatamente para refrescar el DOM visual
    if (typeof window.renderizarArticulosBunkerLDN1 === 'function') {
        window.renderizarArticulosBunkerLDN1();
    }

    if (window.VigíaPizarra) {
        window.VigíaPizarra.logEvent('LOTES_HISTORIAL_SELECCION', `Usuario aplicó explícitamente el costo de lote $${costoKilo}/kg a [${articuloId}] (${provNombre}: ${artDesc})`, {
            articuloId,
            costoKilo,
            porcentajeIva,
            costoBultoCalculado,
            proveedor: provNombre,
            descripcion: artDesc
        });
    }

    // D. Consultar al usuario si desea IMPACTAR EN BASE DE DATOS PERMANENTEMENTE
    if (typeof Swal !== 'undefined') {
        const confirmRes = await Swal.fire({
            title: isIng ? '¿Guardar Costo del Insumo en BD?' : '¿Guardar Costo de Lote en BD?',
            html: `
                <div style="text-align: left; font-size: 0.9rem; color: #cbd5e1; line-height: 1.5;">
                    <div style="margin-bottom: 6px;"><span style="color: #c084fc; font-weight: 700;">🏢 Proveedor:</span> <strong>${provNombre || 'Depósito'}</strong></div>
                    <div style="margin-bottom: 8px;"><span style="color: #fde047; font-weight: 700;">📦 Insumo:</span> <strong>${artDesc || articuloId}</strong></div>
                    <div>Se aplicó en memoria RAM el costo de <strong>$${costoKilo.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong> con IVA <strong>${porcentajeIva}%</strong>.</div>
                    ${esPendienteVincular ? `<div style="margin-top: 8px; padding: 6px 10px; border-radius: 6px; background: rgba(245, 158, 11, 0.14); border: 1px solid rgba(245, 158, 11, 0.4); color: #fde68a; font-size: 0.80rem;">⏳ Lote pendiente de vincular en Recepción de Lotes: esta acción actualiza el costo en Pizarra/BD; el stock físico se suma al vincular el remito.</div>` : ''}
                    <div style="margin-top: 10px; color: #38bdf8; font-weight: 600;">¿Deseas impactar en la Base de Datos y actualizar los costos de producción ahora mismo?</div>
                </div>
            `,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#a855f7',
            cancelButtonColor: '#64748b',
            confirmButtonText: '⚡ Sí, Impactar en BD Ahora',
            cancelButtonText: '⏳ Dejar solo en Memoria RAM',
            background: '#151e2e',
            color: '#f3f4f6'
        });

        if (confirmRes.isConfirmed) {
            await confirmarCostoReposicionDesdeIA(
                articuloId,
                costoBultoCalculado,
                'SUPABASE_LOTE',
                provNombre || 'LOTE SUPABASE (RECEPCIÓN DEPÓSITO)',
                loteIdSupabase || 'LOTE_INGRESADO',
                artDesc || 'Ingreso efectivo de mercadería en depósito',
                costoBultoCalculado,
                costoKilo,
                new Date().toISOString(),
                0,
                'MATCH_EXACTO',
                `Selección explícita de costo de lote recepcionado en depósito ($${costoKilo}/kg) - ${provNombre}: ${artDesc}`,
                porcentajeIva
            );
        } else {
            if (typeof window.actualizarBannerCambios === 'function') {
                window.actualizarBannerCambios();
            }
            cerrarModuloConciliacionIA();
            Swal.fire({
                title: 'Costo de Lote en Memoria RAM',
                text: `El costo de $${costoKilo.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg se aplicó en pantalla. Presioná '🚀 Aplicar Cambios' en la cabecera para guardar permanentemente.`,
                icon: 'info',
                timer: 3500,
                showConfirmButton: false,
                background: '#151e2e',
                color: '#f3f4f6'
            });
        }
    }
};

// =========================================================================
// CAPA 5 DETERMINISTA: PRODUCCIÓN PROPIA LAMDA (LDN 4 TOSTADERO / LDN 2 FRACCIONADO / LDN 3-5-6)
// =========================================================================

function obtenerMejorReferenciaExternaModal(data, lotesHistoria = []) {
    if (!data) return null;
    const topIA = data.recomendacion_principal_ia;
    if (topIA && parseFloat(topIA.costo_kilo_calculado) > 0) {
        return {
            origen: 'CHOFER_IA',
            etiqueta: `${topIA.proveedor_nombre || 'Proveedor'} (Chofer IA #1)`,
            detalle: topIA.descripcion_proveedor || topIA.presentacion_maestra || '',
            costo_kg: Number(parseFloat(topIA.costo_kilo_calculado).toFixed(2)),
            tab_destino: 'CHOFER_IA'
        };
    }
    const hab0 = Array.isArray(data.capa_habitual) ? data.capa_habitual[0] : null;
    if (hab0 && parseFloat(hab0.costo_kilo_calculado) > 0) {
        return {
            origen: 'HABITUAL',
            etiqueta: `${hab0.proveedor_nombre || 'Habitual'} (Lista Vigente)`,
            detalle: hab0.descripcion_proveedor || '',
            costo_kg: Number(parseFloat(hab0.costo_kilo_calculado).toFixed(2)),
            tab_destino: 'HABITUAL'
        };
    }
    const op0 = Array.isArray(data.capa_operador?.exactos) ? data.capa_operador.exactos[0] : null;
    if (op0 && parseFloat(op0.costo_kilo_calculado) > 0) {
        return {
            origen: 'OPERADOR',
            etiqueta: `${op0.proveedor_nombre || 'Proveedor'} (Filtros)`,
            detalle: op0.descripcion_proveedor || '',
            costo_kg: Number(parseFloat(op0.costo_kilo_calculado).toFixed(2)),
            tab_destino: 'OPERADOR'
        };
    }
    const lote0 = Array.isArray(lotesHistoria) ? lotesHistoria[0] : null;
    if (lote0 && parseFloat(lote0.costo_kilo_al_momento || lote0.costo_kilo_calculado) > 0) {
        return {
            origen: 'LOTES',
            etiqueta: `${lote0.proveedor_nombre || 'Depósito'} (Último Lote)`,
            detalle: lote0.articulo_descripcion || '',
            costo_kg: Number(parseFloat(lote0.costo_kilo_al_momento || lote0.costo_kilo_calculado).toFixed(2)),
            tab_destino: 'LOTES'
        };
    }
    const fuenteSaved = data.capa_produccion_propia?.fuente_abastecimiento_ldn4;
    if (fuenteSaved && parseFloat(fuenteSaved.compra_costo_kg) > 0) {
        return {
            origen: 'BENCHMARK_GUARDADO',
            etiqueta: `${fuenteSaved.compra_proveedor_nombre || 'Benchmark Guardado'}`,
            detalle: fuenteSaved.compra_descripcion || '',
            costo_kg: Number(parseFloat(fuenteSaved.compra_costo_kg).toFixed(2)),
            tab_destino: 'CHOFER_IA'
        };
    }
    return null;
}

function construirHtmlTabProduccionPropia(capaPropia, art, valoresPropia, mejorRefExterna) {
    // -------------------------------------------------------------------------
    // CASO 1: SIMULADOR INTERACTIVO COMPLETO DE TOSTADERO [LDN 4]
    // -------------------------------------------------------------------------
    if (capaPropia.tipo_ficha === 'LDN4_TOSTADERO') {
        const sim = estadoSimulacionPropiaModal || capaPropia.parametros_iniciales || {};
        const crudoDet = sim.crudo_detalle || capaPropia.crudo_actual || {};
        const repoCrudoKg = Number(crudoDet.costo_repo_kilo || 0);
        const loteCrudoObj = crudoDet.lote_reciente || null;
        const loteCrudoKg = loteCrudoObj ? Number(loteCrudoObj.costo_kilo || 0) : 0;

        const colabs = Array.isArray(capaPropia.colaboradores) ? capaPropia.colaboradores : [];
        const colabSel = colabs.find(c => Number(c.usuario_id) === Number(sim.colaborador_id)) || colabs[0] || null;
        const serviciosColab = colabSel && Array.isArray(colabSel.servicios) ? colabSel.servicios : [];

        const costoExtKg = mejorRefExterna ? mejorRefExterna.costo_kg : 0;
        const ahorroKg = costoExtKg > 0 ? Number((costoExtKg - valoresPropia.costoIng).toFixed(2)) : null;
        const ahorroPct = (ahorroKg !== null && costoExtKg > 0) ? Number(((ahorroKg / costoExtKg) * 100).toFixed(1)) : null;

        const ctxOrigen = capaPropia.contexto_origen || {};
        const bannerBultoVinculadoHtml = ctxOrigen.tipo === 'BULTO_COMPRADO_VINCULADO' ? `
            <div style="margin-bottom: 14px; padding: 10px 14px; border-radius: 10px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.42); font-size: 0.82rem; color: #fef3c7; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
                <div>
                    🔗 <strong>Vínculo Transitivo Detectado:</strong> Abriste la Mesa desde el bulto comprado <code>[${ctxOrigen.sku_bulto_comprado}]</code> (${ctxOrigen.kilos_bulto_comprado}kg), vinculado al ingrediente <strong>[ING #${capaPropia.ingrediente_id}] ${capaPropia.ingrediente_nombre}</strong> (AP <code>[${capaPropia.ap_codigo}]</code>).
                </div>
                <span style="font-size: 0.75rem; color: #fde68a; font-weight: 700;">Al confirmar podrás elegir si impactar el bulto, el ingrediente o ambos.</span>
            </div>
        ` : '';

        const modoRectorLabel = capaPropia.modo_rector_actual === 'COMPRA_PROVEEDOR'
            ? '🛒 Compra Proveedor'
            : (capaPropia.modo_rector_actual === 'MANUAL' ? '🎯 Valor Manual' : '🏭 Producción Propia UP');

        const crudosOpcionesHtml = (capaPropia.crudos_alternativos || []).map(c => `
            <option value="${c.sku}" ${String(c.sku).toUpperCase() === String(sim.crudo_sku || '').toUpperCase() ? 'selected' : ''}>
                [${c.sku}] ${c.descripcion} — Stock: ${c.stock_bultos} bultos (${c.stock_kilos}kg) — Repo: $${c.costo_repo_kilo.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg${c.es_oficial_up ? ' 📌 Oficial Receta UP' : ''}
            </option>
        `).join('');

        const colabsOpcionesHtml = colabs.map(c => `
            <option value="${c.usuario_id}" ${colabSel && Number(c.usuario_id) === Number(colabSel.usuario_id) ? 'selected' : ''}>
                👤 ${c.nombre}${c.valor_hora > 0 ? ` ($${c.valor_hora.toLocaleString('es-AR')}/h)` : ''}
            </option>
        `).join('');

        const serviciosOpcionesHtml = [
            ...serviciosColab.map(s => `
                <option value="${s.id}" ${String(sim.servicio_id || '') === String(s.id) ? 'selected' : ''}>
                    [${s.articulo_numero}] ${s.descripcion} — $${s.valor_por_unidad.toLocaleString('es-AR', {minimumFractionDigits: 2})}/${s.unidad_medida}
                </option>
            `),
            `<option value="__MANUAL__" ${!sim.servicio_id ? 'selected' : ''}>✏️ Tarifa Manual / Personalizada</option>`
        ].join('');

        const filasHistorialHtml = (capaPropia.historial_cocciones || []).length === 0
            ? `<tr><td colspan="6" style="padding: 16px; text-align: center; color: #94a3b8; font-size: 0.80rem;">No hay tandas registradas aún en <code>produccion_externa_historial</code> para este circuito.</td></tr>`
            : capaPropia.historial_cocciones.map(h => {
                const fechaFmt = h.fecha_registro ? new Date(h.fecha_registro).toLocaleDateString('es-AR') : '-';
                return `
                    <tr style="border-bottom: 1px solid rgba(51, 65, 85, 0.65); font-size: 0.77rem; ${h.es_invalida ? 'opacity: 0.58;' : ''}">
                        <td style="padding: 6px 8px; color: #cbd5e1;">${fechaFmt}</td>
                        <td style="padding: 6px 8px; color: #38bdf8; font-family: monospace;">#${h.carro_id || h.id}</td>
                        <td style="padding: 6px 8px; text-align: right; color: #e2e8f0;">${h.kilos_entrada !== null ? `${h.kilos_entrada.toFixed(2)} kg` : '<span style="color:#f87171;">s/dato</span>'}</td>
                        <td style="padding: 6px 8px; text-align: right; color: #e2e8f0;">${h.kilos_salida.toFixed(2)} kg</td>
                        <td style="padding: 6px 8px; text-align: right; font-weight: 800; color: ${h.es_invalida ? '#f87171' : '#fbbf24'};">
                            ${h.es_invalida ? `<span title="${h.motivo_invalida || ''}">⚠️ ${h.motivo_invalida || 'Inválida'}</span>` : `${h.porcentaje_merma.toFixed(2)}%`}
                        </td>
                        <td style="padding: 6px 8px; text-align: center;">
                            ${!h.es_invalida && h.porcentaje_merma !== null ? `
                                <button type="button" onclick="aplicarMermaTabPropia(${h.porcentaje_merma})"
                                    style="padding: 2px 8px; border-radius: 5px; border: 1px solid ${Math.abs(valoresPropia.merma - h.porcentaje_merma) < 0.01 ? '#34d399' : '#475569'}; background: ${Math.abs(valoresPropia.merma - h.porcentaje_merma) < 0.01 ? 'rgba(16,185,129,0.22)' : '#0f172a'}; color: ${Math.abs(valoresPropia.merma - h.porcentaje_merma) < 0.01 ? '#6ee7b7' : '#cbd5e1'}; font-size: 0.71rem; font-weight: 700; cursor: pointer;">
                                    ${Math.abs(valoresPropia.merma - h.porcentaje_merma) < 0.01 ? '✓ Activa' : 'Usar'}
                                </button>
                            ` : '-'}
                        </td>
                    </tr>
                `;
            }).join('');

        const crudoCambioDeOficial = capaPropia.crudo_actual?.sku &&
            sim.crudo_sku &&
            String(sim.crudo_sku).toUpperCase() !== String(capaPropia.crudo_actual.sku).toUpperCase();

        return `
            <div style="background: rgba(16, 185, 129, 0.04); border: 1px solid rgba(16, 185, 129, 0.30); border-radius: 12px; padding: 18px;">
                ${bannerBultoVinculadoHtml}

                <!-- FRANJA EJECUTIVA MAKE VS BUY -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; margin-bottom: 18px;">
                    <div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 12px 16px;">
                        <div style="font-size: 0.74rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">📌 Costo Vigente en BD ([ING #${capaPropia.ingrediente_id}])</div>
                        <div style="font-size: 1.25rem; font-weight: 800; color: #f8fafc; margin-top: 4px;">
                            $${(capaPropia.costo_ingrediente_bd || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})} <span style="font-size: 0.8rem; color: #94a3b8;">/kg</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #38bdf8; margin-top: 4px;">Modo actual: <strong>${modoRectorLabel}</strong> · AP [${capaPropia.ap_codigo}]: $${(capaPropia.costo_base_ap_bd || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</div>
                    </div>

                    <div style="background: #1e293b; border: 1px solid rgba(56, 189, 248, 0.38); border-radius: 10px; padding: 12px 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.74rem; color: #7dd3fc; font-weight: 700; text-transform: uppercase;">🛒 Mejor Oferta Terminado (Solapas 1–4)</span>
                            ${mejorRefExterna ? `<button type="button" onclick="cambiarTabConciliacion('${mejorRefExterna.tab_destino}')" style="background:none; border:none; color:#38bdf8; font-size:0.72rem; font-weight:700; cursor:pointer; text-decoration:underline;">Ver oferta →</button>` : ''}
                        </div>
                        <div style="font-size: 1.25rem; font-weight: 800; color: #38bdf8; margin-top: 4px;">
                            ${mejorRefExterna ? `$${mejorRefExterna.costo_kg.toLocaleString('es-AR', {minimumFractionDigits: 2})} <span style="font-size: 0.8rem; color: #94a3b8;">/kg</span>` : '<span style="font-size:0.95rem; color:#64748b;">Sin oferta directa detectada</span>'}
                        </div>
                        <div style="font-size: 0.75rem; color: #cbd5e1; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${mejorRefExterna ? `${mejorRefExterna.etiqueta} — ${mejorRefExterna.detalle}` : ''}">
                            ${mejorRefExterna ? `<strong>${mejorRefExterna.etiqueta}</strong>` : 'Podés filtrar manualmente en Solapa 3'}
                        </div>
                    </div>

                    <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.18), rgba(15, 23, 42, 0.92)); border: 1.5px solid #10b981; border-radius: 10px; padding: 12px 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                            <span style="font-size: 0.74rem; color: #6ee7b7; font-weight: 800; text-transform: uppercase;">🏭 Costo Producción Propia Simulado</span>
                            ${ahorroKg !== null ? `
                                <span style="padding: 2px 8px; border-radius: 999px; font-size: 0.72rem; font-weight: 800; background: ${ahorroKg >= 0 ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}; color: ${ahorroKg >= 0 ? '#34d399' : '#fbbf24'};">
                                    ${ahorroKg >= 0 ? `✅ Ahorro $${ahorroKg.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg (${ahorroPct}%)` : `⚠️ +$${Math.abs(ahorroKg).toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg vs Comprar`}
                                </span>
                            ` : ''}
                        </div>
                        <div style="font-size: 1.35rem; font-weight: 900; color: #34d399; margin-top: 4px;">
                            $${valoresPropia.costoIng.toLocaleString('es-AR', {minimumFractionDigits: 2})} <span style="font-size: 0.82rem; color: #a7f3d0;">/kg puesto en Ingrediente</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #d1fae5; margin-top: 4px;">
                            AP [${capaPropia.ap_codigo}]: <strong>$${valoresPropia.costoBaseAp.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong> + MO Recepción AP: <strong>+$${valoresPropia.moAp.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong>
                        </div>
                    </div>
                </div>

                <!-- ESTACIÓN INTERACTIVA EN 2 COLUMNAS -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(430px, 1fr)); gap: 16px;">
                    <!-- COLUMNA IZQUIERDA: INSUMO CRUDO + COLABORADOR Y TARIFA -->
                    <div style="display: flex; flex-direction: column; gap: 14px;">
                        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px 16px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap;">
                                <span style="font-size: 0.86rem; font-weight: 800; color: #38bdf8;">1° 🌾 Insumo Crudo de Entrada (UP [${capaPropia.up_codigo}])</span>
                                ${sim.crudo_sku ? `
                                    <button type="button" onclick="abrirModuloConciliacionIA('${sim.crudo_sku}')" style="background: rgba(56, 189, 248, 0.14); color: #7dd3fc; border: 1px solid rgba(56, 189, 248, 0.4); padding: 3px 9px; border-radius: 6px; font-size: 0.72rem; font-weight: 700; cursor: pointer;" title="Abrir las ofertas de proveedores para la bolsa cruda [${sim.crudo_sku}]">
                                        🔍 Auditar Proveedores del Crudo [${sim.crudo_sku}]
                                    </button>
                                ` : ''}
                            </div>

                            <label style="font-size: 0.74rem; color: #94a3b8; display: block; margin-bottom: 4px;">Bulto crudo a enviar a tostar:</label>
                            <select onchange="cambiarCrudoTabPropia(this.value)" style="width: 100%; background: #0f172a; color: #f8fafc; border: 1px solid #475569; border-radius: 7px; padding: 8px 10px; font-size: 0.82rem; font-weight: 600; margin-bottom: 12px;">
                                ${crudosOpcionesHtml}
                            </select>

                            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: space-between; background: #0f172a; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155;">
                                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                                    <button type="button" onclick="cambiarFuenteCrudoTabPropia('REPO')"
                                        style="padding: 5px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; cursor: pointer; border: 1px solid ${sim.fuente_costo_crudo === 'REPO' ? '#38bdf8' : '#334155'}; background: ${sim.fuente_costo_crudo === 'REPO' ? 'rgba(2,132,199,0.28)' : '#1e293b'}; color: ${sim.fuente_costo_crudo === 'REPO' ? '#bae6fd' : '#94a3b8'};">
                                        📋 Costo Repo ($${repoCrudoKg.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)
                                    </button>
                                    <button type="button" ${loteCrudoKg > 0 ? `onclick="cambiarFuenteCrudoTabPropia('LOTE')"` : 'disabled'}
                                        style="padding: 5px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; cursor: ${loteCrudoKg > 0 ? 'pointer' : 'not-allowed'}; opacity: ${loteCrudoKg > 0 ? '1' : '0.45'}; border: 1px solid ${sim.fuente_costo_crudo === 'LOTE' ? '#c084fc' : '#334155'}; background: ${sim.fuente_costo_crudo === 'LOTE' ? 'rgba(168,85,247,0.25)' : '#1e293b'}; color: ${sim.fuente_costo_crudo === 'LOTE' ? '#e9d5ff' : '#94a3b8'};">
                                        📦 Último Lote ${loteCrudoKg > 0 ? `($${loteCrudoKg.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)` : '(Sin lote)'}
                                    </button>
                                </div>
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span style="font-size: 0.75rem; color: #94a3b8; font-weight: 700;">Crudo $/kg:</span>
                                    <input type="number" step="10" value="${valoresPropia.crudoKg.toFixed(2)}"
                                        onchange="cambiarCostoCrudoManualTabPropia(this.value)"
                                        style="width: 105px; background: #1e293b; border: 1px solid #38bdf8; border-radius: 6px; padding: 5px 8px; color: #f8fafc; font-weight: 800; font-size: 0.85rem; text-align: right;" />
                                </div>
                            </div>
                            ${crudoCambioDeOficial ? `
                                <div style="margin-top: 8px; font-size: 0.74rem; color: #fbbf24;">
                                    ⚡ Estás simulando con <code>[${sim.crudo_sku}]</code> (en Receta UP oficial figura <code>[${capaPropia.crudo_actual.sku}]</code>). Al confirmar podrás elegir si actualizar también la Receta UP.
                                </div>
                            ` : ''}
                        </div>

                        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px 16px;">
                            <div style="font-size: 0.86rem; font-weight: 800; color: #c084fc; margin-bottom: 10px;">
                                2° 👨‍🍳 Colaborador Externo (Maquila UP) y Recepción Interna AP
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                                <div>
                                    <label style="font-size: 0.73rem; color: #94a3b8; display: block; margin-bottom: 4px;">Colaborador / Tostadero:</label>
                                    <select onchange="cambiarColaboradorTabPropia(this.value)" style="width: 100%; background: #0f172a; color: #f8fafc; border: 1px solid #475569; border-radius: 7px; padding: 7px 9px; font-size: 0.80rem;">
                                        ${colabsOpcionesHtml || '<option value="">Sin colaboradores activos</option>'}
                                    </select>
                                </div>
                                <div>
                                    <label style="font-size: 0.73rem; color: #94a3b8; display: block; margin-bottom: 4px;">Tarifa Parametrizada (Rendimiento):</label>
                                    <select onchange="cambiarServicioTabPropia(this.value)" style="width: 100%; background: #0f172a; color: #f8fafc; border: 1px solid #475569; border-radius: 7px; padding: 7px 9px; font-size: 0.80rem;">
                                        ${serviciosOpcionesHtml}
                                    </select>
                                </div>
                            </div>

                            <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; background: #0f172a; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 0.77rem; color: #cbd5e1; font-weight: 700;">🔥 Tarifa Tostado ($/kg salido):</span>
                                    <input type="number" step="10" value="${valoresPropia.tarifaKg.toFixed(2)}"
                                        onchange="cambiarTarifaManualTabPropia(this.value)"
                                        style="width: 100px; background: #1e293b; border: 1px solid #c084fc; border-radius: 6px; padding: 5px 8px; color: #f3e8ff; font-weight: 800; font-size: 0.85rem; text-align: right;" />
                                </div>
                                <div style="font-size: 0.77rem; color: #94a3b8;">
                                    ⏱️ M.O. Interna Recepción AP <code>[${capaPropia.ap_codigo}]</code>:
                                    <strong style="color: #38bdf8;">+$${valoresPropia.moAp.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- COLUMNA DERECHA: HISTORIAL DE COCCIONES + DESGLOSE FINAL Y ACCIÓN -->
                    <div style="display: flex; flex-direction: column; gap: 14px;">
                        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px 16px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap;">
                                <span style="font-size: 0.86rem; font-weight: 800; color: #fbbf24;">3° ⚖️ Historial Real de Cocciones y Merma Física</span>
                                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                    <button type="button" onclick="aplicarMermaTabPropia(${capaPropia.merma_promedio})"
                                        style="padding: 4px 9px; border-radius: 6px; font-size: 0.73rem; font-weight: 700; cursor: pointer; border: 1px solid ${Math.abs(valoresPropia.merma - capaPropia.merma_promedio) < 0.01 ? '#fbbf24' : '#475569'}; background: ${Math.abs(valoresPropia.merma - capaPropia.merma_promedio) < 0.01 ? 'rgba(245,158,11,0.22)' : '#0f172a'}; color: #fde68a;">
                                        📊 Promedio (${capaPropia.merma_promedio}% · ${capaPropia.total_cocciones_validas} tandas)
                                    </button>
                                    <button type="button" onclick="aplicarMermaTabPropia(${capaPropia.ultima_merma})"
                                        style="padding: 4px 9px; border-radius: 6px; font-size: 0.73rem; font-weight: 700; cursor: pointer; border: 1px solid ${Math.abs(valoresPropia.merma - capaPropia.ultima_merma) < 0.01 ? '#38bdf8' : '#475569'}; background: ${Math.abs(valoresPropia.merma - capaPropia.ultima_merma) < 0.01 ? 'rgba(56,189,248,0.22)' : '#0f172a'}; color: #bae6fd;">
                                        ⏱️ Última (${capaPropia.ultima_merma}%)
                                    </button>
                                    <div style="display: inline-flex; align-items: center; gap: 4px;">
                                        <span style="font-size: 0.74rem; color: #94a3b8;">% Merma:</span>
                                        <input type="number" step="0.1" min="0" max="90" value="${valoresPropia.merma.toFixed(2)}"
                                            onchange="aplicarMermaTabPropia(this.value)"
                                            style="width: 72px; background: #0f172a; border: 1px solid #fbbf24; border-radius: 6px; padding: 4px 6px; color: #fde047; font-weight: 800; font-size: 0.82rem; text-align: right;" />
                                    </div>
                                </div>
                            </div>

                            <div style="max-height: 175px; overflow-y: auto; border: 1px solid #334155; border-radius: 8px; background: #0f172a;">
                                <table style="width: 100%; border-collapse: collapse;">
                                    <thead style="position: sticky; top: 0; background: #1e293b; font-size: 0.71rem; color: #94a3b8; text-transform: uppercase;">
                                        <tr>
                                            <th style="padding: 6px 8px; text-align: left;">Fecha</th>
                                            <th style="padding: 6px 8px; text-align: left;">Carro</th>
                                            <th style="padding: 6px 8px; text-align: right;">Entrada</th>
                                            <th style="padding: 6px 8px; text-align: right;">Salida</th>
                                            <th style="padding: 6px 8px; text-align: right;">Merma</th>
                                            <th style="padding: 6px 8px; text-align: center;">Aplicar</th>
                                        </tr>
                                    </thead>
                                    <tbody>${filasHistorialHtml}</tbody>
                                </table>
                            </div>
                        </div>

                        <div style="background: #1e293b; border: 1.5px solid rgba(16, 185, 129, 0.45); border-radius: 10px; padding: 14px 16px;">
                            <div style="font-size: 0.86rem; font-weight: 800; color: #34d399; margin-bottom: 8px;">
                                4° 🧮 Liquidación Exacta por 1 kg Elaborado e Impacto en Cadena
                            </div>
                            <div style="background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 10px 12px; font-size: 0.80rem; display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px;">
                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: #94a3b8;">Crudo [$${valoresPropia.crudoKg.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg] ÷ Rendimiento ${(valoresPropia.factorRend * 100).toFixed(2)}%:</span>
                                    <strong style="color: #e2e8f0;">$${valoresPropia.crudoAjustadoRend.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: #94a3b8;">+ Tarifa Tostadero Externo:</span>
                                    <strong style="color: #e9d5ff;">+$${valoresPropia.tarifaKg.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong>
                                </div>
                                <div style="display: flex; justify-content: space-between; border-top: 1px dashed #334155; padding-top: 4px;">
                                    <span style="color: #7dd3fc; font-weight: 700;">= Costo Base Artículo Puente [${capaPropia.ap_codigo}]:</span>
                                    <strong style="color: #38bdf8;">$${valoresPropia.costoBaseAp.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: #94a3b8;">+ Mano de Obra Interna Recepción AP:</span>
                                    <strong style="color: #38bdf8;">+$${valoresPropia.moAp.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong>
                                </div>
                                <div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(16,185,129,0.35); padding-top: 6px; font-size: 0.92rem;">
                                    <span style="color: #6ee7b7; font-weight: 800;">= Costo Final [ING #${capaPropia.ingrediente_id}] ${capaPropia.ingrediente_nombre}:</span>
                                    <strong style="color: #34d399; font-size: 1.02rem;">$${valoresPropia.costoIng.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong>
                                </div>
                            </div>

                            <div style="font-size: 0.75rem; color: #cbd5e1; margin-bottom: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                                <span>📦 <strong>Fracciones hijas (${capaPropia.fracciones_afectadas?.length || 0}):</strong> ${(capaPropia.fracciones_afectadas || []).map(f => `<code style="background:#0f172a; padding:1px 5px; border-radius:4px; color:#38bdf8;">${f.sku}</code>`).join(' ') || 'ninguna'}</span>
                                ${(capaPropia.mixes_afectados || []).length > 0 ? `<span>· 🧪 <strong>Mixes LDN 3 (${capaPropia.mixes_afectados.length}):</strong> ${capaPropia.mixes_afectados.map(m => `<span style="color:#e9d5ff;">[#${m.id}] ${m.nombre}</span>`).join(', ')}</span>` : ''}
                            </div>

                            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                                <button type="button" onclick="confirmarCostoProduccionPropiaModal()"
                                    style="flex: 1; background: linear-gradient(135deg, #10b981, #059669); color: #052e16; border: 1px solid #34d399; padding: 10px 16px; border-radius: 8px; font-size: 0.86rem; font-weight: 900; cursor: pointer; box-shadow: 0 4px 12px rgba(16,185,129,0.25);">
                                    ✅ Adoptar Costo de Producción Propia ($${valoresPropia.costoIng.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)
                                </button>
                                <button type="button" onclick="irAPanelLdnDesdeConciliacion(4, '${capaPropia.up_codigo}')"
                                    style="background: #0f172a; color: #bae6fd; border: 1px solid #0284c7; padding: 10px 14px; border-radius: 8px; font-size: 0.80rem; font-weight: 700; cursor: pointer;">
                                    🥜 Ir a [LDN 4] →
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // -------------------------------------------------------------------------
    // CASO 2: FRACCIONADO INTERNO CON RECETA PROPIA [LDN 2] (ej. SZPX10 x 5kg, CRx5 x 5kg)
    // -------------------------------------------------------------------------
    if (capaPropia.tipo_ficha === 'LDN2_FRACCIONADO') {
        const kilosArt = Number(capaPropia.kilos_unidad || 1);
        const costoExtKg = mejorRefExterna ? mejorRefExterna.costo_kg : 0;
        const costoExtBulto = costoExtKg > 0 ? Number((costoExtKg * kilosArt).toFixed(2)) : 0;
        const ahorroBulto = costoExtBulto > 0 ? Number((costoExtBulto - capaPropia.costo_total_elaborado_bulto).toFixed(2)) : null;
        const ahorroPct = (ahorroBulto !== null && costoExtBulto > 0) ? Number(((ahorroBulto / costoExtBulto) * 100).toFixed(1)) : null;

        const filasCompHtml = (capaPropia.componentes_receta || []).map(c => `
            <tr style="border-bottom: 1px solid #334155; font-size: 0.82rem;">
                <td style="padding: 9px 10px;">
                    <span style="font-weight: 700; color: ${c.es_insumo ? '#fbbf24' : '#38bdf8'};">${c.es_insumo ? '📦 Empaque' : '🌱 Materia Prima'}</span>
                </td>
                <td style="padding: 9px 10px; color: #f8fafc; font-weight: 600;">
                    [#${c.ingrediente_id}] ${c.nombre}
                    ${c.bulto_madre_sku ? `<div style="font-size: 0.74rem; color: #94a3b8; margin-top: 2px;">Bulto Madre vinculado: <code style="color:#7dd3fc;">[${c.bulto_madre_sku}]</code> ${c.bulto_madre_descripcion || ''} · Stock Madre: <strong style="color:${c.bulto_madre_stock_bultos > 0 ? '#34d399' : '#f87171'};">${c.bulto_madre_stock_bultos} bultos</strong></div>` : ''}
                </td>
                <td style="padding: 9px 10px; text-align: right; color: #cbd5e1;">${c.cantidad} ${c.unidad_medida}</td>
                <td style="padding: 9px 10px; text-align: right; color: #cbd5e1;">$${c.costo_unitario.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                <td style="padding: 9px 10px; text-align: right; font-weight: 800; color: #e2e8f0;">$${c.subtotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                <td style="padding: 9px 10px; text-align: center;">
                    ${c.origen_up_sku ? `
                        <button type="button" onclick="abrirModuloConciliacionIA('ING-${c.ingrediente_id}', null, { es_ingrediente: true, ingrediente_id: ${c.ingrediente_id}, tab_inicial: 'PRODUCCION_PROPIA' })"
                            style="background: rgba(249,115,22,0.18); color: #fdba74; border: 1px solid rgba(249,115,22,0.45); padding: 4px 9px; border-radius: 6px; font-size: 0.73rem; font-weight: 700; cursor: pointer;">
                            🥜 Ver Tostadero Origen
                        </button>
                    ` : (c.bulto_madre_sku ? `
                        <button type="button" onclick="abrirModuloConciliacionIA('${c.bulto_madre_sku}')"
                            style="background: rgba(56,189,248,0.15); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.4); padding: 4px 9px; border-radius: 6px; font-size: 0.73rem; font-weight: 700; cursor: pointer;">
                            🔍 Auditar Madre [${c.bulto_madre_sku}]
                        </button>
                    ` : '-')}
                </td>
            </tr>
        `).join('');

        return `
            <div style="background: rgba(16, 185, 129, 0.04); border: 1px solid rgba(16, 185, 129, 0.30); border-radius: 12px; padding: 18px;">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-bottom: 18px;">
                    <div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 12px 16px;">
                        <div style="font-size: 0.74rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">📌 Costo Actual en BD ([${capaPropia.articulo_id}])</div>
                        <div style="font-size: 1.22rem; font-weight: 800; color: #f8fafc; margin-top: 4px;">
                            $${capaPropia.costo_actual_bd_bulto.toLocaleString('es-AR', {minimumFractionDigits: 2})} <span style="font-size: 0.8rem; color: #94a3b8;">/bulto (${kilosArt}kg)</span>
                        </div>
                        <div style="font-size: 0.76rem; color: #94a3b8; margin-top: 3px;">Equivalente: <strong>$${capaPropia.costo_actual_bd_kilo.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong></div>
                    </div>

                    <div style="background: #1e293b; border: 1px solid rgba(56, 189, 248, 0.38); border-radius: 10px; padding: 12px 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.74rem; color: #7dd3fc; font-weight: 700; text-transform: uppercase;">🛒 Mejor Oferta Proveedor (Solapas 1–4)</span>
                            ${mejorRefExterna ? `<button type="button" onclick="cambiarTabConciliacion('${mejorRefExterna.tab_destino}')" style="background:none; border:none; color:#38bdf8; font-size:0.72rem; font-weight:700; cursor:pointer; text-decoration:underline;">Ver oferta →</button>` : ''}
                        </div>
                        <div style="font-size: 1.22rem; font-weight: 800; color: #38bdf8; margin-top: 4px;">
                            ${mejorRefExterna ? `$${costoExtBulto.toLocaleString('es-AR', {minimumFractionDigits: 2})} <span style="font-size: 0.8rem; color: #94a3b8;">/bulto ($${mejorRefExterna.costo_kg.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)</span>` : '<span style="font-size:0.95rem; color:#64748b;">Sin oferta externa en filtro</span>'}
                        </div>
                        <div style="font-size: 0.75rem; color: #cbd5e1; margin-top: 3px;">${mejorRefExterna ? `<strong>${mejorRefExterna.etiqueta}</strong>` : 'Consultá Solapa 3 ó 4 para ver presentaciones'}</div>
                    </div>

                    <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.18), rgba(15, 23, 42, 0.92)); border: 1.5px solid #10b981; border-radius: 10px; padding: 12px 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                            <span style="font-size: 0.74rem; color: #6ee7b7; font-weight: 800; text-transform: uppercase;">🏭 Fraccionado Propio LAMDA [LDN 2]</span>
                            ${ahorroBulto !== null ? `
                                <span style="padding: 2px 8px; border-radius: 999px; font-size: 0.72rem; font-weight: 800; background: ${ahorroBulto >= 0 ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}; color: ${ahorroBulto >= 0 ? '#34d399' : '#fbbf24'};">
                                    ${ahorroBulto >= 0 ? `✅ Ahorro $${ahorroBulto.toLocaleString('es-AR', {minimumFractionDigits: 2})}/bulto (${ahorroPct}%)` : `⚠️ +$${Math.abs(ahorroBulto).toLocaleString('es-AR', {minimumFractionDigits: 2})}/bulto vs Comprar`}
                                </span>
                            ` : ''}
                        </div>
                        <div style="font-size: 1.30rem; font-weight: 900; color: #34d399; margin-top: 4px;">
                            $${capaPropia.costo_total_elaborado_bulto.toLocaleString('es-AR', {minimumFractionDigits: 2})} <span style="font-size: 0.82rem; color: #a7f3d0;">/bulto c/MO ($${capaPropia.costo_total_elaborado_kilo.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #d1fae5; margin-top: 3px;">
                            Base s/MO: <strong>$${capaPropia.costo_sin_mo_bulto.toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong> + M.O. Fraccionado: <strong>+$${capaPropia.mo_fraccionado_bulto.toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong>
                        </div>
                    </div>
                </div>

                <div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px;">
                    <div style="font-size: 0.92rem; font-weight: 800; color: #f8fafc; margin-bottom: 10px;">
                        📋 Anatomía Determinista de Fraccionado Interno (Receta Oficial #${capaPropia.receta_id} — [${capaPropia.articulo_id}] ${capaPropia.descripcion})
                    </div>
                    <div style="overflow-x: auto; border: 1px solid #334155; border-radius: 8px; background: #0f172a; margin-bottom: 14px;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead style="background: #1e293b; color: #94a3b8; font-size: 0.73rem; text-transform: uppercase;">
                                <tr>
                                    <th style="padding: 8px 10px; text-align: left;">Rol</th>
                                    <th style="padding: 8px 10px; text-align: left;">Componente / Bulto Madre</th>
                                    <th style="padding: 8px 10px; text-align: right;">Cantidad</th>
                                    <th style="padding: 8px 10px; text-align: right;">Costo Unit.</th>
                                    <th style="padding: 8px 10px; text-align: right;">Subtotal</th>
                                    <th style="padding: 8px 10px; text-align: center;">Trazabilidad</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${filasCompHtml}
                                <tr style="border-top: 1px dashed #475569; font-size: 0.82rem; background: rgba(56, 189, 248, 0.06);">
                                    <td style="padding: 8px 10px; color: #38bdf8; font-weight: 700;">⏱️ Mano de Obra</td>
                                    <td style="padding: 8px 10px; color: #cbd5e1;" colspan="3">Tiempo interno de fraccionamiento en Taller LAMDA (se suma neto sin recargarle margen comercial)</td>
                                    <td style="padding: 8px 10px; text-align: right; font-weight: 800; color: #38bdf8;">+$${capaPropia.mo_fraccionado_bulto.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                                    <td></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                        <div style="font-size: 0.78rem; color: #94a3b8;">
                            💡 Si compraste ocasionalmente esta presentación ya envasada, elegí la oferta en Solapas 1–4. Para volver al costo de fraccionado propio desde bulto madre, usá el botón verde.
                        </div>
                        <button type="button" onclick="confirmarCostoFraccionadoPropioModal()"
                            style="background: linear-gradient(135deg, #10b981, #059669); color: #052e16; border: 1px solid #34d399; padding: 10px 18px; border-radius: 8px; font-size: 0.85rem; font-weight: 900; cursor: pointer;">
                            ✅ Adoptar / Sincronizar Costo de Fraccionado Propio ($${capaPropia.costo_total_elaborado_bulto.toLocaleString('es-AR', {minimumFractionDigits: 2})}/bulto)
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // -------------------------------------------------------------------------
    // CASO 3: RESUMEN EJECUTIVO DE CIRCUITOS COMPLEJOS (LDN 3 MIXES / LDN 5 BARRITAS / LDN 6 GRANOLAS)
    // -------------------------------------------------------------------------
    return `
        <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 12px; padding: 22px; display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;">
            <div>
                <div style="font-size: 0.78rem; color: #6ee7b7; font-weight: 800; text-transform: uppercase;">
                    🏭 Elaboración Propia Compleja — Línea de Negocio ${capaPropia.linea_negocio}
                </div>
                <h3 style="margin: 6px 0; color: #f8fafc; font-size: 1.15rem;">
                    ${capaPropia.ingrediente_nombre || capaPropia.ap_descripcion} ${capaPropia.ap_codigo ? `<code style="color:#38bdf8;">[${capaPropia.ap_codigo}]</code>` : ''}
                </h3>
                <div style="font-size: 0.86rem; color: #cbd5e1;">
                    Costo Elaborado Vigente en LAMDA: <strong style="color: #34d399; font-size: 1.05rem;">$${(capaPropia.costo_kilo_elaborado || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong>
                    ${capaPropia.merma_promedio !== undefined ? ` · Merma histórica promedio: <strong>${capaPropia.merma_promedio}%</strong> (${capaPropia.total_cocciones_validas || 0} tandas válidas)` : ''}
                </div>
            </div>
            <button type="button" onclick="irAPanelLdnDesdeConciliacion(${capaPropia.destino_panel_ldn || capaPropia.linea_negocio}, '${capaPropia.up_codigo || ''}')"
                style="background: linear-gradient(135deg, #0284c7, #6366f1); color: #ffffff; border: none; padding: 11px 18px; border-radius: 8px; font-size: 0.86rem; font-weight: 800; cursor: pointer;">
                🚀 Abrir Simulador Específico [LDN ${capaPropia.destino_panel_ldn || capaPropia.linea_negocio}] →
            </button>
        </div>
    `;
}

async function cambiarCrudoTabPropia(nuevoSku) {
    if (!estadoSimulacionPropiaModal || !nuevoSku) return;
    try {
        const res = await fetch(`/api/produccion/produccion-propia/insumo-crudo/${encodeURIComponent(nuevoSku)}`);
        const json = await res.json();
        if (!json.success || !json.data) throw new Error(json.error || 'No se pudo cargar el insumo crudo.');
        const det = json.data;
        estadoSimulacionPropiaModal.crudo_sku = det.sku;
        estadoSimulacionPropiaModal.crudo_detalle = det;
        if (estadoSimulacionPropiaModal.fuente_costo_crudo === 'LOTE' && det.lote_reciente?.costo_kilo > 0) {
            estadoSimulacionPropiaModal.costo_crudo_kg = det.lote_reciente.costo_kilo;
        } else {
            estadoSimulacionPropiaModal.fuente_costo_crudo = 'REPO';
            estadoSimulacionPropiaModal.costo_crudo_kg = det.costo_repo_kilo || 0;
        }
        renderizarContenidoConciliacion(datosEstadoActualConciliacion);
    } catch (err) {
        console.error('Error al cambiar crudo en Solapa 5:', err);
        Swal.fire('Aviso', err.message || 'No se pudo consultar el bulto crudo.', 'warning');
    }
}

function cambiarFuenteCrudoTabPropia(fuente) {
    if (!estadoSimulacionPropiaModal) return;
    const det = estadoSimulacionPropiaModal.crudo_detalle || datosEstadoActualConciliacion?.capa_produccion_propia?.crudo_actual || {};
    estadoSimulacionPropiaModal.fuente_costo_crudo = fuente;
    if (fuente === 'REPO') {
        estadoSimulacionPropiaModal.costo_crudo_kg = Number(det.costo_repo_kilo || 0);
    } else if (fuente === 'LOTE' && det.lote_reciente?.costo_kilo > 0) {
        estadoSimulacionPropiaModal.costo_crudo_kg = Number(det.lote_reciente.costo_kilo);
    }
    renderizarContenidoConciliacion(datosEstadoActualConciliacion);
}

function cambiarCostoCrudoManualTabPropia(val) {
    if (!estadoSimulacionPropiaModal) return;
    estadoSimulacionPropiaModal.fuente_costo_crudo = 'MANUAL';
    estadoSimulacionPropiaModal.costo_crudo_kg = Math.max(0, parseFloat(val) || 0);
    renderizarContenidoConciliacion(datosEstadoActualConciliacion);
}

function cambiarColaboradorTabPropia(usuarioId) {
    if (!estadoSimulacionPropiaModal || !datosEstadoActualConciliacion?.capa_produccion_propia) return;
    const capa = datosEstadoActualConciliacion.capa_produccion_propia;
    const uid = Number(usuarioId);
    estadoSimulacionPropiaModal.colaborador_id = uid;
    const colab = (capa.colaboradores || []).find(c => Number(c.usuario_id) === uid);
    if (colab && Array.isArray(colab.servicios) && colab.servicios.length > 0) {
        const srvMatch = colab.servicios.find(s =>
            String(s.articulo_numero || '').toUpperCase() === String(capa.ap_codigo || '').toUpperCase() ||
            String(s.articulo_numero || '').toUpperCase() === String(capa.up_codigo || '').toUpperCase()
        ) || colab.servicios[0];
        estadoSimulacionPropiaModal.servicio_id = srvMatch.id;
        estadoSimulacionPropiaModal.tarifa_kg = Number(srvMatch.valor_por_unidad || 0);
    } else {
        estadoSimulacionPropiaModal.servicio_id = null;
    }
    renderizarContenidoConciliacion(datosEstadoActualConciliacion);
}

function cambiarServicioTabPropia(servicioId) {
    if (!estadoSimulacionPropiaModal || !datosEstadoActualConciliacion?.capa_produccion_propia) return;
    if (!servicioId || servicioId === '__MANUAL__') {
        estadoSimulacionPropiaModal.servicio_id = null;
        renderizarContenidoConciliacion(datosEstadoActualConciliacion);
        return;
    }
    const capa = datosEstadoActualConciliacion.capa_produccion_propia;
    const colab = (capa.colaboradores || []).find(c => Number(c.usuario_id) === Number(estadoSimulacionPropiaModal.colaborador_id));
    const srv = (colab?.servicios || []).find(s => String(s.id) === String(servicioId));
    if (srv) {
        estadoSimulacionPropiaModal.servicio_id = srv.id;
        estadoSimulacionPropiaModal.tarifa_kg = Number(srv.valor_por_unidad || 0);
    }
    renderizarContenidoConciliacion(datosEstadoActualConciliacion);
}

function cambiarTarifaManualTabPropia(val) {
    if (!estadoSimulacionPropiaModal) return;
    estadoSimulacionPropiaModal.servicio_id = null;
    estadoSimulacionPropiaModal.tarifa_kg = Math.max(0, parseFloat(val) || 0);
    renderizarContenidoConciliacion(datosEstadoActualConciliacion);
}

function aplicarMermaTabPropia(val) {
    if (!estadoSimulacionPropiaModal) return;
    estadoSimulacionPropiaModal.merma_pct = Math.max(0, Math.min(90, parseFloat(val) || 0));
    renderizarContenidoConciliacion(datosEstadoActualConciliacion);
}

function irAPanelLdnDesdeConciliacion(ldnNum, upCodigo = '') {
    cerrarModuloConciliacionIA();
    if (typeof window.cambiarContextoLDN === 'function') {
        window.cambiarContextoLDN(Number(ldnNum));
    }
    if (Number(ldnNum) === 4 && upCodigo && typeof window.seleccionarTostaderoLDN4 === 'function') {
        window.seleccionarTostaderoLDN4(upCodigo);
    }
}

async function confirmarCostoProduccionPropiaModal() {
    const capa = datosEstadoActualConciliacion?.capa_produccion_propia;
    if (!capa || !capa.habilitada || capa.tipo_ficha !== 'LDN4_TOSTADERO') return;
    const sim = estadoSimulacionPropiaModal || capa.parametros_iniciales || {};
    const val = calcularValoresVivosPropia(capa);
    const crudoCambioDeOficial = capa.crudo_actual?.sku &&
        sim.crudo_sku &&
        String(sim.crudo_sku).toUpperCase() !== String(capa.crudo_actual.sku).toUpperCase();

    const confirmRes = await Swal.fire({
        title: '🏭 Adoptar Costo de Producción Propia LAMDA',
        width: '640px',
        html: `
            <div style="text-align:left; font-size:0.86rem; color:#cbd5e1; display:flex; flex-direction:column; gap:8px;">
                <div>Se fijará <strong>🏭 Producción Propia (UP [${capa.up_codigo}])</strong> como Fuente Rectora para <strong>[ING #${capa.ingrediente_id}] ${capa.ingrediente_nombre}</strong>:</div>
                <ul style="margin:4px 0; padding-left:18px;">
                    <li><strong>Crudo evaluado:</strong> [${sim.crudo_sku}] a $${val.crudoKg.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg (${sim.fuente_costo_crudo})</li>
                    <li><strong>Merma aplicada:</strong> ${val.merma.toFixed(2)}% · <strong>Tarifa Tostadero:</strong> $${val.tarifaKg.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</li>
                    <li><strong>Costo Base AP [${capa.ap_codigo}]:</strong> $${val.costoBaseAp.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg (+ MO AP $${val.moAp.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)</li>
                    <li><strong>Nuevo Costo Final Ingrediente:</strong> <strong style="color:#34d399;">$${val.costoIng.toLocaleString('es-AR', {minimumFractionDigits: 2})} / kg</strong></li>
                </ul>
                ${crudoCambioDeOficial ? `
                    <label style="display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:6px; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.38); color:#fde68a; font-size:0.80rem; cursor:pointer;">
                        <input type="checkbox" id="chk-guardar-crudo-receta-up" style="width:16px; height:16px; accent-color:#f59e0b;">
                        <span>📌 Dejar también [${sim.crudo_sku}] guardado como insumo oficial en la Receta UP [${capa.up_codigo}]</span>
                    </label>
                ` : ''}
                <div style="font-size:0.78rem; color:#94a3b8;">A continuación se abrirá la tabla de auditoría de precios ofrecidos para confirmar el impacto en las ${capa.fracciones_afectadas?.length || 0} fracciones${capa.mixes_afectados?.length ? ` y ${capa.mixes_afectados.length} mix(es) de LDN 3` : ''}.</div>
            </div>
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: '✅ Continuar a Auditoría de Cadena',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#059669',
        cancelButtonColor: '#475569',
        background: '#151e2e',
        color: '#f3f4f6',
        preConfirm: () => ({
            guardarEnRecetaUp: Boolean(document.getElementById('chk-guardar-crudo-receta-up')?.checked)
        })
    });

    if (!confirmRes.isConfirmed) return;
    const guardarEnRecetaUp = Boolean(confirmRes.value?.guardarEnRecetaUp);

    try {
        if (crudoCambioDeOficial && guardarEnRecetaUp) {
            await fetch(`/api/produccion/tostaderos/${encodeURIComponent(capa.up_codigo)}/cambiar-crudo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nuevo_crudo_sku: sim.crudo_sku })
            });
        }

        const payloadSync = {
            crudo_sku: sim.crudo_sku,
            crudo_descripcion: sim.crudo_detalle?.descripcion || capa.crudo_actual?.descripcion || sim.crudo_sku,
            crudo_costo_repo_kilo: Number(sim.crudo_detalle?.costo_repo_kilo ?? capa.crudo_actual?.costo_repo_kilo ?? val.crudoKg),
            lote_costo_kilo: sim.crudo_detalle?.lote_reciente?.costo_kilo || null,
            fuente_costo: sim.fuente_costo_crudo || 'REPO',
            costo_crudo_kg: val.crudoKg,
            colaborador_id: sim.colaborador_id || null,
            servicio_id: sim.servicio_id || null,
            tarifa_kg: val.tarifaKg,
            merma_pct: val.merma,
            costo_base_ap: val.costoBaseAp,
            costo_ingrediente: val.costoIng
        };

        cerrarModuloConciliacionIA();

        if (typeof window.sincronizarSimulacionPropiaLdn4DesdeMesa === 'function') {
            await window.sincronizarSimulacionPropiaLdn4DesdeMesa(capa.up_codigo, payloadSync, true);
        } else {
            await fetch(`/api/produccion/ldn4/fuente-abastecimiento/${encodeURIComponent(capa.ap_codigo)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modo_rector: 'PRODUCCION_UP' })
            });
            await fetch(`/api/logistica/bunker/tostadero-simulacion/${encodeURIComponent(capa.ap_codigo)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tarifa: val.tarifaKg,
                    merma: val.merma,
                    colaborador_id: sim.colaborador_id || null,
                    servicio_id: sim.servicio_id || null,
                    insumo_evaluado_sku: sim.crudo_sku,
                    es_comparacion_bulto_comprado: false,
                    fuente_costo: sim.fuente_costo_crudo || 'REPO',
                    costo_repo_referencia_kg: payloadSync.crudo_costo_repo_kilo,
                    costo_crudo_kg: val.crudoKg,
                    costo_resultante_kg: val.costoBaseAp,
                    updated_at: new Date().toISOString()
                })
            });
            Swal.fire('¡Simulación Guardada!', `Producción Propia ($${val.costoIng.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg) registrada en [${capa.ap_codigo}].`, 'success');
        }
    } catch (err) {
        console.error('Error al adoptar costo de producción propia:', err);
        Swal.fire('Error', err.message || 'No se pudo sincronizar la producción propia.', 'error');
    }
}

async function confirmarCostoFraccionadoPropioModal() {
    const capa = datosEstadoActualConciliacion?.capa_produccion_propia;
    if (!capa || !capa.habilitada || capa.tipo_ficha !== 'LDN2_FRACCIONADO') return;
    const compAlim = (capa.componentes_receta || []).find(c => !c.es_insumo) || capa.componentes_receta?.[0] || null;
    const sku = capa.articulo_id;
    const ingId = compAlim ? compAlim.ingrediente_id : null;

    cerrarModuloConciliacionIA();
    if (typeof window.impactarFraccionQuirurgica === 'function') {
        await window.impactarFraccionQuirurgica(sku, ingId);
    } else {
        Swal.fire(
            'Costo de Fraccionado Propio',
            `El costo elaborado de [${sku}] es $${capa.costo_total_elaborado_bulto.toLocaleString('es-AR', {minimumFractionDigits: 2})}/bulto ($${capa.costo_total_elaborado_kilo.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg). Abrí la Pizarra para impactar sus listas.`,
            'info'
        );
    }
}

window.abrirModuloConciliacionIA = abrirModuloConciliacionIA;
window.tacharEtiqueta = tacharEtiqueta;
window.cambiarModoEtiqueta = cambiarModoEtiqueta;
window.habilitarEdicionEtiqueta = habilitarEdicionEtiqueta;
window.guardarEdicionEtiqueta = guardarEdicionEtiqueta;
window.cambiarCriterioOrdenamiento = cambiarCriterioOrdenamiento;
window.toggleExcluirPrecioCero = toggleExcluirPrecioCero;
window.actualizarPlaceholderInputTag = actualizarPlaceholderInputTag;
window.agregarNuevaEtiquetaConConfig = agregarNuevaEtiquetaConConfig;
window.reprocesarBúsquedaConEtiquetasActivas = reprocesarBúsquedaConEtiquetasActivas;
window.guardarEstrategiaEnBD = guardarEstrategiaEnBD;
window.eliminarEstrategiaDeBD = eliminarEstrategiaDeBD;
window.enviarInstruccionChoferIA = enviarInstruccionChoferIA;
window.restaurarChoferIA = restaurarChoferIA;
window.ejecutarAuditoriaComiteGeminiIA = ejecutarAuditoriaComiteGeminiIA;
window.toggleModoPrecioTarjeta = toggleModoPrecioTarjeta;
window.toggleTipoPrecioTarjeta = toggleTipoPrecioTarjeta;
window.cerrarModuloConciliacionIA = cerrarModuloConciliacionIA;
window.confirmarCostoReposicionDesdeIA = confirmarCostoReposicionDesdeIA;
window.seleccionarEImpactarCostoTarjeta = seleccionarEImpactarCostoTarjeta;
window.seleccionarCostoLoteTarjeta = seleccionarCostoLoteTarjeta;
window.cambiarCrudoTabPropia = cambiarCrudoTabPropia;
window.cambiarFuenteCrudoTabPropia = cambiarFuenteCrudoTabPropia;
window.cambiarCostoCrudoManualTabPropia = cambiarCostoCrudoManualTabPropia;
window.cambiarColaboradorTabPropia = cambiarColaboradorTabPropia;
window.cambiarServicioTabPropia = cambiarServicioTabPropia;
window.cambiarTarifaManualTabPropia = cambiarTarifaManualTabPropia;
window.aplicarMermaTabPropia = aplicarMermaTabPropia;
window.irAPanelLdnDesdeConciliacion = irAPanelLdnDesdeConciliacion;
window.confirmarCostoProduccionPropiaModal = confirmarCostoProduccionPropiaModal;
window.confirmarCostoFraccionadoPropioModal = confirmarCostoFraccionadoPropioModal;


