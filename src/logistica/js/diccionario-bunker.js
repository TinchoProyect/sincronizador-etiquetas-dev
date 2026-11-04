// 🔑 HELPER UNIVERSAL DE CODIFICACIÓN HTML v5.11 (Garantía de Scope Global)
if (typeof window.escapeHtmlAttr !== 'function') {
    window.escapeHtmlAttr = function(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };
}

let jerarquiaGlobal = {};
let principalesGlobales = [];
let familiasGlobales = [];
let principalSeleccionado = '';
let familiaSeleccionada = '';

document.addEventListener('DOMContentLoaded', () => {
    cargarFamilias();
    cargarPrincipales();
});

async function cargarFamilias() {
    try {
        const res = await fetch('/api/logistica/bunker-diccionario/familias');
        const json = await res.json();
        if (json.success && json.data) {
            familiasGlobales = json.data;
            const selectFam = document.getElementById('filtro-familia');
            if (selectFam) {
                const currentVal = selectFam.value;
                selectFam.innerHTML = '<option value="">🌳 Todas las Familias...</option>';
                json.data.forEach(fam => {
                    const opt = document.createElement('option');
                    opt.value = fam.id;
                    opt.text = fam.nombre;
                    selectFam.appendChild(opt);
                });

                const optNew = document.createElement('option');
                optNew.value = '__NUEVA_FAMILIA__';
                optNew.text = '➕ [+] Crear nueva familia...';
                optNew.style.fontWeight = 'bold';
                optNew.style.color = '#166534';
                selectFam.appendChild(optNew);

                if (currentVal && Array.from(selectFam.options).some(o => o.value === currentVal)) {
                    selectFam.value = currentVal;
                }
            }
        }
    } catch(err) {
        console.error('Error cargando familias:', err);
    }
}

async function cargarPrincipales(familiaId = null) {
    try {
        const queryFam = familiaId ? `?familia_id=${encodeURIComponent(familiaId)}` : '';
        const res = await fetch(`/api/logistica/bunker-diccionario/principales${queryFam}`);
        const json = await res.json();
        if(json.success && json.data) {
            principalesGlobales = json.data;
            const select = document.getElementById('filtro-principal');
            const selectFam = document.getElementById('filtro-familia');
            const famText = (selectFam && selectFam.selectedIndex > 0) ? selectFam.options[selectFam.selectedIndex].text : 'esta Familia';
            const prevValue = select ? select.value : '';

            if (select) {
                select.innerHTML = '<option value="">📦 Todos los Atributos Principales...</option>';
                
                let optGroupNivel1 = document.createElement('optgroup');
                optGroupNivel1.label = `⭐ Atributos Principales Vinculados a ${famText}`;

                let optGroupNivel2 = document.createElement('optgroup');
                optGroupNivel2.label = '🌐 Atributos Principales Usados en Otras Familias';

                let optGroupNivel3 = document.createElement('optgroup');
                optGroupNivel3.label = '📚 Resto de Atributos Disponibles del Diccionario Maestro';

                const seenTerms = new Set();
                json.data.forEach(obj => {
                    const termLower = (obj.termino || '').trim().toLowerCase();
                    if (seenTerms.has(termLower)) return;
                    seenTerms.add(termLower);

                    const opt = document.createElement('option');
                    opt.value = obj.id;
                    opt.setAttribute("data-termino", obj.termino);

                    const prioLevel = obj.nivel_prioridad || (obj.prioritario ? 1 : 2);
                    if (prioLevel === 1) {
                        opt.text = `⭐ ${obj.termino}`;
                        opt.style.fontWeight = 'bold';
                        opt.style.color = '#1e3a8a';
                        optGroupNivel1.appendChild(opt);
                    } else if (prioLevel === 2) {
                        opt.text = `🌐 ${obj.termino}`;
                        opt.style.color = '#0369a1';
                        optGroupNivel2.appendChild(opt);
                    } else {
                        opt.text = obj.termino;
                        optGroupNivel3.appendChild(opt);
                    }
                });

                if (optGroupNivel1.children.length > 0) select.appendChild(optGroupNivel1);
                if (optGroupNivel2.children.length > 0) select.appendChild(optGroupNivel2);
                if (optGroupNivel3.children.length > 0) select.appendChild(optGroupNivel3);

                const optNewPrincipal = document.createElement('option');
                optNewPrincipal.value = '__NUEVO_PRINCIPAL__';
                optNewPrincipal.text = '➕ [+] Crear o vincular nuevo Atributo Principal...';
                optNewPrincipal.style.fontWeight = 'bold';
                optNewPrincipal.style.color = '#1e3a8a';
                select.appendChild(optNewPrincipal);
            }

            if (prevValue && Array.from(select.options).some(o => o.value === prevValue)) {
                select.value = prevValue;
            }

            // Aplicar filtro vivo persistente si hay texto ingresado en el buscador
            if (typeof window.filtrarOpcionesPrincipalViva === 'function') {
                window.filtrarOpcionesPrincipalViva();
            }
        }
    } catch(err) {
        console.error('Fallo al cargar la lista principal:', err);
    }
}

// 🔍 POLÍTICA UNIVERSAL DE BÚSQUEDA LAMDA (Fase 49) — Buscador Vivo en Posición 2
window.filtrarOpcionesPrincipalViva = function() {
    const inputSearch = document.getElementById('buscar-filtro-principal');
    const selectPrinc = document.getElementById('filtro-principal');
    if (!inputSearch || !selectPrinc) return;

    const rawVal = inputSearch.value.trim().toLowerCase();
    const keywords = rawVal.split(/\s+/).filter(Boolean);

    const optgroups = selectPrinc.getElementsByTagName('optgroup');
    const options = selectPrinc.getElementsByTagName('option');

    for (let opt of options) {
        // Preservar las opciones especiales e informativas siempre visibles
        if (!opt.value || opt.value === '__NUEVO_PRINCIPAL__') {
            opt.hidden = false;
            opt.style.display = '';
            continue;
        }

        const dataTermino = (opt.getAttribute('data-termino') || '').toLowerCase();
        const textContent = (opt.textContent || opt.innerText || '').toLowerCase();
        const combinedText = `${dataTermino} ${textContent}`;

        // Política LAMDA: Cada espacio actúa como un filtro acumulativo (AND)
        const matchesAll = keywords.every(kw => combinedText.includes(kw));

        if (matchesAll) {
            opt.hidden = false;
            opt.style.display = '';
        } else {
            opt.hidden = true;
            opt.style.display = 'none';
        }
    }

    // Ocultar optgroups que hayan quedado totalmente sin opciones visibles
    for (let og of optgroups) {
        let visibleCount = 0;
        const opts = og.querySelectorAll ? og.querySelectorAll('option') : (og.children || []);
        for (let childOpt of opts) {
            if (!childOpt.hidden && childOpt.style.display !== 'none') {
                visibleCount++;
            }
        }
        if (visibleCount === 0) {
            og.hidden = true;
            og.style.display = 'none';
        } else {
            og.hidden = false;
            og.style.display = '';
        }
    }
};

window.familiaCambiada = async function() {
    const selectFam = document.getElementById('filtro-familia');
    familiaSeleccionada = selectFam ? selectFam.value : '';
    
    // 🔑 FLUSH TOTAL DE ESTADO (Tirar la Cadena) v5.23
    principalSeleccionado = '';
    window.ultimoPrincipalSeleccionado = '';
    window.taxonomiaFamiliaActual = [];
    window.categoriasOrdenadasActuales = [];
    window.mostrarEjesVacios = false;

    const selectPrinc = document.getElementById('filtro-principal');
    if (selectPrinc) {
        selectPrinc.value = '';
    }

    const divAccionesFam = document.getElementById('acciones-familia');
    if (divAccionesFam) {
        divAccionesFam.style.display = familiaSeleccionada ? 'flex' : 'none';
    }

    // 👆 ESTADO PASIVO DE ESPERA EN DOM (v5.23)
    const containerAcordeon = document.getElementById('diccionario-acordeon-container');
    if (containerAcordeon) {
        containerAcordeon.innerHTML = `
            <div style="text-align: center; padding: 35px; border: 1px dashed #cbd5e1; border-radius: 8px; color: #64748b; background: #ffffff; margin: 15px 0;">
                <div style="font-size: 2em; margin-bottom: 6px;">👆</div>
                <p style="margin: 0; font-size: 0.95em;">Seleccione un <strong>Atributo Principal (Nivel 2)</strong> para desplegar la estructura posicional.</p>
            </div>
        `;
    }

    await cargarPrincipales(familiaSeleccionada);
    // ⛔ SE SUPRIME window.cargarJerarquia() AUTOMÁTICO. Espera pasiva a que el usuario elija en Posición 2.
};

// Variable global de seguimiento de estado en la Zona 2 para reversión defensiva
window.ultimoPrincipalSeleccionado = '';

window.cargarJerarquia = async function() {
    window.mostrarEjesVacios = false;
    const select = document.getElementById('filtro-principal');
    const termino = select ? select.value : '';
    
    if (termino === '__NUEVO_PRINCIPAL__') {
        if (select) select.value = window.ultimoPrincipalSeleccionado || '';
        window.crearNuevoArticuloPrincipalModal();
        return;
    }

    // A. Detección de Estado: Evaluación de vinculación previa del atributo seleccionado
    if (termino && familiaSeleccionada) {
        const itemObj = principalesGlobales.find(p => String(p.id) === String(termino));
        const esVinculado = itemObj ? (itemObj.prioritario === true) : true;

        // B. Intercepción y Confirmación (SweetAlert2) si NO está vinculado ("Resto del Diccionario")
        if (itemObj && !esVinculado) {
            const selectFam = document.getElementById('filtro-familia');
            const nombreFamilia = selectFam && selectFam.options[selectFam.selectedIndex]
                ? selectFam.options[selectFam.selectedIndex].text.replace(/^🌳\s*/, '').trim()
                : 'la Familia seleccionada';
            const nombreAtributo = itemObj.termino || 'Atributo Principal';

            const confirmacion = await Swal.fire({
                title: '¿Vincular Atributo Principal?',
                text: `El atributo "${nombreAtributo}" no pertenece a la familia "${nombreFamilia}". ¿Desea vincularlo estructuralmente como una nueva Categoría Principal?`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#2563eb',
                cancelButtonColor: '#64748b',
                confirmButtonText: 'Sí, Vincular Estructuralmente',
                cancelButtonText: 'Cancelar',
                reverseButtons: true
            });

            // C. Manejo de Promesa (Resolución / Cancelación)
            if (!confirmacion.isConfirmed) {
                // Cancelado por el operador: revertir obligatoriamente el selector al valor previo
                if (select) select.value = window.ultimoPrincipalSeleccionado || '';
                return;
            }

            // Aceptado por el operador: registrar vínculo en la BD mediante el endpoint POST
            try {
                Swal.fire({ title: 'Vinculando Atributo Principal...', didOpen: () => Swal.showLoading() });
                const res = await fetch('/api/logistica/bunker-diccionario/articulos-principales', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        familia_id: parseInt(familiaSeleccionada, 10),
                        termino_id: parseInt(termino, 10)
                    })
                });
                const json = await res.json();
                if (json.success) {
                    await Swal.fire({
                        title: '¡Vínculo Registrado!',
                        text: `El atributo "${nombreAtributo}" fue vinculado estructuralmente a "${nombreFamilia}".`,
                        icon: 'success',
                        timer: 1800,
                        showConfirmButton: false
                    });
                    // Recargar lista de principales para refrescar los flags prioritarios (estrellas)
                    await cargarPrincipales(familiaSeleccionada);
                    if (select) select.value = termino;
                } else {
                    Swal.fire('Error', json.error || 'No se pudo vincular el Atributo Principal.', 'error');
                    if (select) select.value = window.ultimoPrincipalSeleccionado || '';
                    return;
                }
            } catch (e) {
                console.error('Error al vincular atributo principal:', e);
                Swal.fire('Error', 'Fallo de red al intentar vincular el Atributo Principal.', 'error');
                if (select) select.value = window.ultimoPrincipalSeleccionado || '';
                return;
            }
        }
    }

    // Actualizar el registro del último valor seleccionado
    window.ultimoPrincipalSeleccionado = termino;

    if (termino) {
        document.getElementById('acciones-raiz').style.display = 'flex';
        principalSeleccionado = termino;
    } else {
        document.getElementById('acciones-raiz').style.display = 'none';
        principalSeleccionado = 'Familia';
    }

    const container = document.getElementById('diccionario-acordeon-container');
    container.innerHTML = '<div style="text-align: center; padding: 20px;">Cargando jerarquía relacional...</div>';
    
    try {
        const paramTerm = termino ? encodeURIComponent(termino) : 'TODOS';
        const queryFam = familiaSeleccionada ? `?familia_id=${encodeURIComponent(familiaSeleccionada)}` : '';
        const urlJerarquia = `/api/logistica/bunker-diccionario/jerarquia/${paramTerm}${queryFam}`;
        console.log(`🚨 [VIGÍA DICCIONARIO - SOLICITANDO JERARQUÍA]: ${urlJerarquia}`);
        const res = await fetch(urlJerarquia);
        const json = await res.json();
        
        if (json.success) {
            jerarquiaGlobal = json.data;
            console.log(`🚨 [VIGÍA DICCIONARIO - RESPUESTA JERARQUÍA RECIBIDA]:`, jerarquiaGlobal);
        } else {
            container.innerHTML = `<div style="color:red; text-align:center;">${json.error}</div>`;
        }

        // Consultar la taxonomía maestra de la familia para garantizar la visibilidad de categorías vacías (0 términos)
        window.taxonomiaFamiliaActual = [];
        if (familiaSeleccionada) {
            try {
                const resTax = await fetch(`/api/logistica/bunker-taxonomia/familias/${familiaSeleccionada}/categorias`);
                const jsonTax = await resTax.json();
                if (jsonTax.success && Array.isArray(jsonTax.data)) {
                    window.taxonomiaFamiliaActual = jsonTax.data;
                }
            } catch(e) {
                console.warn('⚠️ [VIGÍA DICCIONARIO] Error obteniendo taxonomía maestra:', e);
            }
        }
        renderizarAcordeon();
    } catch(e) {
        container.innerHTML = `<div style="color:red; text-align:center;">Fallo de conexión al cargar el árbol</div>`;
    }
};

