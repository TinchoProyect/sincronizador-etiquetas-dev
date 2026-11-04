/**
 * =========================================================================
 * MÓDULO ACCORDION LDN 1 — PIZARRA INTELIGENTE DE COSTOS (LAMDA B2B)
 * =========================================================================
 * Encapsula la lógica de maquetado dual, toggle de acordeones y conteos
 * de la pestaña [LDN 1] Comercialización Directa.
 * 
 * Regla de Negocio:
 * - Sin Receta (tiene_receta === false): Comercialización Directa.
 * - Con Receta (tiene_receta === true): Transformados / Auditoría.
 * - Exclusión Mutua: La apertura de un acordeón cierra automáticamente el hermano.
 * - Preservación de Estado: El colapso del DOM NO limpia window.articuloSeleccionadoId
 *   ni altera la Pizarra Comercial y Contraste Multilista.
 */

// Estados colapsables globales para jerarquía de Pizarra (Replegados por defecto)
window.pizarraFamiliasDesplegadas = window.pizarraFamiliasDesplegadas || new Set();
window.pizarraSubfamiliasDesplegadas = window.pizarraSubfamiliasDesplegadas || new Set();

window.togglePizarraColapsarFamilia = function(famKey, e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (!window.pizarraFamiliasDesplegadas || !(window.pizarraFamiliasDesplegadas instanceof Set)) {
        window.pizarraFamiliasDesplegadas = new Set();
    }
    if (window.pizarraFamiliasDesplegadas.has(famKey)) {
        window.pizarraFamiliasDesplegadas.delete(famKey);
    } else {
        window.pizarraFamiliasDesplegadas.add(famKey);
    }
    if (typeof window.renderizarArticulosBunkerLDN1 === 'function') {
        window.renderizarArticulosBunkerLDN1();
    }
};

window.togglePizarraColapsarSubfamilia = function(subfamKey, e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (!window.pizarraSubfamiliasDesplegadas || !(window.pizarraSubfamiliasDesplegadas instanceof Set)) {
        window.pizarraSubfamiliasDesplegadas = new Set();
    }
    if (window.pizarraSubfamiliasDesplegadas.has(subfamKey)) {
        window.pizarraSubfamiliasDesplegadas.delete(subfamKey);
    } else {
        window.pizarraSubfamiliasDesplegadas.add(subfamKey);
    }
    if (typeof window.renderizarArticulosBunkerLDN1 === 'function') {
        window.renderizarArticulosBunkerLDN1();
    }
};

// Alternar apertura/cierre de acordeón de forma totalmente independiente
function toggleAccordion(id) {
    const targetItem = document.getElementById(id);
    if (!targetItem) return;

    // Alternar el acordeón seleccionado de forma independiente
    targetItem.classList.toggle('open');
    const isOpen = targetItem.classList.contains('open');
    const targetIcon = targetItem.querySelector('.accordion-icon');
    if (targetIcon) {
        targetIcon.innerText = isOpen ? '🔽' : '▶️';
    }

    if (window.VigíaPizarra) {
        const titulo = targetItem.querySelector('.accordion-title span')?.innerText || id;
        window.VigíaPizarra.logEvent('PANEL', `Acordeón LDN 1 "${titulo}" ${isOpen ? 'DESPLEGADO 🔽' : 'REPLEGADO ▶️'}`, {
            accordionId: id,
            isOpen: isOpen
        });
    }
}

// Motor de Búsqueda Unificado LAMDA (Política Universal Fase 49 - Single Source of Truth)
window.obtenerTextoBusquedaArticulo = function(art) {
    if (!art) return '';

    const tokens = [];

    // 1. Nomenclador Generado Visible en Pantalla
    if (art.descripcion_generada) tokens.push(art.descripcion_generada);
    if (art.descripcion && art.descripcion !== art.descripcion_generada) {
        tokens.push(art.descripcion);
    }

    // 2. Nombre de la Familia
    const famNombre = art.familia_nombre || art.familia || art.nombre_familia || art.propiedades_dinamicas?.familia_nombre;
    if (famNombre) tokens.push(famNombre);

    // 3. Rubro y Sub-Rubro
    if (art.rubro) tokens.push(art.rubro);
    if (art.sub_rubro) tokens.push(art.sub_rubro);

    // 4. Kilos por Unidad
    if (art.kilos_unidad) {
        const k = parseFloat(art.kilos_unidad);
        if (!isNaN(k)) {
            tokens.push(`${k}kg`);
            tokens.push(`${k} kg`);
        }
    }

    // 5. Atributos descriptivos completos (palabras completas 'valor', omitiendo abreviaturas)
    if (art.propiedades_dinamicas && typeof art.propiedades_dinamicas === 'object') {
        const pd = art.propiedades_dinamicas;

        if (pd.articulo_principal) tokens.push(pd.articulo_principal);

        const posObj = pd.posiciones || pd;
        if (posObj && typeof posObj === 'object') {
            Object.keys(posObj).forEach(key => {
                if (key.startsWith('asistente_') || key.startsWith('rendimiento_') || key.startsWith('tostadero_') || key.startsWith('_meta')) {
                    return;
                }
                const item = posObj[key];
                if (item && typeof item === 'object' && item.valor) {
                    tokens.push(item.valor);
                } else if (typeof item === 'string' && key !== 'articulo_principal' && key !== 'familia_nombre') {
                    tokens.push(item);
                }
            });
        }
    }

    // 6. Ingredientes de Recetas asociadas y fórmulas
    if (window.pizarraSimulacionMaster) {
        const master = window.pizarraSimulacionMaster;
        const skuUpper = (art.articulo_id || '').trim().toUpperCase();

        const indexarIng = (ingId, nombreDefault) => {
            if (nombreDefault) tokens.push(nombreDefault);
            const ing = (master.ingredientes || []).find(i => i.id === ingId);
            if (ing) {
                if (ing.nombre) tokens.push(ing.nombre);
                if (ing.articulo_vinculado_numero) tokens.push(ing.articulo_vinculado_numero);
                (ing.bunker_articulos || []).forEach(b => {
                    if (b.codigo) tokens.push(b.codigo);
                    if (b.descripcion) tokens.push(b.descripcion);
                    const bArt = (master.articulosBunker || []).find(a => (a.articulo_id || '').trim().toUpperCase() === String(b.codigo || '').trim().toUpperCase());
                    if (bArt) {
                        if (bArt.descripcion_generada) tokens.push(bArt.descripcion_generada);
                        if (bArt.kilos_unidad) tokens.push(`${bArt.kilos_unidad}kg`, `${bArt.kilos_unidad} kg`, String(bArt.kilos_unidad));
                    }
                });
                if (ing.articulo_vinculado_numero) {
                    const bArtVinc = (master.articulosBunker || []).find(a => (a.articulo_id || '').trim().toUpperCase() === String(ing.articulo_vinculado_numero || '').trim().toUpperCase());
                    if (bArtVinc) {
                        if (bArtVinc.descripcion_generada) tokens.push(bArtVinc.descripcion_generada);
                        if (bArtVinc.kilos_unidad) tokens.push(`${bArtVinc.kilos_unidad}kg`, `${bArtVinc.kilos_unidad} kg`, String(bArtVinc.kilos_unidad));
                    }
                }
            }
        };

        const recs = (master.recetas || []).filter(r => (r.articulo_numero || '').trim().toUpperCase() === skuUpper);
        recs.forEach(r => {
            const ingsRec = (master.recetaIngredientes || []).filter(ri => ri.receta_id === r.id);
            ingsRec.forEach(ri => indexarIng(ri.ingrediente_id, ri.nombre_ingrediente));
        });

        if (skuUpper === 'BF24X50' && master.composicionMix) {
            tokens.push('barrita', 'barritas', 'barra flor', 'bfxp', 'bfx50g');
            master.composicionMix.filter(c => c.mix_id === 109).forEach(c => indexarIng(c.ingrediente_id));
        }
        if (skuUpper.startsWith('GDF') && master.composicionMix) {
            tokens.push('grana flor', 'granola flor');
            master.composicionMix.filter(c => c.mix_id === 134).forEach(c => indexarIng(c.ingrediente_id));
        }
        const esGranolaSol = skuUpper.startsWith('GS') && !skuUpper.startsWith('GSC') && 
            (skuUpper.startsWith('GSGN') || skuUpper.startsWith('GSX') || /^GS\d/.test(skuUpper) || (art.descripcion_generada || art.descripcion || '').toLowerCase().includes('grana sol'));
        if (esGranolaSol && master.composicionMix) {
            tokens.push('grana sol', 'granola sol');
            master.composicionMix.filter(c => c.mix_id === 132).forEach(c => indexarIng(c.ingrediente_id));
        }
    }

    // Normalización: minúsculas y sin acentos
    let text = tokens
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    // Expansión inteligente de abreviaturas/sinónimos búnker
    if (text.includes('vgna')) text += ' virginia';
    if (text.includes('virginia')) text += ' vgna';
    if (text.includes('reldo')) text += ' repelado';
    if (text.includes('repelado')) text += ' reldo';
    if (text.includes('sem ')) text += ' semilla ';

    return text;
};

