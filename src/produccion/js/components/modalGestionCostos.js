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

async function abrirModuloConciliacionIA(articuloId, tagsOpcionales = null, opcionesOver = {}) {
    if (!articuloId) {
        Swal.fire('Atención', 'Debe seleccionar un artículo válido.', 'warning');
        return;
    }

    articuloIdActualConciliacion = articuloId;
    tagEnEdicionIndex = null;

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
        <div style="background: #1e293b; padding: 14px 24px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
            <div style="display: flex; align-items: center; gap: 14px;">
                <div style="background: linear-gradient(135deg, #6366f1, #0284c7); padding: 8px 12px; border-radius: 8px; font-size: 1.3rem;">🤖</div>
                <div>
                    <h2 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 10px;">
                        Mesa Integrada de Fuentes de Reposición y Trazabilidad (Tabla B4.1 & Lotes Supabase)
                        <span style="font-size: 0.72rem; background: #0284c7; color: white; padding: 2px 8px; border-radius: 12px;">Pizarra Inteligente</span>
                    </h2>
                    <div id="art-target-header-info" style="font-size: 0.82rem; color: #94a3b8; margin-top: 2px;">
                        Cargando información del artículo <strong style="color: #38bdf8;">${articuloId}</strong>...
                    </div>
                </div>
            </div>

            <!-- UNIFIED CONVERSATIONAL BAR WITH AI CHOFER -->
            <div style="display: flex; align-items: center; gap: 10px; flex: 1; max-width: 540px; margin: 0 24px;">
                <div style="position: relative; width: 100%;">
                    <input type="text" id="input-instruccion-chofer" 
                        placeholder="💬 Hablar con el Chofer IA (ej: 'quitar tostados', 'solo bultos > 10kg')..."
                        style="width: 100%; padding: 9px 14px; padding-right: 36px; background: #0f172a; border: 1px solid #0284c7; border-radius: 8px; color: white; font-size: 0.88rem; outline: none; box-shadow: 0 0 10px rgba(2, 132, 199, 0.2);"
                        onkeyup="if(event.key==='Enter') enviarInstruccionChoferIA();" />
                </div>
                <button onclick="enviarInstruccionChoferIA()" style="background: linear-gradient(135deg, #0284c7, #6366f1); color: white; border: none; padding: 9px 18px; border-radius: 8px; font-size: 0.85rem; font-weight: 700; cursor: pointer; white-space: nowrap; box-shadow: 0 2px 8px rgba(2, 132, 199, 0.3);">
                    ⚡ Enviar a Chofer IA
                </button>
            </div>

            <button onclick="cerrarModuloConciliacionIA()" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); padding: 7px 14px; border-radius: 6px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
                ✖️ Cerrar Escenario
            </button>
        </div>

        <!-- CONTENIDO PRINCIPAL -->
        <div style="flex: 1; padding: 20px 32px; overflow-y: auto; background: #0f172a;" id="conciliacion-content-area">
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
            criterio_orden: criterioOrdenMemoria,
            excluir_cero: excluirCeroMemoria
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
            forzar_refresco: true,
            criterio_orden: criterioOrdenMemoria,
            excluir_cero: excluirCeroMemoria
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

    // 2. Capa Proveedor Habitual
    const capaHabitual = data.capa_habitual || [];

    // 3. Capa Operador Manual
    const capaOperadorExactos = (data.capa_operador && data.capa_operador.exactos) || data.nivel_1_exacto || [];
    const capaOperadorSugerencias = (data.capa_operador && data.capa_operador.sugerencias) || data.nivel_2_sugerencias || [];

    // 4. Capa Chofer IA
    const capaChoferIA = data.capa_chofer_ia || [];
    const fichaIA = data.ficha_semantica_ia || {};

    // Selección inteligente de pestaña activa por defecto
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
        tabContentHtml = `
            <div style="background: rgba(168, 85, 247, 0.03); padding: 18px; border-radius: 12px; border: 1px dashed rgba(168, 85, 247, 0.25);">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
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

        tabContentHtml = `
            <!-- INSIGHT Y BLOQUES DE RAZONAMIENTO ESTRUCTURADO DEL CHOFER IA -->
            <div style="background: linear-gradient(135deg, rgba(2, 132, 199, 0.12), rgba(99, 102, 241, 0.12)); border: 1px solid #0284c7; padding: 18px 22px; border-radius: 12px; margin-bottom: 24px; box-shadow: 0 4px 16px rgba(2, 132, 199, 0.15);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: ${bloquesRazonamiento.length > 0 ? '14px' : '0'};">
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px; font-size: 0.98rem; font-weight: 700; color: #38bdf8; margin-bottom: 8px; flex-wrap: wrap;">
                            <span>🧠 Cadena de Razonamiento del Chofer IA:</span>
                            <span style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; padding: 3px 10px; border-radius: 6px; font-size: 0.76rem; border: 1px solid rgba(56, 189, 248, 0.3);">🌱 Materia Prima: ${entidadStr}</span>
                            ${calibreTargetStr ? `<span style="background: rgba(16, 185, 129, 0.22); color: #34d399; padding: 3px 10px; border-radius: 6px; font-size: 0.76rem; border: 1px solid rgba(16, 185, 129, 0.45); font-weight: 800;">📏 Calibre/Tamaño Objetivo: ${calibreTargetStr}</span>` : ''}
                            ${ingVincStr ? `<span style="background: rgba(99, 102, 241, 0.22); color: #a5b4fc; padding: 3px 10px; border-radius: 6px; font-size: 0.76rem; border: 1px solid rgba(99, 102, 241, 0.45);">🔗 Insumo Fábrica: ${ingVincStr}</span>` : ''}
                            <span style="background: ${conformacionBg}; color: ${conformacionColor}; padding: 3px 10px; border-radius: 6px; font-size: 0.76rem; border: 1px solid ${conformacionBorder}; font-weight: 700;">${conformacionLabel}</span>
                            <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; padding: 3px 10px; border-radius: 6px; font-size: 0.76rem; border: 1px solid rgba(16, 185, 129, 0.3);">🍃 ${estadoStr}</span>
                            <span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; padding: 3px 10px; border-radius: 6px; font-size: 0.76rem; border: 1px solid rgba(245, 158, 11, 0.3);">📦 ${empaqueStr}</span>
                        </div>
                        <div style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.5; max-width: 960px;">
                            💡 <strong>Síntesis de Ordenamiento:</strong>
                            <strong style="color: #34d399;">${itemsNivel1.length} coincidencias fuertes vigentes</strong> en primera línea${itemsNivel2.length > 0 ? `, <strong style="color: #38bdf8;">${itemsNivel2.length} variantes vigentes (otro calibre o caja fraccionada 10x1kg)</strong> en segundo orden` : ''}${itemsNivel3.length > 0 ? `, <strong style="color: #fbbf24;">${itemsNivel3.length} referencias secundarias</strong>` : ''}${itemsNivel4.length > 0 ? ` y <strong style="color: #f87171;">${itemsNivel4.length} ofertas vencidas (> 45 días)</strong> desplazadas al fondo` : ''}.
                        </div>
                    </div>
                    <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 8px 12px; font-size: 0.74rem; color: #94a3b8; text-align: right;">
                        💬 Escribe en la barra superior y pulsa <strong>⚡ Enviar a Chofer IA</strong> para instruir más filtros.
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
    }

    contentArea.innerHTML = `
        <!-- RESUMEN DE FLUJOS Y CONTADORES METRICOS -->
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; background: #1e293b; padding: 10px 16px; border-radius: 8px; border: 1px solid #334155;">
            <div style="display: flex; align-items: center; gap: 12px; font-size: 0.8rem; color: #94a3b8;">
                <span>Escaneadas B4.1: <strong style="color: #38bdf8;">${totalEscaneadas.toLocaleString('es-AR')}</strong></span>
                <span>•</span>
                <span>Proveedores en Resultados: <strong style="color: #cbd5e1;">${provsStr || 'Ninguno'}</strong></span>
            </div>
            <div style="font-size: 0.76rem; color: #a78bfa; display: flex; align-items: center; gap: 10px;">
                <span>⚡ Arquitectura de 4 Capas: Depósito • Habitual • Operador • Chofer IA</span>
                <button id="btn-sync-supa" onclick="forzarSincronizacionSupabase(this)" style="background: rgba(56, 189, 248, 0.14); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); padding: 3px 10px; border-radius: 6px; font-size: 0.74rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: all 0.2s;" title="Reconsultar inmediatamente Supabase para traer especificaciones y precios recién editados">
                    🔄 Sincronizar Supabase
                </button>
            </div>
        </div>

        <!-- NAVEGACIÓN POR PESTAÑAS (TABS) -->
        <div style="display: flex; gap: 8px; border-bottom: 2px solid #334155; margin-bottom: 20px; overflow-x: auto;">
            <button class="tab-conciliacion-btn ${tabActiva === 'LOTES' ? 'active' : ''}" onclick="cambiarTabConciliacion('LOTES')">
                📦 1. Lotes de Depósito <span class="tab-counter-badge">${lotesHistoria.length}</span>
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
        </div>

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
        <div class="prov-card">
            <div>
                <!-- CABECERA TARJETA: PROVEEDOR Y RECIENCIA -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                    <div>
                        <div style="font-weight: 700; color: #f8fafc; font-size: 0.95rem;">${item.proveedor_nombre}</div>
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
                    ${tipoPrecioActual === 'PROMO' ? '🔥 Impactar Costo Promo' : '✅ Impactar Costo'} ($${costoBultoFinal.toLocaleString('es-AR', {minimumFractionDigits: 2})}/bulto)
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
                ${!esIngrediente ? `
                <div style="margin-top: 14px; padding: 10px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 6px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: #fde047; font-size: 0.82rem; font-weight: 600; margin: 0;">
                        <input type="checkbox" id="chk-sincronizar-ingrediente-modal" checked style="width: 16px; height: 16px; accent-color: #f59e0b; cursor: pointer;">
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
    const fechaStr = lote.fecha_vinculacion ? new Date(lote.fecha_vinculacion).toLocaleDateString('es-AR') : 'N/D';
    
    let diasTranscurridos = 'Reciente';
    if (lote.fecha_vinculacion) {
        const diffMs = new Date() - new Date(lote.fecha_vinculacion);
        const dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        diasTranscurridos = dias === 0 ? 'Hoy' : `hace ${dias} día${dias !== 1 ? 's' : ''}`;
    }

    const loteIdClean = (lote.lote_codigo_corto || lote.lote_id_supabase || 'Sin Código').substring(0, 16);
    const provNombre = lote.proveedor_nombre || 'Proveedor Depósito';
    const artDesc = lote.articulo_descripcion || 'Ingreso de mercadería';
    const remito = lote.numero_remito ? ` • Remito: ${lote.numero_remito}` : '';
    const prodCod = lote.producto_codigo ? ` [${lote.producto_codigo}]` : '';

    const provEscaped = (provNombre || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const artDescEscaped = (artDesc || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

    return `
        <div style="background: #1e293b; border: 1px solid rgba(168, 85, 247, 0.4); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between; gap: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.25);">
            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span style="background: rgba(168, 85, 247, 0.2); color: #c084fc; font-weight: 700; font-size: 0.76rem; padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(168, 85, 247, 0.4);">
                        🏷️ Lote #${index + 1} (${loteIdClean})
                    </span>
                    <span style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 600; font-size: 0.74rem; padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.3);">
                        📅 ${diasTranscurridos} (${fechaStr})
                    </span>
                </div>
                <div style="font-size: 0.95rem; font-weight: 700; color: #f3f4f6; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                    <span style="color: #c084fc;">🏢 Proveedor:</span>
                    <span style="color: #38bdf8;">${provNombre}</span>
                </div>
                <div style="font-size: 0.85rem; font-weight: 600; color: #e2e8f0; margin-bottom: 4px;">
                    📦 Insumo: <span style="color: #fde047;">${artDesc}${prodCod}</span>
                </div>
                <div style="font-size: 0.74rem; color: #94a3b8; line-height: 1.4;">
                    Ingreso físico recepcionado por escáner en depósito${remito}
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

            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem;">
                <span style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; padding: 2px 7px; border-radius: 4px; border: 1px solid rgba(245, 158, 11, 0.3);">
                    IVA ${porcentajeIva}%
                </span>
                <button onclick="seleccionarCostoLoteTarjeta(${index})" 
                    style="background: #a855f7; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s;"
                    title="Actualizar explícitamente el costo de simulación con este lote">
                    📥 Tomar Costo de Lote
                </button>
            </div>
        </div>
    `;
}

async function seleccionarCostoLoteTarjeta(index) {
    if (!datosEstadoActualConciliacion || !Array.isArray(datosEstadoActualConciliacion.historial_lotes_recientes)) return;
    const lote = datosEstadoActualConciliacion.historial_lotes_recientes[index];
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
        lote.articulo_descripcion || ''
    );
}

window.aplicarCostoLoteSimulacion = async function(articuloId, costoKilo, porcentajeIva, loteIdSupabase = '', provNombre = '', artDesc = '') {
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
window.toggleModoPrecioTarjeta = toggleModoPrecioTarjeta;
window.toggleTipoPrecioTarjeta = toggleTipoPrecioTarjeta;
window.cerrarModuloConciliacionIA = cerrarModuloConciliacionIA;
window.confirmarCostoReposicionDesdeIA = confirmarCostoReposicionDesdeIA;
window.seleccionarEImpactarCostoTarjeta = seleccionarEImpactarCostoTarjeta;
window.seleccionarCostoLoteTarjeta = seleccionarCostoLoteTarjeta;