window.mostrarEjesVacios = false;

window.toggleMostrarEjesVacios = function() {
    window.mostrarEjesVacios = !window.mostrarEjesVacios;
    renderizarAcordeon();
};

window.agregarAtributoADropdownModal = async function() {
    if (!window.categoriasOrdenadasActuales || window.categoriasOrdenadasActuales.length === 0) {
        Swal.fire('Atención', 'No hay categorías posicionales configuradas en la plantilla de esta familia.', 'warning');
        return;
    }

    const optionsHtml = window.categoriasOrdenadasActuales.map(c => 
        `<option value="${c.id}" data-cat="${c.categoria}" data-label="${c.label}">🏷️ Posición ${c.orden_posicional ? (c.orden_posicional + 2) : ''}: ${c.label}</option>`
    ).join('');

    const { value: selectedId } = await Swal.fire({
        title: 'Seleccionar Eje Posicional',
        html: `
            <div style="text-align:left; font-size:0.95em; color:#334155;">
                <p>Elija la categoría posicional a la cual desea agregar un nuevo término:</p>
                <select id="swal-select-eje" class="swal2-input" style="width:100%; margin-top:10px;">
                    ${optionsHtml}
                </select>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Continuar ➡️',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#10b981',
        preConfirm: () => {
            const sel = document.getElementById('swal-select-eje');
            const opt = sel ? sel.options[sel.selectedIndex] : null;
            if (!opt) return null;
            return {
                id: parseInt(sel.value, 10),
                cat: opt.getAttribute('data-cat'),
                label: opt.getAttribute('data-label')
            };
        }
    });

    if (selectedId && selectedId.id) {
        window.agregarAtributoACategoriaModal(selectedId.id, selectedId.cat, selectedId.label);
    }
};

function renderizarAcordeon() {
    const container = document.getElementById('diccionario-acordeon-container');
    container.innerHTML = '';
    
    // Consolidar categorías normalizadas preservando orden_posicional
    const mapConsolidado = {};
    
    const tienePlantillaExplicita = Array.isArray(window.taxonomiaFamiliaActual) && window.taxonomiaFamiliaActual.length > 0;

    // 🛡️ DOBLE CANDADO GUARDIÁN DEFINITIVO v5.24
    // Si la familia no posee plantilla explícita en bunker_familia_categorias (0 filas),
    // ABORTAR INMEDIATAMENTE ANTES DE CONSTRUIR O ITERAR NINGÚN MAPA O DICCIONARIO GLOBAL.
    if (!tienePlantillaExplicita) {
        const famObj = (familiasGlobales || []).find(f => String(f.id) === String(familiaSeleccionada));
        const famNombre = famObj ? famObj.nombre : 'esta Familia';
        container.innerHTML = `
            <div style="text-align: center; padding: 35px 20px; border: 2px dashed #cbd5e1; border-radius: 8px; color: #64748b; background: #ffffff; margin: 15px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="font-size: 2.5em; margin-bottom: 8px;">🌳</div>
                <h4 style="margin: 0 0 6px 0; color: #1e293b; font-size: 1.25em;">Familia "${famNombre}" sin ejes posicionales asignados</h4>
                <p style="margin: 0 0 18px 0; font-size: 0.95em; color: #64748b;">Esta familia aún no posee ejes posicionales (posiciones 3+) vinculados en su plantilla maestra.</p>
                <button type="button" class="btn-action" style="background:#0284c7; color:#fff; padding:10px 22px; font-weight:bold; font-size:1em; border-radius:6px; border:none; cursor:pointer; box-shadow:0 2px 4px rgba(0,0,0,0.1);" onclick="crearNuevaCategoriaModal()">➕ Vincular o Crear Categoría Posicional</button>
            </div>
        `;
        window.categoriasOrdenadasActuales = [];
        return; // ⛔ ABORTAR DE FORMA ABSOLUTA. IMPOSIBLE ITERAR SOBRE EL DICCIONARIO GLOBAL.
    }
    if (tienePlantillaExplicita) {
        window.taxonomiaFamiliaActual.forEach(item => {
            if (!item.categoria) return;
            const catKey = item.categoria.toLowerCase();
            if (catKey === 'articulo_principal' || catKey === 'pos_1') return;
            const catIdNum = item.id; // INTEGER PK de bunker_familia_categorias
            mapConsolidado[catIdNum] = {
                id: catIdNum,
                categoria: catKey,
                label: item.categoria.replaceAll('_', ' ').charAt(0).toUpperCase() + item.categoria.replaceAll('_', ' ').slice(1),
                orden_posicional: item.posicion || item.orden_posicional || 99,
                terms: []
            };
        });
    }

    // B. Poblar términos existentes desde jerarquiaGlobal indexando por categoria_id numérico entero (v5.67-rev3)
    Object.keys(jerarquiaGlobal).forEach(catIdKey => {
        const targetIdNum = parseInt(catIdKey);

        if (mapConsolidado[targetIdNum]) {
            (jerarquiaGlobal[catIdKey] || []).forEach(item => {
                if (item.orden_posicional && item.orden_posicional < mapConsolidado[targetIdNum].orden_posicional) {
                    mapConsolidado[targetIdNum].orden_posicional = item.orden_posicional;
                }
                if (!mapConsolidado[targetIdNum].terms.some(x => Number(x.id) === Number(item.id))) {
                    mapConsolidado[targetIdNum].terms.push(item);
                }
            });
        }
    });

    // Ordenar categorías explícitamente por orden_posicional
    window.categoriasOrdenadasActuales = Object.values(mapConsolidado).sort((a, b) => a.orden_posicional - b.orden_posicional);
    
    console.log(`🚨 [VIGÍA DICCIONARIO - ACORDEÓN ORDENADO RESULTANTE]:`, window.categoriasOrdenadasActuales.map((item, idx) => ({
        posicion_ui: idx + 3,
        categoria: item.categoria,
        orden_posicional_db: item.orden_posicional
    })));
    
    if (familiaSeleccionada && (!principalesGlobales || principalesGlobales.length === 0)) {
        const famObj = (familiasGlobales || []).find(f => String(f.id) === String(familiaSeleccionada));
        const famNombre = famObj ? famObj.nombre : 'Familia';
        container.innerHTML = `
            <div style="text-align: center; padding: 35px; border: 2px dashed #3b82f6; border-radius: 8px; background: #eff6ff; margin: 15px 0;">
                <div style="font-size: 2.5em; margin-bottom: 8px;">🌳</div>
                <h4 style="margin: 0 0 10px 0; color: #1e3a8a; font-size: 1.25em;">Familia "${famNombre}" lista para configuración</h4>
                <p style="color: #475569; font-size: 0.95em; margin-bottom: 20px;">Esta familia aún no posee ningún Atributo Principal (Nivel 2) asignado.</p>
                <button type="button" class="btn-action" style="background:#1e3a8a; color:#fff; padding:12px 22px; font-size:1.05em; font-weight:bold; border-radius:6px; border:none; cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,0.15);" onclick="window.crearNuevoArticuloPrincipalModal()">📦 ➕ Buscar o Vincular Atributo Principal (Fase 49)</button>
            </div>
        `;
        return;
    }

    // 🔑 REGLA DE NEGOCIO ESTRICTA v5.23: Estado Vacío Explícito (📭)
    // Si la familia no posee plantilla explícita en bunker_familia_categorias, ABORTAR cualquier inyección del diccionario global.
    if (!tienePlantillaExplicita) {
        const termTitle = principalSeleccionado || 'La entidad seleccionada';
        container.innerHTML = `
            <div style="text-align: center; padding: 35px; border: 2px dashed #cbd5e1; border-radius: 8px; color: #64748b; background: #f8fafc; margin: 15px 0;">
                <div style="font-size: 2.5em; margin-bottom: 8px;">📭</div>
                <h4 style="margin: 0 0 8px 0; color: #334155; font-size: 1.15em;">Sin categorías posicionales asignadas</h4>
                <p style="margin: 0; font-size: 0.9em; color: #94a3b8;"><strong>${termTitle}</strong> no posee ejes posicionales configurados en la plantilla activa.</p>
            </div>
        `;
        return; // ⛔ ABORTAR CUALQUIER INYECCIÓN DEL DICCIONARIO GLOBAL
    }
    
    // Separar categorías con términos (activas) de categorías vacías
    const categoriasConTerminos = window.categoriasOrdenadasActuales.filter(c => c.terms && c.terms.length > 0);
    const categoriasVacias = window.categoriasOrdenadasActuales.filter(c => !c.terms || c.terms.length === 0);

    // Estado 1: 0 términos activos en NINGUNA categoría y la vista de vacías no se ha forzado
    if (categoriasConTerminos.length === 0 && !window.mostrarEjesVacios) {
        const selectPrinc = document.getElementById('filtro-principal');
        const selectedOpt = selectPrinc && selectPrinc.selectedIndex >= 0 ? selectPrinc.options[selectPrinc.selectedIndex] : null;
        const nombrePrincipal = selectedOpt ? (selectedOpt.getAttribute('data-termino') || selectedOpt.text.replace(/^⭐\s*|^🌐\s*/, '').trim()) : (principalSeleccionado || 'El Atributo Principal');

        const famObj = (familiasGlobales || []).find(f => String(f.id) === String(familiaSeleccionada));
        const famNombre = famObj ? famObj.nombre : 'la Familia seleccionada';

        container.innerHTML = `
            <div style="text-align: center; padding: 35px 20px; border: 2px dashed #cbd5e1; border-radius: 8px; background: #ffffff; margin: 15px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="font-size: 2.2em; margin-bottom: 8px;">📦</div>
                <h4 style="margin: 0 0 6px 0; color: #1e293b; font-size: 1.2em;">"${nombrePrincipal}" aún no posee términos posicionales</h4>
                <p style="color: #64748b; font-size: 0.95em; margin-bottom: 20px; max-width: 650px; margin-left: auto; margin-right: auto;">
                    La plantilla de la familia <strong>${famNombre}</strong> define ${window.categoriasOrdenadasActuales.length} ejes posicionales (${window.categoriasOrdenadasActuales.map(c => c.label).join(', ')}).
                </p>
                <div style="display: flex; gap: 12px; justify-content: center; align-items: center; flex-wrap: wrap;">
                    <button type="button" class="btn-action" style="background:#10b981; color:#fff; padding:10px 20px; font-weight:bold; font-size:0.95em; border-radius:6px; border:none; cursor:pointer; box-shadow:0 2px 4px rgba(0,0,0,0.1);" onclick="window.agregarAtributoADropdownModal()">➕ Agregar Atributo a un Eje</button>
                    <button type="button" class="btn-action" style="background:#475569; color:#fff; padding:10px 20px; font-weight:bold; font-size:0.95em; border-radius:6px; border:none; cursor:pointer;" onclick="window.toggleMostrarEjesVacios()">👁️ Mostrar Ejes Posicionales de la Plantilla (${window.categoriasOrdenadasActuales.length})</button>
                </div>
            </div>
        `;
        return;
    }

    const categoriasARenderizar = window.mostrarEjesVacios 
        ? window.categoriasOrdenadasActuales 
        : categoriasConTerminos;

    categoriasARenderizar.forEach((catObj, idx) => {
        const cat = catObj.categoria;
        const label = catObj.label;
        const terms = catObj.terms;
        const posNum = (catObj.orden_posicional && catObj.orden_posicional < 90) ? (catObj.orden_posicional + 2) : (idx + 3);
        const hasTerms = terms.length > 0;
        const cardId = `cat-card-body-${idx}`;
        const arrowId = `cat-card-arrow-${idx}`;
        
        // Render Acordeón Item
        const card = document.createElement('div');
        card.style.border = '1px solid #cbd5e1';
        card.style.borderRadius = '6px';
        card.style.overflow = 'hidden';
        card.style.background = '#fff';
        card.style.marginBottom = '10px';
        
        const header = document.createElement('div');
        header.style.background = hasTerms ? '#334155' : '#475569';
        header.style.color = '#fff';
        header.style.padding = '10px 20px';
        header.style.fontWeight = 'bold';
        header.style.fontSize = '1.05em';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.cursor = 'pointer';
        header.onclick = (e) => {
            if (e.target.closest('button')) return;
            const b = document.getElementById(cardId);
            const a = document.getElementById(arrowId);
            if (b) {
                const isHidden = b.style.display === 'none';
                b.style.display = isHidden ? 'block' : 'none';
                if (a) a.textContent = isHidden ? '▼' : '▶';
            }
        };

        header.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <span id="${arrowId}" style="font-size:0.85em; user-select:none;">${hasTerms ? '▼' : '▶'}</span>
                <span>🏷️ Posición ${posNum} - Categoría Posicional: <span style="color:#fbbf24;">${label}</span></span>
                <div style="display:inline-flex; gap:3px;">
                    <button type="button" title="Mover Categoría Arriba" onclick="moverCategoriaDirecta(${idx}, -1)" style="border:1px solid #64748b; background:#334155; color:#fff; border-radius:4px; padding:2px 6px; font-size:0.75em; cursor:pointer;" ${idx === 0 ? 'disabled style="opacity:0.4;"' : ''}>⬆️</button>
                    <button type="button" title="Mover Categoría Abajo" onclick="moverCategoriaDirecta(${idx}, 1)" style="border:1px solid #64748b; background:#334155; color:#fff; border-radius:4px; padding:2px 6px; font-size:0.75em; cursor:pointer;" ${idx === window.categoriasOrdenadasActuales.length - 1 ? 'disabled style="opacity:0.4;"' : ''}>⬇️</button>
                </div>
            </div>
            <div style="display:flex; gap:10px; align-items:center;">
                <button type="button" onclick="editarNombreCategoriaModal('${cat}', '${label}')" style="background:#f59e0b; color:#fff; padding:4px 10px; border:none; border-radius:4px; font-size:0.75em; font-weight:bold; cursor:pointer;" title="Editar nombre de la categoría ${label}">✏️ Editar Eje</button>
                <button type="button" onclick="agregarAtributoACategoriaModal(${catObj.id}, '${cat}', '${label}')" style="background:#10b981; color:#fff; padding:4px 10px; border:none; border-radius:4px; font-size:0.75em; font-weight:bold; cursor:pointer;" title="Agregar nuevo término a la categoría ${label}">➕ Agregar Atributo</button>
                <button type="button" onclick="desvincularCategoriaDeFamiliaModal('${cat}', '${label}')" style="background:#ef4444; color:#fff; padding:4px 8px; border:none; border-radius:4px; font-size:0.75em; font-weight:bold; cursor:pointer;" title="Desvincular categoría de la plantilla posicional de la familia">🗑️ Quitar Eje</button>
                <span style="font-size: 0.75em; background:${hasTerms ? '#1e293b' : '#64748b'}; padding: 3px 8px; border-radius:12px;">${terms.length} Términos</span>
            </div>
        `;
        
        const body = document.createElement('div');
        body.id = cardId;
        body.style.display = hasTerms ? 'block' : 'none';
        body.style.padding = '0';
        
        if (hasTerms) {
            let tableHtml = `
                <table class="grid-dict" style="margin:0; border:none; box-shadow:none; width: 100%;">
                    <thead style="display:none;"><tr><th>Término</th><th>Abrev</th><th>Acciones</th></tr></thead>
                    <tbody>
            `;
            
            // Sort terms alphabetically
            terms.sort((a,b) => a.termino.localeCompare(b.termino)).forEach(item => {
                const isRev = item.en_revision === true;
                const countArticles = item.articulos_asociados_count || 0;
                const termCat = (item.categoria && item.categoria !== 'undefined') ? item.categoria : cat;

                const bgRow = isRev ? 'background-color: #fffbeb;' : '';
                const revBadge = isRev ? `<span style="background:#f59e0b; color:#fff; font-size:0.75em; padding:2px 6px; border-radius:4px; font-weight:bold; margin-left:8px;">🟡 EN REVISIÓN</span>` : '';
                const usageBadge = `<span style="font-size:0.8em; color:${countArticles > 0 ? '#1e3a8a' : '#64748b'}; font-weight:600; margin-left:8px;">📌 Usado en ${countArticles} art.</span>`;

                tableHtml += `
                    <tr style="border-bottom: 1px solid #f1f5f9; ${bgRow}">
                        <td style="width: 45%; padding: 10px 20px;">
                            <strong>${item.termino}</strong>
                            ${revBadge}
                            ${usageBadge}
                        </td>
                        <td style="width: 15%; padding: 10px 20px; font-family: monospace; font-size: 1.1em; color: #b91c1c; font-weight: bold;">[${item.abreviatura}]</td>
                        <td style="width: 40%; padding: 10px 20px; text-align: right; display: flex; gap: 5px; justify-content: flex-end; align-items: center;">
                            <button class="btn-action" style="background: ${isRev ? '#10b981' : '#f59e0b'}; color: white;" title="${isRev ? 'Quitar Marcado' : 'Marcar para Depurar'}" onclick="alternarMarcadoRevision(${item.id}, ${isRev})">${isRev ? '🟢 Normal' : '🟡 En Revisión'}</button>
                            <button class="btn-action btn-edit" title="Editar Valores" onclick="editarTerminoInfo(${item.id}, '${item.termino.replace(/'/g, "\\'")}', '${item.abreviatura}', '${termCat}')">✏️ Editar</button>
                            <button class="btn-action" style="background: #ef4444; color: white;" title="Desvincular término de esta jerarquía" onclick="desvincularTerminoJerarquia(${item.id}, '${item.termino.replace(/'/g, "\\'")}', '${cat}')">🔗❌ Desvincular</button>
                        </td>
                    </tr>
                `;
            });
            
            tableHtml += `</tbody></table>`;
            body.innerHTML = tableHtml;
        } else {
            body.innerHTML = `<div style="padding:15px 20px; color:#94a3b8; font-size:0.9em; font-style:italic; background:#f8fafc;">No hay términos asignados en este eje para la selección actual. Presione <strong>➕ Agregar Atributo</strong> para añadir uno.</div>`;
        }
        
        card.appendChild(header);
        card.appendChild(body);
        container.appendChild(card);
    });

    if (categoriasVacias.length > 0 && !window.mostrarEjesVacios) {
        const barVacias = document.createElement('div');
        barVacias.style.textAlign = 'center';
        barVacias.style.padding = '12px 20px';
        barVacias.style.border = '1px dashed #cbd5e1';
        barVacias.style.borderRadius = '6px';
        barVacias.style.background = '#f8fafc';
        barVacias.style.color = '#64748b';
        barVacias.style.marginTop = '10px';
        barVacias.style.display = 'flex';
        barVacias.style.justifyContent = 'space-between';
        barVacias.style.alignItems = 'center';
        barVacias.innerHTML = `
            <span style="font-size: 0.9em;">👁️ <strong>${categoriasVacias.length} eje(s) sin términos</strong> en la plantilla (${categoriasVacias.map(c => c.label).join(', ')}).</span>
            <button type="button" onclick="window.toggleMostrarEjesVacios()" style="background:#475569; color:#fff; padding:6px 14px; border:none; border-radius:4px; font-size:0.85em; font-weight:bold; cursor:pointer;">👁️ Ver Ejes Vacíos</button>
        `;
        container.appendChild(barVacias);
    } else if (window.mostrarEjesVacios && categoriasVacias.length > 0) {
        const barVacias = document.createElement('div');
        barVacias.style.textAlign = 'center';
        barVacias.style.padding = '10px';
        barVacias.style.marginTop = '10px';
        barVacias.innerHTML = `
            <button type="button" onclick="window.toggleMostrarEjesVacios()" style="background:#64748b; color:#fff; padding:6px 14px; border:none; border-radius:4px; font-size:0.85em; font-weight:bold; cursor:pointer;">🙈 Ocultar Ejes Vacíos</button>
        `;
        container.appendChild(barVacias);
    }
}