// Renderizado dual en LDN 1 según flag relacional PostgreSQL `tiene_receta`
function renderizarArticulosBunkerLDN1() {
    const searchInput = document.getElementById('search-articulos');
    const queryRaw = searchInput ? searchInput.value : '';
    const queryNorm = queryRaw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const searchTerms = queryNorm.split(/\s+/).filter(Boolean);
    
    const gridSinReceta = document.getElementById('grid-sin-receta');
    const gridConRecetaMono = document.getElementById('grid-con-receta-mono');
    const gridConRecetaCompuestas = document.getElementById('grid-con-receta-compuestas');
    const gridConRecetaUP = document.getElementById('grid-con-receta-up');
    const gridIngredientes = document.getElementById('grid-ingredientes-relacionados');

    if (!gridSinReceta) return;

    gridSinReceta.innerHTML = '';
    if (gridConRecetaMono) gridConRecetaMono.innerHTML = '';
    if (gridConRecetaCompuestas) gridConRecetaCompuestas.innerHTML = '';
    if (gridConRecetaUP) gridConRecetaUP.innerHTML = '';
    if (gridIngredientes) gridIngredientes.innerHTML = '';

    const master = window.pizarraSimulacionMaster;
    if (!master || !master.articulosBunker) {
        return;
    }

    const todos = master.articulosBunker;
    const ingredientesList = window.pizarraSimulacionMaster.ingredientes || [];
    const lotesList = window.pizarraSimulacionMaster.lotes || [];
    const recetasList = window.pizarraSimulacionMaster.recetas || [];
    const recetaIngredientesList = window.pizarraSimulacionMaster.recetaIngredientes || [];
    const composicionMixList = window.pizarraSimulacionMaster.composicionMix || [];
    
    let countSin = 0;
    let countConMono = 0;
    let countConCompuestas = 0;
    let countConUP = 0;
    let countIng = 0;

    // -------------------------------------------------------------------------
    // PASO 1: Renderizar solo Comercialización Directa (Sin Receta) en el 1er Acordeón
    // El buscador query (Motor Unificado LAMDA) impacta EXCLUSIVAMENTE sobre esta sección
    // -------------------------------------------------------------------------
    const directosSinRecetaVisibles = [];

    // Helper Unificado de Finanzas Búnker (Single Source of Truth)
    function obtenerFinanzasBunkerArticulo(art) {
        const kilosUnidad = parseFloat(art.kilos_unidad || 0);
        const articulosListas = (window.pizarraSimulacionMaster && Array.isArray(window.pizarraSimulacionMaster.articulosListas))
            ? window.pizarraSimulacionMaster.articulosListas
            : [];

        const listaPatron = articulosListas.find(la => la.articulo_numero === art.articulo_id && la.es_patron === true) ||
                            articulosListas.find(la => la.articulo_numero === art.articulo_id && la.lista_id === 1) ||
                            articulosListas.find(la => la.articulo_numero === art.articulo_id);

        let costoKilo = 0;
        let porcentajeIva = parseFloat(art.porcentaje_iva || 21);

        if (listaPatron) {
            if (listaPatron.iva !== null && listaPatron.iva !== undefined && !isNaN(parseFloat(listaPatron.iva))) {
                porcentajeIva = parseFloat(listaPatron.iva);
            }
            if (listaPatron.costo_base_sobrescrito !== null && listaPatron.costo_base_sobrescrito !== undefined && parseFloat(listaPatron.costo_base_sobrescrito) > 0) {
                costoKilo = parseFloat(listaPatron.costo_base_sobrescrito);
            }
        }

        if (costoKilo === 0 && parseFloat(art.costo_base || 0) > 0 && kilosUnidad > 0) {
            costoKilo = parseFloat(art.costo_base) / kilosUnidad;
        }

        const costoBulto = costoKilo * kilosUnidad;
        const listasDelArt = articulosListas.filter(la => la.articulo_numero === art.articulo_id && la.disponible !== false);
        let listasDesfasadasCount = 0;
        if (costoBulto > 0 && listasDelArt.length > 0) {
            listasDelArt.forEach(la => {
                const m = parseFloat(la.margen_ganancia || 0);
                const mo = la.mano_obra_activa !== false ? parseFloat(la.costo_tiempo || 0) : 0;
                const ivaLa = parseFloat(la.iva !== null && la.iva !== undefined ? la.iva : porcentajeIva);
                const pEsp = (costoBulto * (1 + (m / 100)) + mo) * (1 + (ivaLa / 100));
                const pGrab = parseFloat(la.precio_final || 0);
                if (Math.abs(pEsp - pGrab) > 2.0) listasDesfasadasCount++;
            });
        }

        return {
            costoKilo,
            costoBulto,
            porcentajeIva,
            listasDesfasadasCount
        };
    }
    window.obtenerFinanzasBunkerArticulo = obtenerFinanzasBunkerArticulo;

    const familiasMap = new Map();

    todos.forEach(art => {
        const esPack = art.pack_hijo_codigo && art.pack_hijo_codigo.trim() !== '';
        if (esPack) return;
        if (art.tiene_receta === true) return; // Solo artículos directos sin receta

        // Excluir artículos de producción interna (APs y UPs) de la Comercialización Directa de LDN 1
        const famNombre = String(art.familia_nombre || art.familia || '').toLowerCase().trim();
        const descLower = String(art.descripcion || '').toLowerCase().trim();
        const esProduccionInterna = famNombre === 'produccion' ||
                                    descLower === 'articulo puente' ||
                                    descLower === 'unidad productiva' ||
                                    String(art.articulo_id || '').startsWith('PROD');
        if (esProduccionInterna) return;

        let matchQuery = true;
        if (searchTerms.length > 0) {
            const searchableText = window.obtenerTextoBusquedaArticulo(art);
            const codeNorm = (art.articulo_id || '').toLowerCase();
            matchQuery = searchTerms.every(term => searchableText.includes(term) || codeNorm.includes(term));
        }

        if (!matchQuery) return;

        directosSinRecetaVisibles.push(art);
        countSin++;

        const stockBultos = parseFloat(art.stock_consolidado || 0);
        const kilosUnidad = parseFloat(art.kilos_unidad || 0);
        const totalKilos = stockBultos * kilosUnidad;

        const finanzas = obtenerFinanzasBunkerArticulo(art);
        const costoBaseBulto = finanzas.costoBulto;
        const costoKilo = finanzas.costoKilo;
        const porcentajeIva = finanzas.porcentajeIva;

        // -------------------------------------------------------------------------
        // EVALUACIÓN DETERMINISTA DEL SEMÁFORO DE COSTOS ($/KG) VS INGREDIENTE FÁBRICA
        // -------------------------------------------------------------------------
        const ingVinculado = ingredientesList.find(ing => {
            const vinculacionesDirectas = ing.bunker_articulos || [];
            const esDirecto = ing.articulo_vinculado_numero === art.articulo_id;
            const esJunction = vinculacionesDirectas.some(b => (b.codigo || b.articulo_id) === art.articulo_id);
            return esDirecto || esJunction;
        });

        let badgeSemaforo = `<span class="art-badge-tipo" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);" title="Artículo sin ingrediente de fábrica vinculado">⚪ Sin Vínculo</span>`;
        let bordeSemaforoStyle = '';

        if (ingVinculado) {
            const costoIngKilo = parseFloat(ingVinculado.costo_patron || 0);
            const diffKilo = costoKilo - costoIngKilo;

            if (Math.abs(diffKilo) < 0.05) {
                badgeSemaforo = `<span class="art-badge-tipo success" style="box-shadow: 0 0 6px rgba(16, 185, 129, 0.3);" title="Costo $/kg del artículo es idéntico al del insumo en fábrica ($${costoKilo.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)">🟢 Alineado 100%</span>`;
                bordeSemaforoStyle = 'border-color: rgba(16, 185, 129, 0.4);';
            } else if (costoKilo > costoIngKilo) {
                const diffFmt = diffKilo.toLocaleString('es-AR', {minimumFractionDigits: 2});
                const costoKiloFmt = costoKilo.toLocaleString('es-AR', {minimumFractionDigits: 2});
                badgeSemaforo = `
                    <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
                        <span class="art-badge-tipo danger" style="box-shadow: 0 0 8px rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.18); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4);" title="Desfasaje positivo: El costo $/kg del artículo es mayor que en fábrica (+$${diffFmt}/kg)">🔴 Superior (+$${diffFmt}/kg)</span>
                        <button onclick="sincronizarIngredienteDesdeArticulo('${art.articulo_id}', ${ingVinculado.id})" 
                            style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); padding: 2px 8px; border-radius: 5px; font-size: 0.7rem; font-weight: 700; cursor: pointer; transition: all 0.2s;"
                            title="Transferir $${costoKiloFmt}/kg al insumo en fábrica '${ingVinculado.nombre}'">
                            ⚡ Actualizar Insumo ($${costoKiloFmt}/kg)
                        </button>
                    </div>
                `;
                bordeSemaforoStyle = 'border-color: rgba(239, 68, 68, 0.45);';
            } else {
                const diffFmt = Math.abs(diffKilo).toLocaleString('es-AR', {minimumFractionDigits: 2});
                const costoKiloFmt = costoKilo.toLocaleString('es-AR', {minimumFractionDigits: 2});
                badgeSemaforo = `
                    <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
                        <span class="art-badge-tipo warning" style="box-shadow: 0 0 8px rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.18); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);" title="Alerta de margen: El costo $/kg del artículo está por debajo del insumo en fábrica (-$${diffFmt}/kg)">🟡 Inferior (-$${diffFmt}/kg)</span>
                        <button onclick="sincronizarIngredienteDesdeArticulo('${art.articulo_id}', ${ingVinculado.id})" 
                            style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); padding: 2px 8px; border-radius: 5px; font-size: 0.7rem; font-weight: 700; cursor: pointer; transition: all 0.2s;"
                            title="Transferir $${costoKiloFmt}/kg al insumo en fábrica '${ingVinculado.nombre}'">
                            ⚡ Actualizar Insumo ($${costoKiloFmt}/kg)
                        </button>
                    </div>
                `;
                bordeSemaforoStyle = 'border-color: rgba(245, 158, 11, 0.45);';
            }
        }

        const card = document.createElement('div');
        const isSelected = Array.isArray(window.articulosSeleccionadosIds)
            ? window.articulosSeleccionadosIds.includes(art.articulo_id)
            : window.articuloSeleccionadoId === art.articulo_id;

        card.className = `articulo-card` + (isSelected ? ' active' : '');
        if (bordeSemaforoStyle && !isSelected) {
            card.style.cssText = bordeSemaforoStyle;
        }
        card.setAttribute('data-tooltip', `${art.descripcion_generada || art.descripcion} | Stock: ${stockBultos} bultos (${totalKilos.toFixed(1)} kg tot.) | Costo: $${costoBaseBulto.toLocaleString('es-AR', {minimumFractionDigits:2})}/bulto ($${costoKilo.toLocaleString('es-AR', {minimumFractionDigits:2})}/kg) [CTRL+Clic para multiselección]`);
        card.onclick = (e) => {
            if (typeof window.seleccionarArticuloMulti === 'function') {
                window.seleccionarArticuloMulti(art.articulo_id, e);
            } else if (typeof window.seleccionarArticulo === 'function') {
                window.seleccionarArticulo(art.articulo_id);
            }
        };

        const badgeIva = `<span class="art-badge-tipo warning" title="IVA Implícito en Búnker">IVA ${porcentajeIva}%</span>`;

        card.innerHTML = `
            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <div class="art-code">${art.articulo_id}</div>
                        <button onclick="event.stopPropagation(); abrirModuloConciliacionIA('${art.articulo_id}')" 
                            style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; border: none; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 700; cursor: pointer; box-shadow: 0 0 6px rgba(139, 92, 246, 0.4);" 
                            title="Abrir Mesa Integrada de Fuentes de Reposición (Tabla B4.1 & Lotes Supabase)">
                            🤖 Conciliar IA
                        </button>
                    </div>
                    ${badgeIva}
                </div>
                <div class="art-name-compact" title="${art.descripcion_generada || art.descripcion}">${art.descripcion_generada || art.descripcion}</div>
            </div>
            <div class="art-stock-info" style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255, 255, 255, 0.08); display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem;">
                <span style="color: var(--text-secondary);">Stock: <strong style="color: ${stockBultos > 0 ? '#10b981' : '#ef4444'}; font-weight: 700;">${stockBultos.toLocaleString('es-AR')} bultos</strong></span>
                <span style="color: #06b6d4; font-weight: 600;" title="Totalidad de kilos disponibles en depósito">📦 ${totalKilos.toFixed(1).replace('.', ',')} kg tot.</span>
            </div>
            <div style="margin-top: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; background: rgba(0, 0, 0, 0.25); padding: 4px 6px; border-radius: 4px; border: 1px solid rgba(245, 158, 11, 0.15);">
                <span style="color: #f59e0b; font-weight: 700;" title="Costo total del bulto cerrado provisto por Búnker">💰 $${costoBaseBulto.toLocaleString('es-AR', {minimumFractionDigits: 2})}/bulto</span>
                <button onclick="event.stopPropagation(); abrirEdicionManualCostoIva('${art.articulo_id}')" 
                    style="background: rgba(96, 165, 250, 0.15); color: #60a5fa; border: 1px solid rgba(96, 165, 250, 0.3); border-radius: 4px; padding: 1px 5px; font-size: 0.7rem; font-weight: 600; cursor: pointer; transition: all 0.2s;" 
                    title="Editar manualmente el Costo $/kg e IVA de este artículo">
                    ✏️ ($${costoKilo.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)
                </button>
            </div>
            ${finanzas.listasDesfasadasCount > 0 ? `<div style="margin-top: 4px; padding: 3px 6px; border-radius: 4px; background: rgba(239, 68, 68, 0.18); border: 1px solid rgba(239, 68, 68, 0.45); display: flex; justify-content: space-between; align-items: center; font-size: 0.68rem; color: #fca5a5;" title="Hay ${finanzas.listasDesfasadasCount} lista(s) de venta cuyo precio final grabado en BD no refleja este costo de ${costoBaseBulto.toLocaleString('es-AR', {minimumFractionDigits: 2})}/bulto"><span>⚠️ ${finanzas.listasDesfasadasCount} lista(s) s/recalcular</span><button onclick="event.stopPropagation(); abrirEdicionManualCostoIva('${art.articulo_id}')" style="background: #ef4444; color: white; border: none; border-radius: 3px; padding: 1px 6px; font-size: 0.66rem; font-weight: 700; cursor: pointer;">⚡ Impactar</button></div>` : ''}
            <div class="art-footer" style="margin-top: 6px;">
                <span>${kilosUnidad.toFixed(2)} kg/bulto</span>
                ${badgeSemaforo}
            </div>
        `;
        // Helper de Resolución de Nombre de Familia Búnker (Single Source of Truth)
        function obtenerPizarraFamiliaNombre(art) {
            if (art && art.familia_nombre && String(art.familia_nombre).trim()) {
                return String(art.familia_nombre).trim();
            }
            if (art && art.familia && String(art.familia).trim()) {
                return String(art.familia).trim();
            }
            if (art && art.nombre_familia && String(art.nombre_familia).trim()) {
                return String(art.nombre_familia).trim();
            }
            if (art && art.propiedades_dinamicas?.familia_nombre && String(art.propiedades_dinamicas.familia_nombre).trim()) {
                return String(art.propiedades_dinamicas.familia_nombre).trim();
            }
            const master = window.pizarraSimulacionMaster;
            if (master) {
                const listFam = master.familiasBunker || master.familias || master.bunkerFamilias || [];
                if (Array.isArray(listFam)) {
                    const famObj = listFam.find(f => Number(f.id) === Number(art.familia_id));
                    if (famObj && (famObj.nombre || famObj.familia_nombre)) {
                        return String(famObj.nombre || famObj.familia_nombre).trim();
                    }
                }
            }
            if (art && art.rubro && String(art.rubro).trim()) {
                return String(art.rubro).trim();
            }
            return 'Sin Familia';
        }

        // Clasificar en mapa jerárquico Nivel 1 & Nivel 2
        const famName = obtenerPizarraFamiliaNombre(art);
        const famIdKey = art.familia_id ? String(art.familia_id) : famName.toLowerCase().replace(/\s+/g, '_');
        const subfamName = (art.propiedades_dinamicas?.articulo_principal || art.descripcion || 'Sin Atributo Principal').trim();
        const subfamKey = `${famIdKey}___${subfamName.toLowerCase()}`;

        if (!familiasMap.has(famIdKey)) {
            familiasMap.set(famIdKey, {
                famKey: famIdKey,
                famName: famName,
                subfamiliasMap: new Map()
            });
        }
        const famObj = familiasMap.get(famIdKey);
        if (!famObj.subfamiliasMap.has(subfamKey)) {
            famObj.subfamiliasMap.set(subfamKey, {
                subfamKey: subfamKey,
                subfamName: subfamName,
                cards: []
            });
        }
        famObj.subfamiliasMap.get(subfamKey).cards.push({ art, card, kilosUnidad });
    });

    // RENDERIZADO JERÁRQUICO EN EL DOM DE gridSinReceta
    if (directosSinRecetaVisibles.length === 0) {
        gridSinReceta.innerHTML = '<div class="empty-state">No se encontraron artículos directos (sin receta).</div>';
    } else {
        const familiasArray = Array.from(familiasMap.values()).sort((a, b) => a.famName.localeCompare(b.famName));

        console.log(`🌳 [VIGÍA-FAMILIAS] Se detectaron ${familiasArray.length} familias en [LDN 1]:`, familiasArray.map(f => `${f.famName} (${Array.from(f.subfamiliasMap.values()).reduce((acc, s) => acc + s.cards.length, 0)} arts)`).join(', '));

        familiasArray.forEach(famObj => {
            const isFamExpanded = (window.pizarraFamiliasDesplegadas && typeof window.pizarraFamiliasDesplegadas.has === 'function')
                ? window.pizarraFamiliasDesplegadas.has(famObj.famKey)
                : false;
            const isFamCollapsed = !isFamExpanded;

            const subfamiliasArray = Array.from(famObj.subfamiliasMap.values()).sort((a, b) => a.subfamName.localeCompare(b.subfamName));
            let totalArtsInFam = 0;
            subfamiliasArray.forEach(s => totalArtsInFam += s.cards.length);

            const famContainer = document.createElement('div');
            famContainer.className = 'pizarra-familia-group';
            famContainer.style.cssText = 'grid-column: 1 / -1; width: 100%; margin-bottom: 3px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(168, 85, 247, 0.35); border-radius: 6px; overflow: hidden; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);';

            const famHeader = document.createElement('div');
            famHeader.className = 'pizarra-fam-header';
            famHeader.style.cssText = 'padding: 8px 14px; background: linear-gradient(90deg, rgba(126, 34, 206, 0.3) 0%, rgba(88, 28, 135, 0.2) 100%); border-left: 5px solid #a855f7; cursor: pointer; user-select: none; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(168, 85, 247, 0.2);';
            famHeader.onclick = (e) => window.togglePizarraColapsarFamilia(famObj.famKey, e);

            famHeader.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px; font-weight: 700; color: #c084fc; font-size: 0.95rem;">
                    <span style="font-size: 0.85rem; width: 16px; text-align: center; color: #a855f7;">${isFamCollapsed ? '▶' : '▼'}</span>
                    <span>🌳 FAMILIA: <strong style="color: #f3e8ff; text-transform: uppercase; letter-spacing: 0.5px;">${famObj.famName}</strong></span>
                    <span style="background: rgba(168, 85, 247, 0.25); color: #e9d5ff; padding: 2px 9px; border-radius: 12px; font-size: 0.75rem; font-weight: 700; border: 1px solid rgba(168, 85, 247, 0.4);">${totalArtsInFam} artículo${totalArtsInFam === 1 ? '' : 's'}</span>
                </div>
                <div style="font-size: 0.78rem; color: #c084fc; font-weight: 600;">
                    ${isFamCollapsed ? 'Desplegar ➕' : 'Replegar ➖'}
                </div>
            `;
            famContainer.appendChild(famHeader);

            if (!isFamCollapsed) {
                const subBody = document.createElement('div');
                subBody.style.cssText = 'padding: 4px 6px; width: 100%;';

                subfamiliasArray.forEach(subObj => {
                    const isSubExpanded = (window.pizarraSubfamiliasDesplegadas && typeof window.pizarraSubfamiliasDesplegadas.has === 'function')
                        ? window.pizarraSubfamiliasDesplegadas.has(subObj.subfamKey)
                        : false;
                    const isSubCollapsed = !isSubExpanded;
                    subObj.cards.sort((a, b) => a.kilosUnidad - b.kilosUnidad);

                    const subContainer = document.createElement('div');
                    subContainer.className = 'pizarra-subfam-group';
                    subContainer.style.cssText = 'margin-bottom: 3px; background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 5px; overflow: hidden; width: 100%;';

                    const subHeader = document.createElement('div');
                    subHeader.className = 'pizarra-subfam-header';
                    subHeader.style.cssText = 'padding: 6px 12px; background: linear-gradient(90deg, rgba(2, 132, 199, 0.25) 0%, rgba(3, 105, 161, 0.15) 100%); border-left: 4px solid #38bdf8; cursor: pointer; user-select: none; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(56, 189, 248, 0.2);';
                    subHeader.onclick = (e) => window.togglePizarraColapsarSubfamilia(subObj.subfamKey, e);

                    subHeader.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: #38bdf8; font-size: 0.88rem;">
                            <span style="font-size: 0.78rem; width: 14px; text-align: center; color: #0284c7;">${isSubCollapsed ? '▶' : '▼'}</span>
                            <span>🏷️ ATRIBUTO: <strong style="color: #e0f2fe; text-transform: uppercase;">${subObj.subfamName}</strong></span>
                            <span style="background: rgba(56, 189, 248, 0.25); color: #bae6fd; padding: 1px 8px; border-radius: 10px; font-size: 0.72rem; font-weight: 700; border: 1px solid rgba(56, 189, 248, 0.4);">${subObj.cards.length} artículo${subObj.cards.length === 1 ? '' : 's'}</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #38bdf8; font-weight: 600;">
                            ${isSubCollapsed ? 'Desplegar ➕' : 'Replegar ➖'}
                        </div>
                    `;
                    subContainer.appendChild(subHeader);

                    if (!isSubCollapsed) {
                        const cardsGrid = document.createElement('div');
                        cardsGrid.className = 'articulos-grid';
                        cardsGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; padding: 10px; width: 100%;';
                        subObj.cards.forEach(cItem => {
                            cardsGrid.appendChild(cItem.card);
                        });
                        subContainer.appendChild(cardsGrid);
                    }

                    subBody.appendChild(subContainer);
                });

                famContainer.appendChild(subBody);
            }

            gridSinReceta.appendChild(famContainer);
        });
    }

    // -------------------------------------------------------------------------
    // PASO 2: Resolver los Artículos Seleccionados (Soporte Multiselección CTRL+Clic)
    // Debe corresponder estrictamente a los artículos VISIBLES en la búsqueda
    // -------------------------------------------------------------------------
    if (!Array.isArray(window.articulosSeleccionadosIds) || window.articulosSeleccionadosIds.length === 0) {
        window.articulosSeleccionadosIds = window.articuloSeleccionadoId ? [window.articuloSeleccionadoId] : [];
    }

    let seleccionadosVisibles = directosSinRecetaVisibles.filter(a => window.articulosSeleccionadosIds.includes(a.articulo_id));

    // Si el usuario deseleccionó manualmente o no hay selección activa, mantener estado neutral sin forzar auto-selección
    if (window.deseleccionManual || (!window.articuloSeleccionadoId && !window.ingredienteSeleccionadoId)) {
        seleccionadosVisibles = [];
        window.articulosSeleccionadosIds = [];
        window.articuloSeleccionadoId = null;
    }

    const articuloSeleccionadoObj = seleccionadosVisibles[0] || null;

    // -------------------------------------------------------------------------
    // PASO 3: Encontrar los Ingredientes Relacionados (Acumulativo Multiselección)
    // -------------------------------------------------------------------------
    let ingredientesAsociados = [];
    if (seleccionadosVisibles.length > 0) {
        const selIdsLower = seleccionadosVisibles.map(a => a.articulo_id.toLowerCase());
        const selArtIds = seleccionadosVisibles.map(a => a.articulo_id);
        
        // 1. Por vínculo directo en tabla ingredientes (articulo_vinculado_numero o array N->1 bunker_articulos)
        const ingsDirectos = ingredientesList.filter(i => {
            const vincNum = (i.articulo_vinculado_numero || '').toLowerCase();
            const vincArray = Array.isArray(i.bunker_articulos)
                ? i.bunker_articulos.map(b => (b.codigo || b.articulo_id || '').toLowerCase())
                : [];
            
            return selIdsLower.includes(vincNum) ||
                vincArray.some(code => selIdsLower.includes(code)) ||
                selIdsLower.includes(i.id.toString()) ||
                (i.codigo && selIdsLower.includes(i.codigo.toString().toLowerCase()));
        });

        // 2. Por recetas de los artículos seleccionados
        const recsDelSel = recetasList.filter(r => selArtIds.includes(r.articulo_numero));
        const recIds = recsDelSel.map(r => r.id);
        const ingIdsInRec = recetaIngredientesList.filter(ri => recIds.includes(ri.receta_id)).map(ri => ri.ingrediente_id);
        const ingsReceta = ingredientesList.filter(i => ingIdsInRec.includes(i.id));

        // Combinar acumulativamente sin duplicados
        const ingMap = new Map();
        [...ingsDirectos, ...ingsReceta].forEach(i => ingMap.set(i.id, i));
        ingredientesAsociados = Array.from(ingMap.values());
    } else if (window.ingredienteSeleccionadoId) {
        const ingSel = ingredientesList.find(i => i.id === window.ingredienteSeleccionadoId);
        if (ingSel) {
            ingredientesAsociados = [ingSel];
        }
    }

    const idsIngredientesAsociados = ingredientesAsociados.map(i => i.id);

    // -------------------------------------------------------------------------
    // PASO 4: Renderizar Acordeón 3 (Insumos y Stock de Fábrica)
    // -------------------------------------------------------------------------
    if (gridIngredientes) {
        if (ingredientesAsociados.length === 0) {
            const emptyCard = document.createElement('div');
            emptyCard.className = 'articulo-card empty-link-card';
            emptyCard.style.gridColumn = '1 / -1';
            emptyCard.style.border = '1px dashed #f59e0b';
            emptyCard.style.background = 'rgba(245, 158, 11, 0.06)';
            emptyCard.style.padding = '14px';
            emptyCard.style.borderRadius = '10px';
            emptyCard.style.display = 'flex';
            emptyCard.style.flexDirection = 'column';
            emptyCard.style.alignItems = 'center';
            emptyCard.style.gap = '8px';
            emptyCard.style.textAlign = 'center';

            if (seleccionadosVisibles.length === 1 && articuloSeleccionadoObj) {
                const cleanArtDesc = (articuloSeleccionadoObj.descripcion_generada || articuloSeleccionadoObj.descripcion || '').replace(/'/g, "\\'");
                emptyCard.innerHTML = `
                    <div style="font-size: 0.88rem; font-weight: 700; color: #fbbf24; display: flex; align-items: center; gap: 6px;">
                        <span>⚠️ Sin Ingrediente de Fábrica Vinculado Estructuralmente</span>
                    </div>
                    <div style="font-size: 0.76rem; color: #cbd5e1; max-width: 520px; line-height: 1.4;">
                        El artículo seleccionado <strong style="color: #38bdf8;">[${articuloSeleccionadoObj.articulo_id}] ${articuloSeleccionadoObj.descripcion_generada || articuloSeleccionadoObj.descripcion}</strong> no posee un puntero registrado en la tabla de ingredientes de PostgreSQL.
                    </div>
                    <button class="btn btn-primary" onclick="abrirModalVinculacionEstructural('${articuloSeleccionadoObj.articulo_id}', '${cleanArtDesc}')" style="margin-top: 4px; padding: 6px 14px; font-size: 0.78rem; background: #0284c7; border: 1px solid #0369a1; border-radius: 6px; cursor: pointer; color: white; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
                        🔗 Vincular Ingrediente de Fábrica (BD Estructural)
                    </button>
                `;

                // Auto-expandir el Acordeón 3 (Insumos) solo en selección única
                const accIngItem = gridIngredientes.closest('.accordion-item');
                if (accIngItem && !accIngItem.classList.contains('open')) {
                    accIngItem.classList.add('open');
                    const icon = accIngItem.querySelector('.accordion-icon');
                    if (icon) icon.innerText = '🔽';
                }
            } else if (seleccionadosVisibles.length > 1) {
                emptyCard.innerHTML = `
                    <div style="font-size: 0.88rem; font-weight: 700; color: #f59e0b; display: flex; align-items: center; gap: 6px;">
                        <span>⚠️ Multiselección Activa (${seleccionadosVisibles.length} Artículos Seleccionados)</span>
                    </div>
                    <div style="font-size: 0.76rem; color: #cbd5e1; max-width: 520px; line-height: 1.4;">
                        Ninguno de los artículos seleccionados posee un ingrediente de fábrica vinculado. La herramienta de vinculación requiere seleccionar <strong>exactamente 1 solo artículo</strong>.
                    </div>
                    <button class="btn btn-secondary" disabled style="margin-top: 4px; padding: 6px 14px; font-size: 0.78rem; background: #334155; border: 1px solid #475569; border-radius: 6px; cursor: not-allowed; color: #94a3b8; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; opacity: 0.65;" title="Deshabilitado: Selecciona 1 solo artículo para vincular">
                        🔒 Vincular Ingrediente (Requiere 1 solo artículo seleccionado)
                    </button>
                `;
            } else {
                emptyCard.innerHTML = `
                    <div style="font-size: 0.80rem; color: #94a3b8;">
                        Selecciona 1 artículo para consultar o gestionar sus vínculos con ingredientes de fábrica.
                    </div>
                `;
            }

            gridIngredientes.appendChild(emptyCard);
        } else {
            ingredientesAsociados.forEach(ing => {
                countIng++;
                const stockActualKg = parseFloat(ing.stock_actual !== undefined && ing.stock_actual !== null ? ing.stock_actual : (ing.stock_potencial || 0));
                const stockBultosCerrados = parseInt(ing.stock_bultos || 0);
                const costoPatron = parseFloat(ing.costo_patron || 0);
                const ivaVal = ing.porcentaje_iva || ing.iva || 21;

                let loteAsignado = null;
                if (Array.isArray(ing.lotes_cajas_cerradas) && ing.lotes_cajas_cerradas.length > 0) {
                    loteAsignado = ing.lotes_cajas_cerradas[0];
                } else if (lotesList && lotesList.length > 0) {
                    loteAsignado = lotesList.find(l => 
                        (ing.articulo_vinculado_numero && l.destino_id === ing.articulo_vinculado_numero) || 
                        l.destino_id === ing.id.toString() ||
                        (ing.codigo && l.destino_id === ing.codigo.toString())
                    );
                }

                const ingCard = document.createElement('div');
                ingCard.className = `articulo-card ingredient-card`;
                ingCard.style.borderColor = 'rgba(6, 182, 212, 0.4)';
                ingCard.style.background = 'linear-gradient(135deg, rgba(6, 182, 212, 0.05), rgba(15, 23, 42, 0.8))';

                ingCard.onclick = () => {
                    document.querySelectorAll('#grid-ingredientes-relacionados .ingredient-card').forEach(c => {
                        c.classList.remove('active');
                        c.style.borderColor = 'rgba(6, 182, 212, 0.4)';
                        c.style.boxShadow = 'none';
                    });
                    ingCard.classList.add('active');
                    ingCard.style.borderColor = '#38bdf8';
                    ingCard.style.boxShadow = '0 0 10px rgba(56, 189, 248, 0.35)';

                    window.ultimoIngredienteSeleccionadoId = ing.id;
                    if (typeof window.auditarIncidenciaLineasNegocio === 'function') {
                        window.auditarIncidenciaLineasNegocio(window.articuloSeleccionadoId, ing.id);
                    }

                    if (window.VigíaPizarra) {
                        window.VigíaPizarra.logEvent('ARTICULO', `Ficha de Ingrediente seleccionada: [Ingrediente #${ing.id}] ${ing.nombre}`, {
                            ingredienteId: ing.id,
                            stockKilos: stockActualKg,
                            stockBultosCerrados: stockBultosCerrados,
                            costoPatron: costoPatron,
                            lote: loteAsignado ? loteAsignado.lote_id_supabase : 'Sin Lote'
                        });
                    }
                };

                const loteHtml = loteAsignado 
                    ? `<div style="margin-top: 4px; font-size: 0.70rem; color: #a78bfa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="Lote: ${loteAsignado.lote_codigo_corto || loteAsignado.lote_id_supabase}${loteAsignado.proveedor_nombre ? ' | Proveedor: ' + loteAsignado.proveedor_nombre : ''}${loteAsignado.articulo_descripcion ? ' | ' + loteAsignado.articulo_descripcion : ''}">
                         🏷️ Lote: <strong>${loteAsignado.proveedor_nombre ? loteAsignado.proveedor_nombre + ' • ' : ''}${(loteAsignado.lote_codigo_corto || loteAsignado.lote_id_supabase || '').substring(0, 10)}</strong> | FOB: $${parseFloat(loteAsignado.costo_kilo_al_momento || 0).toLocaleString('es-AR')}/kg
                       </div>`
                    : `<div style="margin-top: 4px; font-size: 0.70rem; color: var(--text-secondary);">🏷️ Sin lote asignado activo</div>`;

                const cleanDesc = (articuloSeleccionadoObj?.descripcion_generada || articuloSeleccionadoObj?.descripcion || '').replace(/'/g, "\\'");

                // Consolidar todos los artículos vinculados en la relación N->1
                let vinculosCodigos = [];
                if (Array.isArray(ing.bunker_articulos) && ing.bunker_articulos.length > 0) {
                    vinculosCodigos = ing.bunker_articulos.map(b => b.codigo || b.articulo_id).filter(Boolean);
                }
                if (ing.articulo_vinculado_numero && !vinculosCodigos.includes(ing.articulo_vinculado_numero)) {
                    vinculosCodigos.unshift(ing.articulo_vinculado_numero);
                }
                const vinculosLabel = vinculosCodigos.length > 0 ? `(${vinculosCodigos.join(', ')})` : '';

                const estadoMono = (typeof window.auditarEstadoFraccionesMono === 'function') 
                    ? window.auditarEstadoFraccionesMono(ing.id) 
                    : { total: 0, todosAlDia: false, pendientes: 0 };

                let btnMonoPropagarHtml = '';
                if (estadoMono.total > 0) {
                    if (estadoMono.todosAlDia) {
                        btnMonoPropagarHtml = `
                            <button onclick="propagarIngredienteAFraccionesMono(${ing.id})" 
                                style="width: 100%; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); padding: 4px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; cursor: pointer; transition: all 0.2s;"
                                onmouseover="this.style.background='rgba(16, 185, 129, 0.25)'" onmouseout="this.style.background='rgba(16, 185, 129, 0.15)'"
                                title="Las ${estadoMono.total} fracciones directas [LDN 2] están 100% al día con el costo patrón de $${costoPatron.toFixed(2)}/kg. Hacé clic para ver la auditoría de costos.">
                                🟢 Fracciones [LDN 2] al Día (Ver Auditoría)
                            </button>
                        `;
                    } else {
                        btnMonoPropagarHtml = `
                            <button onclick="propagarIngredienteAFraccionesMono(${ing.id})" 
                                style="width: 100%; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; cursor: pointer; box-shadow: 0 0 10px rgba(245, 158, 11, 0.4);"
                                title="Detectada variación: hay ${estadoMono.pendientes} fracción(es) directas en [LDN 2] pendientes de propagar en BD. Hacé clic para impactar.">
                                ⚡ Propagar a Fracciones [LDN 2] (${estadoMono.pendientes} pendientes)
                            </button>
                        `;
                    }
                } else {
                    btnMonoPropagarHtml = `
                        <button onclick="propagarIngredienteAFraccionesMono(${ing.id})" 
                            style="width: 100%; background: rgba(255, 255, 255, 0.05); color: #94a3b8; border: 1px solid rgba(255, 255, 255, 0.1); padding: 4px 8px; border-radius: 4px; font-size: 0.70rem; cursor: pointer;"
                            title="Sin fracciones mono registradas en [LDN 2] para este ingrediente">
                            📦 Sin Fracciones Directas [LDN 2]
                        </button>
                    `;
                }

                // Auditoría de participación en Mixes (LDN 3) para tarjeta de Ingrediente Vinculado
                const mixesVinculados = (composicionMixList || []).filter(cm => cm.ingrediente_id === ing.id).map(cm => cm.mix_id);
                const uniqueMixesVinc = [...new Set(mixesVinculados)];
                let btnMixesVincHtml = '';
                if (uniqueMixesVinc.length > 0) {
                    btnMixesVincHtml = `
                        <button onclick="event.stopPropagation(); if(window.cambiarContextoLDN) window.cambiarContextoLDN(3);" 
                            style="width: 100%; background: rgba(168, 85, 247, 0.18); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.45); padding: 4px 8px; border-radius: 4px; font-size: 0.71rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;"
                            title="Este insumo forma parte de ${uniqueMixesVinc.length} fórmula(s) de mezcla interna (Mixes). Hacé clic para ir a [LDN 3] e impactar la cascada de mixes.">
                            🧪 Incide en ${uniqueMixesVinc.length} Mix${uniqueMixesVinc.length > 1 ? 'es' : ''} (Ir a [LDN 3])
                        </button>
                    `;
                }

                ingCard.innerHTML = `
                    <div>
                        <div class="art-code" style="color: #06b6d4;">[ING #${ing.id}] <span style="color: #38bdf8;">${vinculosLabel}</span></div>
                        <div class="art-name-compact" title="${ing.nombre}" style="font-weight: 600; color: #f3f4f6;">${ing.nombre}</div>
                    </div>
                    <div style="margin-top: 6px; padding: 6px; background: rgba(0, 0, 0, 0.25); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.05);">
                        <div style="display: flex; justify-content: space-between; font-size: 0.72rem; margin-bottom: 2px;">
                            <span style="color: var(--text-secondary);">Stock Suelto:</span>
                            <strong style="color: ${stockActualKg > 0 ? '#10b981' : '#ef4444'};">🧪 ${stockActualKg.toFixed(2).replace('.', ',')} kg</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.72rem;">
                            <span style="color: var(--text-secondary);">Cajas Cerradas:</span>
                            <strong style="color: #38bdf8;">📦 ${stockBultosCerrados} bultos</strong>
                        </div>
                    </div>
                    <div style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem;">
                        <span style="color: #f59e0b; font-weight: 700;">💰 $${costoPatron.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</span>
                        <span class="art-badge-tipo" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24;">IVA ${ivaVal}%</span>
                    </div>
                    ${loteHtml}
                    <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed rgba(255, 255, 255, 0.08); display: flex; flex-direction: column; gap: 4px;" onclick="event.stopPropagation();">
                        ${btnMonoPropagarHtml}
                        ${btnMixesVincHtml}
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 4px;">
                            <button onclick="abrirModalVinculacionEstructural('${articuloSeleccionadoObj ? articuloSeleccionadoObj.articulo_id : ''}', '${cleanDesc}')" style="background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); color: #60a5fa; padding: 2px 6px; font-size: 0.68rem; border-radius: 4px; cursor: pointer;" title="Agregar otro artículo a la relación N->1">➕ Vincular Otro</button>
                            <button onclick="revocarVinculoEstructural(${ing.id}, '${articuloSeleccionadoObj ? articuloSeleccionadoObj.articulo_id : ''}')" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; padding: 2px 6px; font-size: 0.68rem; border-radius: 4px; cursor: pointer;" title="Revocar vínculo relacional en PostgreSQL">🗑️ Revocar Vínculo</button>
                        </div>
                    </div>
                `;
                gridIngredientes.appendChild(ingCard);
            });
        }
    }

    // -------------------------------------------------------------------------
    // PASO 4-B: Renderizar Acordeón 4 (Ingredientes Huérfanos — Sin Vínculo Estructural)
    // -------------------------------------------------------------------------
    const gridHuerfanos = document.getElementById('grid-ingredientes-huerfanos');
    const badgeHuerfanos = document.getElementById('count-ingredientes-huerfanos');
    let countHuerfanos = 0;

    if (gridHuerfanos) {
        gridHuerfanos.innerHTML = '';
        
        // Identificar ingredientes que NO poseen ningún artículo de Comercialización Directa vinculado
        const skusComercializacionDirecta = new Set(
            todos
                .filter(a => {
                    const esPack = a.pack_hijo_codigo && a.pack_hijo_codigo.trim() !== '';
                    const famNombre = String(a.familia_nombre || a.familia || '').toLowerCase().trim();
                    const descLower = String(a.descripcion || '').toLowerCase().trim();
                    const esProduccionInterna = famNombre === 'produccion' ||
                                                descLower === 'articulo puente' ||
                                                descLower === 'unidad productiva' ||
                                                String(a.articulo_id || '').startsWith('PROD');
                    return !esPack && !a.es_pack && a.tiene_receta !== true && !esProduccionInterna;
                })
                .map(a => (a.articulo_id || '').toLowerCase().trim())
                .filter(Boolean)
        );

        const ingredientesHuerfanos = ingredientesList.filter(ing => {
            const vincNum = (ing.articulo_vinculado_numero || '').toLowerCase().trim();
            const vinculacionesDirectas = Array.isArray(ing.bunker_articulos)
                ? ing.bunker_articulos.map(b => (b.codigo || b.articulo_id || '').toLowerCase().trim()).filter(Boolean)
                : [];

            const tieneVinculoDirectoTablaMaestra = vincNum !== '' && skusComercializacionDirecta.has(vincNum);
            const tieneVinculoDirectoJunction = vinculacionesDirectas.some(code => skusComercializacionDirecta.has(code));

            return !tieneVinculoDirectoTablaMaestra && !tieneVinculoDirectoJunction;
        });

        ingredientesHuerfanos.forEach(ing => {
            let matchQuery = true;
            if (searchTerms.length > 0) {
                const searchableText = `${ing.nombre || ''} ${ing.articulo_vinculado_numero || ''} ${ing.codigo || ''}`
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "");
                matchQuery = searchTerms.every(term => searchableText.includes(term));
            }
            if (!matchQuery) return;

            countHuerfanos++;
            const cleanDesc = (ing.nombre || '').replace(/'/g, "\\'");
            const stockKg = parseFloat(ing.stock_actual || 0);
            const costoPatron = parseFloat(ing.costo_patron || 0);
            const ivaVal = parseFloat(ing.porcentaje_iva || 21);

            // Auditoría determinista de fracciones mono para este ingrediente huérfano
            const estadoMono = (typeof window.auditarEstadoFraccionesMono === 'function')
                ? window.auditarEstadoFraccionesMono(ing.id)
                : { total: 0, todosAlDia: false, pendientes: 0 };

            let btnMonoPropagarHtml = '';
            if (estadoMono.total > 0) {
                if (estadoMono.todosAlDia) {
                    btnMonoPropagarHtml = `
                        <button onclick="propagarIngredienteAFraccionesMono(${ing.id})" 
                            style="width: 100%; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); padding: 4px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; cursor: pointer; transition: all 0.2s;"
                            onmouseover="this.style.background='rgba(16, 185, 129, 0.25)'" onmouseout="this.style.background='rgba(16, 185, 129, 0.15)'"
                            title="Las ${estadoMono.total} fracciones directas [LDN 2] están 100% al día con el costo patrón de $${costoPatron.toFixed(2)}/kg. Hacé clic para ver la auditoría de costos.">
                            🟢 Fracciones [LDN 2] al Día (Ver Auditoría)
                        </button>
                    `;
                } else {
                    btnMonoPropagarHtml = `
                        <button onclick="propagarIngredienteAFraccionesMono(${ing.id})" 
                            style="width: 100%; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; cursor: pointer; box-shadow: 0 0 10px rgba(245, 158, 11, 0.4);"
                            title="Detectada variación: hay ${estadoMono.pendientes} fracción(es) directas en [LDN 2] pendientes de propagar en BD. Hacé clic para impactar.">
                            ⚡ Propagar a Fracciones [LDN 2] (${estadoMono.pendientes} pendientes)
                        </button>
                    `;
                }
            }

            // Auditoría de participación en Mixes (LDN 3)
            const mixesQueConsumen = (composicionMixList || []).filter(cm => cm.ingrediente_id === ing.id).map(cm => cm.mix_id);
            const uniqueMixes = [...new Set(mixesQueConsumen)];
            let btnMixesHtml = '';
            if (uniqueMixes.length > 0) {
                btnMixesHtml = `
                    <button onclick="event.stopPropagation(); window.seleccionarIngredienteHuerfano(${ing.id}); if(window.cambiarContextoLDN) window.cambiarContextoLDN(3);" 
                        style="width: 100%; background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); padding: 3px 6px; border-radius: 4px; font-size: 0.70rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;"
                        title="Este insumo incide en ${uniqueMixes.length} fórmula(s) de mezcla interna (Mixes). Hacé clic para ir a LDN 3.">
                        🧪 Incide en ${uniqueMixes.length} Mix${uniqueMixes.length > 1 ? 'es' : ''} (Ver LDN 3)
                    </button>
                `;
            }

            // Auditoría de participación en Granolas (LDN 6)
            const participaEnGranolas = uniqueMixes.includes(132) || (master.granolasInsumos || []).some(gi => gi.ingrediente_id === ing.id);
            let btnGranolaHtml = '';
            if (participaEnGranolas) {
                btnGranolaHtml = `
                    <button onclick="event.stopPropagation(); window.seleccionarIngredienteHuerfano(${ing.id}); if(window.cambiarContextoLDN) window.cambiarContextoLDN(6);" 
                        style="width: 100%; background: rgba(234, 179, 8, 0.15); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.4); padding: 3px 6px; border-radius: 4px; font-size: 0.70rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;"
                        title="Este insumo o sus mezclas forman parte de las Granolas. Hacé clic para ir a LDN 6.">
                        🌾 Incide en Granolas (Ver LDN 6)
                    </button>
                `;
            }

            // Auditoría de participación en Tostaderos (LDN 4)
            const CIRCUITOS_TOSTADEROS_IDS = [38, 57, 123, 18, 41, 56, 166];
            const vincUpper = (ing.articulo_vinculado_numero || '').toUpperCase();
            const participaEnTostadero = CIRCUITOS_TOSTADEROS_IDS.includes(ing.id) || 
                vincUpper.includes('TPG') || vincUpper.includes('TSPG') || vincUpper.includes('CTG') || vincUpper.includes('PTS');
            let btnTostaderoHtml = '';
            if (participaEnTostadero) {
                btnTostaderoHtml = `
                    <button onclick="event.stopPropagation(); window.seleccionarIngredienteHuerfano(${ing.id}); if(window.cambiarContextoLDN) window.cambiarContextoLDN(4);" 
                        style="width: 100%; background: rgba(249, 115, 22, 0.15); color: #fb923c; border: 1px solid rgba(249, 115, 22, 0.4); padding: 3px 6px; border-radius: 4px; font-size: 0.70rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;"
                        title="Este insumo se elabora o transforma en Tostaderos (UP Externa). Hacé clic para ir a LDN 4.">
                        🥜 Elaborado en Tostadero (Ver LDN 4)
                    </button>
                `;
            }

            const esSeleccionado = window.ingredienteSeleccionadoId === ing.id;
            const ingCard = document.createElement('div');
            ingCard.className = `articulo-card ${esSeleccionado ? 'selected active' : ''}`;
            ingCard.style.borderColor = esSeleccionado ? '#f59e0b' : 'rgba(245, 158, 11, 0.3)';
            ingCard.style.background = esSeleccionado ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.04)';
            if (esSeleccionado) {
                ingCard.style.boxShadow = '0 0 12px rgba(245, 158, 11, 0.4)';
            }
            ingCard.style.cursor = 'pointer';
            ingCard.setAttribute('data-tooltip', `[ING #${ing.id}] ${ing.nombre} | Insumo de Fábrica Sin Vínculo con Comercialización Directa`);
            ingCard.onclick = () => window.seleccionarIngredienteHuerfano(ing.id);

            const badgeVinculoHtml = ing.articulo_vinculado_numero ? `
                <span class="art-badge-tipo warning" style="background: rgba(14, 165, 233, 0.15); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.35);" title="Artículo Puente / Producción: ${ing.articulo_vinculado_numero}">AP: ${ing.articulo_vinculado_numero}</span>
            ` : `
                <span class="art-badge-tipo warning">Sin Vínculo</span>
            `;

            ingCard.innerHTML = `
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                        <div class="art-code" style="color: #f59e0b; font-weight: 700;">ING #${ing.id}</div>
                        ${badgeVinculoHtml}
                    </div>
                    <div class="art-name-compact" title="${ing.nombre}" style="font-weight: 600;">${ing.nombre}</div>
                </div>
                <div class="art-stock-info" style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255, 255, 255, 0.08);">
                    <div style="display: flex; justify-content: space-between; font-size: 0.72rem; margin-bottom: 2px;">
                        <span style="color: var(--text-secondary);">Stock Fábrica:</span>
                        <strong style="color: ${stockKg > 0 ? '#10b981' : '#ef4444'}; font-weight: 700;">📦 ${stockKg.toFixed(1).replace('.', ',')} kg</strong>
                    </div>
                </div>
                <div style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem;">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <span style="color: #f59e0b; font-weight: 700;">💰 $${costoPatron.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</span>
                        <button onclick="event.stopPropagation(); window.abrirEdicionManualCostoIngrediente(${ing.id});" style="background: none; border: none; cursor: pointer; font-size: 0.72rem; padding: 0 2px;" title="Editar costo manualmente">✏️</button>
                    </div>
                    <span class="art-badge-tipo" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24;">IVA ${ivaVal}%</span>
                </div>
                <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed rgba(255, 255, 255, 0.08); display: flex; flex-direction: column; gap: 4px;" onclick="event.stopPropagation();">
                    ${btnMonoPropagarHtml}
                    ${btnMixesHtml}
                    ${btnGranolaHtml}
                    ${btnTostaderoHtml}
                    <div style="display: flex; gap: 6px; justify-content: center;">
                        <button onclick="window.abrirModuloConciliacionIA('ING-${ing.id}', null, { es_ingrediente: true, ingrediente_id: ${ing.id} })" style="flex: 1; background: linear-gradient(135deg, rgba(2, 132, 199, 0.35), rgba(99, 102, 241, 0.35)); border: 1px solid #38bdf8; color: #bae6fd; padding: 4px 6px; font-size: 0.72rem; font-weight: 700; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: all 0.2s;" title="Conciliar costo con IA y proveedores de Tabla Maestra">🤖 Conciliar IA</button>
                        <button onclick="abrirModalVinculacionEstructural('', '${cleanDesc}')" style="background: rgba(245, 158, 11, 0.2); border: 1px solid rgba(245, 158, 11, 0.4); color: #fbbf24; padding: 4px 8px; font-size: 0.72rem; font-weight: 600; border-radius: 4px; cursor: pointer;" title="Vincular este insumo a un artículo de comercialización directa">🔗 Vincular</button>
                    </div>
                </div>
            `;
            gridHuerfanos.appendChild(ingCard);
        });

        if (badgeHuerfanos) {
            badgeHuerfanos.innerText = `${countHuerfanos} insumo${countHuerfanos !== 1 ? 's' : ''}`;
        }
        if (countHuerfanos === 0) {
            gridHuerfanos.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">No se encontraron insumos huérfanos sin vínculo relacional.</div>';
        }
    }

    // -------------------------------------------------------------------------
    // PASO 5: Renderizar Acordeón 2 (Transformados con Receta) en función del ingrediente asociado
    // -------------------------------------------------------------------------
    todos.forEach(art => {
        // NOTA: Los artículos fraccionados con receta o Packs Padres derivados DEBEN mostrarse en Acordeón 2
        const esPackPadre = (art.es_pack === true || Boolean(art.pack_hijo_codigo)) && !art.tiene_receta;
        if (art.tiene_receta !== true && !esPackPadre) return;

        const skuEvaluadoReceta = esPackPadre ? (art.pack_hijo_codigo || '').trim() : art.articulo_id;

        const descStr = (art.descripcion_generada || art.descripcion || '').toLowerCase();
        const codeStr = (art.articulo_id || '').toLowerCase();

        const recetasDelArt = recetasList.filter(r => (r.articulo_numero || '').trim().toLowerCase() === skuEvaluadoReceta.toLowerCase());
        const recetaIds = recetasDelArt.map(r => r.id);
        const ingredientesDeReceta = recetaIngredientesList.filter(ri => recetaIds.includes(ri.receta_id));
        
        // Verificar consumo del ingrediente del artículo seleccionado
        const consumeIngredienteSeleccionado = ingredientesDeReceta.some(ri => idsIngredientesAsociados.includes(ri.ingrediente_id)) ||
            composicionMixList.some(cm => idsIngredientesAsociados.includes(cm.ingrediente_id) && ingredientesDeReceta.some(ri => ri.ingrediente_id === cm.mix_id));

        if (!consumeIngredienteSeleccionado) return;

        let matchQuery = true;
        // AISLAMIENTO DE BÚSQUEDA: Si hay un artículo o ingrediente seleccionado (idsIngredientesAsociados.length > 0),
        // el filtro estructural del insumo es la condición primaria. No debe filtrarse Acordeón 2 por el texto
        // de búsqueda de LDN 1 ('sem par') para no ocultar las presentaciones transformadas (ej: MPGDSX7).
        if (idsIngredientesAsociados.length === 0 && searchTerms.length > 0) {
            const searchableText = window.obtenerTextoBusquedaArticulo(art);
            const codeNorm = (art.articulo_id || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const fullIndex = `${searchableText} ${codeNorm}`;
            matchQuery = searchTerms.every(term => fullIndex.includes(term));
        }

        if (!matchQuery) return;

        const stockBultos = parseFloat(art.stock_consolidado || 0);
        const kilosUnidad = parseFloat(art.kilos_unidad || 0);
        const totalKilos = stockBultos * kilosUnidad;

        const card = document.createElement('div');
        const isSelected = window.articuloSeleccionadoId === art.articulo_id;
        card.className = `articulo-card` + (isSelected ? ' active' : '');
        card.setAttribute('data-tooltip', `${art.descripcion_generada || art.descripcion} | Stock: ${stockBultos} bultos (${totalKilos.toFixed(1)} kg tot.)`);
        card.onclick = () => {
            if (typeof window.seleccionarArticulo === 'function') {
                window.seleccionarArticulo(art.articulo_id);
            }
        };

        // Filtrar solo ingredientes alimenticios descartando insumos de empaque
        const rIngsAlimentos = ingredientesDeReceta.filter(ri => {
            const ingObj = ingredientesList.find(i => i.id === ri.ingrediente_id);
            return ingObj && !ingObj.es_insumo && ingObj.unidad_medida !== 'Unidades';
        });

        // Verificar si la receta consume un ingrediente que a su vez es un Mix
        const tieneIngredienteMix = rIngsAlimentos.some(ri => {
            const ingObj = ingredientesList.find(i => i.id === ri.ingrediente_id);
            return ingObj && (ingObj.es_mix || composicionMixList.some(cm => cm.mix_id === ingObj.id));
        });

        // Categorización determinista en 3 Sub-Secciones: UP (Fábrica), AP/Mix (Carro/Mezcla), Mono (100%)
        const esUnidadProductiva = codeStr.startsWith('prod up') || codeStr.includes(' up ') || codeStr.endsWith(' up') || descStr.includes('unidad productiva') || descStr.includes('prod up');
        const esMixOPuente = !esUnidadProductiva && (descStr.includes('mix') || codeStr.includes('mix') || codeStr.startsWith('prod ap') || descStr.includes('puente') || rIngsAlimentos.length > 1 || tieneIngredienteMix);

        if (esUnidadProductiva) {
            const packPadreContenedor = todos.find(p => p.pack_hijo_codigo && p.pack_hijo_codigo.trim().toLowerCase() === art.articulo_id.trim().toLowerCase());
            const badgeTipo = packPadreContenedor
                ? `<span class="art-badge-tipo pack-hijo" style="background: rgba(236, 72, 153, 0.2); color: #f472b6; border: 1px solid rgba(236, 72, 153, 0.4);" title="Forma parte del pack padre ${packPadreContenedor.articulo_id}">👶 Hijo de Pack (${packPadreContenedor.articulo_id})</span>`
                : `<span class="art-badge-tipo" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);">🏭 UP (Planta)</span>`;
            card.innerHTML = `
                <div>
                    <div class="art-code" style="color: ${packPadreContenedor ? '#f472b6' : '#c084fc'};">${art.articulo_id}</div>
                    <div class="art-name-compact" title="${art.descripcion_generada || art.descripcion}">${art.descripcion_generada || art.descripcion}</div>
                </div>
                <div class="art-stock-info" style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255, 255, 255, 0.08); display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem;">
                    <span style="color: var(--text-secondary);">Stock: <strong style="color: ${stockBultos > 0 ? '#10b981' : '#ef4444'}; font-weight: 700;">${stockBultos.toLocaleString('es-AR')} bultos</strong></span>
                    <span style="color: #06b6d4; font-weight: 600;" title="Totalidad de kilos disponibles en depósito">📦 ${totalKilos.toFixed(1).replace('.', ',')} kg tot.</span>
                </div>
                <div class="art-footer" style="margin-top: 6px;">
                    <span>${kilosUnidad.toFixed(2)} kg/bulto</span>
                    ${badgeTipo}
                </div>
            `;
            if (gridConRecetaUP) gridConRecetaUP.appendChild(card);
            countConUP++;
        } else if (esMixOPuente) {
            const packPadreContenedor = todos.find(p => p.pack_hijo_codigo && p.pack_hijo_codigo.trim().toLowerCase() === art.articulo_id.trim().toLowerCase());
            const badgeTipo = packPadreContenedor
                ? `<span class="art-badge-tipo pack-hijo" style="background: rgba(236, 72, 153, 0.2); color: #f472b6; border: 1px solid rgba(236, 72, 153, 0.4);" title="Forma parte del pack padre ${packPadreContenedor.articulo_id}">👶 Hijo de Pack (${packPadreContenedor.articulo_id})</span>`
                : `<span class="art-badge-tipo warning">🧩 Mix / AP</span>`;

            // Desglose determinista de costos para Mix / AP (Unificado con calcularCostoBaseKiloArticulo y Radiografía)
            const master = window.pizarraSimulacionMaster || {};
            const laArts = (master.articulosListas || []).filter(l => (l.articulo_numero || '').trim().toLowerCase() === art.articulo_id.trim().toLowerCase());
            const laArt = laArts.find(l => l.es_patron) || laArts.find(l => l.lista_id === 1) || laArts[0];
            const costoTiempoVal = (laArt && laArt.mano_obra_activa !== false) ? parseFloat(laArt?.costo_tiempo || 0) : 0;

            // Costo de ingredientes de la receta (Materia Prima + Bolsa de empaque de receta, SIN mano de obra)
            let costoIngredientesTotal = 0;
            const nombresIngredientesComp = [];
            let mixRelacionadoObj = null;
            let costoMixFormulaSim = 0;

            ingredientesDeReceta.forEach(ri => {
                const ingObj = ingredientesList.find(i => i.id === ri.ingrediente_id);
                if (!ingObj) return;
                const cant = parseFloat(ri.cantidad || 0);
                
                // Si este ingrediente es un Mix, calcular costo a partir de su composición
                const compMix = composicionMixList.filter(cm => cm.mix_id === ingObj.id);
                let costoKiloIng = 0;
                if (compMix.length > 0) {
                    const totalKg = compMix.reduce((s, cm) => s + parseFloat(cm.cantidad || 0), 0);
                    const total$ = compMix.reduce((s, cm) => {
                        const cIng = ingredientesList.find(i => i.id === cm.ingrediente_id);
                        const cKg = parseFloat(cIng?.costo_patron || 0);
                        return s + (parseFloat(cm.cantidad || 0) * cKg);
                    }, 0);
                    costoKiloIng = totalKg > 0 ? (total$ / totalKg) : parseFloat(ingObj.costo_patron || 0);
                    mixRelacionadoObj = ingObj;
                    costoMixFormulaSim = costoKiloIng;
                } else {
                    costoKiloIng = parseFloat(ingObj.costo_patron || 0);
                }

                costoIngredientesTotal += (cant * costoKiloIng);
                nombresIngredientesComp.push(`${ingObj.nombre} (${cant.toFixed(2)} kg)`);
            });

            // UNIFICACIÓN MATEMÁTICA: costo_base_sobrescrito almacena estrictamente el costo de receta por kg (SIN M.O., pues M.O. vive en costo_tiempo)
            const costoBaseTotalBultoMix = costoIngredientesTotal;
            const costoKiloBaseSobrescritoMix = kilosUnidad > 0 ? (costoBaseTotalBultoMix / kilosUnidad) : costoBaseTotalBultoMix;
            const costoNetoOperativoBultoMix = costoBaseTotalBultoMix + costoTiempoVal;
            const costoNetoOperativoKiloMix = kilosUnidad > 0 ? (costoNetoOperativoBultoMix / kilosUnidad) : costoNetoOperativoBultoMix;

            // Semáforo de certeza visual BD vs Simulación (Verifica AP + Fórmula Mix + Ingrediente Simple vinculado)
            let costoOficialBDMix = parseFloat(art.costo_base) || 0;
            if (laArt && laArt.costo_base_sobrescrito !== null && laArt.costo_base_sobrescrito !== undefined && parseFloat(laArt.costo_base_sobrescrito) > 0) {
                const cKiloBD = parseFloat(laArt.costo_base_sobrescrito);
                costoOficialBDMix = cKiloBD * (kilosUnidad || 1);
            }
            const diffCostoMix = Math.abs(costoBaseTotalBultoMix - costoOficialBDMix);
            const mixPatronSincronizado = !mixRelacionadoObj || Math.abs(costoMixFormulaSim - parseFloat(mixRelacionadoObj.costo_patron || 0)) < 0.05;

            const skuCleanLower = art.articulo_id.trim().toLowerCase();
            const simpleVincObj = ingredientesList.find(i => {
                const esMix = composicionMixList.some(cm => cm.mix_id === i.id);
                if (esMix) return false;
                if (String(i.articulo_vinculado_numero || '').trim().toLowerCase() === skuCleanLower) return true;
                if (Array.isArray(i.articulos_vinculados) && i.articulos_vinculados.some(av => String(av.codigo || av.bunker_articulo_id || '').trim().toLowerCase() === skuCleanLower)) return true;
                return false;
            });
            const simplePatronSincronizado = !simpleVincObj || Math.abs(costoNetoOperativoKiloMix - parseFloat(simpleVincObj.costo_patron || 0)) < 0.05;

            const estaSincronizadoMix = diffCostoMix < 0.05 && costoOficialBDMix > 0 && mixPatronSincronizado && simplePatronSincronizado;

            // Identificar Línea de Negocio Destino para guiar al operador con claridad total
            const skuUpperAP = art.articulo_id.trim().toUpperCase();
            let destinoLdnNum = 3;
            let destinoLdnLabel = '🧪 Flujo [LDN 3] Mixes';
            let destinoLdnColor = '#c084fc';
            if (skuUpperAP === 'MPB' || skuUpperAP.startsWith('BF')) {
                destinoLdnNum = 5;
                destinoLdnLabel = '🍫 Pre-Mezcla ➔ [LDN 5] Barritas';
                destinoLdnColor = '#fb923c';
            } else if (skuUpperAP.startsWith('MPGDF') || skuUpperAP.startsWith('MPGDS') || skuUpperAP.startsWith('GDF') || skuUpperAP.startsWith('GS')) {
                destinoLdnNum = 6;
                destinoLdnLabel = '🥣 Pre-Mezcla ➔ [LDN 6] Granolas';
                destinoLdnColor = '#f472b6';
            }

            const semaforoMixHtml = estaSincronizadoMix
                ? `<div style="margin-top: 5px; padding: 3px 6px; border-radius: 4px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); display: flex; align-items: center; justify-content: space-between; font-size: 0.68rem; color: #34d399;" title="Costo de Receta, Artículo Puente e Ingrediente Simple 100% sincronizados en PostgreSQL">
                     <span>🟢 Grabado en BD</span>
                     <span style="font-weight: 700;">$${costoOficialBDMix.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                   </div>`
                : `<div style="margin-top: 5px; padding: 3px 6px; border-radius: 4px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); display: flex; align-items: center; justify-content: space-between; font-size: 0.68rem; color: #fbbf24;" title="Costo simulado en memoria pendiente de impactar en BD">
                     <span>🟡 Simulado</span>
                     <span style="font-weight: 700;">Sim: $${costoBaseTotalBultoMix.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                   </div>`;

            // Botón de acción quirúrgica individual para el Mix / AP + Inspector de Costos + Salto directo a su LDN
            const btnRadiografiaMixHtml = `
                <div style="display: inline-flex; gap: 3px; align-items: center;">
                    <button type="button" onclick="event.stopPropagation(); window.abrirRadiografiaCostosArticulo('${art.articulo_id}')" style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; padding: 2px 6px; border-radius: 4px; font-size: 0.66rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 2px;" title="Ver radiografía financiera paso a paso">
                        📊 Costos
                    </button>
                    <button type="button" onclick="event.stopPropagation(); if (typeof window.cambiarContextoLDN === 'function') window.cambiarContextoLDN(${destinoLdnNum});" style="background: rgba(168, 85, 247, 0.15); border: 1px solid ${destinoLdnColor}; color: ${destinoLdnColor}; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 700; cursor: pointer;" title="Ir a ${destinoLdnLabel} para ver y actualizar sus presentaciones comerciales finales">
                        ➔ LDN ${destinoLdnNum}
                    </button>
                </div>
            `;
            const btnQuirurgicoMixHtml = estaSincronizadoMix
                ? `
                <div style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center; gap: 4px;">
                    ${btnRadiografiaMixHtml}
                    <button class="btn-impactar-quirurgico" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; padding: 2px 8px; border-radius: 4px; font-size: 0.70rem; font-weight: 700; cursor: default;" disabled title="Precios y costos 100% al día en PostgreSQL">
                        ✓ Al día en BD
                    </button>
                </div>
                `
                : `
                <div style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center; gap: 4px;">
                    ${btnRadiografiaMixHtml}
                    <button class="btn-impactar-quirurgico" onclick="event.stopPropagation(); window.impactarArticuloCompuestoQuirurgico('${art.articulo_id}', ${costoKiloBaseSobrescritoMix})" style="background: rgba(245, 158, 11, 0.25); border: 1px solid #f59e0b; color: #fbbf24; padding: 2px 8px; border-radius: 4px; font-size: 0.70rem; font-weight: 800; cursor: pointer; box-shadow: 0 0 6px rgba(245, 158, 11, 0.3); display: inline-flex; align-items: center; gap: 4px;" title="Guardar nuevo costo simulado ($${costoKiloBaseSobrescritoMix.toFixed(2)}/kg) en BD">
                        ⚡ Impactar en BD
                    </button>
                </div>
                `;

            const infoTiempoMixHtml = costoTiempoVal > 0 
                ? `<div style="font-size: 0.68rem; color: #38bdf8; margin-top: 2px; display: flex; justify-content: space-between; align-items: center;" title="Mano de Obra / Tiempo de elaboración por bulto">
                     <span>⏱️ + M.O. (Tiempo):</span>
                     <strong>+$${costoTiempoVal.toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong>
                   </div>
                   <div style="font-size: 0.70rem; color: #fcd34d; margin-top: 2px; padding-top: 2px; border-top: 1px dotted rgba(255, 255, 255, 0.12); display: flex; justify-content: space-between; align-items: center;" title="Costo Total Operativo del bulto (Costo Base Receta + Mano de Obra)">
                     <span>💰 = Costo Total c/M.O.:</span>
                     <strong>$${costoNetoOperativoBultoMix.toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong>
                   </div>` 
                : '';

            const infoCostoBaseMixHtml = `
                <div style="font-size: 0.65rem; color: ${destinoLdnColor}; margin-top: 3px; font-weight: 700;">
                    ${destinoLdnLabel}
                </div>
                <div style="font-size: 0.70rem; color: #34d399; margin-top: 3px; padding-top: 3px; border-top: 1px dashed rgba(255, 255, 255, 0.1); display: flex; justify-content: space-between; align-items: center;" title="Costo Base de receta del bulto/carro comercial (${kilosUnidad.toFixed(2)} kg) sin M.O.">
                    <span>📦 Costo Base (Receta):</span>
                    <strong>$${costoBaseTotalBultoMix.toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong>
                </div>
                ${infoTiempoMixHtml}
                <div style="font-size: 0.68rem; color: #94a3b8; margin-top: 2px; display: flex; justify-content: space-between; align-items: center;" title="Costo base por kilogramo ($${costoKiloBaseSobrescritoMix.toFixed(2)}/kg) | Costo Neto con M.O.: $${costoNetoOperativoKiloMix.toFixed(2)}/kg">
                    <span>⚖️ Base / Total c/MO (kg):</span>
                    <strong style="color: #cbd5e1;">$${costoKiloBaseSobrescritoMix.toLocaleString('es-AR', {minimumFractionDigits: 2})} / $${costoNetoOperativoKiloMix.toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong>
                </div>
            `;

            card.innerHTML = `
                <div>
                    <div class="art-code" style="color: ${packPadreContenedor ? '#f472b6' : '#f59e0b'};">${art.articulo_id}</div>
                    <div class="art-name-compact" title="${art.descripcion_generada || art.descripcion}">${art.descripcion_generada || art.descripcion}</div>
                </div>
                <div class="art-stock-info" style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255, 255, 255, 0.08); display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem;">
                    <span style="color: var(--text-secondary);">Stock: <strong style="color: ${stockBultos > 0 ? '#10b981' : '#ef4444'}; font-weight: 700;">${stockBultos.toLocaleString('es-AR')} bultos</strong></span>
                    <span style="color: #06b6d4; font-weight: 600;" title="Totalidad de kilos disponibles en depósito">📦 ${totalKilos.toFixed(1).replace('.', ',')} kg tot.</span>
                </div>
                ${infoCostoBaseMixHtml}
                ${semaforoMixHtml}
                ${btnQuirurgicoMixHtml}
                <div class="art-footer" style="margin-top: 6px;">
                    <span>${kilosUnidad.toFixed(2)} kg/bulto</span>
                    ${badgeTipo}
                </div>
            `;
            if (gridConRecetaCompuestas) gridConRecetaCompuestas.appendChild(card);
            countConCompuestas++;

            // Pareo Estructural en Familia 42: Resolver la Unidad Productiva (UP) correspondiente al Carro (AP) mediante articulosProduccionExternaRelacion
            let upMatchCode = null;
            const dataMaster = window.pizarraSimulacionMaster;
            if (dataMaster && Array.isArray(dataMaster.articulosProduccionExternaRelacion)) {
                const rel = dataMaster.articulosProduccionExternaRelacion.find(r => 
                    (r.articulo_kilo_codigo || '').trim().toUpperCase() === art.articulo_id.trim().toUpperCase()
                );
                if (rel) {
                    upMatchCode = rel.articulo_produccion_codigo;
                }
            }

            if (upMatchCode) {
                const upArt = todos.find(a => a.articulo_id === upMatchCode);
                if (upArt && gridConRecetaUP) {
                    const alreadyRendered = Array.from(gridConRecetaUP.children).some(child => child.querySelector('.art-code')?.innerText === upArt.articulo_id);
                    if (!alreadyRendered) {
                        const stockBultosUP = parseFloat(upArt.stock_consolidado || 0);
                        const kilosUnidadUP = parseFloat(upArt.kilos_unidad || 0);
                        const totalKilosUP = stockBultosUP * kilosUnidadUP;

                        const upCard = document.createElement('div');
                        const isSelectedUP = window.articuloSeleccionadoId === upArt.articulo_id;
                        upCard.className = `articulo-card` + (isSelectedUP ? ' active' : '');
                        upCard.setAttribute('data-tooltip', `${upArt.descripcion_generada || upArt.descripcion} | Unidad Productiva`);
                        upCard.onclick = () => {
                            if (typeof window.seleccionarArticulo === 'function') {
                                window.seleccionarArticulo(upArt.articulo_id);
                            }
                        };
                        const badgeTipoUP = `<span class="art-badge-tipo" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);">🏭 UP (Planta)</span>`;
                        upCard.innerHTML = `
                            <div>
                                <div class="art-code" style="color: #c084fc;">${upArt.articulo_id}</div>
                                <div class="art-name-compact" title="${upArt.descripcion_generada || upArt.descripcion}">${upArt.descripcion_generada || upArt.descripcion}</div>
                            </div>
                            <div class="art-stock-info" style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255, 255, 255, 0.08); display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem;">
                                <span style="color: var(--text-secondary);">Stock: <strong style="color: ${stockBultosUP > 0 ? '#10b981' : '#ef4444'}; font-weight: 700;">${stockBultosUP.toLocaleString('es-AR')} bultos</strong></span>
                                <span style="color: #06b6d4; font-weight: 600;" title="Totalidad de kilos disponibles en depósito">📦 ${totalKilosUP.toFixed(1).replace('.', ',')} kg tot.</span>
                            </div>
                            <div class="art-footer" style="margin-top: 6px;">
                                <span>${kilosUnidadUP.toFixed(2)} kg/bulto</span>
                                ${badgeTipoUP}
                            </div>
                        `;
                        gridConRecetaUP.appendChild(upCard);
                        countConUP++;
                    }
                }
            }
        } else {
            // Desglose determinista de costos para tarjeta Mono (100%) o Pack Padre de Mono
            // IMPORTANTE: Verificar si el artículo tiene receta PROPIA sobre su propio SKU (no la heredada de pack_hijo_codigo)
            const tieneRecetaPropia = recetasList.some(r => (r.articulo_numero || '').trim().toLowerCase() === art.articulo_id.trim().toLowerCase()) || art.tiene_receta === true;
            const skuHijoClean = (art.pack_hijo_codigo || '').trim().toLowerCase();
            const bultoOrigenClean = (window.articuloSeleccionadoId || '').trim().toLowerCase();
            const esPack = (art.es_pack === true || (art.pack_unidades && parseInt(art.pack_unidades) > 1)) &&
                           Boolean(art.pack_hijo_codigo) &&
                           !tieneRecetaPropia &&
                           skuHijoClean !== art.articulo_id.trim().toLowerCase() &&
                           skuHijoClean !== bultoOrigenClean;

            const insumosEmpaqueReceta = ingredientesDeReceta.filter(ri => {
                const ingObj = ingredientesList.find(i => i.id === ri.ingrediente_id);
                return ingObj && (ingObj.es_insumo || ingObj.unidad_medida === 'Unidades');
            });
            const costoInsumosRecetaVal = insumosEmpaqueReceta.reduce((sum, ri) => {
                const ingObj = ingredientesList.find(i => i.id === ri.ingrediente_id);
                return sum + (parseFloat(ri.cantidad || 0) * parseFloat(ingObj?.costo_patron || 0));
            }, 0);

            const nombresInsumosStr = insumosEmpaqueReceta.map(ri => {
                const ingObj = ingredientesList.find(i => i.id === ri.ingrediente_id);
                return ingObj ? ingObj.nombre : 'Insumo';
            }).join(', ');

            const master = window.pizarraSimulacionMaster || {};
            const laArts = (master.articulosListas || []).filter(l => (l.articulo_numero || '').trim().toLowerCase() === art.articulo_id.trim().toLowerCase());
            const laArt = laArts.find(l => l.es_patron) || laArts.find(l => l.lista_id === 1) || laArts[0];
            const costoTiempoVal = parseFloat(laArt?.costo_tiempo || 0);

            const ingAlim = rIngsAlimentos[0];
            const ingAlimObj = ingAlim ? ingredientesList.find(i => i.id === ingAlim.ingrediente_id) : null;
            const costoKiloMatPrima = ingAlimObj
                ? parseFloat(ingAlimObj.costo_patron || 0)
                : (insumosEmpaqueReceta.length > 0 ? 0 : ((parseFloat(art.costo_base) || 0) / (kilosUnidad || 1)));
            
            let costoBaseTotalBulto = 0;
            let costoKiloBaseSobrescrito = 0;
            let empaqueDesgloseHtml = '';

            if (esPack && art.pack_hijo_codigo) {
                const hijoObj = todos.find(a => (a.articulo_id || '').toLowerCase() === (art.pack_hijo_codigo || '').toLowerCase());
                const kilosHijo = parseFloat(hijoObj?.kilos_unidad) || 1;
                const packUnidades = parseInt(art.pack_unidades) || 10;
                
                // 1. Insumos propios del pack en bunker_lista_insumos (ej: Bolsa 30x40 para el pack)
                const insumosPackList = (master.insumosListas || []).filter(ins => {
                    return laArt && ins.lista_articulo_id === laArt.id && (ins.incluido === true || ins.incluido === 'true');
                });
                const costoInsumosPackPropio = insumosPackList.reduce((sum, ins) => sum + (parseFloat(ins.cantidad || 0) * parseFloat(ins.costo_unitario_capturado || ins.costo_unitario_en_vivo || 0)), 0);
                const nombresInsumosPack = insumosPackList.map(i => i.descripcion || 'Empaque Pack').join(', ');

                // 2. Mano de obra de fraccionar las unidades hijas
                const laHijos = (master.articulosListas || []).filter(l => (l.articulo_numero || '').trim().toLowerCase() === (art.pack_hijo_codigo || '').trim().toLowerCase());
                const laHijo = (laArt ? laHijos.find(l => l.lista_id === laArt.lista_id) : null) || laHijos.find(l => l.es_patron) || laHijos[0];
                const moHijo = (laHijo && laHijo.mano_obra_activa !== false) ? (parseFloat(laHijo.costo_tiempo) || 0) : 0;

                // 3. Costo del hijo (Materia prima + insumo receta del hijo + mano de obra del hijo)
                const costoBultoHijo = (costoKiloMatPrima * kilosHijo) + costoInsumosRecetaVal + moHijo;
                costoBaseTotalBulto = (costoBultoHijo * packUnidades) + costoInsumosPackPropio;
                costoKiloBaseSobrescrito = costoBaseTotalBulto / (kilosUnidad || 1);

                if (costoInsumosPackPropio > 0) {
                    empaqueDesgloseHtml += `
                        <div style="font-size: 0.68rem; color: #c084fc; margin-top: 3px; display: flex; justify-content: space-between; align-items: center;" title="Empaque contenedor del pack: ${nombresInsumosPack}">
                            <span>📦 Pack (${nombresInsumosPack}):</span>
                            <strong>$${costoInsumosPackPropio.toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong>
                        </div>
                    `;
                }
                if (costoInsumosRecetaVal > 0) {
                    empaqueDesgloseHtml += `
                        <div style="font-size: 0.68rem; color: #fbbf24; margin-top: 2px; display: flex; justify-content: space-between; align-items: center;" title="Empaque individual de las ${packUnidades} unidades hijas: $${(costoInsumosRecetaVal * packUnidades).toLocaleString('es-AR', {minimumFractionDigits: 2})} en total">
                            <span>📦 Hijos (${packUnidades}x ${nombresInsumosStr || 'Bolsa'}):</span>
                            <strong>$${(costoInsumosRecetaVal * packUnidades).toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong>
                        </div>
                    `;
                }
                if (moHijo > 0) {
                    empaqueDesgloseHtml += `
                        <div style="font-size: 0.68rem; color: #38bdf8; margin-top: 2px; display: flex; justify-content: space-between; align-items: center;" title="Mano de obra de fraccionamiento de las ${packUnidades} unidades hijas: $${(moHijo * packUnidades).toLocaleString('es-AR', {minimumFractionDigits: 2})} en total">
                            <span>⏱️ MO Hijos (${packUnidades}x):</span>
                            <strong>$${(moHijo * packUnidades).toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong>
                        </div>
                    `;
                }
            } else {
                const costoMatPrimaBulto = costoKiloMatPrima * (kilosUnidad || 1);
                costoBaseTotalBulto = costoMatPrimaBulto + costoInsumosRecetaVal;
                costoKiloBaseSobrescrito = costoBaseTotalBulto / (kilosUnidad || 1);

                empaqueDesgloseHtml = `
                    <div style="font-size: 0.68rem; color: #cbd5e1; margin-top: 3px; display: flex; justify-content: space-between; align-items: center;" title="Materia prima: ${kilosUnidad.toFixed(2)} kg × $${costoKiloMatPrima.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg">
                        <span>🌱 Mat. Prima (${kilosUnidad.toFixed(2)}kg):</span>
                        <strong>$${costoMatPrimaBulto.toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong>
                    </div>
                `;
                if (costoInsumosRecetaVal > 0) {
                    empaqueDesgloseHtml += `
                        <div style="font-size: 0.68rem; color: #fbbf24; margin-top: 2px; display: flex; justify-content: space-between; align-items: center;" title="Insumos de empaque: ${nombresInsumosStr}">
                            <span>📦 + Empaque (${nombresInsumosStr || 'Bolsa'}):</span>
                            <strong>+$${costoInsumosRecetaVal.toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong>
                        </div>
                    `;
                }
            }

            // SEMÁFORO DE CERTEZA VISUAL: Base de Datos vs Simulación en Memoria
            // Nota: laArt.costo_base_sobrescrito en PostgreSQL ya incluye los insumos propios del pack dividido por kilosUnidad
            let costoOficialBD = parseFloat(art.costo_base) || 0;
            if (laArt && laArt.costo_base_sobrescrito !== null && laArt.costo_base_sobrescrito !== undefined && parseFloat(laArt.costo_base_sobrescrito) > 0) {
                const costoKiloBD = parseFloat(laArt.costo_base_sobrescrito);
                const costoBultoBD = costoKiloBD * (kilosUnidad || 1);
                if (Math.abs(costoBaseTotalBulto - costoBultoBD) < 0.05 || Math.abs(costoBaseTotalBulto - costoOficialBD) >= 0.05) {
                    costoOficialBD = costoBultoBD;
                }
            }
            const diffCosto = Math.abs(costoBaseTotalBulto - costoOficialBD);
            const estaSincronizado = diffCosto < 0.05 && costoOficialBD > 0;
            const costoTotalConMoBulto = costoBaseTotalBulto + costoTiempoVal;

            const semaforoHtml = estaSincronizado 
                ? `<div style="margin-top: 5px; padding: 3px 6px; border-radius: 4px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); display: flex; align-items: center; justify-content: space-between; font-size: 0.67rem; color: #34d399;" title="Costo Base grabado en PostgreSQL: $${costoOficialBD.toLocaleString('es-AR', {minimumFractionDigits: 2})} | Costo Total con M.O.: $${(costoOficialBD + costoTiempoVal).toLocaleString('es-AR', {minimumFractionDigits: 2})}">
                     <span>🟢 Grabado en BD</span>
                     <span style="font-weight: 700;">$${costoOficialBD.toLocaleString('es-AR', {minimumFractionDigits: 2})}${costoTiempoVal > 0 ? ` <span style="color:#a7f3d0; font-weight:600;">(c/MO: $${(costoOficialBD + costoTiempoVal).toLocaleString('es-AR', {minimumFractionDigits: 2})})</span>` : ''}</span>
                   </div>`
                : `<div style="margin-top: 5px; padding: 3px 6px; border-radius: 4px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); display: flex; align-items: center; justify-content: space-between; font-size: 0.67rem; color: #fbbf24;" title="Costo simulado en memoria pendiente de impactar en BD">
                     <span>🟡 Simulado (Pendiente)</span>
                     <span style="font-weight: 700;">Sim: $${costoBaseTotalBulto.toLocaleString('es-AR', {minimumFractionDigits: 2})}${costoTiempoVal > 0 ? ` (c/MO: $${costoTotalConMoBulto.toLocaleString('es-AR', {minimumFractionDigits: 2})})` : ''}</span>
                   </div>`;

            // Botón de acción quirúrgica individual + Inspector de Costos / Finanzas
            const btnRadiografiaHtml = `
                <button type="button" onclick="event.stopPropagation(); window.abrirRadiografiaCostosArticulo('${art.articulo_id}')" style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; padding: 2px 7px; border-radius: 4px; font-size: 0.68rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;" title="Ver radiografía financiera paso a paso de cómo se compone el costo y las listas de precios">
                    📊 Costos
                </button>
            `;
            const targetIngIdQuirurgico = ingAlimObj ? ingAlimObj.id : (window.ingredienteSeleccionadoId || insumosEmpaqueReceta[0]?.ingrediente_id || ingredientesAsociados[0]?.id || null);
            const btnQuirurgicoHtml = estaSincronizado
                ? `
                <div style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center; gap: 4px;">
                    ${btnRadiografiaHtml}
                    <button class="btn-impactar-quirurgico" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; padding: 2px 8px; border-radius: 4px; font-size: 0.70rem; font-weight: 700; cursor: default;" disabled title="Precios y costos 100% al día en base de datos PostgreSQL">
                        ✓ Al día en BD
                    </button>
                </div>
                `
                : `
                <div style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center; gap: 4px;">
                    ${btnRadiografiaHtml}
                    <button class="btn-impactar-quirurgico" onclick="event.stopPropagation(); window.impactarFraccionQuirurgica('${art.articulo_id}', ${targetIngIdQuirurgico})" style="background: rgba(245, 158, 11, 0.25); border: 1px solid #f59e0b; color: #fbbf24; padding: 2px 8px; border-radius: 4px; font-size: 0.70rem; font-weight: 800; cursor: pointer; box-shadow: 0 0 6px rgba(245, 158, 11, 0.3); display: inline-flex; align-items: center; gap: 4px;" title="Detectada variación de costo vs BD. Hacé clic para guardar en BD">
                        ⚡ Impactar en BD
                    </button>
                </div>
                `;

            const infoTiempoHtml = costoTiempoVal > 0 
                ? `<div style="font-size: 0.68rem; color: #38bdf8; margin-top: 2px; display: flex; justify-content: space-between; align-items: center;" title="Mano de Obra / Tiempo de fraccionamiento (se suma íntegro al precio sin recargarle margen encima)">
                     <span>⏱️ + M.O. (${esPack ? 'Armado Pack' : 'Tiempo'}):</span>
                     <strong>+$${costoTiempoVal.toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong>
                   </div>
                   <div style="font-size: 0.70rem; color: #fcd34d; margin-top: 2px; padding-top: 2px; border-top: 1px dotted rgba(255, 255, 255, 0.15); display: flex; justify-content: space-between; align-items: center;" title="Costo Total Operativo del Bulto (Materia Prima + Empaque + Mano de Obra)">
                     <span>💰 = Costo Total c/M.O.:</span>
                     <strong>$${costoTotalConMoBulto.toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong>
                   </div>` 
                : '';

            const infoCostoBaseHtml = `
                <div style="font-size: 0.70rem; color: #34d399; margin-top: 3px; padding-top: 3px; border-top: 1px dashed rgba(255, 255, 255, 0.1); display: flex; justify-content: space-between; align-items: center;" title="Costo Base de mercadería + empaque (${kilosUnidad.toFixed(2)} kg = $${costoKiloBaseSobrescrito.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg) sobre el que se aplica el % de Margen">
                    <span>📦 = Costo Base (s/MO):</span>
                    <strong>$${costoBaseTotalBulto.toLocaleString('es-AR', {minimumFractionDigits: 2})} <span style="font-size:0.63rem; color:#94a3b8; font-weight:600;">($${costoKiloBaseSobrescrito.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg)</span></strong>
                </div>
                ${infoTiempoHtml}
            `;

            const packPadreContenedor = todos.find(p => p.pack_hijo_codigo && p.pack_hijo_codigo.trim().toLowerCase() === art.articulo_id.trim().toLowerCase());
            const badgeTipo = esPack
                ? `<span class="art-badge-tipo" style="background: rgba(168, 85, 247, 0.2); color: #e9d5ff; border: 1px solid rgba(168, 85, 247, 0.4);">📦 Pack Padre (${art.pack_unidades || 10}x)</span>`
                : (packPadreContenedor
                    ? `<span class="art-badge-tipo pack-hijo" style="background: rgba(236, 72, 153, 0.2); color: #f472b6; border: 1px solid rgba(236, 72, 153, 0.4);" title="Forma parte del pack padre ${packPadreContenedor.articulo_id}">👶 Hijo de Pack (${packPadreContenedor.articulo_id})</span>`
                    : `<span class="art-badge-tipo success">📦 Mono (100%)</span>`);

            card.innerHTML = `
                <div>
                    <div class="art-code" style="color: ${esPack ? '#c084fc' : (packPadreContenedor ? '#f472b6' : '#10b981')};">${art.articulo_id}</div>
                    <div class="art-name-compact" title="${art.descripcion_generada || art.descripcion}">${art.descripcion_generada || art.descripcion}</div>
                </div>
                <div class="art-stock-info" style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255, 255, 255, 0.08); display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem;">
                    <span style="color: var(--text-secondary);">Stock: <strong style="color: ${stockBultos > 0 ? '#10b981' : '#ef4444'}; font-weight: 700;">${stockBultos.toLocaleString('es-AR')} bultos</strong></span>
                    <span style="color: #06b6d4; font-weight: 600;" title="${stockBultos} bultos de ${kilosUnidad.toFixed(2)} kg = ${totalKilos.toFixed(1)} kg totales">📦 ${stockBultos > 0 ? `(${kilosUnidad.toFixed(2)}kg ➔ ` : ''}${totalKilos.toFixed(1).replace('.', ',')} kg tot.${stockBultos > 0 ? ')' : ''}</span>
                </div>
                ${empaqueDesgloseHtml}
                ${infoCostoBaseHtml}
                ${semaforoHtml}
                ${btnQuirurgicoHtml}
                <div class="art-footer" style="margin-top: 6px;">
                    <span>${kilosUnidad.toFixed(2)} kg/bulto</span>
                    ${badgeTipo}
                </div>
            `;
            if (gridConRecetaMono) gridConRecetaMono.appendChild(card);
            countConMono++;
        }
    });

    // Actualización de badges de conteo
    const badgeSin = document.getElementById('count-sin-receta');
    const badgeCon = document.getElementById('count-con-receta');
    const badgeConMono = document.getElementById('count-con-receta-mono');
    const badgeConCompuestas = document.getElementById('count-con-receta-compuestas');
    const badgeConUP = document.getElementById('count-con-receta-up');
    const badgeIng = document.getElementById('count-ingredientes-relacionados');

    const totalConReceta = countConMono + countConCompuestas + countConUP;

    if (badgeSin) badgeSin.innerText = `${countSin} artículo${countSin !== 1 ? 's' : ''}`;
    if (badgeCon) badgeCon.innerText = `${totalConReceta} artículo${totalConReceta !== 1 ? 's' : ''}`;
    if (badgeConMono) badgeConMono.innerText = `${countConMono} artículo${countConMono !== 1 ? 's' : ''}`;
    if (badgeConCompuestas) badgeConCompuestas.innerText = `${countConCompuestas} artículo${countConCompuestas !== 1 ? 's' : ''}`;
    if (badgeConUP) badgeConUP.innerText = `${countConUP} artículo${countConUP !== 1 ? 's' : ''}`;
    if (badgeIng) {
        badgeIng.innerText = countIng > 0 ? `${countIng} insumo${countIng !== 1 ? 's' : ''}` : '⚠️ Sin vínculo';
    }

    // Despliegue de estados vacíos si corresponde
    if (countSin === 0) {
        gridSinReceta.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">No se encontraron artículos directos (sin receta).</div>';
    }
    if (gridConRecetaMono && countConMono === 0) {
        gridConRecetaMono.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">No se encontraron mono-ingredientes 100% puros.</div>';
    }
    if (gridConRecetaCompuestas && countConCompuestas === 0) {
        gridConRecetaCompuestas.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">No se encontraron mezclas o artículos puente.</div>';
    }
    if (gridConRecetaUP && countConUP === 0) {
        gridConRecetaUP.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">No se encontraron unidades productivas (UP).</div>';
    }
    if (gridIngredientes && countIng === 0 && ingredientesAsociados.length > 0) {
        gridIngredientes.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">No se encontraron insumos o ingredientes vinculados.</div>';
    }

    // -------------------------------------------------------------------------
    // CONTROL DE VISIBILIDAD Y CABECERA DINÁMICA DE TRANSPARENCIA (LDN 1 vs LDN 2)
    // -------------------------------------------------------------------------
    const accSinReceta = document.getElementById('accordion-sin-receta');
    const accConReceta = document.getElementById('accordion-con-receta');
    const articulosTitle = document.getElementById('articulos-title');
    const contextoActual = window.contextoLDN || 1;

    if (articulosTitle) {
        if (contextoActual === 2) {
            // Resolver si hay un ingrediente principal asociado para auditoría/propagación
            const ingPrincipalId = window.ingredienteSeleccionadoId || (ingredientesAsociados.length > 0 ? ingredientesAsociados[0].id : null);
            let btnMasterMonoHtml = '';
            if (ingPrincipalId) {
                const estadoMono = (typeof window.auditarEstadoFraccionesMono === 'function') 
                    ? window.auditarEstadoFraccionesMono(ingPrincipalId) 
                    : { total: 0, todosAlDia: false, pendientes: 0 };
                if (estadoMono.total > 0) {
                    btnMasterMonoHtml = estadoMono.todosAlDia
                        ? `<button onclick="propagarIngredienteAFraccionesMono(${ingPrincipalId})" style="margin-left: 10px; background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); padding: 3px 10px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; cursor: pointer;" title="Fracciones al día en BD. Ver auditoría">🟢 Fracciones al Día (${estadoMono.total})</button>`
                        : `<button onclick="propagarIngredienteAFraccionesMono(${ingPrincipalId})" style="margin-left: 10px; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border: none; padding: 3px 10px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; cursor: pointer; box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);" title="Impactar todas las fracciones mono en BD">⚡ Impactar Fracciones (${estadoMono.pendientes} pendientes)</button>`;
                }
            }

            if (seleccionadosVisibles.length === 1) {
                const artSel = seleccionadosVisibles[0];
                const nameSel = artSel.descripcion_generada || artSel.descripcion;
                articulosTitle.innerHTML = `⚙️ Transformados con Receta <span style="font-size: 0.78rem; font-weight: 500; color: #38bdf8; background: rgba(56, 189, 248, 0.15); padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(56, 189, 248, 0.3); margin-left: 8px;">🔍 Filtro Activo desde LDN 1: [${artSel.articulo_id}] ${nameSel}</span> ${btnMasterMonoHtml}`;
            } else if (seleccionadosVisibles.length > 1) {
                const codesSel = seleccionadosVisibles.map(a => a.articulo_id).join(', ');
                articulosTitle.innerHTML = `⚙️ Transformados con Receta <span style="font-size: 0.78rem; font-weight: 500; color: #fbbf24; background: rgba(251, 191, 36, 0.15); padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(251, 191, 36, 0.3); margin-left: 8px;">🔍 Filtro Activo desde LDN 1 (${seleccionadosVisibles.length} artículos): [${codesSel}]</span> ${btnMasterMonoHtml}`;
            } else if (window.ingredienteSeleccionadoId) {
                const ingSel = ingredientesList.find(i => i.id === window.ingredienteSeleccionadoId);
                const ingName = ingSel ? ingSel.nombre : `Insumo #${window.ingredienteSeleccionadoId}`;
                articulosTitle.innerHTML = `⚙️ Transformados con Receta <span style="font-size: 0.78rem; font-weight: 600; color: #fbbf24; background: rgba(245, 158, 11, 0.15); padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(245, 158, 11, 0.3); margin-left: 8px;">🎯 Insumo de Fábrica Activo: [ING #${window.ingredienteSeleccionadoId}] ${ingName}</span> ${btnMasterMonoHtml}`;
            } else {
                articulosTitle.innerHTML = `⚙️ Transformados con Receta <span style="font-size: 0.78rem; font-weight: 500; color: #94a3b8; background: rgba(148, 163, 184, 0.15); padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(148, 163, 184, 0.3); margin-left: 8px;">🔍 Mostrando Todos los Transformados (Sin Selección Previa)</span>`;
            }
        } else if (contextoActual === 1) {
            articulosTitle.innerHTML = '📦 Artículos [LDN 1]: Comercialización Directa';
        }
    }

    if (accConReceta) {
        // En LDN 1 (Comercialización Directa Limpia): Ocultar el acordeón de transformados
        // En LDN 2 (Transición / Transformados): Mostrar y expandir el acordeón de transformados
        accConReceta.style.display = (contextoActual === 1) ? 'none' : 'block';
        if (contextoActual === 2) {
            accConReceta.classList.add('open');
        }
    }
    if (accSinReceta) {
        accSinReceta.style.display = (contextoActual === 2) ? 'none' : 'block';
    }

    // -------------------------------------------------------------------------
    // VIGÍA DEPURADOR COMPLETO EN CONSOLA F12 (AUDITORÍA DE INTEGRIDAD EN TIEMPO REAL)
    // -------------------------------------------------------------------------
    if (window.VigíaPizarra) {
        window.VigíaPizarra.logEvent('RENDER_LDN', `Renderizado LDN (Fase ${contextoActual}) completado para [${seleccionadosVisibles.map(a => a.articulo_id).join(', ')}]`, {
            faseActiva: contextoActual,
            articulosSeleccionados: seleccionadosVisibles.map(a => a.articulo_id),
            filtroActivoHeader: seleccionadosVisibles.length > 0 ? seleccionadosVisibles.map(a => `${a.articulo_id} - ${a.descripcion_generada || a.descripcion}`) : 'Todos los transformados',
            ingredientesDetectados: ingredientesAsociados.map(i => `[ING #${i.id}] ${i.nombre}`),
            conteoRecetasMono: countConMono,
            conteoRecetasMixAP: countConCompuestas,
            conteoRecetasUP: countConUP,
            totalTransformados: totalConReceta,
            insumosEnFabrica: countIng,
            insumosHuerfanos: countHuerfanos
        });
    }

    if (typeof window.auditarIncidenciaLineasNegocio === 'function') {
        window.auditarIncidenciaLineasNegocio(window.articuloSeleccionadoId);
    }
}

// Exportar globalmente para el controlador visual
window.toggleAccordion = toggleAccordion;
window.renderizarArticulosBunkerLDN1 = renderizarArticulosBunkerLDN1;

// -------------------------------------------------------------------------
// HERRAMIENTA DE VINCULACIÓN Y REVOCACIÓN ESTRUCTURAL MANUAL (CERO PARCHES)
// -------------------------------------------------------------------------
window.abrirModalVinculacionEstructural = function(artId, artDesc) {
    if (typeof Swal === 'undefined') {
        alert('SweetAlert2 no está disponible');
        return;
    }

    if (Array.isArray(window.articulosSeleccionadosIds) && window.articulosSeleccionadosIds.length > 1) {
        Swal.fire({
            icon: 'warning',
            title: 'Multiselección Activa',
            text: 'Debes seleccionar exactamente 1 solo artículo en el catálogo para establecer una vinculación estructural en PostgreSQL.',
            confirmButtonText: 'Entendido'
        });
        return;
    }

    const ingredientesList = window.pizarraSimulacionMaster?.ingredientes || [];

    Swal.fire({
        title: '🔗 Vinculación Estructural de Ingrediente',
        html: `
            <div style="text-align: left; font-size: 0.85rem; margin-bottom: 12px;">
                <div style="background: rgba(59, 130, 246, 0.1); border-left: 3px solid #3b82f6; padding: 8px 12px; margin-bottom: 12px; border-radius: 4px;">
                    <strong>Artículo Búnker Directo:</strong> <span style="color: #38bdf8;">[${artId}]</span> ${artDesc}
                </div>
                <label style="font-weight: 600; display: block; margin-bottom: 4px;">Buscar Ingrediente en Fábrica (Filtrado Acumulativo por Espacios):</label>
                <input type="text" id="swal-input-search-ing" class="swal2-input" placeholder="Escribe grupo de términos (ej: coco escamas)..." style="margin: 0 0 10px 0; width: 100%; box-sizing: border-box;">
                <div id="swal-ingredientes-list-container" style="max-height: 220px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 6px; background: rgba(15,23,42,0.6);">
                    <!-- Cargado dinámicamente -->
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: '💾 Guardar Vínculo en PostgreSQL',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        didOpen: () => {
            const inputSearch = document.getElementById('swal-input-search-ing');
            const listContainer = document.getElementById('swal-ingredientes-list-container');
            let selectedIngId = null;

            const renderOptions = () => {
                const queryRaw = inputSearch.value || '';
                const queryNorm = queryRaw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
                const searchTerms = queryNorm.split(/\s+/).filter(Boolean);

                const filtered = ingredientesList.filter(ing => {
                    if (ing.es_insumo) return false;
                    if (searchTerms.length === 0) return true;
                    const text = `${ing.id} ${ing.codigo || ''} ${ing.nombre || ''} ${ing.articulo_vinculado_numero || ''}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    return searchTerms.every(term => text.includes(term));
                });

                if (filtered.length === 0) {
                    listContainer.innerHTML = `<div style="padding: 10px; color: #94a3b8; font-size: 0.78rem; text-align: center;">No se encontraron ingredientes coincidentes con "${queryRaw}".</div>`;
                    return;
                }

                listContainer.innerHTML = filtered.map(ing => `
                    <label style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; border-radius: 4px; margin-bottom: 2px;" class="swal-ing-option">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input type="radio" name="swal_selected_ing" value="${ing.id}" ${selectedIngId === ing.id ? 'checked' : ''} style="cursor: pointer;">
                            <div>
                                <strong style="color: #38bdf8; font-size: 0.80rem;">[ING #${ing.id}] ${ing.nombre}</strong>
                                ${ing.articulo_vinculado_numero ? `<span style="font-size: 0.70rem; color: #f59e0b; margin-left: 6px;">(Vinculado a: ${ing.articulo_vinculado_numero})</span>` : ''}
                            </div>
                        </div>
                        <span style="font-size: 0.75rem; color: #10b981;">Stock: ${parseFloat(ing.stock_actual || 0).toFixed(2)} kg</span>
                    </label>
                `).join('');

                listContainer.querySelectorAll('input[name="swal_selected_ing"]').forEach(radio => {
                    radio.onchange = () => {
                        selectedIngId = parseInt(radio.value);
                    };
                });
            };

            inputSearch.oninput = renderOptions;
            renderOptions();
        },
        preConfirm: () => {
            const checked = document.querySelector('input[name="swal_selected_ing"]:checked');
            if (!checked) {
                Swal.showValidationMessage('Debes seleccionar un ingrediente de fábrica para realizar el vínculo.');
                return false;
            }
            return parseInt(checked.value);
        }
    }).then(async (result) => {
        if (result.isConfirmed && result.value) {
            const ingId = result.value;
            try {
                const response = await fetch(`/api/produccion/ingredientes/${ingId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ articulo_vinculado_numero: artId })
                });

                if (!response.ok) {
                    throw new Error(`HTTP Error ${response.status}`);
                }

                if (window.VigíaPizarra) {
                    window.VigíaPizarra.logEvent('BD', `Vínculo estructural ESTABLECIDO en PostgreSQL: [Ingrediente #${ingId}] <-> [Artículo ${artId}]`, {
                        ingredienteId: ingId,
                        articuloId: artId
                    });
                }

                Swal.fire({
                    icon: 'success',
                    title: '¡Vínculo Guardado en PostgreSQL!',
                    text: `El Ingrediente #${ingId} quedó estructuralmente vinculado al Artículo ${artId}.`,
                    timer: 1800,
                    showConfirmButton: false
                });

                // Actualización instantánea en la memoria RAM del cliente para renderizado sin F5
                if (window.pizarraSimulacionMaster && Array.isArray(window.pizarraSimulacionMaster.ingredientes)) {
                    const ingTarget = window.pizarraSimulacionMaster.ingredientes.find(i => i.id === ingId);
                    if (ingTarget) {
                        ingTarget.articulo_vinculado_numero = artId;
                    }
                }

                // Renderizado automático e inmediato del DOM de todos los acordeones
                if (typeof renderizarArticulosBunkerLDN1 === 'function') {
                    renderizarArticulosBunkerLDN1();
                }

                // Rehidratación silenciosa en segundo plano desde el servidor
                if (typeof window.inicializarPizarra === 'function') {
                    window.inicializarPizarra(true);
                }
            } catch (err) {
                console.error('Error al guardar vínculo estructural:', err);
                Swal.fire('Error', `No se pudo guardar el vínculo en PostgreSQL: ${err.message}`, 'error');
            }
        }
    });
};