window.alternarMarcadoRevision = async function(id, enRevisionActual) {
    try {
        Swal.fire({title: 'Actualizando marcado...', didOpen: () => Swal.showLoading()});
        const res = await fetch(`/api/logistica/bunker-diccionario/${id}/marcado`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ en_revision: !enRevisionActual })
        });
        const json = await res.json();
        if(json.success) {
            Swal.fire({ title: !enRevisionActual ? 'Marcado En Revisión' : 'Desmarcado', icon: 'success', timer: 1000, showConfirmButton: false});
            cargarJerarquia();
        } else {
            Swal.fire('Error', json.error || 'No se pudo actualizar marcado.', 'error');
        }
    } catch(e) {
        Swal.fire('Error', 'Fallo de conectividad al servidor', 'error');
    }
};

window.editarTerminoInfo = async function(id, term, abrev, cat) {
    const { value: formValues } = await Swal.fire({
        title: 'Editar Término',
        html:
            `<div style="display:flex; flex-direction:column; gap:10px; text-align:left;">
                <label style="font-weight:bold; font-size:0.9em; color:#475569;">Término Original</label>
                <input id="swal-term" class="swal2-input" style="margin:0;" value="${term}">
                <label style="font-weight:bold; font-size:0.9em; color:#475569;">Abreviatura de Impresión</label>
                <input id="swal-abrev" class="swal2-input" style="margin:0; text-transform:uppercase;" value="${abrev}">
                <label style="font-weight:bold; font-size:0.9em; color:#475569;">Familia (Inmutable desde aquí)</label>
                <input id="swal-cat" class="swal2-input" style="margin:0; text-transform:lowercase; background:#f1f5f9; cursor:not-allowed;" value="${cat}" disabled>
            </div>`,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Guardar Cambios',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            return {
                termino: document.getElementById('swal-term').value.trim(),
                abreviatura: document.getElementById('swal-abrev').value.trim().toUpperCase(),
                categoria: cat || (document.getElementById('swal-cat') ? document.getElementById('swal-cat').value.trim().toLowerCase() : '')
            };
        }
    });

    if (formValues) {
        if(!formValues.termino || !formValues.abreviatura) {
            Swal.fire('Atención', 'El término y la abreviatura son obligatorios.', 'warning');
            return;
        }
        
        try {
            Swal.fire({title: 'Guardando...', didOpen: () => Swal.showLoading()});
            const res = await fetch(`/api/logistica/bunker-diccionario/${id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(formValues)
            });
            const json = await res.json();
            if(json.success) {
                Swal.fire({ title:'Guardado', icon: 'success', timer: 1000, showConfirmButton: false});
                cargarJerarquia();
            } else {
                Swal.fire('Error', json.error || 'Fallo interno al actualizar.', 'error');
            }
        } catch(e) {
            Swal.fire('Error', 'Fallo de red al comunicarse con el servidor', 'error');
        }
    }
};

window.eliminarTermino = async function(id) {
    try {
        Swal.fire({ title: 'Analizando impacto...', didOpen: () => Swal.showLoading() });
        const resImpacto = await fetch(`/api/logistica/bunker-diccionario/impacto/${id}`);
        const dataImpacto = await resImpacto.json();

        if (!dataImpacto.success) {
            Swal.fire('Error', dataImpacto.error || 'No se pudo analizar el impacto.', 'error');
            return;
        }

        const { termino, cnt, articulos } = dataImpacto;

        if (cnt === 0) {
            // Eliminación directa limpia
            Swal.fire({
                title: 'Borrar Atributo',
                text: `¿Está seguro de eliminar el atributo "${termino}"?`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#ef4444',
                confirmButtonText: 'Sí, Eliminar',
                cancelButtonText: 'Cancelar'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    Swal.fire({ title: 'Eliminando...', didOpen: () => Swal.showLoading() });
                    const resDel = await fetch(`/api/logistica/bunker-diccionario/${id}`, { method: 'DELETE' });
                    const jsonDel = await resDel.json();
                    if (jsonDel.success) {
                        Swal.fire({ title: 'Eliminado', icon: 'success', timer: 1000, showConfirmButton: false });
                        cargarJerarquia();
                    } else {
                        Swal.fire('Error', jsonDel.error || 'No se pudo eliminar.', 'error');
                    }
                }
            });
        } else {
            // Eliminación Asistida con Advertencia de Impacto
            let listaArtsHtml = articulos.map(a => `<li style="text-align:left; font-size:0.9em; margin-bottom:3px;"><strong>${a.id}</strong>: ${a.descripcion}</li>`).join('');

            Swal.fire({
                title: '⚠️ ATENCIÓN: ATRIBUTO EN USO',
                html: `
                    <div style="font-size:0.95em; color:#334155; margin-bottom:12px;">
                        El término <strong>"${termino}"</strong> está asignado actualmente a <strong>${cnt}</strong> artículo(s):
                    </div>
                    <ul style="max-height:120px; overflow-y:auto; background:#f8fafc; padding:10px 20px; border:1px solid #cbd5e1; border-radius:6px; margin-bottom:12px;">
                        ${listaArtsHtml}
                    </ul>
                    <div style="font-size:0.9em; color:#b45309; background:#fffbeeb3; padding:8px; border-radius:4px; border:1px solid #fde68a;">
                        <strong>Soberanía del Usuario:</strong> Si procede con la eliminación, el campo correspondiente pasará a estar <strong>VACÍO (Sin Asignar)</strong> en dichos artículos.
                    </div>
                `,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#dc2626',
                cancelButtonColor: '#64748b',
                confirmButtonText: '🗑️ Sí, Eliminar y Vaciar en Artículos',
                cancelButtonText: '❌ Cancelar'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        Swal.fire({ title: 'Ejecutando vaciado y eliminación...', didOpen: () => Swal.showLoading() });
                        const resForzado = await fetch(`/api/logistica/bunker-diccionario/forzado/${id}`, { method: 'DELETE' });
                        const jsonForzado = await resForzado.json();

                        if (jsonForzado.success) {
                            Swal.fire({
                                title: 'Atributo Pulverizado',
                                text: jsonForzado.message,
                                icon: 'success',
                                timer: 1800,
                                showConfirmButton: false
                            });
                            cargarJerarquia();
                        } else {
                            Swal.fire('Error', jsonForzado.error || 'No se pudo ejecutar el vaciado.', 'error');
                        }
                    } catch (errForzado) {
                        Swal.fire('Error', 'Fallo de red durante el vaciado forzado.', 'error');
                    }
                }
            });
        }
    } catch (err) {
        Swal.fire('Error', 'Fallo al analizar el impacto de eliminación.', 'error');
    }
};

window.editarRaiz = async function() {
    const terminoSeleccionado = document.getElementById('filtro-principal').value;
    if (!terminoSeleccionado) return;
    
    const obj = principalesGlobales.find(p => String(p.id) === String(terminoSeleccionado) || p.termino === terminoSeleccionado);
    if (!obj) return;

    const { value: formValues } = await Swal.fire({
        title: 'Editar Atributo Principal',
        html:
            `<div style="display:flex; flex-direction:column; gap:10px; text-align:left;">
                <label style="font-weight:bold; font-size:0.9em; color:#475569;">Atributo Principal</label>
                <input id="swal-term-raiz" class="swal2-input" style="margin:0;" value="${obj.termino}">
                <label style="font-weight:bold; font-size:0.9em; color:#475569;">Abreviatura de Impresión</label>
                <input id="swal-abrev-raiz" class="swal2-input" style="margin:0; text-transform:uppercase;" value="${obj.abreviatura || ''}">
            </div>`,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Guardar Cambios',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            return {
                termino: document.getElementById('swal-term-raiz').value.trim(),
                abreviatura: document.getElementById('swal-abrev-raiz').value.trim().toUpperCase()
            };
        }
    });

    if (formValues) {
        if(!formValues.termino || !formValues.abreviatura) {
            Swal.fire('Atención', 'El atributo y la abreviatura son obligatorios.', 'warning');
            return;
        }
        
        try {
            Swal.fire({title:'Actualizando...', didOpen:()=>Swal.showLoading()});
            const payload = { termino: formValues.termino, abreviatura: formValues.abreviatura, categoria: 'general' };
            const response = await fetch(`/api/logistica/bunker-diccionario/${obj.id}`, {
                method: 'PUT',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            
            if (result.success) {
                Swal.fire('Actualizado', 'El Atributo Principal fue modificado', 'success');
                await cargarPrincipales();
                document.getElementById('filtro-principal').value = obj.id;
                document.getElementById('diccionario-acordeon-container').innerHTML = `<div style="text-align: center; padding: 40px; color: #94a3b8; font-size: 1.2em; border: 2px dashed #cbd5e1; border-radius: 8px;">👆 Seleccione un Atributo Principal en la Zona 2 para desplegar la estructura de términos.</div>`;
                document.getElementById('acciones-raiz').style.display = 'flex';
                cargarJerarquia();
            } else { Swal.fire('Error', result.error, 'error'); }
        } catch(e) { Swal.fire('Error', 'Fallo de red', 'error'); }
    }
};

window.eliminarRaiz = async function() {
    const terminoSeleccionado = document.getElementById('filtro-principal').value;
    if (!terminoSeleccionado) return;
    
    const obj = principalesGlobales.find(p => String(p.id) === String(terminoSeleccionado) || p.termino === terminoSeleccionado);
    if (!obj) return;
    
    const numFamilies = Object.keys(jerarquiaGlobal).length;
    let warningText = `Se eliminará el Atributo Principal "${obj.termino}". Esta acción es irreversible.`;
    if (numFamilies > 0) warningText = `¡ATENCIÓN! "${obj.termino}" tiene ${numFamilies} familias vinculadas. Borrar el Atributo Principal romperá el nomenclador del SKU. ¿Aún desea continuar?`;

    const { isConfirmed } = await Swal.fire({
        title: '¿Eliminar Atributo Principal?',
        text: warningText,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, Eliminar Definitivamente',
        cancelButtonText: 'Cancelar'
    });

    if (isConfirmed) {
        try {
            Swal.fire({title:'Borrando...', didOpen:()=>Swal.showLoading()});
            const response = await fetch(`/api/logistica/bunker-diccionario/${obj.id}`, { method: 'DELETE' });
            const result = await response.json();
            
            if (result.success) {
                Swal.fire('Eliminado', 'Atributo raíz eliminado exitosamente', 'success');
                await cargarPrincipales();
                document.getElementById('diccionario-acordeon-container').innerHTML = `<div style="text-align: center; padding: 40px; color: #94a3b8; font-size: 1.2em; border: 2px dashed #cbd5e1; border-radius: 8px;">👆 Seleccione un Atributo Principal arriba para desplegar su diccionario.</div>`;
                document.getElementById('acciones-raiz').style.display = 'none';
                principalSeleccionado = '';
                jerarquiaGlobal = {};
            } else { Swal.fire('Error', result.error, 'error'); }
        } catch(e) { Swal.fire('Error', 'Fallo de red', 'error'); }
    }
};

window.crearNuevaCategoriaModal = async function() {
    const familiaId = Number(document.getElementById('filtro-familia').value) || 1;
    const familiaNombre = document.getElementById('filtro-familia').options[document.getElementById('filtro-familia').selectedIndex]?.text || 'Familia Seleccionada';

    Swal.fire({ title: 'Cargando catálogo global de categorías...', didOpen: () => Swal.showLoading() });

    let catsGlobalesEnriquecidas = [];
    try {
        const resDict = await fetch('/api/logistica/bunker-taxonomia/categorias-globales');
        const jsonDict = await resDict.json();
        if (jsonDict.success && Array.isArray(jsonDict.data)) {
            catsGlobalesEnriquecidas = jsonDict.data;
        }
    } catch(e) {
        console.warn('⚠️ [DICCIONARIO] Error obteniendo lista global de categorías:', e);
    }

    const setCatsFamilia = new Set(
        (Array.isArray(window.taxonomiaFamiliaActual) ? window.taxonomiaFamiliaActual : [])
            .map(item => (item.categoria || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    );

    const estadoA_bloqueadas = [];
    const estadoB_enUsoFamilia = [];
    const estadoC_restoGlobal = [];

    catsGlobalesEnriquecidas.forEach(catObj => {
        const cat = (catObj.categoria || '').trim().toLowerCase();
        const catNorm = cat.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const label = cat.replaceAll('_', ' ').charAt(0).toUpperCase() + cat.replaceAll('_', ' ').slice(1);
        const yaIncluida = setCatsFamilia.has(catNorm);

        const familiasNums = Array.isArray(catObj.familias_ids)
            ? catObj.familias_ids.map(id => Number(id)).filter(id => !isNaN(id))
            : [];
        const usadaEnFamiliaActiva = familiasNums.includes(familiaId);

        if (yaIncluida) {
            estadoA_bloqueadas.push({ cat, label });
        } else if (usadaEnFamiliaActiva) {
            estadoB_enUsoFamilia.push({ cat, label });
        } else {
            estadoC_restoGlobal.push({ cat, label });
        }
    });

    let opcionesSelectHtml = `<option value="">-- Seleccione una Categoría Preexistente --</option>`;

    // 🔥 ESTADO B (Prioridad Máxima - Destacado en Familia Activa)
    if (estadoB_enUsoFamilia.length > 0) {
        opcionesSelectHtml += `<optgroup label="🔥 Categorías en Uso en ${familiaNombre}">`;
        opcionesSelectHtml += estadoB_enUsoFamilia.map(c => 
            `<option value="${c.cat}" style="font-weight:bold; background-color:#fef9c3; color:#854d0e;">🔥 ${c.label} (🔥 Usada en ${familiaNombre})</option>`
        ).join('');
        opcionesSelectHtml += `</optgroup>`;
    }

    // 🌐 ESTADO C (Prioridad Baja - Catálogo Global)
    if (estadoC_restoGlobal.length > 0) {
        opcionesSelectHtml += `<optgroup label="🌐 Resto del Catálogo Global">`;
        opcionesSelectHtml += estadoC_restoGlobal.map(c => 
            `<option value="${c.cat}" style="font-weight:bold; color:#1e293b;">${c.label} (Preexistente - Disponible)</option>`
        ).join('');
        opcionesSelectHtml += `</optgroup>`;
    }

    // ⛔ ESTADO A (Bloqueadas - Ya Incluidas en esta Familia)
    if (estadoA_bloqueadas.length > 0) {
        opcionesSelectHtml += `<optgroup label="✔ Ya Incluidas en ${familiaNombre}">`;
        opcionesSelectHtml += estadoA_bloqueadas.map(c => 
            `<option value="${c.cat}" disabled style="color:#94a3b8; font-style:italic;">${c.label} (✔ Ya incluida en ${familiaNombre})</option>`
        ).join('');
        opcionesSelectHtml += `</optgroup>`;
    }

    opcionesSelectHtml += `<option value="__NUEVA__" style="color:#2563eb; font-weight:bold;">➕ Crear Nueva Categoría desde Cero...</option>`;

    const { value: formValues } = await Swal.fire({
        title: '➕ Vincular o Crear Categoría Posicional',
        html: `
            <div style="display:flex; flex-direction:column; gap:12px; text-align:left;">
                <div style="font-size:0.85em; background:#f1f5f9; padding:8px 12px; border-radius:6px; border:1px solid #cbd5e1; color:#475569;">
                    📍 Familia Activa: <strong>${familiaNombre}</strong>
                </div>

                <label style="font-weight:bold; font-size:0.9em; color:#1e293b;">1. Seleccionar Categoría Preexistente del Diccionario Global</label>
                <select id="swal-cat-select" class="swal2-select" style="margin:0; width:100%; box-sizing:border-box;" onchange="
                    const isNueva = this.value === '__NUEVA__';
                    document.getElementById('swal-seccion-nueva').style.display = isNueva ? 'flex' : 'none';
                ">
                    ${opcionesSelectHtml}
                </select>

                <div id="swal-seccion-nueva" style="display:none; flex-direction:column; gap:10px; border-top:1px dashed #cbd5e1; padding-top:10px; margin-top:5px;">
                    <label style="font-weight:bold; font-size:0.9em; color:#2563eb;">2. Alta de Nueva Categoría (Si no existe previamente)</label>
                    <input id="swal-cat-nombre" class="swal2-input" placeholder="ej. procesamiento, envase" style="margin:0;">
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Vincular / Crear Categoría',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const selectVal = document.getElementById('swal-cat-select').value;
            if (!selectVal) {
                Swal.showValidationMessage('Debe seleccionar una categoría preexistente o elegir "Crear Nueva".');
                return false;
            }
            if (selectVal === '__NUEVA__') {
                const nombreNuevo = document.getElementById('swal-cat-nombre').value.trim().toLowerCase();
                if (!nombreNuevo) {
                    Swal.showValidationMessage('Debe ingresar el nombre de la nueva categoría.');
                    return false;
                }
                return { modo: 'NUEVA', categoria: nombreNuevo };
            } else {
                return { modo: 'REUTILIZAR', categoria: selectVal };
            }
        }
    });

    if (formValues) {
        try {
            Swal.fire({ title: 'Vinculando categoría a la familia...', didOpen: () => Swal.showLoading() });
            
            if (formValues.modo === 'REUTILIZAR') {
                // 1. Agregar categoría preexistente a la plantilla de la familia
                const resAdd = await fetch(`/api/logistica/bunker-taxonomia/familias/${familiaId}/categorias`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ categoria: formValues.categoria, orden_posicional: 99 })
                });
                const jsonAdd = await resAdd.json();
                if (jsonAdd.success) {
                    Swal.fire({ title: 'Eje Vinculado', text: `Categoría "${formValues.categoria}" vinculada a la familia.`, icon: 'success', timer: 1500, showConfirmButton: false });
                    cargarJerarquia();
                } else {
                    Swal.fire('Error', jsonAdd.error || 'No se pudo vincular la categoría.', 'error');
                }
            } else {
                // 2. Crear nueva categoría limpia vinculada a la familia (sin inyectar términos ficticios)
                const res = await fetch('/api/logistica/bunker-taxonomia/categorias', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ categoria: formValues.categoria, familiaId: familiaId, ordenPosicional: 99 })
                });
                const json = await res.json();
                if (json.success) {
                    Swal.fire({ title: 'Categoría Creada y Vinculada', text: json.message, icon: 'success', timer: 1500, showConfirmButton: false });
                    cargarJerarquia();
                } else {
                    Swal.fire('Error', json.error || 'No se pudo crear la categoría.', 'error');
                }
            }
        } catch (e) {
            Swal.fire('Error', 'Fallo de red al procesar categoría.', 'error');
        }
    }
};