window.revocarVinculoEstructural = function(ingId, artId) {
    if (typeof Swal === 'undefined') return;

    Swal.fire({
        title: '¿Revocar Vínculo Estructural?',
        text: `¿Deseas eliminar el vínculo en PostgreSQL entre el Ingrediente #${ingId} y el Artículo [${artId}]?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, Revocar Vínculo',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const response = await fetch(`/api/produccion/ingredientes/${ingId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ articulo_vinculado_numero: null, revocar_articulo_id: artId })
                });

                if (!response.ok) {
                    throw new Error(`HTTP Error ${response.status}`);
                }

                if (window.VigíaPizarra) {
                    window.VigíaPizarra.logEvent('BD', `Vínculo estructural REVOCADO en PostgreSQL: [Ingrediente #${ingId}] </-> [Artículo ${artId}]`, {
                        ingredienteId: ingId,
                        articuloId: artId
                    });
                }

                Swal.fire({
                    icon: 'success',
                    title: 'Vínculo Revocado',
                    text: `El Ingrediente #${ingId} ya no está vinculado al Artículo ${artId}.`,
                    timer: 1600,
                    showConfirmButton: false
                });

                // Actualización instantánea en la memoria RAM del cliente para renderizado sin F5
                if (window.pizarraSimulacionMaster && Array.isArray(window.pizarraSimulacionMaster.ingredientes)) {
                    const ingTarget = window.pizarraSimulacionMaster.ingredientes.find(i => i.id === ingId);
                    if (ingTarget) {
                        ingTarget.articulo_vinculado_numero = null;
                    }
                }

                // Renderizado automático e inmediato del DOM de todos los acordeones
                if (typeof renderizarArticulosBunkerLDN1 === 'function') {
                    renderizarArticulosBunkerLDN1();
                }

                // Rehidratación silenciosa en segundo plano desde el servidor
                if (typeof window.inicializarPizarra === 'function') {
                    window.inicializarPizarra(true);
                }
            } catch (err) {
                console.error('Error al revocar vínculo estructural:', err);
                Swal.fire('Error', `No se pudo revocar el vínculo: ${err.message}`, 'error');
            }
        }
    });
};

// -------------------------------------------------------------------------
// MANEJO DE MULTISELECCIÓN CON TECLA CONTROL (CTRL + CLIC)
// -------------------------------------------------------------------------
window.seleccionarArticuloMulti = function(articuloId, event) {
    const isCtrl = event && (event.ctrlKey || event.metaKey);

    if (!Array.isArray(window.articulosSeleccionadosIds)) {
        window.articulosSeleccionadosIds = window.articuloSeleccionadoId ? [window.articuloSeleccionadoId] : [];
    }

    if (isCtrl) {
        const idx = window.articulosSeleccionadosIds.indexOf(articuloId);
        if (idx >= 0) {
            if (window.articulosSeleccionadosIds.length > 1) {
                window.articulosSeleccionadosIds.splice(idx, 1);
            }
        } else {
            window.articulosSeleccionadosIds.push(articuloId);
        }
    } else {
        window.articulosSeleccionadosIds = [articuloId];
    }

    window.articuloSeleccionadoId = window.articulosSeleccionadosIds[0];
    window.ingredienteSeleccionadoId = null;
    window.deseleccionManual = false;

    if (window.VigíaPizarra) {
        window.VigíaPizarra.logEvent('ARTICULO', `Multiselección [CTRL+Clic]: ${window.articulosSeleccionadosIds.length} artículos seleccionados`, {
            articulos: window.articulosSeleccionadosIds
        });
    }

    if (typeof window.seleccionarArticulo === 'function') {
        window.seleccionarArticulo(window.articuloSeleccionadoId);
    }

    if (typeof window.renderizarArticulosBunkerLDN1 === 'function') {
        window.renderizarArticulosBunkerLDN1();
    }
};