window.editarNombreCategoriaModal = async function(catActual, labelActual) {
    const { value: nuevoNombre } = await Swal.fire({
        title: `✏️ Editar Nombre del Eje Posicional`,
        text: `Ingrese el nuevo nombre para la categoría "${labelActual}":`,
        input: 'text',
        inputValue: labelActual,
        showCancelButton: true,
        confirmButtonText: 'Guardar Cambios',
        cancelButtonText: 'Cancelar',
        inputValidator: (val) => {
            if (!val || !val.trim()) return 'Debe ingresar un nombre válido!';
        }
    });

    if (nuevoNombre) {
        const newExact = nuevoNombre.trim();
        if (newExact === catActual.trim()) return;

        try {
            Swal.fire({ title: 'Renombrando categoría en cascada...', didOpen: () => Swal.showLoading() });
            const res = await fetch('/api/logistica/bunker-taxonomia/categorias/renombrar', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoriaActual: catActual, categoriaNueva: newExact })
            });
            const json = await res.json();
            if (json.success) {
                window.todasLasCategoriasMaestras = null; // 🔑 Limpieza de caché de categorías en RAM
                Swal.fire({ title: 'Eje Renombrado', text: json.message, icon: 'success', timer: 1500, showConfirmButton: false });
                if (typeof cargarJerarquia === 'function') cargarJerarquia();
            } else {
                Swal.fire('Error', json.error || 'No se pudo renombrar el eje.', 'error');
            }
        } catch(e) {
            Swal.fire('Error', 'Fallo de conectividad al renombrar eje.', 'error');
        }
    }
};