// -------------------------------------------------------------------------
// SELECCIÓN Y EDICIÓN DE INGREDIENTES HUÉRFANOS DE FÁBRICA
// -------------------------------------------------------------------------
window.seleccionarIngredienteHuerfano = function(ingId) {
    const ingIdNum = Number(ingId);
    window.deseleccionManual = false;
    window.ingredienteSeleccionadoId = ingIdNum;
    window.articuloSeleccionadoId = null;
    window.articulosSeleccionadosIds = [];
    window.articuloRaizTrazadoId = null;
    window.ingredienteRaizTrazadoId = ingIdNum;
    window.ultimoIngredienteSeleccionadoId = ingIdNum;

    if (window.VigíaPizarra) {
        window.VigíaPizarra.logEvent('INSUMO_HUERFANO', `Insumo puro de fábrica seleccionado: [ING #${ingIdNum}]`, {
            ingredienteId: ingIdNum
        });
    }

    if (typeof window.auditarIncidenciaLineasNegocio === 'function') {
        window.auditarIncidenciaLineasNegocio(null, ingIdNum);
    }

    if (typeof window.renderizarArticulosBunkerLDN1 === 'function') {
        window.renderizarArticulosBunkerLDN1();
    }
};

window.abrirEdicionManualCostoIngrediente = async function(ingId) {
    const master = window.pizarraSimulacionMaster;
    const ing = (master?.ingredientes || []).find(i => i.id === Number(ingId));
    if (!ing) return;

    const { value: nuevoCosto } = await Swal.fire({
        title: `Editar Costo Patrón`,
        text: `Insumo #${ing.id}: ${ing.nombre}`,
        input: 'number',
        inputValue: ing.costo_patron || 0,
        inputAttributes: {
            step: '0.01',
            min: '0'
        },
        showCancelButton: true,
        confirmButtonText: 'Guardar Costo',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#0284c7'
    });

    if (nuevoCosto !== undefined && nuevoCosto !== null && !isNaN(parseFloat(nuevoCosto))) {
        const costoVal = parseFloat(nuevoCosto);
        try {
            Swal.fire({
                title: 'Guardando...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            const res = await fetch('/api/produccion/conciliacion/articulos/confirmar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    articulo_id: `ING-${ing.id}`,
                    es_ingrediente: true,
                    ingrediente_id: ing.id,
                    nuevo_costo_base: costoVal,
                    costo_kilo_calculado: costoVal,
                    proveedor_nombre: 'Ajuste Manual Operador',
                    descripcion_proveedor: `${ing.nombre} (Edición Manual Taller)`,
                    justificacion_determinista: 'Actualización manual de costo patrón desde Pizarra'
                })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);

            ing.costo_patron = costoVal;
            Swal.fire('¡Actualizado!', `Costo de ${ing.nombre} actualizado a $${costoVal.toFixed(2)}/kg`, 'success');
            
            if (typeof window.inicializarPizarra === 'function') {
                await window.inicializarPizarra(true);
            }
            if (typeof window.renderizarArticulosBunkerLDN1 === 'function') {
                window.renderizarArticulosBunkerLDN1();
            }
            if (typeof window.auditarIncidenciaLineasNegocio === 'function') {
                window.auditarIncidenciaLineasNegocio(null, ing.id);
            }
        } catch (e) {
            Swal.fire('Error', e.message, 'error');
        }
    }
};

async function sincronizarIngredienteDesdeArticulo(articuloId, ingredienteId) {
    const result = await Swal.fire({
        title: '¿Actualizar Insumo de Fábrica?',
        html: `
            <div style="text-align: left; font-size: 0.9rem; color: #334155;">
                <p>Se actualizará el costo del ingrediente en fábrica (catálogo oficial en <code>public.ingredientes.costo_patron</code>):</p>
                <ul>
                    <li><strong>Artículo Comercial:</strong> [${articuloId}]</li>
                    <li><strong>Ingrediente ID:</strong> #${ingredienteId}</li>
                </ul>
            </div>
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, Actualizar Insumo',
        cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
        Swal.fire({
            title: 'Actualizando insumo en fábrica...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const response = await fetch('/api/produccion/simulacion/sincronizar-ingrediente', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articulo_id: articuloId, ingrediente_id: ingredienteId })
        });

        const resData = await response.json();
        if (!resData.success) throw new Error(resData.message || 'Error al sincronizar');

        if (window.VigíaPizarra) {
            window.VigíaPizarra.logEvent('INSUMO_FABRICA', `⚡ Costo Patrón Transferido al Insumo de Fábrica: [Ingrediente #${ingredienteId}] <- SKU [${articuloId}]`, {
                articuloId: articuloId,
                ingredienteId: ingredienteId,
                respuesta: resData.message
            });
        }

        Swal.fire('¡Insumo Actualizado!', resData.message, 'success');

        window.articuloSeleccionadoId = articuloId;
        window.articulosSeleccionadosIds = [articuloId];

        if (typeof window.inicializarPizarra === 'function') {
            await window.inicializarPizarra(true);
        } else if (typeof window.renderizarArticulosBunkerLDN1 === 'function') {
            window.renderizarArticulosBunkerLDN1();
        }
    } catch (err) {
        console.error('❌ Error al sincronizar ingrediente:', err);
        Swal.fire('Error', err.message || 'No se pudo actualizar el ingrediente.', 'error');
    }
}

// Módulo de Edición Manual de Costo por Kilo e IVA con Réplica al Ingrediente de Fábrica
window.abrirEdicionManualCostoIva = async function(articuloId) {
    const master = window.pizarraSimulacionMaster;
    if (!master || !master.articulosBunker) return;

    const art = master.articulosBunker.find(a => a.articulo_id === articuloId);
    if (!art) return;

    const kilosUnidad = parseFloat(art.kilos_unidad) || 1;
    const finanzasActuales = (typeof window.obtenerFinanzasBunkerArticulo === 'function')
        ? window.obtenerFinanzasBunkerArticulo(art)
        : { costoBulto: parseFloat(art.costo_base) || 0, costoKilo: (parseFloat(art.costo_base) || 0) / kilosUnidad, porcentajeIva: parseFloat(art.porcentaje_iva || art.iva || 21) };
    let costoBaseBulto = finanzasActuales.costoBulto;
    const ivaActual = finanzasActuales.porcentajeIva;

    // Buscar si hay ingrediente vinculado
    const ingredientesList = master.ingredientes || [];
    const ingVinculado = ingredientesList.find(ing => {
        const vinculacionesDirectas = ing.bunker_articulos || [];
        const esDirecto = ing.articulo_vinculado_numero === art.articulo_id;
        const esJunction = vinculacionesDirectas.some(b => (b.codigo || b.articulo_id) === art.articulo_id);
        return esDirecto || esJunction;
    });

    let costoKiloActual = kilosUnidad > 0 ? (costoBaseBulto / kilosUnidad) : costoBaseBulto;
    if (costoKiloActual <= 0 && ingVinculado && parseFloat(ingVinculado.costo_patron) > 0) {
        costoKiloActual = parseFloat(ingVinculado.costo_patron);
        costoBaseBulto = costoKiloActual * kilosUnidad;
    }

    const ingInfoHTML = ingVinculado 
        ? `<div style="margin-top: 10px; padding: 8px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 6px; font-size: 0.78rem; color: #93c5fd;">
             🔗 <strong>Ingrediente Vinculado en Fábrica:</strong> #${ingVinculado.id} ${ingVinculado.nombre} (Costo Patrón actual: $${parseFloat(ingVinculado.costo_patron || 0).toFixed(2)}/kg)
           </div>`
        : `<div style="margin-top: 10px; padding: 8px; background: rgba(148, 163, 184, 0.1); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 6px; font-size: 0.78rem; color: #94a3b8;">
             ⚪ <em>No se detectó ingrediente en fábrica directamente vinculado a este artículo.</em>
           </div>`;

    const { value: formValues } = await Swal.fire({
        title: `✏️ Edición Manual de Costo e IVA`,
        html: `
            <div style="text-align: left; font-size: 0.85rem; color: #e2e8f0;">
                <p style="margin-bottom: 8px;">Artículo: <strong>[${art.articulo_id}] ${art.descripcion_generada || art.descripcion}</strong> (${kilosUnidad} kg/bulto)</p>
                
                <div style="margin-bottom: 12px;">
                    <label style="display: block; font-weight: 600; margin-bottom: 4px; color: #38bdf8;">💰 Nuevo Costo por Kilo ($/kg):</label>
                    <input id="swal-costo-kilo" type="number" step="0.01" class="swal2-input" style="width: 100%; margin: 0; background: #0f172a; color: #fff; border: 1px solid #334155;" value="${costoKiloActual.toFixed(2)}" oninput="
                        const k = ${kilosUnidad};
                        const v = parseFloat(this.value) || 0;
                        document.getElementById('swal-preview-bulto').innerText = '$' + (v * k).toLocaleString('es-AR', {minimumFractionDigits:2});
                    ">
                    <span style="font-size: 0.75rem; color: #f59e0b; display: block; margin-top: 4px;">
                        ➡️ Costo Bulto resultante: <strong id="swal-preview-bulto">$${costoBaseBulto.toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong>
                    </span>
                </div>

                <div style="margin-bottom: 12px;">
                    <label style="display: block; font-weight: 600; margin-bottom: 4px; color: #a855f7;">📊 Tasa de IVA (%):</label>
                    <select id="swal-iva" class="swal2-input" style="width: 100%; margin: 0; background: #0f172a; color: #fff; border: 1px solid #334155;">
                        <option value="21" ${ivaActual === 21 ? 'selected' : ''}>21.0% (Tasa General)</option>
                        <option value="10.5" ${ivaActual === 10.5 ? 'selected' : ''}>10.5% (Tasa Reducida)</option>
                        <option value="0" ${ivaActual === 0 ? 'selected' : ''}>0.0% (Exento)</option>
                    </select>
                </div>

                ${ingInfoHTML}

                ${ingVinculado ? `
                <div style="margin-top: 12px; display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" id="swal-sync-ingrediente" style="width: 16px; height: 16px; cursor: pointer;">
                    <label for="swal-sync-ingrediente" style="font-size: 0.8rem; font-weight: 600; color: #34d399; cursor: pointer;">
                        ⚡ Replicar $/kg e IVA al Ingrediente de Fábrica (#${ingVinculado.id})
                    </label>
                </div>
                ` : ''}
            </div>
        `,
        background: '#151e2e',
        color: '#f3f4f6',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#64748b',
        confirmButtonText: '⚡ Guardar e Impactar en BD',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        preConfirm: () => {
            const costoKilo = parseFloat(document.getElementById('swal-costo-kilo').value);
            const iva = parseFloat(document.getElementById('swal-iva').value);
            const syncIng = document.getElementById('swal-sync-ingrediente')?.checked || false;

            if (isNaN(costoKilo) || costoKilo <= 0) {
                Swal.showValidationMessage('Por favor ingrese un costo por kilo válido mayor a 0');
                return false;
            }
            return { costoKilo, iva, syncIng };
        }
    });

    if (!formValues) return;

    try {
        Swal.fire({
            title: 'Actualizando parámetros...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const response = await fetch('/api/produccion/simulacion/sincronizar-ingrediente', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                articulo_id: articuloId,
                ingrediente_id: formValues.syncIng && ingVinculado ? ingVinculado.id : null,
                costo_kilo_manual: formValues.costoKilo,
                iva_manual: formValues.iva
            })
        });

        const resData = await response.json();
        if (!resData.success) throw new Error(resData.message || 'Error al actualizar');

        window.articuloSeleccionadoId = articuloId;
        window.articulosSeleccionadosIds = [articuloId];

        if (typeof window.inicializarPizarra === 'function') {
            await window.inicializarPizarra(true);
        } else if (typeof window.renderizarArticulosBunkerLDN1 === 'function') {
            window.renderizarArticulosBunkerLDN1();
        }

        Swal.fire({
            icon: 'success',
            title: 'Parámetros Actualizados',
            text: resData.message,
            timer: 2200,
            showConfirmButton: false,
            background: '#151e2e',
            color: '#f3f4f6'
        });

    } catch (err) {
        Swal.fire({
            icon: 'error',
            title: 'Error de Actualización',
            text: err.message,
            background: '#151e2e',
            color: '#f3f4f6'
        });
    }
};

// Función Helper Determinista: Obtiene las fracciones directas Y sus Packs Padres derivados (Línea 2)
window.obtenerArticulosMonoIngredientesDeIngrediente = function(ingredienteId) {
    const master = window.pizarraSimulacionMaster;
    if (!master || !master.articulosBunker) return [];

    const todos = master.articulosBunker || [];
    const recetasList = master.recetas || [];
    const recetaIngredientesList = master.recetaIngredientes || [];
    const ingredientesList = master.ingredientes || [];

    const ingObj = ingredientesList.find(i => i.id === ingredienteId);
    const bultoCerradoOrigen = (ingObj?.articulo_vinculado_numero || '').trim().toLowerCase();

    // 1. Fracciones con receta directa (nota: si art.tiene_receta === true, ya es una presentación transformada en LDN 2, nunca un bulto cerrado sin receta de LDN 1)
    const fraccionesDirectas = todos.filter(art => {
        if (art.tiene_receta !== true) return false;

        const descStr = (art.descripcion_generada || art.descripcion || '').toLowerCase();
        const codeStr = (art.articulo_id || '').toLowerCase();

        const recetasDelArt = recetasList.filter(r => r.articulo_numero === art.articulo_id);
        const recetaIds = recetasDelArt.map(r => r.id);
        const ingredientesDeReceta = recetaIngredientesList.filter(ri => recetaIds.includes(ri.receta_id));

        const consumeIngrediente = ingredientesDeReceta.some(ri => ri.ingrediente_id === ingredienteId);
        if (!consumeIngrediente) return false;

        const rIngsAlimentos = ingredientesDeReceta.filter(ri => {
            const ingItem = ingredientesList.find(i => i.id === ri.ingrediente_id);
            return ingItem && !ingItem.es_insumo && ingItem.unidad_medida !== 'Unidades';
        });

        const esUnidadProductiva = codeStr.startsWith('prod up') || codeStr.includes(' up ') || codeStr.endsWith(' up') || descStr.includes('unidad productiva') || descStr.includes('prod up');
        const esMixOPuente = !esUnidadProductiva && (descStr.includes('mix') || codeStr.includes('mix') || codeStr.startsWith('prod ap') || descStr.includes('puente') || rIngsAlimentos.length > 1);

        return !esUnidadProductiva && !esMixOPuente;
    });

    const skusHijosSet = new Set(fraccionesDirectas.map(f => (f.articulo_id || '').trim().toLowerCase()));

    // 2. Packs Padres derivados de estas fracciones mono
    const packsPadres = todos.filter(art => {
        if (!art.es_pack && (!art.pack_unidades || parseInt(art.pack_unidades) <= 1)) return false;
        if (!art.pack_hijo_codigo) return false;
        if (art.tiene_receta === true) return false;
        const hijoSku = (art.pack_hijo_codigo || '').trim().toLowerCase();
        return hijoSku && skusHijosSet.has(hijoSku) && hijoSku !== art.articulo_id.trim().toLowerCase();
    });

    return [...fraccionesDirectas, ...packsPadres];
};

// Función Helper Determinista: Audita el estado de sincronización de las fracciones mono de un ingrediente
window.auditarEstadoFraccionesMono = function(ingredienteId) {
    const master = window.pizarraSimulacionMaster;
    if (!master || !master.ingredientes) return { total: 0, pendientes: 0, alDia: 0, todosAlDia: false, rowsData: [] };
    const ing = master.ingredientes.find(i => i.id === ingredienteId);
    if (!ing) return { total: 0, pendientes: 0, alDia: 0, todosAlDia: false, rowsData: [] };

    const articulosMono = typeof window.obtenerArticulosMonoIngredientesDeIngrediente === 'function'
        ? window.obtenerArticulosMonoIngredientesDeIngrediente(ingredienteId)
        : [];

    if (articulosMono.length === 0) return { total: 0, pendientes: 0, alDia: 0, todosAlDia: false, rowsData: [] };

    const costoPatron = parseFloat(ing.costo_patron || 0);

    const rowsData = articulosMono.map(art => {
        const kilos = parseFloat(art.kilos_unidad) || 1;
        const recArt = (master.recetas || []).filter(r => (r.articulo_numero || '').trim().toLowerCase() === art.articulo_id.trim().toLowerCase());
        const tieneRecetaPropia = recArt.length > 0 || art.tiene_receta === true;
        const skuHijoClean = (art.pack_hijo_codigo || '').trim().toLowerCase();
        const bultoOrigenClean = (ing.articulo_vinculado_numero || '').trim().toLowerCase();
        const esPack = (art.es_pack === true || (art.pack_unidades && parseInt(art.pack_unidades) > 1)) &&
                       Boolean(art.pack_hijo_codigo) &&
                       !tieneRecetaPropia &&
                       skuHijoClean !== art.articulo_id.trim().toLowerCase() &&
                       skuHijoClean !== bultoOrigenClean;

        const laArts = (master.articulosListas || []).filter(l => (l.articulo_numero || '').trim().toLowerCase() === art.articulo_id.trim().toLowerCase());
        const laArt = laArts.find(l => l.es_patron) || laArts.find(l => l.lista_id === 1) || laArts[0];
        const costoTiempo = parseFloat(laArt?.costo_tiempo || 0);

        let costoMatPrima = 0;
        let costoEmpaque = 0;
        let moHijosTotal = 0;
        let empaqueNombres = 'Sin empaque';

        if (esPack && art.pack_hijo_codigo) {
            const hijo = (master.articulosBunker || []).find(a => (a.articulo_id || '').toLowerCase() === (art.pack_hijo_codigo || '').toLowerCase());
            const kilosHijo = parseFloat(hijo?.kilos_unidad) || 1;
            const unidades = parseInt(art.pack_unidades) || 10;
            
            const recHijo = (master.recetas || []).filter(r => (r.articulo_numero || '').trim().toLowerCase() === (art.pack_hijo_codigo || '').trim().toLowerCase());
            const recIdsHijo = recHijo.map(r => r.id);
            const ingRecHijo = (master.recetaIngredientes || []).filter(ri => recIdsHijo.includes(ri.receta_id));
            
            const alimHijo = ingRecHijo.filter(ri => {
                const iObj = master.ingredientes.find(i => i.id === ri.ingrediente_id);
                return iObj && !iObj.es_insumo && iObj.unidad_medida !== 'Unidades';
            });
            const insHijo = ingRecHijo.filter(ri => {
                const iObj = master.ingredientes.find(i => i.id === ri.ingrediente_id);
                return iObj && (iObj.es_insumo || iObj.unidad_medida === 'Unidades');
            });
            const costoEmpaqueHijos = insHijo.reduce((s, ri) => {
                const iObj = master.ingredientes.find(i => i.id === ri.ingrediente_id);
                return s + (parseFloat(ri.cantidad || 0) * parseFloat(iObj?.costo_patron || 0));
            }, 0) * unidades;

            const costoMatPrimaHijoUnit = alimHijo.length > 0
                ? alimHijo.reduce((s, ri) => {
                    const iObj = master.ingredientes.find(i => i.id === ri.ingrediente_id);
                    const cant = parseFloat(ri.cantidad) || kilosHijo;
                    return s + (cant * parseFloat(iObj?.costo_patron || 0));
                }, 0)
                : (insHijo.length > 0 ? 0 : (costoPatron * kilosHijo));

            // Insumos propios del Pack Padre en bunker_lista_insumos (ej: Bolsa 30x40)
            const insumosPackList = (master.insumosListas || []).filter(ins => {
                return laArt && ins.lista_articulo_id === laArt.id && (ins.incluido === true || ins.incluido === 'true');
            });
            const costoInsumosPackPropio = insumosPackList.reduce((sum, ins) => sum + (parseFloat(ins.cantidad || 0) * parseFloat(ins.costo_unitario_capturado || ins.costo_unitario_en_vivo || 0)), 0);
            const nombresInsumosPack = insumosPackList.map(i => i.descripcion || 'Bolsa Pack').join(', ');

            // Mano de obra del hijo multiplicada por las unidades del pack
            const laHijos = (master.articulosListas || []).filter(l => (l.articulo_numero || '').trim().toLowerCase() === (art.pack_hijo_codigo || '').trim().toLowerCase());
            const laHijo = (laArt ? laHijos.find(l => l.lista_id === laArt.lista_id) : null) || laHijos.find(l => l.es_patron) || laHijos[0];
            const moHijo = (laHijo && laHijo.mano_obra_activa !== false) ? (parseFloat(laHijo.costo_tiempo) || 0) : 0;
            moHijosTotal = moHijo * unidades;

            costoEmpaque = costoEmpaqueHijos + costoInsumosPackPropio;
            costoMatPrima = costoMatPrimaHijoUnit * unidades;
            empaqueNombres = `${unidades}x Hijos ($${costoEmpaqueHijos.toFixed(2)})` + (costoInsumosPackPropio > 0 ? ` + Pack ${nombresInsumosPack} ($${costoInsumosPackPropio.toFixed(2)})` : '');
        } else {
            const recIds = recArt.map(r => r.id);
            const ingRec = (master.recetaIngredientes || []).filter(ri => recIds.includes(ri.receta_id));
            
            const alimRec = ingRec.filter(ri => {
                const iObj = master.ingredientes.find(i => i.id === ri.ingrediente_id);
                return iObj && !iObj.es_insumo && iObj.unidad_medida !== 'Unidades';
            });
            const insRec = ingRec.filter(ri => {
                const iObj = master.ingredientes.find(i => i.id === ri.ingrediente_id);
                return iObj && (iObj.es_insumo || iObj.unidad_medida === 'Unidades');
            });
            costoEmpaque = insRec.reduce((s, ri) => {
                const iObj = master.ingredientes.find(i => i.id === ri.ingrediente_id);
                return s + (parseFloat(ri.cantidad || 0) * parseFloat(iObj?.costo_patron || 0));
            }, 0);

            costoMatPrima = alimRec.length > 0
                ? alimRec.reduce((s, ri) => {
                    const iObj = master.ingredientes.find(i => i.id === ri.ingrediente_id);
                    const cant = parseFloat(ri.cantidad) || kilos;
                    return s + (cant * parseFloat(iObj?.costo_patron || 0));
                }, 0)
                : (insRec.length > 0 ? 0 : (costoPatron * kilos));

            empaqueNombres = insRec.map(ri => {
                const iObj = master.ingredientes.find(i => i.id === ri.ingrediente_id);
                return iObj ? iObj.nombre : 'Bolsa';
            }).join(', ') || 'Sin empaque';
        }

        // En un Pack Padre, el Costo Base Total incluye: Mat. Prima Hijos + Empaque Hijos + M.O. Hijos + Empaque Propio del Pack
        const costoBaseTotal = costoMatPrima + costoEmpaque + moHijosTotal;
        const costoKiloBase = costoBaseTotal / kilos;

        let costoOficialBD = parseFloat(art.costo_base) || 0;
        if (laArt && laArt.costo_base_sobrescrito !== null && laArt.costo_base_sobrescrito !== undefined && parseFloat(laArt.costo_base_sobrescrito) > 0) {
            const costoKiloBD = parseFloat(laArt.costo_base_sobrescrito);
            const costoBultoBD = costoKiloBD * kilos;
            if (Math.abs(costoBaseTotal - costoBultoBD) < 0.05 || Math.abs(costoBaseTotal - costoOficialBD) >= 0.05) {
                costoOficialBD = costoBultoBD;
            }
        }
        const diff = Math.abs(costoBaseTotal - costoOficialBD);
        const estaSincronizado = diff < 0.05 && costoOficialBD > 0;

        return {
            sku: art.articulo_id,
            nombre: art.descripcion_generada || art.descripcion || art.articulo_id,
            esPack,
            packInfo: esPack ? `${art.pack_unidades || 10}x ${art.pack_hijo_codigo}` : null,
            kilos,
            costoMatPrima,
            costoEmpaque,
            empaqueNombres,
            moHijosTotal,
            costoTiempo,
            costoBaseTotal,
            costoKiloBase,
            costoOficialBD,
            diff,
            estaSincronizado
        };
    });

    const pendientes = rowsData.filter(r => !r.estaSincronizado).length;
    const alDia = rowsData.filter(r => r.estaSincronizado).length;
    const todosAlDia = rowsData.length > 0 && pendientes === 0;

    return {
        total: rowsData.length,
        pendientes,
        alDia,
        todosAlDia,
        rowsData
    };
};

// Función Quirúrgica: Impacta en la BD PostgreSQL únicamente 1 artículo puntual
window.impactarFraccionQuirurgica = async function(sku, ingredienteId) {
    if (!sku) return;
    const master = window.pizarraSimulacionMaster;
    const ing = master?.ingredientes?.find(i => i.id === ingredienteId);
    const ivaVal = parseFloat(ing?.porcentaje_iva || ing?.iva || 21);

    const art = (master?.articulosBunker || []).find(a => (a.articulo_id || '').trim().toLowerCase() === sku.trim().toLowerCase());
    const artName = art?.descripcion_generada || art?.descripcion || sku;

    const { isConfirmed } = await Swal.fire({
        title: `💾 Impactar en Base de Datos`,
        html: `
            <div style="text-align: left; font-size: 0.85rem; color: #e2e8f0;">
                <p style="margin-bottom: 6px;">¿Deseas impactar en la base de datos oficial <strong>únicamente</strong> este artículo?</p>
                <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); padding: 8px 12px; border-radius: 6px; margin-top: 8px;">
                    <div style="font-weight: 700; color: #34d399;">[${sku}] ${artName}</div>
                    <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 4px;">Se actualizará el costo base y los precios de las 6 listas en PostgreSQL respetando sus insumos y mano de obra.</div>
                </div>
            </div>
        `,
        icon: 'question',
        background: '#151e2e',
        color: '#f3f4f6',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, Impactar Este Artículo',
        cancelButtonText: 'Cancelar'
    });

    if (!isConfirmed) return;

    try {
        Swal.fire({
            title: `Impactando [${sku}] en BD...`,
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const res = await fetch('/api/produccion/simulacion/propagar-ingrediente-a-fracciones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ingrediente_id: ingredienteId,
                porcentaje_iva: ivaVal,
                articulos_target_ids: [sku]
            })
        });

        const resData = await res.json();
        if (!resData.success) throw new Error(resData.message || 'Error al impactar artículo.');

        if (typeof window.inicializarPizarra === 'function') {
            await window.inicializarPizarra(true);
        } else if (typeof window.renderizarArticulosBunkerLDN1 === 'function') {
            window.renderizarArticulosBunkerLDN1();
        }

        Swal.fire({
            icon: 'success',
            title: 'Impactado Exitosamente',
            text: `El artículo [${sku}] quedó grabado y sincronizado en PostgreSQL.`,
            timer: 2000,
            showConfirmButton: false,
            background: '#151e2e',
            color: '#f3f4f6'
        });
    } catch (err) {
        Swal.fire({
            icon: 'error',
            title: 'Error al Impactar',
            text: err.message,
            background: '#151e2e',
            color: '#f3f4f6'
        });
    }
};