window.abrirGestorTaxonomiaModal = async function() {
    const familiaId = document.getElementById('filtro-familia').value || 1;
    const familiaNombre = document.getElementById('filtro-familia').options[document.getElementById('filtro-familia').selectedIndex]?.text || 'Familia Seleccionada';

    try {
        Swal.fire({ title: 'Cargando plantilla de categorías...', didOpen: () => Swal.showLoading() });
        const res = await fetch(`/api/logistica/bunker-taxonomia/familias/${familiaId}/categorias`);
        const json = await res.json();

        if (!json.success) {
            Swal.fire('Error', 'No se pudo obtener la plantilla de categorías.', 'error');
            return;
        }

        const categorias = json.data; // [{ categoria: 'conformacion', orden_posicional: 2 }, ...]

        let filasHtml = categorias.map((item, idx) => `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px; font-weight: bold; color: #475569; text-align: center;">Posición ${item.orden_posicional}</td>
                <td style="padding: 8px; font-weight: bold; color: #1e293b; text-transform: capitalize;">${item.categoria}</td>
                <td style="padding: 8px; text-align: center;">
                    <button type="button" style="padding:4px 8px; cursor:pointer;" onclick="moverCategoriaArriba(${idx})">⬆️</button>
                    <button type="button" style="padding:4px 8px; cursor:pointer;" onclick="moverCategoriaAbajo(${idx})">⬇️</button>
                </td>
            </tr>
        `).join('');

        window.taxonomiaTempArray = [...categorias];

        const renderModalTable = () => {
            const tbody = document.getElementById('tbody-taxonomia');
            if (tbody) {
                tbody.innerHTML = window.taxonomiaTempArray.map((item, idx) => `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 8px; font-weight: bold; color: #475569; text-align: center;">Posición ${idx + 2}</td>
                        <td style="padding: 8px; font-weight: bold; color: #1e293b; text-transform: capitalize;">${item.categoria}</td>
                        <td style="padding: 8px; text-align: center;">
                            <button type="button" style="padding:4px 8px; cursor:pointer; border:1px solid #cbd5e1; border-radius:4px;" onclick="moverCategoriaArriba(${idx})">⬆️ Subir</button>
                            <button type="button" style="padding:4px 8px; cursor:pointer; border:1px solid #cbd5e1; border-radius:4px;" onclick="moverCategoriaAbajo(${idx})">⬇️ Bajar</button>
                        </td>
                    </tr>
                `).join('');
            }
        };

        window.moverCategoriaArriba = (idx) => {
            if (idx > 0) {
                const temp = window.taxonomiaTempArray[idx];
                window.taxonomiaTempArray[idx] = window.taxonomiaTempArray[idx - 1];
                window.taxonomiaTempArray[idx - 1] = temp;
                renderModalTable();
            }
        };

        window.moverCategoriaAbajo = (idx) => {
            if (idx < window.taxonomiaTempArray.length - 1) {
                const temp = window.taxonomiaTempArray[idx];
                window.taxonomiaTempArray[idx] = window.taxonomiaTempArray[idx + 1];
                window.taxonomiaTempArray[idx + 1] = temp;
                renderModalTable();
            }
        };

        const { isConfirmed } = await Swal.fire({
            title: `⚙️ Moldes Posicionales (${familiaNombre})`,
            html: `
                <div style="font-size:0.9em; color:#64748b; margin-bottom:10px;">
                    Defina la secuencia exacta de posiciones para esta familia. 
                    <strong>Posición 1</strong> está reservada para el <em>Nombre Principal (articulo_principal)</em>.
                </div>
                <table style="width:100%; border-collapse:collapse; background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px;">
                    <thead>
                        <tr style="background:#e2e8f0; text-align:left;">
                            <th style="padding:8px; text-align:center;">Secuencia</th>
                            <th style="padding:8px;">Categoría Posicional</th>
                            <th style="padding:8px; text-align:center;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-taxonomia">
                        ${filasHtml}
                    </tbody>
                </table>
            `,
            width: '600px',
            showCancelButton: true,
            confirmButtonText: '💾 Guardar Nuevo Orden Posicional',
            cancelButtonText: 'Cancelar'
        });

        if (isConfirmed) {
            const ordenamientoPayload = window.taxonomiaTempArray.map((item, idx) => ({
                categoria: item.categoria,
                orden: idx + 2
            }));

            Swal.fire({ title: 'Guardando secuencia posicional...', didOpen: () => Swal.showLoading() });
            const resSave = await fetch(`/api/logistica/bunker-taxonomia/familias/${familiaId}/reordenar`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ordenamiento: ordenamientoPayload })
            });
            const jsonSave = await resSave.json();

            if (jsonSave.success) {
                Swal.fire({ title: 'Orden Actualizado', text: jsonSave.message, icon: 'success', timer: 1500, showConfirmButton: false });
                cargarJerarquia();
            } else {
                Swal.fire('Error', jsonSave.error || 'No se pudo actualizar el orden.', 'error');
            }
        }
    } catch (e) {
        Swal.fire('Error', 'Fallo de red al obtener la plantilla posicional.', 'error');
    }
};

window.agregarAtributoACategoriaModal = async function(categoriaId, categoria, labelCategoria) {
    const selFam = document.getElementById('filtro-familia');
    const selPrinc = document.getElementById('filtro-principal');
    const familiaId = selFam ? parseInt(selFam.value) || null : null;
    const articuloPrincipalId = selPrinc ? parseInt(selPrinc.value) || null : null;
    const selectedOpt = selPrinc && selPrinc.selectedIndex >= 0 ? selPrinc.options[selPrinc.selectedIndex] : null;
    const articuloPrincipalTexto = selectedOpt ? (selectedOpt.getAttribute('data-termino') || selectedOpt.text.replace(/^⭐\s*/, '')) : '';

    if (!familiaId || !articuloPrincipalId) {
        Swal.fire('Selección Incompleta', 'Debe seleccionar una Familia y un Artículo Principal válidos antes de agregar atributos.', 'warning');
        return;
    }

    try {
        Swal.fire({ title: 'Obteniendo catálogo de términos...', didOpen: () => Swal.showLoading() });
        const resDict = await fetch('/api/logistica/bunker-diccionario?solo_atributos=true');
        const jsonDict = await resDict.json();

        let todosLosTerminosRaw = jsonDict.success ? jsonDict.data : [];
        let todosLosTerminos = todosLosTerminosRaw.filter(t => 
            t.obsoleto !== true && 
            t.categoria && 
            !['general', 'articulo_principal', 'pos_1'].includes((t.categoria || '').trim().toLowerCase())
        );

        const renderOptions = (termFilter = '') => {
            const queryNorm = termFilter.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const queryWords = queryNorm.split(/\s+/).filter(w => w.length > 0);

            const filtered = todosLosTerminos.filter(t => {
                if (queryWords.length === 0) {
                    return true;
                }
                const searchableText = `${t.termino || ''} ${t.abreviatura || ''} ${t.categoria || ''}`
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "");
                return queryWords.every(word => searchableText.includes(word));
            });

            if (filtered.length === 0) {
                const termClean = termFilter.trim();
                if (termClean.length > 0) {
                    return `<option value="__CREAR_NUEVO__" data-newterm="${termClean}" style="color:#2563eb; font-weight:bold;">✨ [+] Usar "${termClean}" para crear este nuevo atributo</option>`;
                }
                return `<option value="" disabled style="color:#94a3b8;">⚠️ No se hallaron términos que coincidan</option>`;
            }

            // 🛡️ ALGORITMO RECTIFICADO v5.78: DISPONIBILIDAD UNIVERSAL DE ATRIBUTOS (INCLUYENDO MIX)
            const familiaActivaId = Number(document.getElementById('filtro-familia').value) || 1;
            const familiaActivaNombre = document.getElementById('filtro-familia').options[document.getElementById('filtro-familia').selectedIndex]?.text || 'Familia Activa';

            const catClean = (categoria || '').trim().toLowerCase();

            const nivel1_familiaActiva = []; // 🔥 Nivel 1: Usado en ESTA familia activa BAJO ESTA MISMA CATEGORÍA
            const nivel2_otrasFamilias = []; // ⭐ Nivel 2: Término perteneciente a ESTA categoría usado en otras familias
            const nivel3_restoGlobal = [];   // 🌐 Nivel 3: Atributos de Otras Categorías Posicionales

            filtered.forEach(t => {
                const tCatClean = (t.categoria || '').trim().toLowerCase();
                const esDeEstaCategoriaNativa = (tCatClean === catClean);

                const vinculaciones = Array.isArray(t.vinculaciones_relacionales) ? t.vinculaciones_relacionales : [];

                // 🎯 1. Coincidencia Relacional Exacta: ¿Vinculado en Familia Activa Y bajo ESTA misma Categoría?
                const registradoEnFamiliaYCategoria = vinculaciones.some(v => 
                    Number(v.familia_id) === familiaActivaId && 
                    (v.categoria || '').trim().toLowerCase() === catClean
                );

                // 🎯 2. Coincidencia Relacional Secundaria en Otras Familias
                const registradoEnOtrasFamiliasMismaCategoria = vinculaciones.some(v => 
                    (v.categoria || '').trim().toLowerCase() === catClean
                );

                if (registradoEnFamiliaYCategoria) {
                    // 🔥 NIVEL 1: Coincidencia Relacional + Familia Activa + Categoría Correcta
                    nivel1_familiaActiva.push(t);
                } else if (esDeEstaCategoriaNativa || registradoEnOtrasFamiliasMismaCategoria) {
                    // ⭐ NIVEL 2: Mínimo pertenece a esta Categoría (Nativa o Relacional en otras familias)
                    nivel2_otrasFamilias.push(t);
                } else if (tCatClean && tCatClean !== 'general') {
                    // 🌐 NIVEL 3: Atributos Disponibles (Aislamiento Ontológico v5.78)
                    nivel3_restoGlobal.push(t);
                }
            });

            let htmlOptions = '';

            // 🔥 NIVEL 1 (Prioridad Máxima - Marca Superior): Usado en esta Familia Activa
            if (nivel1_familiaActiva.length > 0) {
                htmlOptions += `<optgroup label="🔥 Frecuentes en ${familiaActivaNombre}">`;
                htmlOptions += nivel1_familiaActiva.map(t => 
                    `<option value="${t.termino}" data-id="${t.id}" data-abrev="${t.abreviatura || ''}" style="font-weight:bold; background-color:#fef9c3; color:#854d0e;">🔥 ${t.termino} [${t.abreviatura || 'S/A'}] (🔥 Usado en ${familiaActivaNombre})</option>`
                ).join('');
                htmlOptions += `</optgroup>`;
            }

            // ⭐ NIVEL 2 (Prioridad Media): Usado en Otras Familias
            if (nivel2_otrasFamilias.length > 0) {
                htmlOptions += `<optgroup label="⭐ Términos de ${labelCategoria} (Otras Familias)">`;
                htmlOptions += nivel2_otrasFamilias.map(t => 
                    `<option value="${t.termino}" data-id="${t.id}" data-abrev="${t.abreviatura || ''}" style="font-weight:bold; background-color:#f0fdf4; color:#166534;">⭐ ${t.termino} [${t.abreviatura || 'S/A'}] (⭐ Usado en Otras Familias)</option>`
                ).join('');
                htmlOptions += `</optgroup>`;
            }

            // 🌐 NIVEL 3 (Prioridad Baja): Atributos de Otras Categorías Posicionales
            if (nivel3_restoGlobal.length > 0) {
                htmlOptions += `<optgroup label="🌐 Atributos de Otras Categorías Posicionales">`;
                htmlOptions += nivel3_restoGlobal.map(t => {
                    const catInfo = t.categoria ? ` (${t.categoria})` : '';
                    return `<option value="${t.termino}" data-id="${t.id}" data-abrev="${t.abreviatura || ''}" style="color:#475569;">${t.termino} [${t.abreviatura || 'S/A'}]${catInfo}</option>`;
                }).join('');
                htmlOptions += `</optgroup>`;
            }

            return htmlOptions;
        };

        window.modalSelectedTermId = null;

        const { value: formValues } = await Swal.fire({
            title: `➕ Vincular o Crear Atributo (${labelCategoria})`,
            html: `
                <div style="display:flex; flex-direction:column; gap:12px; text-align:left;">
                    <div style="background:#eff6ff; border:1px solid #bfdbfe; padding:12px; border-radius:8px;">
                        <label style="font-weight:bold; font-size:0.88em; color:#1e3a8a; display:block; margin-bottom:6px;">
                            🔍 1. Buscador Dinámico por Texto en Catálogo Global (Fase 49)
                        </label>
                        <input id="swal-search-input" class="swal2-input" placeholder="Escriba para filtrar (ej. mariposa, pelada, light...)" style="margin:0 0 8px 0; width:100%; box-sizing:border-box; font-size:0.95em;">
                        <select id="swal-select-existente" class="swal2-select" style="width:100%; margin:0; padding:8px;" onchange="window.seleccionarExistenteModal(this)">
                            <option value="" selected>-- Seleccione un término del catálogo --</option>
                            ${renderOptions('')}
                        </select>
                    </div>

                    <div style="text-align:center; font-size:0.8em; font-weight:bold; color:#64748b;">— O BIEN ALTA DE NUEVO TÉRMINO —</div>

                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <label style="font-weight:bold; font-size:0.85em; color:#475569;">2. Término (Nombre del Atributo)</label>
                        <input id="swal-attr-term" class="swal2-input" placeholder="ej. Pelada, Mariposa..." style="margin:0;">
                        <label style="font-weight:bold; font-size:0.85em; color:#475569;">3. Abreviatura</label>
                        <input id="swal-attr-abrev" class="swal2-input" placeholder="ej. PEL" style="margin:0; text-transform:uppercase;">
                    </div>
                </div>
            `,
            width: '560px',
            showCancelButton: true,
            confirmButtonText: '💾 Vincular Atributo',
            cancelButtonText: 'Cancelar',
            didOpen: () => {
                const searchInput = document.getElementById('swal-search-input');
                const selectEl = document.getElementById('swal-select-existente');
                const termInput = document.getElementById('swal-attr-term');
                const abrevInput = document.getElementById('swal-attr-abrev');
                const confirmBtn = Swal.getConfirmButton();

                const actualizarEstadoBotonVisual = () => {
                    if (!confirmBtn) return;
                    const termVal = termInput ? termInput.value.trim() : '';
                    const selectedOpt = selectEl ? selectEl.options[selectEl.selectedIndex] : null;
                    const isNewOpt = selectedOpt && selectedOpt.value === '__CREAR_NUEVO__';

                    const existeEnCatalogoGlobalActive = todosLosTerminos.some(
                        t => (t.termino || '').toLowerCase().trim() === termVal.toLowerCase()
                    );

                    // Banner Informativo No Restrictivo v5.70-rev3
                    let infoBanner = document.getElementById('swal-info-banner');
                    if (existeEnCatalogoGlobalActive && termVal.length > 0) {
                        if (!infoBanner) {
                            infoBanner = document.createElement('div');
                            infoBanner.id = 'swal-info-banner';
                            infoBanner.style.cssText = 'background:#eff6ff; border:1px solid #93c5fd; color:#1e40af; padding:8px 12px; border-radius:6px; font-size:0.82em; margin-top:8px; display:flex; align-items:center; gap:8px;';
                            if (termInput && termInput.parentNode) {
                                termInput.parentNode.insertBefore(infoBanner, termInput.nextSibling);
                            }
                        }
                        infoBanner.innerHTML = `ℹ️ <strong>Nota Informativa:</strong> El término "${termVal}" ya existe en el catálogo master. Podés continuar libremente con la creación de una nueva entidad o seleccionar la existente.`;
                        infoBanner.style.display = 'block';
                    } else if (infoBanner) {
                        infoBanner.style.display = 'none';
                    }

                    if (isNewOpt || (!existeEnCatalogoGlobalActive && termVal.length > 0)) {
                        confirmBtn.innerHTML = '✨ Crear y Vincular Nuevo Término';
                        confirmBtn.style.backgroundColor = '#2563eb';
                    } else if (termVal.length > 0) {
                        confirmBtn.innerHTML = '🔗 Vincular Término Existente';
                        confirmBtn.style.backgroundColor = '#16a34a';
                    } else {
                        confirmBtn.innerHTML = '💾 Vincular Atributo';
                        confirmBtn.style.backgroundColor = '#2563eb';
                    }
                };

                if (searchInput) {
                    searchInput.addEventListener('input', (e) => {
                        const filterVal = e.target.value;
                        selectEl.innerHTML = `<option value="" selected>-- Seleccione un término del catálogo --</option>` + renderOptions(filterVal);
                        actualizarEstadoBotonVisual();
                    });
                }

                if (termInput) {
                    termInput.addEventListener('input', () => {
                        window.modalSelectedTermId = null;
                        actualizarEstadoBotonVisual();
                    });
                }

                if (selectEl) {
                    selectEl.addEventListener('change', actualizarEstadoBotonVisual);
                }

                window.seleccionarExistenteModal = (selectElement) => {
                    const selectedOpt = selectElement.options[selectElement.selectedIndex];
                    if (selectedOpt && selectedOpt.value === '__CREAR_NUEVO__') {
                        const newTerm = selectedOpt.getAttribute('data-newterm') || '';
                        if (termInput) termInput.value = newTerm;
                        if (abrevInput) abrevInput.focus();
                        window.modalSelectedTermId = null;
                    } else if (selectedOpt && selectedOpt.value) {
                        if (termInput) termInput.value = selectedOpt.value;
                        if (abrevInput) abrevInput.value = selectedOpt.getAttribute('data-abrev') || '';
                        window.modalSelectedTermId = parseInt(selectedOpt.getAttribute('data-id')) || null;
                    } else {
                        window.modalSelectedTermId = null;
                    }
                    actualizarEstadoBotonVisual();
                };

                actualizarEstadoBotonVisual();
            },
            preConfirm: () => {
                const termInputVal = (document.getElementById('swal-attr-term') ? document.getElementById('swal-attr-term').value : '').trim();
                const abrevInputVal = (document.getElementById('swal-attr-abrev') ? document.getElementById('swal-attr-abrev').value : '').trim().toUpperCase();
                return {
                    term: termInputVal,
                    termino: termInputVal,
                    abrv: abrevInputVal,
                    abreviatura: abrevInputVal,
                    termino_id: window.modalSelectedTermId || null
                };
            }
        });

        if (formValues) {
            const finalTerm = (formValues.termino || formValues.term || '').trim();
            const finalAbrev = (formValues.abreviatura || formValues.abrv || '').trim().toUpperCase();

            if (!finalTerm) {
                Swal.fire('Atención', 'Debe seleccionar o escribir un término.', 'warning');
                return;
            }

            Swal.fire({ title: 'Vinculando atributo...', didOpen: () => Swal.showLoading() });

            const confirmBtn = Swal.getConfirmButton();
            const esEstadoCreacionNuevo = confirmBtn && confirmBtn.innerText.includes('Crear y Vincular');

            const payloadData = {
                familia_id: parseInt(familiaId),
                articulo_principal_id: parseInt(articuloPrincipalId),
                articulo_principal_texto: articuloPrincipalTexto,
                termino_id: esEstadoCreacionNuevo ? null : (formValues.termino_id || window.modalSelectedTermId || null),
                categoria_id: parseInt(categoriaId) || null,
                categoria: categoria,
                termino: finalTerm,
                abreviatura: finalAbrev
            };

            const resPost = await fetch('/api/logistica/bunker-diccionario/crear-termino-en-categoria', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadData)
            });

            const jsonPost = await resPost.json();
            if (jsonPost.success) {
                Swal.fire({ title: 'Atributo Vinculado', text: jsonPost.message, icon: 'success', timer: 1500, showConfirmButton: false });
                cargarJerarquia();
            } else {
                Swal.fire('Error', jsonPost.error || 'No se pudo vincular el atributo.', 'error');
            }
        }
    } catch (e) {
        Swal.fire('Error', 'Fallo de red al procesar el catálogo de atributos.', 'error');
    }
};