// Función Quirúrgica: Impacta en la BD PostgreSQL un artículo compuesto (Mix / AP) y sincroniza sus eslabones directos (Fórmula Mix + Ingrediente Simple)
window.impactarArticuloCompuestoQuirurgico = async function(sku, nuevoCostoKiloParam) {
    if (!sku) return;
    const master = window.pizarraSimulacionMaster;
    const skuLower = sku.trim().toLowerCase();
    const art = (master?.articulosBunker || []).find(a => (a.articulo_id || '').trim().toLowerCase() === skuLower);
    const artName = art?.descripcion_generada || art?.descripcion || sku;
    const kilosUnidad = parseFloat(art?.kilos_unidad || 1);
    const laArts = (master?.articulosListas || []).filter(l => (l.articulo_numero || '').trim().toLowerCase() === skuLower);
    const laPatron = laArts.find(l => l.es_patron) || laArts.find(l => l.lista_id === 1) || laArts[0];
    const moPatron = (laPatron && laPatron.mano_obra_activa !== false) ? parseFloat(laPatron?.costo_tiempo || 0) : 0;

    // Recalcular de forma determinista el costo de receta (Mix + Bolsa de receta, SIN M.O.) y detectar Mix e Ingrediente Simple vinculados
    const recetasList = master?.recetas || [];
    const recetaArticulosList = master?.recetaArticulos || [];
    const recetaIngredientesList = master?.recetaIngredientes || [];
    const ingredientesList = master?.ingredientes || [];
    const composicionMixList = master?.composicionMix || [];

    const recsDirectas = recetasList.filter(r => (r.articulo_numero || '').trim().toLowerCase() === skuLower);
    const recsAsociadas = recetaArticulosList.filter(ra => (ra.articulo_numero || '').trim().toLowerCase() === skuLower);
    const recIds = [...new Set([...recsDirectas.map(r => r.id), ...recsAsociadas.map(ra => ra.receta_id)])];
    const ingsDeReceta = recetaIngredientesList.filter(ri => recIds.includes(ri.receta_id));

    let costoIngredientesTotal = 0;
    let mixVinculadoObj = null;
    let costoMixCalculado = 0;

    ingsDeReceta.forEach(ri => {
        const ingObj = ingredientesList.find(i => i.id === ri.ingrediente_id);
        if (!ingObj) return;
        const cant = parseFloat(ri.cantidad || 0);
        const compMix = composicionMixList.filter(cm => cm.mix_id === ingObj.id);
        let costoKiloIng = 0;
        if (compMix.length > 0) {
            const totalKg = compMix.reduce((s, cm) => s + parseFloat(cm.cantidad || 0), 0);
            const total$ = compMix.reduce((s, cm) => {
                const cIng = ingredientesList.find(i => i.id === cm.ingrediente_id);
                const cKg = parseFloat(cIng?.costo_patron || 0);
                return s + (parseFloat(cm.cantidad || 0) * cKg);
            }, 0);
            costoKiloIng = totalKg > 0 ? (total$ / totalKg) : parseFloat(ingObj.costo_patron || 0);
            mixVinculadoObj = ingObj;
            costoMixCalculado = costoKiloIng;
        } else {
            costoKiloIng = parseFloat(ingObj.costo_patron || 0);
        }
        costoIngredientesTotal += (cant * costoKiloIng);
    });

    const nuevoCostoKilo = costoIngredientesTotal > 0
        ? (kilosUnidad > 0 ? (costoIngredientesTotal / kilosUnidad) : costoIngredientesTotal)
        : (parseFloat(nuevoCostoKiloParam) || 0);
    const costoNetoOperativoKilo = nuevoCostoKilo + (kilosUnidad > 0 ? (moPatron / kilosUnidad) : moPatron);

    const simpleVinculadoObj = ingredientesList.find(i => {
        const esMix = composicionMixList.some(cm => cm.mix_id === i.id);
        if (esMix) return false;
        if (String(i.articulo_vinculado_numero || '').trim().toLowerCase() === skuLower) return true;
        if (Array.isArray(i.articulos_vinculados) && i.articulos_vinculados.some(av => String(av.codigo || av.bunker_articulo_id || '').trim().toLowerCase() === skuLower)) return true;
        return false;
    });

    const eslabonesExtraHtml = `
        ${mixVinculadoObj ? `<div style="font-size: 0.73rem; color: #c084fc; margin-top: 4px;">🧪 Se actualizará Fórmula Mix <strong>[#${mixVinculadoObj.id}] ${mixVinculadoObj.nombre}</strong>: <strong>$${costoMixCalculado.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong></div>` : ''}
        ${simpleVinculadoObj ? `<div style="font-size: 0.73rem; color: #38bdf8; margin-top: 2px;">🧱 Se actualizará Ingrediente Simple <strong>[#${simpleVinculadoObj.id}] ${simpleVinculadoObj.nombre}</strong>: <strong>$${costoNetoOperativoKilo.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong> (c/MO)</div>` : ''}
    `;

    const { isConfirmed } = await Swal.fire({
        title: `⚡ Impactar Costo en Base de Datos`,
        html: `
            <div style="text-align: left; font-size: 0.85rem; color: #e2e8f0;">
                <p style="margin-bottom: 6px;">¿Deseas impactar en la base de datos oficial este artículo compuesto y sus eslabones directos?</p>
                <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); padding: 8px 12px; border-radius: 6px; margin-top: 8px;">
                    <div style="font-weight: 700; color: #fbbf24;">[${sku}] ${artName}</div>
                    <div style="font-size: 0.75rem; color: #cbd5e1; margin-top: 4px;">
                        Costo Receta Base: <strong style="color: #38bdf8;">$${nuevoCostoKilo.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong> 
                        (Bulto ${kilosUnidad.toFixed(2)}kg: <strong style="color: #34d399;">$${(nuevoCostoKilo * kilosUnidad).toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong>)
                    </div>
                    ${moPatron > 0 ? `<div style="font-size: 0.73rem; color: #94a3b8; margin-top: 2px;">⏱️ M.O. Mezclado: +$${moPatron.toLocaleString('es-AR', {minimumFractionDigits: 2})} ➔ Neto Operativo: <strong>$${costoNetoOperativoKilo.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg</strong></div>` : ''}
                    ${eslabonesExtraHtml}
                    <div style="font-size: 0.71rem; color: #94a3b8; margin-top: 6px; border-top: 1px dashed rgba(255,255,255,0.12); padding-top: 4px;">Se sincronizará con la misma fórmula exacta en LDN 2, LDN 3, LDN 5 y LDN 6.</div>
                </div>
            </div>
        `,
        icon: 'question',
        background: '#151e2e',
        color: '#f3f4f6',
        showCancelButton: true,
        confirmButtonColor: '#f59e0b',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, Impactar Este Artículo',
        cancelButtonText: 'Cancelar'
    });

    if (!isConfirmed) return;

    try {
        Swal.fire({
            title: `Impactando [${sku}] en BD...`,
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        // 1. Si consume una Fórmula de Mix, persistir costo_patron del Mix en public.ingredientes
        if (mixVinculadoObj && costoMixCalculado > 0) {
            await fetch(`/api/produccion/ingredientes/${mixVinculadoObj.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ costo_patron: parseFloat(costoMixCalculado.toFixed(4)) })
            });
            mixVinculadoObj.costo_patron = parseFloat(costoMixCalculado.toFixed(4));
        }

        // 2. Actualizar el Artículo Compuesto / Puente en bunker_lista_articulos y bunker_articulos
        const actualizaciones = (laArts.length > 0 ? laArts : [{ lista_id: 1, margen_ganancia: 0, costo_tiempo: moPatron, iva: art?.porcentaje_iva || 21, disponible: false }]).map(la => {
            const margen = parseFloat(la.margen_ganancia || 0);
            const mo = (la.mano_obra_activa !== false) ? parseFloat(la.costo_tiempo || 0) : 0;
            const iva = parseFloat(la.iva || art?.porcentaje_iva || 21);
            const costoBulto = nuevoCostoKilo * kilosUnidad;
            const precioFinal = (costoBulto * (1 + (margen / 100)) + mo) * (1 + (iva / 100));

            return {
                lista_id: la.lista_id,
                articulo_numero: sku,
                costo_base_sobrescrito: parseFloat(nuevoCostoKilo.toFixed(4)),
                margen_ganancia: margen,
                costo_tiempo: mo,
                iva: iva,
                precio_final: parseFloat(precioFinal.toFixed(2)),
                disponible: la.disponible !== false
            };
        });

        const res = await fetch('/api/produccion/simulacion/aplicar-precios', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actualizaciones })
        });

        const resData = await res.json();
        if (!res.ok) throw new Error(resData.error || resData.detalle || 'Error al impactar artículo.');

        // 3. Si tiene Ingrediente Simple vinculado, persistir su costo neto operativo en public.ingredientes
        if (simpleVinculadoObj && costoNetoOperativoKilo > 0) {
            await fetch(`/api/produccion/ingredientes/${simpleVinculadoObj.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ costo_patron: parseFloat(costoNetoOperativoKilo.toFixed(4)) })
            });
            simpleVinculadoObj.costo_patron = parseFloat(costoNetoOperativoKilo.toFixed(4));
        }

        if (typeof window.inicializarPizarra === 'function') {
            await window.inicializarPizarra(true);
        } else if (typeof window.renderizarArticulosBunkerLDN1 === 'function') {
            window.renderizarArticulosBunkerLDN1();
        }

        Swal.fire({
            icon: 'success',
            title: 'Impactado Exitosamente',
            text: `El artículo [${sku}] y sus eslabones directos quedaron grabados y sincronizados en PostgreSQL.`,
            timer: 2000,
            showConfirmButton: false,
            background: '#151e2e',
            color: '#f3f4f6'
        });
    } catch (err) {
        Swal.fire({
            icon: 'error',
            title: 'Error al Impactar',
            text: err.message,
            background: '#151e2e',
            color: '#f3f4f6'
        });
    }
};

// Módulo de Propagación desde Ingrediente a Fracciones Mono-Ingredientes (100% Puros) con Radiografía Pre-Impacto
window.propagarIngredienteAFraccionesMono = async function(ingredienteId) {
    const master = window.pizarraSimulacionMaster;
    if (!master || !master.ingredientes) return;

    const ing = master.ingredientes.find(i => i.id === ingredienteId);
    if (!ing) return;

    const costoPatron = parseFloat(ing.costo_patron || 0);
    const ivaVal = parseFloat(ing.porcentaje_iva || ing.iva || 21);

    // Obtener exactamente los artículos del sub-acordeón "Mono-Ingredientes (100% Puros)" incluyendo Packs Padres
    const articulosMono = window.obtenerArticulosMonoIngredientesDeIngrediente(ingredienteId);

    if (articulosMono.length === 0) {
        Swal.fire({
            icon: 'info',
            title: 'Sin Fracciones Asociadas',
            text: `No se encontraron fracciones derivadas ni packs para el Ingrediente #${ingredienteId} (${ing.nombre}).`,
            background: '#151e2e',
            color: '#f3f4f6'
        });
        return;
    }

    const estadoMono = window.auditarEstadoFraccionesMono(ingredienteId);
    if (estadoMono.total === 0) {
        Swal.fire({
            icon: 'info',
            title: 'Sin Fracciones Asociadas',
            text: `No se encontraron fracciones derivadas ni packs para el Ingrediente #${ingredienteId} (${ing.nombre}).`,
            background: '#151e2e',
            color: '#f3f4f6'
        });
        return;
    }

    const { rowsData, todosAlDia, pendientes, alDia } = estadoMono;

    const tableRowsHtml = rowsData.map((row, idx) => `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.07); font-size: 0.74rem;">
            <td style="padding: 6px 4px; text-align: center;">
                <input type="checkbox" class="audit-check-sku" data-sku="${row.sku}" ${!todosAlDia && row.estaSincronizado ? '' : 'checked'} style="cursor: pointer; width: 15px; height: 15px;">
            </td>
            <td style="padding: 6px 4px; font-weight: 700; color: ${row.esPack ? '#c084fc' : '#34d399'};">
                <div style="display:flex; align-items:center; gap:5px;">
                    <span>${row.sku}</span>
                    <button type="button" onclick="window.abrirRadiografiaCostosArticulo('${row.sku}')" style="background: rgba(56,189,248,0.15); border: 1px solid rgba(56,189,248,0.4); color: #38bdf8; border-radius: 3px; padding: 1px 4px; font-size: 0.62rem; cursor: pointer;" title="Ver radiografía detallada de costos">📊</button>
                </div>
                ${row.esPack ? `<span style="display:block; font-size:0.65rem; color:#e9d5ff;">📦 Pack (${row.packInfo})</span>` : ''}
            </td>
            <td style="padding: 6px 4px; color: #94a3b8;">${row.kilos} kg</td>
            <td style="padding: 6px 4px; text-align: right; color: #e2e8f0;">$${row.costoMatPrima.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
            <td style="padding: 6px 4px; text-align: right; color: #fbbf24;" title="${row.empaqueNombres}">$${row.costoEmpaque.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
            <td style="padding: 6px 4px; text-align: right; color: #38bdf8;" title="${row.esPack ? `MO de ${row.packInfo}: $${(row.moHijosTotal || 0).toFixed(2)} (incluida en Base Bulto) | MO Armado Pack: $${row.costoTiempo.toFixed(2)}` : 'Mano de obra de fraccionamiento'}">
                $${(row.esPack ? (row.moHijosTotal || 0) : row.costoTiempo).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                ${row.esPack && row.moHijosTotal > 0 ? `<span style="display:block; font-size:0.60rem; color:#93c5fd;">(Hijos en Base)</span>` : ''}
            </td>
            <td style="padding: 6px 4px; text-align: right; font-weight: 700; color: #a7f3d0;">$${row.costoBaseTotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
            <td style="padding: 6px 4px; text-align: center;">
                ${row.estaSincronizado 
                    ? `<span style="background: rgba(16,185,129,0.2); color:#34d399; padding: 2px 5px; border-radius: 3px; font-size: 0.65rem; font-weight: 700;">🟢 Al día</span>` 
                    : `<span style="background: rgba(245,158,11,0.2); color:#fbbf24; padding: 2px 5px; border-radius: 3px; font-size: 0.65rem; font-weight: 700;" title="Grabado en BD: $${row.costoOficialBD.toFixed(2)}">🟡 Pendiente</span>`
                }
            </td>
        </tr>
    `).join('');

    const bannerHtml = todosAlDia
        ? `
            <div style="padding: 8px 12px; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 6px; font-size: 0.74rem; color: #6ee7b7; margin-bottom: 10px;">
                🟢 <strong>Fracciones 100% Sincronizadas:</strong> Todas las presentaciones comerciales derivadas reflejan exactamente el costo patrón de <strong>$${costoPatron.toFixed(2)}/kg</strong> en la base de datos oficial. No hay variaciones pendientes.
            </div>
        `
        : `
            <div style="padding: 8px 12px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 6px; font-size: 0.74rem; color: #fbbf24; margin-bottom: 10px;">
                ⚠️ <strong>Variación de Costos Detectada:</strong> Hay <strong>${pendientes}</strong> artículo(s) con costos en BD diferentes al costo patrón simulado ($${costoPatron.toFixed(2)}/kg). Podés seleccionar cuáles impactar en PostgreSQL conservando insumos de empaque y mano de obra.
            </div>
        `;

    const modalHtml = `
        <div style="text-align: left; font-size: 0.85rem; color: #e2e8f0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div>
                    <span style="color: #94a3b8;">Ingrediente:</span> <strong>[#${ing.id}] ${ing.nombre}</strong>
                </div>
                <div style="color: #38bdf8; font-weight: 700;">
                    Costo Patrón: $${costoPatron.toLocaleString('es-AR', {minimumFractionDigits: 2})}/kg (IVA ${ivaVal}%)
                </div>
            </div>

            ${bannerHtml}

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 0.75rem;">
                <span style="font-weight: 700; color: #e2e8f0;">Desglose Unitario por Presentación (${rowsData.length}):</span>
                <div>
                    <button type="button" onclick="document.querySelectorAll('.audit-check-sku').forEach(c => c.checked = true)" style="background: none; border: none; color: #38bdf8; cursor: pointer; text-decoration: underline; font-size: 0.72rem; margin-right: 8px;">Marcar Todos</button>
                    <button type="button" onclick="document.querySelectorAll('.audit-check-sku').forEach(c => c.checked = false)" style="background: none; border: none; color: #94a3b8; cursor: pointer; text-decoration: underline; font-size: 0.72rem;">Desmarcar Todos</button>
                </div>
            </div>

            <div style="max-height: 250px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; background: rgba(0,0,0,0.25);">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                    <thead style="position: sticky; top: 0; background: #1e293b; color: #94a3b8; font-size: 0.70rem; border-bottom: 1px solid rgba(255,255,255,0.15);">
                        <tr>
                            <th style="padding: 6px 4px; text-align: center; width: 30px;">✓</th>
                            <th style="padding: 6px 4px;">SKU</th>
                            <th style="padding: 6px 4px;">Peso</th>
                            <th style="padding: 6px 4px; text-align: right;">Mat. Prima</th>
                            <th style="padding: 6px 4px; text-align: right;">Empaque</th>
                            <th style="padding: 6px 4px; text-align: right;">M.O.</th>
                            <th style="padding: 6px 4px; text-align: right;">Base Bulto</th>
                            <th style="padding: 6px 4px; text-align: center;">Estado</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRowsHtml}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    const confirmResult = await Swal.fire({
        title: todosAlDia ? `Auditoría: Fracciones al Día` : `⚡ Auditoría y Propagación (${pendientes} pendientes)`,
        html: modalHtml,
        width: '720px',
        background: '#151e2e',
        color: '#f3f4f6',
        showCancelButton: true,
        confirmButtonColor: todosAlDia ? '#10b981' : '#f59e0b',
        cancelButtonColor: todosAlDia ? '#475569' : '#64748b',
        confirmButtonText: todosAlDia ? '✓ Cerrar (Ya al Día)' : '⚡ Confirmar Impacto en Base de Datos',
        cancelButtonText: todosAlDia ? '⚡ Forzar Re-Impacto en BD' : 'Cancelar'
    });

    if (todosAlDia) {
        if (confirmResult.isConfirmed) {
            return; // Cierre limpio sin requests innecesarios
        }
        if (confirmResult.dismiss !== Swal.DismissReason.cancel) {
            return; // Si cerró con backdrop/esc, salir
        }
        // Si hizo clic explícito en "Forzar Re-Impacto en BD", continúa la ejecución
    } else {
        if (!confirmResult.isConfirmed) return;
    }

    const checkedInputs = document.querySelectorAll('.audit-check-sku:checked');
    const selectedSkus = Array.from(checkedInputs).map(i => i.getAttribute('data-sku'));

    if (selectedSkus.length === 0) {
        Swal.fire({
            icon: 'warning',
            title: 'Sin Artículos Seleccionados',
            text: 'No seleccionaste ningún artículo para impactar.',
            background: '#151e2e',
            color: '#f3f4f6'
        });
        return;
    }

    try {
        Swal.fire({
            title: `Propagando ${selectedSkus.length} artículo(s) a BD...`,
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const res = await fetch('/api/produccion/simulacion/propagar-ingrediente-a-fracciones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ingrediente_id: ingredienteId,
                porcentaje_iva: ivaVal,
                articulos_target_ids: selectedSkus
            })
        });

        console.log(`[VIGÍA-PROPAGACIÓN] ⚡ INICIO: Propagando Ingrediente [#${ing.id}] (${ing.nombre}) a $${costoPatron.toFixed(2)}/kg para SKUs seleccionados:`, selectedSkus);

        const resData = await res.json();
        if (!resData.success) throw new Error(resData.message || 'Error al propagar ingrediente.');

        console.log(`[VIGÍA-PROPAGACIÓN] 🔄 RESPUESTA SERVIDOR: ${resData.message}`);

        if (window.ingredientesSim && window.ingredientesSim[ingredienteId]) {
            window.ingredientesSim[ingredienteId].costo_sim = costoPatron;
        }

        if (typeof window.inicializarPizarra === 'function') {
            await window.inicializarPizarra(true);
        } else if (typeof window.renderizarArticulosBunkerLDN1 === 'function') {
            window.renderizarArticulosBunkerLDN1();
        }

        if (typeof window.recalcularCascadaGlobalCompleta === 'function') {
            window.recalcularCascadaGlobalCompleta();
        }

        console.log(`[VIGÍA-PROPAGACIÓN] ✅ ÉXITO: Sincronización en memoria y recálculo en cascada completado para LDN 2.`);

        Swal.fire({
            icon: 'success',
            title: 'Propagación Completada',
            text: resData.message,
            timer: 2500,
            showConfirmButton: false,
            background: '#151e2e',
            color: '#f3f4f6'
        });

    } catch (err) {
        Swal.fire({
            icon: 'error',
            title: 'Error de Propagación',
            text: err.message,
            background: '#151e2e',
            color: '#f3f4f6'
        });
    }
};