window.moverCategoriaDirecta = async function(idx, delta) {
    if (!window.categoriasOrdenadasActuales) return;
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= window.categoriasOrdenadasActuales.length) return;

    const familiaId = document.getElementById('filtro-familia').value || 1;

    // Swap elements in memory array
    const arr = [...window.categoriasOrdenadasActuales];
    const temp = arr[idx];
    arr[idx] = arr[targetIdx];
    arr[targetIdx] = temp;

    // Build reorder payload for backend
    const ordenamientoPayload = arr.map((item, newIdx) => ({
        categoria: item.categoria,
        orden: newIdx + 2 // orden_posicional 2 maps to Posición 3 in UI
    }));

    console.log(`🚨 [VIGÍA DICCIONARIO - REORDENAR PAYLOAD ENVIADO AL BACKEND]:`, ordenamientoPayload);

    try {
        Swal.fire({ title: 'Actualizando secuencia posicional...', didOpen: () => Swal.showLoading() });
        const res = await fetch(`/api/logistica/bunker-taxonomia/familias/${familiaId}/reordenar`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ordenamiento: ordenamientoPayload })
        });
        const json = await res.json();
        console.log(`🚨 [VIGÍA DICCIONARIO - RESPUESTA BACKEND REORDENAR]:`, json);
        if (json.success) {
            Swal.fire({ title: 'Orden Posicional Actualizado', icon: 'success', timer: 1000, showConfirmButton: false });
            cargarJerarquia();
        } else {
            Swal.fire('Error', json.error || 'No se pudo guardar el orden.', 'error');
        }
    } catch (e) {
        Swal.fire('Error', 'Fallo de conectividad al reordenar posiciones.', 'error');
    }
};

window.desvincularCategoriaDeFamiliaModal = async function(cat, label) {
    if (!familiaSeleccionada) {
        Swal.fire('Atención', 'Debe seleccionar una familia para desvincular un eje posicional.', 'warning');
        return;
    }
    const result = await Swal.fire({
        title: '¿Desvincular Eje Posicional?',
        html: `¿Está seguro de que desea eliminar la categoría <strong>${label}</strong> de la plantilla posicional de la familia?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, desvincular eje',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        try {
            Swal.fire({ title: 'Desvinculando eje...', didOpen: () => Swal.showLoading() });
            const res = await fetch(`/api/logistica/bunker-taxonomia/familias/${familiaSeleccionada}/categorias/${encodeURIComponent(cat)}`, {
                method: 'DELETE'
            });
            const json = await res.json();
            if (json.success) {
                Swal.fire('Eje Desvinculado', json.message, 'success');
                window.cargarJerarquia();
            } else {
                Swal.fire('Error', json.error || 'No se pudo desvincular la categoría.', 'error');
            }
        } catch(e) {
            Swal.fire('Error', 'Fallo de conexión al desvincular categoría de la familia.', 'error');
        }
    }
};

window.crearNuevaFamiliaModal = async function() {
    const { value: formValues } = await Swal.fire({
        title: '🌳 Alta de Nueva Familia (Nivel 1)',
        html: `
            <div style="display:flex; flex-direction:column; gap:10px; text-align:left;">
                <label style="font-weight:bold; color:#166534; font-size:0.9em;">Nombre de la Familia *</label>
                <input id="swal-fam-nombre" class="swal2-input" style="margin:0;" placeholder="Ej: Especias y Condimentos">
                <label style="font-weight:bold; color:#475569; font-size:0.9em;">Código de Familia (Opcional - Se auto-generará si se deja en blanco)</label>
                <input id="swal-fam-codigo" class="swal2-input" style="margin:0; text-transform:uppercase;" placeholder="Auto-generado (ej: FAM-ESPECIAS)">
                <small style="color:#64748b; font-size:0.8em;">Deje el código en blanco para que el servidor lo genere automáticamente.</small>
                <label style="font-weight:bold; color:#475569; font-size:0.9em;">Descripción (Opcional)</label>
                <input id="swal-fam-desc" class="swal2-input" style="margin:0;" placeholder="Ej: Orégano, pimentón, comino y derivados">
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: '💾 Crear Familia',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        preConfirm: () => {
            const nombre = document.getElementById('swal-fam-nombre').value.trim();
            if (!nombre) {
                Swal.showValidationMessage('El nombre de la familia es obligatorio');
                return false;
            }
            return {
                nombre,
                codigo_familia: document.getElementById('swal-fam-codigo').value.trim().toUpperCase(),
                descripcion: document.getElementById('swal-fam-desc').value.trim()
            };
        }
    });

    if (formValues) {
        try {
            Swal.fire({ title: 'Creando nueva familia...', didOpen: () => Swal.showLoading() });
            const res = await fetch('/api/logistica/bunker-taxonomia/familias', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formValues)
            });
            const json = await res.json();
            if (json.success && json.data) {
                Swal.fire('Familia Creada', `Familia "${json.data.nombre}" creada con código "${json.data.codigo_familia}".`, 'success');
                await cargarFamilias();
                const selectFam = document.getElementById('filtro-familia');
                if (selectFam) {
                    selectFam.value = json.data.id;
                    window.familiaCambiada();
                }
            } else {
                Swal.fire('Error', json.error || 'No se pudo crear la familia.', 'error');
            }
        } catch(e) {
            Swal.fire('Error', 'Fallo de red al crear la familia.', 'error');
        }
    }
};