// =========================================================================
// INSPECTOR FINANCIERO PASO A PASO (ESTILO PESTAÑA FINANZAS DE ARTÍCULO BUNKER)
// Muestra exactamente cómo se compone el costo de cualquier Fracción, Pack Padre o Mix
// =========================================================================
window.abrirRadiografiaCostosArticulo = function(sku) {
    if (!sku) return;
    const master = window.pizarraSimulacionMaster;
    if (!master) return;

    const todos = master.articulosBunker || [];
    const art = todos.find(a => (a.articulo_id || '').trim().toLowerCase() === sku.trim().toLowerCase());
    if (!art) {
        Swal.fire({ icon: 'warning', title: 'Artículo no encontrado', text: `No se halló [${sku}] en memoria.`, background: '#151e2e', color: '#f3f4f6' });
        return;
    }

    const kilosUnidad = parseFloat(art.kilos_unidad) || 1;
    const recetasList = master.recetas || [];
    const recetaIngsList = master.recetaIngredientes || [];
    const ingredientesList = master.ingredientes || [];

    const recPropias = recetasList.filter(r => (r.articulo_numero || '').trim().toLowerCase() === art.articulo_id.trim().toLowerCase());
    const tieneRecetaPropia = recPropias.length > 0 || art.tiene_receta === true;

    const skuHijoClean = (art.pack_hijo_codigo || '').trim().toLowerCase();
    const esPack = (art.es_pack === true || (art.pack_unidades && parseInt(art.pack_unidades) > 1)) &&
                   Boolean(art.pack_hijo_codigo) &&
                   !tieneRecetaPropia &&
                   skuHijoClean !== art.articulo_id.trim().toLowerCase();

    const packPadreContenedor = todos.find(p => p.pack_hijo_codigo && p.pack_hijo_codigo.trim().toLowerCase() === art.articulo_id.trim().toLowerCase());

    const laArts = (master.articulosListas || []).filter(l => (l.articulo_numero || '').trim().toLowerCase() === art.articulo_id.trim().toLowerCase());
    const laArtPatron = laArts.find(l => l.es_patron) || laArts.find(l => l.lista_id === 1) || laArts[0];
    const moPropiaVal = (laArtPatron && laArtPatron.mano_obra_activa !== false) ? (parseFloat(laArtPatron.costo_tiempo) || 0) : 0;

    // Insumos propios en bunker_lista_insumos (ej: Bolsa 30x40 en un Pack Padre o insumo adicional de lista)
    const insumosListaPropios = (master.insumosListas || []).filter(ins => {
        return laArtPatron && ins.lista_articulo_id === laArtPatron.id && (ins.incluido === true || ins.incluido === 'true');
    });
    const costoInsumosListaPropios = insumosListaPropios.reduce((sum, ins) => sum + (parseFloat(ins.cantidad || 0) * parseFloat(ins.costo_unitario_capturado || ins.costo_unitario_en_vivo || 0)), 0);

    let pasoAPasoHtml = '';
    let costoBaseSimuladoBulto = 0;

    if (esPack && art.pack_hijo_codigo) {
        const hijoObj = todos.find(a => (a.articulo_id || '').trim().toLowerCase() === skuHijoClean);
        const kilosHijo = parseFloat(hijoObj?.kilos_unidad) || 1;
        const packUnidades = parseInt(art.pack_unidades) || 10;

        const recHijo = recetasList.filter(r => (r.articulo_numero || '').trim().toLowerCase() === skuHijoClean);
        const recIdsHijo = recHijo.map(r => r.id);
        const ingRecHijo = recetaIngsList.filter(ri => recIdsHijo.includes(ri.receta_id));

        const alimHijo = ingRecHijo.filter(ri => {
            const iObj = ingredientesList.find(i => i.id === ri.ingrediente_id);
            return iObj && !iObj.es_insumo && iObj.unidad_medida !== 'Unidades';
        });
        const insHijo = ingRecHijo.filter(ri => {
            const iObj = ingredientesList.find(i => i.id === ri.ingrediente_id);
            return iObj && (iObj.es_insumo || iObj.unidad_medida === 'Unidades');
        });

        let costoMatPrimaUnitHijo = 0;
        const filasMatPrimaHijo = alimHijo.map(ri => {
            const iObj = ingredientesList.find(i => i.id === ri.ingrediente_id);
            const cant = parseFloat(ri.cantidad) || kilosHijo;
            const cKilo = parseFloat(window.ingredientesSim?.[ri.ingrediente_id]?.costo_sim ?? iObj?.costo_patron ?? 0);
            const sub = cant * cKilo;
            costoMatPrimaUnitHijo += sub;
            return `<div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#cbd5e1; padding:2px 0;">
                <span>• [#${iObj?.id}] ${iObj?.nombre || 'Ingrediente'} (${cant} kg × $${cKilo.toLocaleString('es-AR', {minimumFractionDigits:2})}/kg)</span>
                <strong>$${sub.toLocaleString('es-AR', {minimumFractionDigits:2})}</strong>
            </div>`;
        }).join('');

        if (alimHijo.length === 0) {
            costoMatPrimaUnitHijo = parseFloat(hijoObj?.costo_base || 0);
        }

        let costoEmpaqueUnitHijo = 0;
        const filasEmpaqueHijo = insHijo.map(ri => {
            const iObj = ingredientesList.find(i => i.id === ri.ingrediente_id);
            const cant = parseFloat(ri.cantidad) || 1;
            const cUnit = parseFloat(iObj?.costo_patron || 0);
            const sub = cant * cUnit;
            costoEmpaqueUnitHijo += sub;
            return `<div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#fde68a; padding:2px 0;">
                <span>• 📦 ${cant}x ${iObj?.nombre || 'Bolsa Hijo'} ($${cUnit.toLocaleString('es-AR', {minimumFractionDigits:2})} c/u)</span>
                <strong>$${sub.toLocaleString('es-AR', {minimumFractionDigits:2})}</strong>
            </div>`;
        }).join('');

        const laHijos = (master.articulosListas || []).filter(l => (l.articulo_numero || '').trim().toLowerCase() === skuHijoClean);
        const laHijo = (laArtPatron ? laHijos.find(l => l.lista_id === laArtPatron.lista_id) : null) || laHijos.find(l => l.es_patron) || laHijos[0];
        const moUnitHijo = (laHijo && laHijo.mano_obra_activa !== false) ? (parseFloat(laHijo.costo_tiempo) || 0) : 0;

        const costoTotalUnitHijo = costoMatPrimaUnitHijo + costoEmpaqueUnitHijo + moUnitHijo;
        const subtotalHijosPack = costoTotalUnitHijo * packUnidades;
        costoBaseSimuladoBulto = subtotalHijosPack + costoInsumosListaPropios;

        const filasEmpaquePackPadre = insumosListaPropios.map(ins => {
            const cant = parseFloat(ins.cantidad) || 1;
            const cUnit = parseFloat(ins.costo_unitario_capturado || ins.costo_unitario_en_vivo || 0);
            const sub = cant * cUnit;
            return `<div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#e9d5ff; padding:2px 0;">
                <span>• 📦 ${cant}x ${ins.descripcion || 'Bolsa Contenedora Pack'} ($${cUnit.toLocaleString('es-AR', {minimumFractionDigits:2})} c/u)</span>
                <strong>$${sub.toLocaleString('es-AR', {minimumFractionDigits:2})}</strong>
            </div>`;
        }).join('');

        pasoAPasoHtml = `
            <div style="background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.35); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px;">
                <div style="font-weight: 800; color: #e9d5ff; font-size: 0.80rem; margin-bottom: 6px; display:flex; justify-content:space-between;">
                    <span>🔗 ESTRUCTURA PADRE-HIJO (${packUnidades} unidades de [${art.pack_hijo_codigo}])</span>
                    <span>Peso Total: ${kilosUnidad.toFixed(2)} kg</span>
                </div>

                <div style="background: rgba(0,0,0,0.25); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px;">
                    <div style="font-size: 0.74rem; font-weight: 700; color: #38bdf8; margin-bottom: 4px;">
                        PASO 1: Costo de 1 Unidad Hija [${art.pack_hijo_codigo}] (${kilosHijo} kg)
                    </div>
                    ${filasMatPrimaHijo || `<div style="font-size:0.74rem; color:#94a3b8;">Materia Prima Hijo: $${costoMatPrimaUnitHijo.toFixed(2)}</div>`}
                    ${filasEmpaqueHijo}
                    <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#38bdf8; padding:2px 0;">
                        <span>• ⏱️ Mano de Obra Fraccionamiento Hijo (Tiempo):</span>
                        <strong>$${moUnitHijo.toLocaleString('es-AR', {minimumFractionDigits:2})}</strong>
                    </div>
                    <div style="border-top: 1px dashed rgba(255,255,255,0.15); margin-top: 4px; padding-top: 4px; display:flex; justify-content:space-between; font-size:0.76rem; color:#f8fafc;">
                        <span><strong>= Costo Completo de 1 Hijo Terminado:</strong></span>
                        <strong style="color:#34d399;">$${costoTotalUnitHijo.toLocaleString('es-AR', {minimumFractionDigits:2})}</strong>
                    </div>
                </div>

                <div style="background: rgba(0,0,0,0.25); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px;">
                    <div style="font-size: 0.74rem; font-weight: 700; color: #c084fc; margin-bottom: 4px;">
                        PASO 2: Multiplicación por ${packUnidades} Unidades + Empaque Propio del Pack Padre
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#cbd5e1; padding:2px 0;">
                        <span>• ${packUnidades}x Unidades Hijas ($${costoTotalUnitHijo.toLocaleString('es-AR', {minimumFractionDigits:2})} × ${packUnidades}):</span>
                        <strong>$${subtotalHijosPack.toLocaleString('es-AR', {minimumFractionDigits:2})}</strong>
                    </div>
                    <div style="font-size:0.68rem; color:#94a3b8; padding-left:10px; margin-bottom:3px;">
                        (Incluye: Mat. Prima $${(costoMatPrimaUnitHijo * packUnidades).toLocaleString('es-AR', {minimumFractionDigits:2})} + Bolsas Hijos $${(costoEmpaqueUnitHijo * packUnidades).toLocaleString('es-AR', {minimumFractionDigits:2})} + M.O. Hijos $${(moUnitHijo * packUnidades).toLocaleString('es-AR', {minimumFractionDigits:2})})
                    </div>
                    ${filasEmpaquePackPadre || `<div style="font-size:0.72rem; color:#64748b;">• Sin bolsa contenedora adicional en el Pack Padre ($0,00)</div>`}
                    <div style="border-top: 1px solid rgba(168,85,247,0.4); margin-top: 5px; padding-top: 5px; display:flex; justify-content:space-between; font-size:0.82rem; color:#a7f3d0;">
                        <span><strong>= COSTO BASE TOTAL DEL PACK PADRE (${kilosUnidad.toFixed(2)} kg):</strong></span>
                        <strong>$${costoBaseSimuladoBulto.toLocaleString('es-AR', {minimumFractionDigits:2})}</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:0.72rem; color:#94a3b8; margin-top:2px;">
                        <span>Costo Base Equivalente por Kilo (costo_base_sobrescrito):</span>
                        <strong>$${(costoBaseSimuladoBulto / kilosUnidad).toLocaleString('es-AR', {minimumFractionDigits:2})}/kg</strong>
                    </div>
                </div>
            </div>
        `;
    } else {
        // Artículo con Receta Propia (Mono-ingrediente o Compuesto/Mix) o Bulto Directo
        const recIds = recPropias.map(r => r.id);
        const ingRec = recetaIngsList.filter(ri => recIds.includes(ri.receta_id));

        const alimRec = ingRec.filter(ri => {
            const iObj = ingredientesList.find(i => i.id === ri.ingrediente_id);
            return iObj && !iObj.es_insumo && iObj.unidad_medida !== 'Unidades';
        });
        const insRec = ingRec.filter(ri => {
            const iObj = ingredientesList.find(i => i.id === ri.ingrediente_id);
            return iObj && (iObj.es_insumo || iObj.unidad_medida === 'Unidades');
        });

        let subtotalMatPrima = 0;
        const filasAlim = alimRec.map(ri => {
            const iObj = ingredientesList.find(i => i.id === ri.ingrediente_id);
            const cant = parseFloat(ri.cantidad) || kilosUnidad;
            const cKilo = parseFloat(window.ingredientesSim?.[ri.ingrediente_id]?.costo_sim ?? iObj?.costo_patron ?? 0);
            const sub = cant * cKilo;
            subtotalMatPrima += sub;
            return `<div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#cbd5e1; padding:2px 0;">
                <span>• [#${iObj?.id}] ${iObj?.nombre || 'Ingrediente'} (${cant} kg × $${cKilo.toLocaleString('es-AR', {minimumFractionDigits:2})}/kg)</span>
                <strong>$${sub.toLocaleString('es-AR', {minimumFractionDigits:2})}</strong>
            </div>`;
        }).join('');

        if (alimRec.length === 0 && insRec.length === 0) {
            subtotalMatPrima = parseFloat(art.costo_base) || 0;
        }

        let subtotalEmpaqueReceta = 0;
        const filasEmpaque = insRec.map(ri => {
            const iObj = ingredientesList.find(i => i.id === ri.ingrediente_id);
            const cant = parseFloat(ri.cantidad) || 1;
            const cUnit = parseFloat(iObj?.costo_patron || 0);
            const sub = cant * cUnit;
            subtotalEmpaqueReceta += sub;
            return `<div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#fde68a; padding:2px 0;">
                <span>• 📦 [Receta] ${cant}x ${iObj?.nombre || 'Empaque'} ($${cUnit.toLocaleString('es-AR', {minimumFractionDigits:2})} c/u)</span>
                <strong>$${sub.toLocaleString('es-AR', {minimumFractionDigits:2})}</strong>
            </div>`;
        }).join('');

        // Si no tiene insumos en receta pero tiene en bunker_lista_insumos
        const empaqueListaExtra = subtotalEmpaqueReceta === 0 ? costoInsumosListaPropios : 0;
        const filasEmpaqueLista = subtotalEmpaqueReceta === 0 ? insumosListaPropios.map(ins => {
            const cant = parseFloat(ins.cantidad) || 1;
            const cUnit = parseFloat(ins.costo_unitario_capturado || ins.costo_unitario_en_vivo || 0);
            return `<div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#fde68a; padding:2px 0;">
                <span>• 📦 [Lista] ${cant}x ${ins.descripcion || 'Empaque'} ($${cUnit.toLocaleString('es-AR', {minimumFractionDigits:2})} c/u)</span>
                <strong>$${(cant * cUnit).toLocaleString('es-AR', {minimumFractionDigits:2})}</strong>
            </div>`;
        }).join('') : '';

        costoBaseSimuladoBulto = subtotalMatPrima + subtotalEmpaqueReceta + empaqueListaExtra;
        const costoTotalOperativoConMo = costoBaseSimuladoBulto + moPropiaVal;

        pasoAPasoHtml = `
            <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px;">
                <div style="font-weight: 800; color: #34d399; font-size: 0.80rem; margin-bottom: 6px; display:flex; justify-content:space-between;">
                    <span>🔬 COMPOSICIÓN DEL COSTO DE LA PRESENTACIÓN</span>
                    <span>Peso Bulto: ${kilosUnidad.toFixed(2)} kg</span>
                </div>
                <div style="background: rgba(0,0,0,0.25); border-radius: 6px; padding: 8px 10px;">
                    <div style="font-size: 0.73rem; font-weight: 700; color: #38bdf8; margin-bottom: 3px;">1. Materia Prima (Receta):</div>
                    ${filasAlim || `<div style="font-size:0.74rem; color:#cbd5e1;">• Costo Base Directo: $${subtotalMatPrima.toLocaleString('es-AR', {minimumFractionDigits:2})}</div>`}
                    
                    <div style="font-size: 0.73rem; font-weight: 700; color: #fbbf24; margin-top: 6px; margin-bottom: 3px;">2. Insumos de Empaque (Bolsas / Envases):</div>
                    ${filasEmpaque || filasEmpaqueLista || `<div style="font-size:0.73rem; color:#64748b;">• Sin insumos de empaque configurados ($0,00)</div>`}

                    <div style="border-top: 1px solid rgba(16,185,129,0.35); margin-top: 6px; padding-top: 6px; display:flex; justify-content:space-between; font-size:0.80rem; color:#a7f3d0;">
                        <span><strong>= COSTO BASE (Mat. Prima + Empaque, s/M.O.):</strong> <span style="font-size:0.68rem; color:#94a3b8; font-weight:400;">($${(costoBaseSimuladoBulto / kilosUnidad).toLocaleString('es-AR', {minimumFractionDigits:2})}/kg — base para el % Margen)</span></span>
                        <strong>$${costoBaseSimuladoBulto.toLocaleString('es-AR', {minimumFractionDigits:2})}</strong>
                    </div>

                    <div style="font-size: 0.73rem; font-weight: 700; color: #38bdf8; margin-top: 6px; margin-bottom: 2px; display:flex; justify-content:space-between;">
                        <span>3. Mano de Obra Operativa (Tiempo de Fraccionamiento):</span>
                        <strong>+$${moPropiaVal.toLocaleString('es-AR', {minimumFractionDigits:2})}</strong>
                    </div>

                    <div style="border-top: 1px solid rgba(251,191,36,0.45); margin-top: 5px; padding-top: 6px; display:flex; justify-content:space-between; font-size:0.84rem; color:#fde68a;">
                        <span><strong>💰 = COSTO TOTAL OPERATIVO (Mat. Prima + Empaque + M.O.):</strong> <span style="font-size:0.68rem; color:#94a3b8; font-weight:400;">($${(costoTotalOperativoConMo / kilosUnidad).toLocaleString('es-AR', {minimumFractionDigits:2})}/kg)</span></span>
                        <strong>$${costoTotalOperativoConMo.toLocaleString('es-AR', {minimumFractionDigits:2})}</strong>
                    </div>
                </div>
                ${packPadreContenedor ? `
                    <div style="margin-top: 8px; padding: 6px 10px; background: rgba(236, 72, 153, 0.12); border: 1px solid rgba(236, 72, 153, 0.35); border-radius: 6px; font-size: 0.73rem; color: #f472b6; display:flex; justify-content:space-between; align-items:center;">
                        <span>👶 <strong>Hijo de Pack Padre [${packPadreContenedor.articulo_id}]:</strong> Al armar el pack, se suma este Costo Base ($${costoBaseSimuladoBulto.toFixed(2)}) + M.O. ($${moPropiaVal.toFixed(2)}) = <strong>$${(costoBaseSimuladoBulto + moPropiaVal).toFixed(2)} c/u</strong></span>
                        <button type="button" onclick="window.abrirRadiografiaCostosArticulo('${packPadreContenedor.articulo_id}')" style="background:#ec4899; color:#fff; border:none; border-radius:4px; padding:2px 7px; font-size:0.68rem; font-weight:700; cursor:pointer;">Ver Pack Padre ➔</button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    // Comparativa BD vs Simulado
    let costoOficialBD = parseFloat(art.costo_base) || 0;
    if (laArtPatron && laArtPatron.costo_base_sobrescrito !== null && laArtPatron.costo_base_sobrescrito !== undefined && parseFloat(laArtPatron.costo_base_sobrescrito) > 0) {
        const costoBultoBD = parseFloat(laArtPatron.costo_base_sobrescrito) * kilosUnidad;
        if (Math.abs(costoBaseSimuladoBulto - costoBultoBD) < 0.05 || Math.abs(costoBaseSimuladoBulto - costoOficialBD) >= 0.05) {
            costoOficialBD = costoBultoBD;
        }
    }
    const estaSincronizado = Math.abs(costoBaseSimuladoBulto - costoOficialBD) < 0.05 && costoOficialBD > 0;

    // Tabla de las Listas de Precios (Usando los nombres oficiales de master.listasPrecios en PostgreSQL)
    const listasCatalogo = master.listasPrecios || [];
    const listasOrdenadas = [...laArts].sort((a, b) => {
        const lpA = listasCatalogo.find(lp => lp.id === a.lista_id);
        const lpB = listasCatalogo.find(lp => lp.id === b.lista_id);
        const ordenA = lpA?.orden ?? a.lista_id ?? 0;
        const ordenB = lpB?.orden ?? b.lista_id ?? 0;
        return ordenA - ordenB;
    });

    const filasListasHtml = listasOrdenadas.map(la => {
        const listaOficial = listasCatalogo.find(lp => lp.id === la.lista_id);
        const nombreLista = listaOficial?.nombre || la.lista_nombre || `Lista #${la.lista_id}`;
        const margen = parseFloat(la.margen_ganancia || 0);
        const mo = (la.mano_obra_activa !== false) ? (parseFloat(la.costo_tiempo) || 0) : 0;
        const costoTotalConMoFila = costoBaseSimuladoBulto + mo;
        const gananciaMargenPesos = costoBaseSimuladoBulto * (margen / 100);
        const iva = parseFloat(la.iva || art.porcentaje_iva || 21);
        const netoSim = (costoBaseSimuladoBulto * (1 + (margen / 100))) + mo;
        const finalSim = netoSim * (1 + (iva / 100));
        const finalBD = parseFloat(la.precio_final || 0);
        const okLista = Math.abs(finalSim - finalBD) < 0.5;

        return `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.07); font-size: 0.72rem;">
                <td style="padding: 5px 6px; font-weight: 700; color: #e2e8f0;">${nombreLista}</td>
                <td style="padding: 5px 6px; text-align: right; color: #a7f3d0;">$${costoBaseSimuladoBulto.toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
                <td style="padding: 5px 6px; text-align: right; color: #38bdf8;">+$${mo.toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
                <td style="padding: 5px 6px; text-align: right; font-weight: 700; color: #fde68a;">$${costoTotalConMoFila.toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
                <td style="padding: 5px 6px; text-align: right; color: #fcd34d;" title="+$${gananciaMargenPesos.toLocaleString('es-AR', {minimumFractionDigits:2})} (${margen.toFixed(1)}% sobre Costo Base $${costoBaseSimuladoBulto.toLocaleString('es-AR', {minimumFractionDigits:2})})">+${margen.toFixed(1)}% <span style="font-size:0.65rem; color:#94a3b8;">(+$${gananciaMargenPesos.toFixed(0)})</span></td>
                <td style="padding: 5px 6px; text-align: right; color: #cbd5e1;">$${netoSim.toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
                <td style="padding: 5px 6px; text-align: right; color: #94a3b8;">${iva}%</td>
                <td style="padding: 5px 6px; text-align: right; font-weight: 800; color: #34d399;">$${finalSim.toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
                <td style="padding: 5px 6px; text-align: right; color: ${okLista ? '#6ee7b7' : '#fbbf24'};">
                    $${finalBD.toLocaleString('es-AR', {minimumFractionDigits:2})} ${okLista ? '🟢' : '🟡'}
                </td>
            </tr>
        `;
    }).join('');

    Swal.fire({
        title: `📊 Finanzas y Costos: [${art.articulo_id}]`,
        html: `
            <div style="text-align: left; font-size: 0.82rem; color: #e2e8f0;">
                <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.04); padding:8px 12px; border-radius:6px; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:800; color:#f8fafc; font-size:0.90rem;">${art.descripcion_generada || art.descripcion}</div>
                        <div style="font-size:0.72rem; color:#94a3b8;">Código: <strong>${art.articulo_id}</strong> | Kilos por Bulto: <strong>${kilosUnidad} kg</strong></div>
                    </div>
                    <div style="text-align:right;">
                        ${estaSincronizado 
                            ? `<span style="background:rgba(16,185,129,0.2); border:1px solid #10b981; color:#34d399; padding:3px 8px; border-radius:5px; font-size:0.72rem; font-weight:800;">🟢 Base BD: $${costoOficialBD.toLocaleString('es-AR', {minimumFractionDigits:2})} | Total c/MO: $${(costoOficialBD + moPropiaVal).toLocaleString('es-AR', {minimumFractionDigits:2})}</span>`
                            : `<span style="background:rgba(245,158,11,0.2); border:1px solid #f59e0b; color:#fbbf24; padding:3px 8px; border-radius:5px; font-size:0.72rem; font-weight:800;">🟡 Simulado $${costoBaseSimuladoBulto.toFixed(2)} vs BD $${costoOficialBD.toFixed(2)}</span>`
                        }
                    </div>
                </div>

                ${pasoAPasoHtml}

                <div style="font-weight: 700; color: #38bdf8; font-size: 0.78rem; margin-bottom: 5px; display:flex; justify-content:space-between; align-items:center;">
                    <span>💰 Formación de Precios en Listas Comerciales:</span>
                    <span style="font-size:0.68rem; color:#94a3b8; font-weight:400;">Neto s/IVA = Costo Total c/MO + (% Margen sobre Costo Base)</span>
                </div>
                <div style="max-height: 220px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; background: rgba(0,0,0,0.25);">
                    <table style="width: 100%; border-collapse: collapse; text-align: left;">
                        <thead style="position: sticky; top: 0; background: #1e293b; color: #94a3b8; font-size: 0.67rem; border-bottom: 1px solid rgba(255,255,255,0.15);">
                            <tr>
                                <th style="padding: 5px 6px;">Lista</th>
                                <th style="padding: 5px 6px; text-align: right;">Costo Base</th>
                                <th style="padding: 5px 6px; text-align: right;">⏱️ +M.O.</th>
                                <th style="padding: 5px 6px; text-align: right; color:#fde68a;">= Total c/M.O.</th>
                                <th style="padding: 5px 6px; text-align: right;">+Margen (s/Base)</th>
                                <th style="padding: 5px 6px; text-align: right;">= Neto s/IVA</th>
                                <th style="padding: 5px 6px; text-align: right;">IVA</th>
                                <th style="padding: 5px 6px; text-align: right;">Final Simulado</th>
                                <th style="padding: 5px 6px; text-align: right;">Grabado en BD</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filasListasHtml || `<tr><td colspan="9" style="padding:10px; text-align:center; color:#64748b;">Sin listas de precios asociadas</td></tr>`}
                        </tbody>
                    </table>
                </div>
            </div>
        `,
        width: '840px',
        background: '#151e2e',
        color: '#f3f4f6',
        confirmButtonColor: '#38bdf8',
        confirmButtonText: 'Cerrar Inspector de Costos'
    });
};

window.sincronizarIngredienteDesdeArticulo = sincronizarIngredienteDesdeArticulo;