window.crearNuevoAtributoPrincipalModal = async function() {
    const selectFam = document.getElementById('filtro-familia');
    const famId = selectFam ? selectFam.value : familiaSeleccionada;

    const { value: formValues } = await Swal.fire({
        title: '🔹 Vincular / Alta de Atributo Principal',
        html: `
            <div style="display:flex; flex-direction:column; gap:10px; text-align:left;">
                <label style="font-weight:bold; color:#1e3a8a; font-size:0.9em;">🔍 Buscador Vivo de Diccionario Maestro (Fase 49)</label>
                <input id="swal-princ-search" class="swal2-input" style="margin:0;" placeholder="Buscar término existente (ej: Aceite de coco, Nuez...)" autocomplete="off">
                <div id="swal-princ-results" style="display:none; max-height:140px; overflow-y:auto; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc; padding:4px;"></div>
                <div id="swal-princ-banner-info" style="display:none; padding:8px 10px; background:#e0f2fe; border:1px solid #bae6fd; border-radius:6px; color:#0369a1; font-size:0.82em; font-weight:bold;"></div>
                <div style="border-top:1px dashed #cbd5e1; margin-top:4px; padding-top:8px; display:flex; flex-direction:column; gap:8px;">
                    <label style="font-weight:bold; color:#1e293b; font-size:0.9em;">Nombre del Atributo Principal *</label>
                    <input id="swal-princ-nombre" class="swal2-input" style="margin:0;" placeholder="Seleccione un resultado o escriba uno nuevo...">
                    <label style="font-weight:bold; color:#475569; font-size:0.9em;">Abreviatura de Impresión</label>
                    <input id="swal-princ-abrev" class="swal2-input" style="margin:0; text-transform:uppercase;" placeholder="Abreviatura (ej: ORE, PIM, ACE...)">
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: '💾 Vincular a la Familia',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        didOpen: () => {
            const inputSearch = document.getElementById('swal-princ-search');
            const divResults = document.getElementById('swal-princ-results');
            const bannerInfo = document.getElementById('swal-princ-banner-info');
            const inputNombre = document.getElementById('swal-princ-nombre');
            const inputAbrev = document.getElementById('swal-princ-abrev');
            let timer = null;

            if (inputSearch && divResults) {
                inputSearch.addEventListener('input', () => {
                    clearTimeout(timer);
                    const q = inputSearch.value.trim();
                    if (q.length < 2) {
                        divResults.style.display = 'none';
                        return;
                    }
                    timer = setTimeout(async () => {
                        try {
                            const res = await fetch(`/api/logistica/bunker-diccionario/principales/buscar?q=${encodeURIComponent(q)}`);
                            const json = await res.json();
                            divResults.innerHTML = '';
                            if (json.success && Array.isArray(json.data) && json.data.length > 0) {
                                divResults.style.display = 'block';
                                json.data.forEach(item => {
                                    const row = document.createElement('div');
                                    row.style.padding = '8px 10px';
                                    row.style.cursor = 'pointer';
                                    row.style.borderBottom = '1px solid #e2e8f0';
                                    row.style.display = 'flex';
                                    row.style.justifyContent = 'space-between';
                                    row.style.fontSize = '0.9em';
                                    const catDisplay = (item.categoria === 'articulo_principal' || !item.categoria) ? 'Atributo Principal' : item.categoria;
                                    row.innerHTML = `<strong>${item.termino}</strong> <span style="color:#0284c7; font-weight:bold;">[ID: ${item.id} - ${catDisplay}]</span>`;
                                    row.onclick = () => {
                                        inputNombre.value = item.termino;
                                        inputAbrev.value = item.abreviatura || item.termino.substring(0, 5).toUpperCase();
                                        divResults.style.display = 'none';
                                        if (bannerInfo) {
                                            bannerInfo.style.display = 'block';
                                            bannerInfo.innerHTML = `ℹ️ Término existente en la BD (ID: ${item.id}, Categoría: ${catDisplay}). Se vinculará por ID primario y se promoverá a Atributo Principal.`;
                                        }
                                    };
                                    divResults.appendChild(row);
                                });
                            } else {
                                divResults.style.display = 'block';
                                divResults.innerHTML = `<div style="padding:8px; color:#64748b; font-size:0.85em; text-align:center;">No hay coincidencias en la BD. Puede registrarlo abajo como nuevo.</div>`;
                            }
                        } catch(e) {
                            console.error('Error buscando en modal:', e);
                        }
                    }, 250);
                });
            }
        },
        preConfirm: () => {
            const termino = document.getElementById('swal-princ-nombre').value.trim();
            if (!termino) {
                Swal.showValidationMessage('El nombre del Atributo Principal es obligatorio');
                return false;
            }
            return {
                familia_id: (famId && famId !== '__NUEVA_FAMILIA__') ? parseInt(famId) : null,
                termino,
                abreviatura: document.getElementById('swal-princ-abrev').value.trim().toUpperCase()
            };
        }
    });

    if (formValues) {
        try {
            Swal.fire({ title: 'Vinculando Atributo Principal...', didOpen: () => Swal.showLoading() });
            const res = await fetch('/api/logistica/bunker-diccionario/articulos-principales', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formValues)
            });
            const json = await res.json();
            if (json.success && json.data) {
                const termVinculado = json.data.termino || formValues.termino;
                
                await Swal.fire({
                    title: 'Atributo Principal Vinculado',
                    text: `El término "${termVinculado}" fue vinculado a la familia y seleccionado en pantalla.`,
                    icon: 'success',
                    timer: 1500,
                    showConfirmButton: false
                });

                // 1. Recargar lista de principales para la familia
                await cargarPrincipales(formValues.familia_id);

                // 2. Autoseleccionar defensivamente por ID numérico en el selector del DOM
                const rawId = json.data ? (json.data.id || json.data.termino_id) : null;
                const termId = rawId ? parseInt(rawId, 10) : NaN;
                const selectPrinc = document.getElementById('filtro-principal');
                if (selectPrinc && !isNaN(termId) && termId > 0) {
                    selectPrinc.value = String(termId);
                    principalSeleccionado = String(termId);
                    const accionesRaiz = document.getElementById('acciones-raiz');
                    if (accionesRaiz) accionesRaiz.style.display = 'flex';
                } else if (selectPrinc && termVinculado) {
                    const matchedOpt = Array.from(selectPrinc.options).find(o => o.getAttribute('data-termino') === termVinculado);
                    if (matchedOpt) {
                        selectPrinc.value = matchedOpt.value;
                        principalSeleccionado = matchedOpt.value;
                        const accionesRaiz = document.getElementById('acciones-raiz');
                        if (accionesRaiz) accionesRaiz.style.display = 'flex';
                    }
                }

                // 3. Renderizar automáticamente el acordeón sin requerir acción del operador
                await window.cargarJerarquia();
            } else {
                Swal.fire('Error', json.error || 'No se pudo vincular el Atributo Principal.', 'error');
            }
        } catch(e) {
            Swal.fire('Error', 'Fallo de red al vincular el Atributo Principal.', 'error');
        }
    }
};

window.desvincularAtributoPrincipalModal = async function() {
    const selectFam = document.getElementById('filtro-familia');
    const selectPrinc = document.getElementById('filtro-principal');
    const famId = selectFam && selectFam.value ? parseInt(selectFam.value, 10) : (familiaSeleccionada ? parseInt(familiaSeleccionada, 10) : null);
    
    if (!selectPrinc || !selectPrinc.value || selectPrinc.value === '__NUEVO_PRINCIPAL__') {
        Swal.fire('Atención', 'Debe seleccionar un Atributo Principal activo para desvincularlo de la familia.', 'warning');
        return;
    }

    const termId = parseInt(selectPrinc.value, 10);
    if (!termId || isNaN(termId)) {
        Swal.fire('Error', 'No se pudo determinar el ID relacional del Atributo Principal.', 'error');
        return;
    }

    const selectedOpt = selectPrinc.options[selectPrinc.selectedIndex];
    const termText = selectedOpt ? (selectedOpt.getAttribute('data-termino') || selectedOpt.text.replace('⭐ ', '').trim()) : principalSeleccionado;
    const famObj = (familiasGlobales || []).find(f => String(f.id) === String(famId));
    const famNombre = famObj ? famObj.nombre : 'la familia activa';

    const result = await Swal.fire({
        title: '¿Desvincular Atributo Principal?',
        html: `
            <div style="text-align:left; font-size:0.95em; color:#1e293b;">
                <p>Se desvinculará el término <strong>"${termText}"</strong> (ID: ${termId}) de la familia <strong>"${famNombre}"</strong>.</p>
                <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:10px; margin-top:10px; color:#991b1b;">
                    <strong>🛡️ Garantía Relacional:</strong> Esta acción elimina únicamente la relación de co-ocurrencia por ID con esta familia. El término permanece intacto en el diccionario maestro global.
                </div>
            </div>
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: '🔗❌ Sí, Desvincular de la Familia',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        try {
            Swal.fire({ title: 'Desvinculando atributo relacional...', didOpen: () => Swal.showLoading() });

            const res = await fetch('/api/logistica/bunker-diccionario/articulos-principales/desvincular', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    familia_id: famId, 
                    articulo_principal_id: termId
                })
            });
            const json = await res.json();
            if (res.ok && json.success) {
                Swal.fire('Atributo Desvinculado', json.message, 'success');

                // 🔑 REACTIVIDAD DOM CERO F5 & FLUSH TOTAL POST-DESVINCULACIÓN (v5.25)
                if (selectedOpt) selectedOpt.remove();

                selectPrinc.value = '';
                principalSeleccionado = '';
                window.ultimoPrincipalSeleccionado = '';

                // Transicionar directamente al Estado Vacío Explícito (📭) sin autoselección fantasma ni modales parásitos
                renderizarAcordeon();
            } else {
                // 🛡️ BARRERA RESTRICT: Manejo de HTTP 400 por categorías hijas activas
                Swal.fire('Desvinculación Bloqueada', json.error || 'No se pudo desvincular el artículo principal.', 'warning');
            }
        } catch(e) {
            Swal.fire('Error', 'Fallo de red al desvincular el artículo principal.', 'error');
        }
    }
};

window.editarFamiliaModal = async function() {
    const selectFam = document.getElementById('filtro-familia');
    const famId = selectFam ? selectFam.value : familiaSeleccionada;

    if (!famId) {
        Swal.fire('Atención', 'Debe seleccionar una Familia de Producto para modificarla.', 'warning');
        return;
    }

    const famObj = (familiasGlobales || []).find(f => String(f.id) === String(famId));
    if (!famObj) {
        Swal.fire('Error', 'No se encontraron los datos de la familia seleccionada.', 'error');
        return;
    }

    const { value: formValues } = await Swal.fire({
        title: '✏️ Editar Familia de Producto',
        html: `
            <div style="text-align: left; font-size: 0.9em;">
                <label style="font-weight: bold; display: block; margin-top: 8px;">Nombre de la Familia (*):</label>
                <input id="swal-fam-edit-nombre" class="swal2-input" value="${famObj.nombre || ''}" style="margin: 4px 0 10px 0; width: 100%;">
                
                <label style="font-weight: bold; display: block; margin-top: 8px;">Código de Familia (estandarizado):</label>
                <input id="swal-fam-edit-codigo" class="swal2-input" value="${famObj.codigo_familia || ''}" style="margin: 4px 0 10px 0; width: 100%;">
                
                <label style="font-weight: bold; display: block; margin-top: 8px;">Descripción:</label>
                <textarea id="swal-fam-edit-desc" class="swal2-textarea" style="margin: 4px 0 10px 0; width: 100%; height: 60px;">${famObj.descripcion || ''}</textarea>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '💾 Guardar Cambios',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const nombre = document.getElementById('swal-fam-edit-nombre').value.trim();
            const codigo_familia = document.getElementById('swal-fam-edit-codigo').value.trim();
            const descripcion = document.getElementById('swal-fam-edit-desc').value.trim();

            if (!nombre) {
                Swal.showValidationMessage('El nombre de la familia es obligatorio.');
                return false;
            }
            return { nombre, codigo_familia, descripcion };
        }
    });

    if (formValues) {
        try {
            Swal.fire({ title: 'Guardando cambios de la familia...', didOpen: () => Swal.showLoading() });
            const res = await fetch(`/api/logistica/bunker-taxonomia/familias/${famId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formValues)
            });
            const json = await res.json();
            if (json.success && json.data) {
                await Swal.fire({
                    title: 'Familia Actualizada',
                    text: `La familia "${json.data.nombre}" fue actualizada exitosamente.`,
                    icon: 'success',
                    timer: 1500,
                    showConfirmButton: false
                });

                // Recargar globalmente los combos de familias en espejo
                if (typeof window.cargarFamiliasBunker === 'function') {
                    await window.cargarFamiliasBunker();
                } else if (typeof window.cargarFamilias === 'function') {
                    await window.cargarFamilias();
                }
                
                if (selectFam) selectFam.value = famId;
                await window.familiaCambiada();
            } else {
                Swal.fire('Error', json.error || 'No se pudo actualizar la familia.', 'error');
            }
        } catch(e) {
            Swal.fire('Error', 'Fallo de red al actualizar la familia.', 'error');
        }
    }
};

window.eliminarFamiliaModal = async function() {
    const selectFam = document.getElementById('filtro-familia');
    const famId = selectFam ? selectFam.value : familiaSeleccionada;

    if (!famId) {
        Swal.fire('Atención', 'Debe seleccionar una Familia de Producto para eliminarla.', 'warning');
        return;
    }

    const famObj = (familiasGlobales || []).find(f => String(f.id) === String(famId));
    const famNombre = famObj ? famObj.nombre : 'la familia seleccionada';

    const result = await Swal.fire({
        title: '¿Eliminar Familia de Producto?',
        html: `
            <div style="text-align:left; font-size:0.95em; color:#1e293b;">
                <p>Se intentará eliminar la familia maestra <strong>"${famNombre}"</strong>.</p>
                <div style="background:#fffbeb; border:1px solid #fef3c7; border-radius:6px; padding:10px; margin-top:10px; color:#92400e;">
                    <strong>🛡️ Barrera de Seguridad:</strong> Si la familia posee Atributos Principales o artículos asignados, la eliminación será <strong>bloqueada automáticamente</strong> por el sistema para proteger los datos.
                </div>
            </div>
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: '🗑️ Sí, Eliminar Familia',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        try {
            Swal.fire({ title: 'Verificando dependencias y eliminando...', didOpen: () => Swal.showLoading() });
            const res = await fetch(`/api/logistica/bunker-taxonomia/familias/${famId}`, {
                method: 'DELETE'
            });
            const json = await res.json();

            if (json.success) {
                await Swal.fire('Familia Eliminada', json.message, 'success');
                // Recargar globalmente los combos de familias en espejo
                if (typeof window.cargarFamiliasBunker === 'function') {
                    await window.cargarFamiliasBunker();
                } else if (typeof window.cargarFamilias === 'function') {
                    await window.cargarFamilias();
                }

                if (selectFam) selectFam.value = '';
                await window.familiaCambiada();
            } else if (res.status === 409 || (json.detalles)) {
                const det = json.detalles || {};
                const result409 = await Swal.fire({
                    title: '🛑 Bloqueo de Seguridad Relacional',
                    html: `
                        <div style="text-align:left; font-size:0.95em; color:#1e293b;">
                            <p style="color:#dc2626; font-weight:bold;">${json.error}</p>
                            <ul style="margin-top:8px; background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:12px 20px; color:#991b1b;">
                                <li><strong>Atributos Principales (Nivel 2) asociados:</strong> ${det.atributos_principales_vinculados || 0}</li>
                                <li><strong>Artículos (SKUs) asociados:</strong> ${det.articulos_vinculados || 0}</li>
                            </ul>
                            <p style="margin-top:10px; font-size:0.9em; color:#1e3a8a;">¿Desea transferir masivamente todos los SKUs a otra familia y eliminar esta familia residual?</p>
                        </div>
                    `,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#2563eb',
                    cancelButtonColor: '#64748b',
                    confirmButtonText: '🔄 Reasignar SKUs y Eliminar',
                    cancelButtonText: 'Cancelar'
                });

                if (result409.isConfirmed) {
                    await window.mostrarModalReasignacionYBajaFamilia(famId, famObj ? famObj.nombre : 'Familia', det);
                }
            } else {
                Swal.fire('Error', json.error || 'No se pudo eliminar la familia.', 'error');
            }
        } catch(e) {
            Swal.fire('Error', 'Fallo de red al intentar eliminar la familia.', 'error');
        }
    }
};

window.mostrarModalReasignacionYBajaFamilia = async function(famId, famNombre, detalles) {
    try {
        console.log('🔄 [BUNKER] Abriendo modal de reasignación masiva para Familia ID:', famId, famNombre);
        const resFam = await fetch('/api/logistica/bunker-diccionario/familias');
        const jsonFam = await resFam.json();
        const otrasFamilias = jsonFam.success && Array.isArray(jsonFam.data) 
            ? jsonFam.data.filter(f => String(f.id) !== String(famId))
            : [];

        if (otrasFamilias.length === 0) {
            Swal.fire('Bloqueo Absoluto', 'No hay otras familias registradas en la base de datos a las cuales transferir las dependencias.', 'warning');
            return;
        }

        let optionsHTML = otrasFamilias.map(f => `<option value="${f.id}">${f.nombre}</option>`).join('');

        const { value: destinoId } = await Swal.fire({
            title: '🔄 Reasignación Masiva y Baja de Familia',
            html: `
                <div style="text-align:left; font-size:0.95em; color:#1e293b;">
                    <p style="color:#dc2626; font-weight:bold; margin-bottom:8px;">La familia "${famNombre}" posee dependencias activas:</p>
                    <ul style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:10px 20px; margin-bottom:12px; color:#991b1b;">
                        <li><strong>SKUs / Artículos a reasignar:</strong> ${detalles.articulos_vinculados || 0}</li>
                        <li><strong>Atributos Principales (Nivel 2) a reasignar:</strong> ${detalles.atributos_principales_vinculados || 0}</li>
                    </ul>
                    <label style="font-weight:bold; display:block; margin-bottom:4px; color:#1e3a8a;">Seleccione la Familia de Destino (*):</label>
                    <select id="swal-fam-destino-reasignar" class="swal2-select" style="width:100%; margin:0; padding:8px; font-weight:bold; border-color:#cbd5e1;">
                        ${optionsHTML}
                    </select>
                    <p style="margin-top:10px; font-size:0.8em; color:#64748b;">Todos los SKUs y relaciones de Nivel 2 serán transferidos atómicamente a la familia seleccionada y luego se eliminará la familia de origen.</p>
                </div>
            `,
            showCancelButton: true,
            confirmButtonColor: '#2563eb',
            cancelButtonColor: '#64748b',
            confirmButtonText: '🔄 Reasignar Dependencias y Eliminar',
            cancelButtonText: 'Cancelar',
            focusConfirm: false,
            preConfirm: () => {
                const selectDestino = document.getElementById('swal-fam-destino-reasignar');
                const val = selectDestino ? selectDestino.value : null;
                if (!val) {
                    Swal.showValidationMessage('Debe seleccionar una familia de destino.');
                    return false;
                }
                return val;
            }
        });

        if (destinoId) {
            Swal.fire({ title: 'Reasignando dependencias y eliminando familia...', didOpen: () => Swal.showLoading() });
            const resReasig = await fetch(`/api/logistica/bunker-taxonomia/familias/${famId}/reasignar-y-eliminar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ familia_destino_id: parseInt(destinoId) })
            });
            const jsonReasig = await resReasig.json();
            if (jsonReasig.success) {
                await Swal.fire({
                    title: 'Reasignación y Baja Completada',
                    text: jsonReasig.message,
                    icon: 'success'
                });
                if (typeof window.cargarFamiliasBunker === 'function') {
                    await window.cargarFamiliasBunker();
                }
                if (typeof window.cargarFamilias === 'function') {
                    await window.cargarFamilias();
                }
                const selectFam = document.getElementById('bunker_familia_id') || document.getElementById('filtro-familia');
                if (selectFam && selectFam.options.length > 0) {
                    selectFam.value = selectFam.options[0].value;
                    if (typeof window.cambiarFamiliaArticulo === 'function') {
                        await window.cambiarFamiliaArticulo(selectFam.value);
                    } else if (typeof window.familiaCambiada === 'function') {
                        await window.familiaCambiada();
                    }
                }
            } else {
                Swal.fire('Error', jsonReasig.error || 'No se pudo realizar la reasignación masiva.', 'error');
            }
        }
    } catch(e) {
        Swal.fire('Error', 'Fallo de red al ejecutar reasignación masiva: ' + e.message, 'error');
    }
};

window.desvincularTerminoJerarquia = async function(terminoId, terminoNombre, categoria) {
    const selFam = document.getElementById('filtro-familia') || document.getElementById('bunker_familia_id') || document.getElementById('select_familia');
    const selPrinc = document.getElementById('filtro-principal') || document.getElementById('select_articulo_principal');
    const famId = (selFam && selFam.value) ? parseInt(selFam.value) : (parseInt(familiaSeleccionada) || null);
    const princId = (selPrinc && selPrinc.value) ? parseInt(selPrinc.value) : null;

    if (!famId) {
        Swal.fire('Atención', 'Debe seleccionar una familia de producto.', 'warning');
        return;
    }

    if (!princId) {
        Swal.fire('Atención', 'Debe seleccionar un Atributo Principal para desvincular.', 'warning');
        return;
    }

    const result = await Swal.fire({
        title: '¿Desvincular Término?',
        html: `¿Desea desvincular el término <strong>"${terminoNombre}"</strong> de la jerarquía actual?<br><br><small style="color:#64748b;">El término permanecerá 100% intacto en el Diccionario Maestro Global para otros usos.</small>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Sí, Desvincular',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        try {
            Swal.fire({ title: 'Desvinculando término...', didOpen: () => Swal.showLoading() });
            const res = await fetch('/api/logistica/bunker-diccionario/jerarquia/desvincular', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    familia_id: famId,
                    articulo_principal_id: princId,
                    termino_id: terminoId,
                    categoria: categoria
                })
            });
            const json = await res.json();
            if (json.success) {
                Swal.fire({ title: 'Desvinculado Exitosamente', icon: 'success', timer: 1200, showConfirmButton: false });
                if (typeof cargarJerarquia === 'function') cargarJerarquia();
            } else {
                Swal.fire('Error', json.error || 'No se pudo desvincular el término.', 'error');
            }
        } catch (e) {
            console.error('❌ Error al desvincular término de jerarquía:', e);
            Swal.fire('Error', 'Error de red al intentar desvincular término.', 'error');
        }
    }
};

// Aliases para preservación semántica y compatibilidad
window.crearNuevoArticuloPrincipalModal = window.crearNuevoAtributoPrincipalModal;
window.desvincularArticuloPrincipalModal = window.desvincularAtributoPrincipalModal;

/**
 * 🧹 HERRAMIENTA DE DEPURACIÓN DE EJES HISTÓRICOS UI v5.10
 * Audita y expone en modal interactivo las claves desnormalizadas en bunker_articulos.propiedades_dinamicas
 */
window.abrirModalAuditoriaEjesHistoricos = async function() {
    try {
        Swal.fire({ title: 'Auditando base de datos de artículos...', didOpen: () => Swal.showLoading() });
        const res = await fetch('/api/logistica/bunker-taxonomia/auditoria-ejes-historicos');
        const json = await res.json();

        if (!json.success) {
            Swal.fire('Error', json.error || 'No se pudo realizar la auditoría.', 'error');
            return;
        }

        const anomalias = json.anomalias || [];

        if (anomalias.length === 0) {
            Swal.fire({
                title: '✅ Base de Datos 100% Saneada',
                text: 'No se detectaron claves legacy ni desnormalizadas en bunker_articulos. Todos los artículos coinciden exactamente con sus plantillas maestras.',
                icon: 'success',
                confirmButtonColor: '#10b981'
            });
            return;
        }

        let filasHtml = anomalias.map((item) => `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding:8px; font-weight:bold; color:#1e293b;">${item.familia_nombre}</td>
                <td style="padding:8px; color:#ef4444; font-weight:bold; font-family:monospace;">${item.clave_detectada}</td>
                <td style="padding:8px; color:#10b981; font-weight:bold; font-family:monospace;">${item.categoria_canonica_sugerida}</td>
                <td style="padding:8px; text-align:center; font-weight:bold; color:#1e293b;">${item.articulos_afectados_count} SKU(s)</td>
                <td style="padding:8px; text-align:center;">
                    <button type="button" onclick="consolidarEjeHistoricoUI(${item.familia_id}, '${window.escapeHtmlAttr(item.clave_detectada)}', '${window.escapeHtmlAttr(item.categoria_canonica_sugerida)}')" style="background:#2563eb; color:#fff; border:none; padding:5px 10px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:0.85em;">⚡ Consolidar y Sanear</button>
                </td>
            </tr>
        `).join('');

        await Swal.fire({
            title: `🧹 Auditar y Depurar Ejes Históricos (${anomalias.length} Inconsistencias)`,
            html: `
                <div style="text-align:left; font-size:0.9em;">
                    <p style="color:#64748b; margin-bottom:10px;">
                        Las siguientes claves almacenadas en <code>bunker_articulos.propiedades_dinamicas</code> no coinciden exactamente con la taxonomía maestra activa. Al hacer clic en <strong>Consolidar</strong>, se ejecutará una transacción SQL en la base de datos para corregirlas masivamente.
                    </p>
                    <div style="max-height:350px; overflow-y:auto; border:1px solid #cbd5e1; border-radius:6px;">
                        <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.88em;">
                            <thead>
                                <tr style="background:#f1f5f9; color:#334155; border-bottom:2px solid #cbd5e1;">
                                    <th style="padding:8px;">Familia</th>
                                    <th style="padding:8px;">Clave en BD</th>
                                    <th style="padding:8px;">Sugerencia Canónica</th>
                                    <th style="padding:8px; text-align:center;">Afectados</th>
                                    <th style="padding:8px; text-align:center;">Acción</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${filasHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            `,
            width: '800px',
            showConfirmButton: false,
            showCancelButton: true,
            cancelButtonText: 'Cerrar'
        });
    } catch(e) {
        Swal.fire('Error', 'Fallo de conectividad al auditar ejes históricos: ' + e.message, 'error');
    }
};

window.consolidarEjeHistoricoUI = async function(familiaId, claveDetectada, claveCanonica) {
    const confirmacion = await Swal.fire({
        title: '⚡ Confirmar Consolidación de Base de Datos',
        html: `¿Está seguro de migrar masivamente la clave <code>"${claveDetectada}"</code> a la canónica <code>"${claveCanonica}"</code> en todos los artículos de la base de datos?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#2563eb',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, Ejecutar UPDATE en BD',
        cancelButtonText: 'Cancelar'
    });

    if (confirmacion.isConfirmed) {
        try {
            Swal.fire({ title: 'Ejecutando transacción SQL en PostgreSQL...', didOpen: () => Swal.showLoading() });
            const res = await fetch('/api/logistica/bunker-taxonomia/consolidar-eje-historico', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ familiaId, claveDetectada, claveCanonica })
            });
            const json = await res.json();

            if (json.success) {
                await Swal.fire({
                    title: '¡Base de Datos Saneada!',
                    text: json.message,
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                });
                // Recargar el modal de auditoría
                window.abrirModalAuditoriaEjesHistoricos();
            } else {
                Swal.fire('Error', json.error || 'No se pudo consolidar el eje.', 'error');
            }
        } catch(e) {
            Swal.fire('Error', 'Fallo de red al consolidar eje: ' + e.message, 'error');
        }
    }
};

