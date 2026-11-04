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
            const prevValue = select ? select.value : '';
            if (select) {
                select.innerHTML = '<option value="">📦 Todos los Atributos Principales...</option>';
                
                let tienePrioritarios = false;
                let optGroupPrioritarios = document.createElement('optgroup');
                optGroupPrioritarios.label = '⭐ Atributos Principales Consolidados';

                let optGroupOtros = document.createElement('optgroup');
                optGroupOtros.label = '── Resto del Diccionario ──';

                const seenTerms = new Set();
                json.data.forEach(obj => {
                    const termLower = (obj.termino || '').trim().toLowerCase();
                    if (seenTerms.has(termLower)) return;
                    seenTerms.add(termLower);

                    const opt = document.createElement('option');
                    opt.value = obj.id;
                    opt.setAttribute("data-termino", obj.termino);

                    if (obj.prioritario) {
                        tienePrioritarios = true;
                        opt.text = `⭐ ${obj.termino}`;
                        opt.style.fontWeight = 'bold';
                        opt.style.color = '#1e3a8a';
                        optGroupPrioritarios.appendChild(opt);
                    } else {
                        opt.text = obj.termino;
                        optGroupOtros.appendChild(opt);
                    }
                });

                if (tienePrioritarios) {
                    select.appendChild(optGroupPrioritarios);
                }
                if (optGroupOtros.children.length > 0) {
                    select.appendChild(optGroupOtros);
                }

                const optNewPrincipal = document.createElement('option');
                optNewPrincipal.value = '__NUEVO_PRINCIPAL__';
                optNewPrincipal.text = '➕ [+] Buscar o crear nuevo artículo principal...';
                optNewPrincipal.style.fontWeight = 'bold';
                optNewPrincipal.style.color = '#1e3a8a';
                select.appendChild(optNewPrincipal);
            }

            if (prevValue && Array.from(select.options).some(o => o.value === prevValue)) {
                select.value = prevValue;
            }
        }
    } catch(err) {
        console.error('Fallo al cargar la lista principal:', err);
    }
}

window.familiaCambiada = async function() {
    const selectFam = document.getElementById('filtro-familia');
    familiaSeleccionada = selectFam ? selectFam.value : '';
    
    const divAccionesFam = document.getElementById('acciones-familia');
    if (divAccionesFam) {
        divAccionesFam.style.display = familiaSeleccionada ? 'flex' : 'none';
    }

    await cargarPrincipales(familiaSeleccionada);
    window.cargarJerarquia();
};

window.cargarJerarquia = async function() {
    const select = document.getElementById('filtro-principal');
    const termino = select ? select.value : '';
    
    if (termino === '__NUEVO_PRINCIPAL__') {
        if (select) select.value = '';
        window.crearNuevoArticuloPrincipalModal();
        return;
    }

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

function renderizarAcordeon() {
    const container = document.getElementById('diccionario-acordeon-container');
    container.innerHTML = '';
    
    // Consolidar categorías normalizadas preservando orden_posicional
    const mapConsolidado = {};
    
    const tienePlantillaExplicita = Array.isArray(window.taxonomiaFamiliaActual) && window.taxonomiaFamiliaActual.length > 0;

    // A. Inyectar primero el esqueleto de la taxonomía maestra de la familia
    if (tienePlantillaExplicita) {
        window.taxonomiaFamiliaActual.forEach(item => {
            if (!item.categoria) return;
            const catKey = item.categoria.toLowerCase();
            if (catKey === 'articulo_principal' || catKey === 'pos_1') return;
            mapConsolidado[catKey] = {
                categoria: catKey,
                label: item.categoria.replaceAll('_', ' ').charAt(0).toUpperCase() + item.categoria.replaceAll('_', ' ').slice(1),
                orden_posicional: item.posicion || item.orden_posicional || 99,
                terms: []
            };
        });
    }

    // B. Poblar términos existentes desde jerarquiaGlobal
    Object.keys(jerarquiaGlobal).forEach(catRaw => {
        const catKey = catRaw.toLowerCase();
        // Si la familia tiene plantilla explícita y la categoría fue desvinculada (no está en mapConsolidado), ignorarla
        if (tienePlantillaExplicita && !mapConsolidado[catKey]) {
            return;
        }

        if (!mapConsolidado[catKey]) {
            mapConsolidado[catKey] = {
                categoria: catKey,
                label: catRaw.replaceAll('_', ' ').charAt(0).toUpperCase() + catRaw.replaceAll('_', ' ').slice(1),
                orden_posicional: 99,
                terms: []
            };
        }
        (jerarquiaGlobal[catRaw] || []).forEach(item => {
            if (item.orden_posicional && item.orden_posicional < mapConsolidado[catKey].orden_posicional) {
                mapConsolidado[catKey].orden_posicional = item.orden_posicional;
            }
            if (!mapConsolidado[catKey].terms.some(x => x.id === item.id || x.termino.toLowerCase() === item.termino.toLowerCase())) {
                mapConsolidado[catKey].terms.push(item);
            }
        });
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

    if (window.categoriasOrdenadasActuales.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px; border: 2px dashed #cbd5e1; border-radius: 8px; color: #64748b;">
                <strong>${principalSeleccionado}</strong> no tiene propiedades dinámicas registradas aún en el sistema.
            </div>
        `;
        return;
    }
    
    window.categoriasOrdenadasActuales.forEach((catObj, idx) => {
        const cat = catObj.categoria;
        const label = catObj.label;
        const terms = catObj.terms;
        const posNum = idx + 3; // Posición 1 = Familia, Posición 2 = Nombre Principal, Posición 3+ = Categorías Posicionales
        
        // Render Acordeón Item
        const card = document.createElement('div');
        card.style.border = '1px solid #cbd5e1';
        card.style.borderRadius = '6px';
        card.style.overflow = 'hidden';
        card.style.background = '#fff';
        
        const header = document.createElement('div');
        header.style.background = '#334155';
        header.style.color = '#fff';
        header.style.padding = '12px 20px';
        header.style.fontWeight = 'bold';
        header.style.fontSize = '1.1em';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <span>🏷️ Posición ${posNum} - Categoría Posicional: <span style="color:#fbbf24;">${label}</span></span>
                <div style="display:inline-flex; gap:3px;">
                    <button type="button" title="Mover Categoría Arriba" onclick="moverCategoriaDirecta(${idx}, -1)" style="border:1px solid #64748b; background:#475569; color:#fff; border-radius:4px; padding:2px 6px; font-size:0.75em; cursor:pointer;" ${idx === 0 ? 'disabled style="opacity:0.4;"' : ''}>⬆️</button>
                    <button type="button" title="Mover Categoría Abajo" onclick="moverCategoriaDirecta(${idx}, 1)" style="border:1px solid #64748b; background:#475569; color:#fff; border-radius:4px; padding:2px 6px; font-size:0.75em; cursor:pointer;" ${idx === window.categoriasOrdenadasActuales.length - 1 ? 'disabled style="opacity:0.4;"' : ''}>⬇️</button>
                </div>
            </div>
            <div style="display:flex; gap:10px; align-items:center;">
                <button type="button" onclick="agregarAtributoACategoriaModal('${cat}', '${label}')" style="background:#10b981; color:#fff; padding:4px 10px; border:none; border-radius:4px; font-size:0.75em; font-weight:bold; cursor:pointer;" title="Agregar nuevo término a la categoría ${label}">➕ Agregar Atributo</button>
                <button type="button" onclick="desvincularCategoriaDeFamiliaModal('${cat}', '${label}')" style="background:#ef4444; color:#fff; padding:4px 8px; border:none; border-radius:4px; font-size:0.75em; font-weight:bold; cursor:pointer;" title="Desvincular categoría de la plantilla posicional de la familia">🗑️ Quitar Eje</button>
                <span style="font-size: 0.75em; background:#475569; padding: 3px 8px; border-radius:12px;">${terms.length} Términos</span>
            </div>
        `;
        
        const body = document.createElement('div');
        body.style.padding = '0';
        
        let tableHtml = `
            <table class="grid-dict" style="margin:0; border:none; box-shadow:none; width: 100%;">
                <thead style="display:none;"><tr><th>Término</th><th>Abrev</th><th>Acciones</th></tr></thead>
                <tbody>
        `;
        
        // Sort terms alphabetically
        terms.sort((a,b) => a.termino.localeCompare(b.termino)).forEach(item => {
            const isRev = item.en_revision === true;
            const countArticles = item.articulos_asociados_count || 0;
            const canDelete = countArticles === 0;

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
                        <button class="btn-action btn-edit" title="Editar Valores" onclick="editarTerminoInfo(${item.id}, '${item.termino}', '${item.abreviatura}', '${item.categoria}')">✏️ Editar</button>
                        <button class="btn-action" style="background: #ef4444; color: white;" title="Desvincular término de esta jerarquía" onclick="desvincularTerminoJerarquia(${item.id}, '${item.termino.replace(/'/g, "\\'")}', '${cat}')">🔗❌ Desvincular</button>
                    </td>
                </tr>
            `;
        });
        
        tableHtml += `</tbody></table>`;
        body.innerHTML = tableHtml;
        
        card.appendChild(header);
        card.appendChild(body);
        container.appendChild(card);
    });
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
    
    const obj = principalesGlobales.find(p => p.termino === terminoSeleccionado);
    if (!obj) return;

    const { value: formValues } = await Swal.fire({
        title: 'Editar Atributo Raíz',
        html:
            `<div style="display:flex; flex-direction:column; gap:10px; text-align:left;">
                <label style="font-weight:bold; font-size:0.9em; color:#475569;">Atributo Principal (Raíz)</label>
                <input id="swal-term-raiz" class="swal2-input" style="margin:0;" value="${obj.termino}">
                <label style="font-weight:bold; font-size:0.9em; color:#475569;">Abreviatura de Impresión</label>
                <input id="swal-abrev-raiz" class="swal2-input" style="margin:0; text-transform:uppercase;" value="${obj.abreviatura}">
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
                Swal.fire('Actualizado', 'El atributo raíz fue modificado', 'success');
                await cargarPrincipales();
                document.getElementById('filtro-principal').value = formValues.termino;
                document.getElementById('diccionario-acordeon-container').innerHTML = `<div style="text-align: center; padding: 40px; color: #94a3b8; font-size: 1.2em; border: 2px dashed #cbd5e1; border-radius: 8px;">👆 Seleccione un Atributo Principal arriba para desplegar su diccionario.</div>`;
                document.getElementById('acciones-raiz').style.display = 'flex';
                cargarJerarquia();
            } else { Swal.fire('Error', result.error, 'error'); }
        } catch(e) { Swal.fire('Error', 'Fallo de red', 'error'); }
    }
};

window.eliminarRaiz = async function() {
    const terminoSeleccionado = document.getElementById('filtro-principal').value;
    if (!terminoSeleccionado) return;
    
    const obj = principalesGlobales.find(p => p.termino === terminoSeleccionado);
    if (!obj) return;
    
    const numFamilies = Object.keys(jerarquiaGlobal).length;
    let warningText = `Se eliminará el Atributo Raíz "${terminoSeleccionado}". Esta acción es irreversible.`;
    if (numFamilies > 0) warningText = `¡ATENCIÓN! "${terminoSeleccionado}" tiene ${numFamilies} familias vinculadas. Borrar la raíz romperá el nomenclador del SKU. ¿Aún desea continuar?`;

    const { isConfirmed } = await Swal.fire({
        title: '¿Eliminar Atributo Raíz?',
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
    const familiaId = document.getElementById('filtro-familia').value || 1;
    const familiaNombre = document.getElementById('filtro-familia').options[document.getElementById('filtro-familia').selectedIndex]?.text || 'Familia Seleccionada';

    Swal.fire({ title: 'Cargando catálogo global de categorías...', didOpen: () => Swal.showLoading() });

    let catsGlobales = [];
    try {
        const resDict = await fetch('/api/logistica/bunker/diccionario');
        const jsonDict = await resDict.json();
        if (jsonDict.success && Array.isArray(jsonDict.data)) {
            catsGlobales = [...new Set(jsonDict.data.map(d => (d.categoria || '').trim().toLowerCase()))].filter(c => c && c !== 'articulo_principal' && c !== 'general').sort();
        }
    } catch(e) {
        console.warn('⚠️ [DICCIONARIO] Error obteniendo lista global de categorías:', e);
    }

    const setCatsFamilia = new Set(
        (Array.isArray(window.taxonomiaFamiliaActual) ? window.taxonomiaFamiliaActual : [])
            .map(item => (item.categoria || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    );

    let opcionesSelectHtml = `<option value="">-- Seleccione una Categoría Preexistente --</option>`;
    catsGlobales.forEach(cat => {
        const catNorm = cat.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const label = cat.replaceAll('_', ' ').charAt(0).toUpperCase() + cat.replaceAll('_', ' ').slice(1);
        const yaIncluida = setCatsFamilia.has(catNorm);

        if (yaIncluida) {
            opcionesSelectHtml += `<option value="${cat}" disabled style="color:#94a3b8; font-style:italic;">${label} (✔ Ya incluida en ${familiaNombre})</option>`;
        } else {
            opcionesSelectHtml += `<option value="${cat}" style="font-weight:bold; color:#1e293b;">${label} (Preexistente - Disponible)</option>`;
        }
    });
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
                    <label style="font-weight:bold; font-size:0.85em; color:#64748b;">Término Inicial (Sugerido)</label>
                    <input id="swal-cat-term" class="swal2-input" placeholder="ej. Artesanal" style="margin:0;">
                    <label style="font-weight:bold; font-size:0.85em; color:#64748b;">Abreviatura</label>
                    <input id="swal-cat-abrev" class="swal2-input" placeholder="ej. ARTES" style="margin:0; text-transform:uppercase;">
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
                const termNuevo = document.getElementById('swal-cat-term').value.trim();
                const abrevNueva = document.getElementById('swal-cat-abrev').value.trim().toUpperCase();
                if (!nombreNuevo) {
                    Swal.showValidationMessage('Debe ingresar el nombre de la nueva categoría.');
                    return false;
                }
                return { modo: 'NUEVA', categoria: nombreNuevo, termino: termNuevo, abreviatura: abrevNueva };
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
                // 2. Crear nueva categoría maestra y vincular a la familia
                const res = await fetch('/api/logistica/bunker-taxonomia/categorias', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ categoria: formValues.categoria, termino: formValues.termino, abreviatura: formValues.abreviatura })
                });
                const json = await res.json();
                if (json.success) {
                    // Vincular a la plantilla posicional de la familia
                    await fetch(`/api/logistica/bunker-taxonomia/familias/${familiaId}/categorias`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ categoria: formValues.categoria, orden_posicional: 99 })
                    });
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

window.agregarAtributoACategoriaModal = async function(categoria, labelCategoria) {
    const familiaId = document.getElementById('filtro-familia').value || 1;
    const articuloPrincipalTexto = document.getElementById('filtro-principal').value || 'Nuez';

    try {
        Swal.fire({ title: 'Obteniendo catálogo de términos...', didOpen: () => Swal.showLoading() });
        const resDict = await fetch('/api/logistica/bunker-diccionario');
        const jsonDict = await resDict.json();

        let todosLosTerminos = jsonDict.success ? jsonDict.data : [];

        const renderOptions = (termFilter = '') => {
            const queryNorm = termFilter.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const queryWords = queryNorm.split(/\s+/).filter(w => w.length > 0);

            const filtered = todosLosTerminos.filter(t => {
                if (queryWords.length === 0) {
                    const catClean = categoria.trim().toLowerCase();
                    const tCatClean = (t.categoria || '').trim().toLowerCase();
                    return tCatClean === catClean || tCatClean === 'general';
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

            return filtered.map(t => {
                const catInfo = t.categoria ? ` (${t.categoria})` : '';
                return `<option value="${t.termino}" data-abrev="${t.abreviatura || ''}">${t.termino} [${t.abreviatura || 'S/A'}]${catInfo}</option>`;
            }).join('');
        };

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

                    const existeEnCatalogoGlobal = (window.diccionarioFullGlobal || window.diccionarioCategorizado || []).some(
                        t => (t.termino || '').toLowerCase().trim() === termVal.toLowerCase()
                    );

                    if (isNewOpt || (!existeEnCatalogoGlobal && termVal.length > 0)) {
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
                    termInput.addEventListener('input', actualizarEstadoBotonVisual);
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
                    } else if (selectedOpt && selectedOpt.value) {
                        if (termInput) termInput.value = selectedOpt.value;
                        if (abrevInput) abrevInput.value = selectedOpt.getAttribute('data-abrev') || '';
                    }
                    actualizarEstadoBotonVisual();
                };

                actualizarEstadoBotonVisual();
            },
            preConfirm: () => {
                return {
                    termino: document.getElementById('swal-attr-term').value.trim(),
                    abreviatura: document.getElementById('swal-attr-abrev').value.trim().toUpperCase()
                };
            }
        });

        if (formValues) {
            if (!formValues.termino) {
                Swal.fire('Atención', 'Debe seleccionar o escribir un término.', 'warning');
                return;
            }

            Swal.fire({ title: 'Vinculando atributo...', didOpen: () => Swal.showLoading() });
            const resPost = await fetch('/api/logistica/bunker-diccionario', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    familia_id: parseInt(familiaId),
                    articulo_principal_texto: articuloPrincipalTexto,
                    categoria,
                    termino: formValues.termino,
                    abreviatura: formValues.abreviatura
                })
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

window.crearNuevoArticuloPrincipalModal = async function() {
    const selectFam = document.getElementById('filtro-familia');
    const famId = selectFam ? selectFam.value : familiaSeleccionada;

    const { value: formValues } = await Swal.fire({
        title: '📦 Vincular / Alta de Artículo Principal (Nivel 2)',
        html: `
            <div style="display:flex; flex-direction:column; gap:10px; text-align:left;">
                <label style="font-weight:bold; color:#1e3a8a; font-size:0.9em;">🔍 Buscador Vivo de Diccionario Maestro (Fase 49)</label>
                <input id="swal-princ-search" class="swal2-input" style="margin:0;" placeholder="Buscar término existente (ej: Aceite de coco, Nuez...)" autocomplete="off">
                <div id="swal-princ-results" style="display:none; max-height:140px; overflow-y:auto; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc; padding:4px;"></div>
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
                            const res = await fetch(`/api/logistica/bunker/diccionario?q=${encodeURIComponent(q)}`);
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
                                    row.innerHTML = `<strong>${item.termino}</strong> <span style="color:#64748b;">[${item.abreviatura || item.termino}]</span>`;
                                    row.onclick = () => {
                                        inputNombre.value = item.termino;
                                        inputAbrev.value = item.abreviatura || item.termino.substring(0, 5).toUpperCase();
                                        divResults.style.display = 'none';
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
                Swal.showValidationMessage('El nombre del Artículo Principal es obligatorio');
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
            Swal.fire({ title: 'Vinculando artículo principal...', didOpen: () => Swal.showLoading() });
            const res = await fetch('/api/logistica/bunker-diccionario/articulos-principales', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formValues)
            });
            const json = await res.json();
            if (json.success && json.data) {
                const termVinculado = json.data.termino || formValues.termino;
                
                await Swal.fire({
                    title: 'Artículo Principal Vinculado',
                    text: `El término "${termVinculado}" fue vinculado a la familia y seleccionado en pantalla.`,
                    icon: 'success',
                    timer: 1500,
                    showConfirmButton: false
                });

                // 1. Recargar el desplegable Nivel 2 con la nueva vinculación
                await cargarPrincipales(formValues.familia_id);

                // 2. Autoseleccionar explícitamente el término en el selector del DOM
                const selectPrinc = document.getElementById('filtro-principal');
                if (selectPrinc) {
                    selectPrinc.value = termVinculado;
                    principalSeleccionado = termVinculado;
                    document.getElementById('acciones-raiz').style.display = 'flex';
                }

                // 3. Renderizar automáticamente el acordeón sin requerir acción del operador
                await window.cargarJerarquia();
            } else {
                Swal.fire('Error', json.error || 'No se pudo vincular el artículo principal.', 'error');
            }
        } catch(e) {
            Swal.fire('Error', 'Fallo de red al vincular el artículo principal.', 'error');
        }
    }
};

window.desvincularArticuloPrincipalModal = async function() {
    const selectFam = document.getElementById('filtro-familia');
    const selectPrinc = document.getElementById('filtro-principal');
    const famId = selectFam ? selectFam.value : familiaSeleccionada;
    const terminoVal = selectPrinc ? selectPrinc.value : principalSeleccionado;

    if (!terminoVal || terminoVal === '__NUEVO_PRINCIPAL__') {
        Swal.fire('Atención', 'Debe seleccionar un Atributo Principal activo para desvincularlo de la familia.', 'warning');
        return;
    }

    const famObj = (familiasGlobales || []).find(f => String(f.id) === String(famId));
    const famNombre = famObj ? famObj.nombre : 'la familia activa';

    const result = await Swal.fire({
        title: '¿Desvincular Atributo Principal (Nivel 2)?',
        html: `
            <div style="text-align:left; font-size:0.95em; color:#1e293b;">
                <p>Se desvinculará el término <strong>"${terminoVal}"</strong> de la familia <strong>"${famNombre}"</strong>.</p>
                <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:10px; margin-top:10px; color:#991b1b;">
                    <strong>🛡️ Garantía de Seguridad:</strong> Esta acción elimina únicamente la relación de co-ocurrencia con esta familia. El término <strong>PERMANECERÁ INTACTO</strong> en el diccionario maestro global.
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
            Swal.fire({ title: 'Desvinculando atributo de la familia...', didOpen: () => Swal.showLoading() });
            const objTerm = (principalesGlobales || []).find(p => p.termino === terminoVal);
            const termId = objTerm ? objTerm.id : null;

            const res = await fetch('/api/logistica/bunker-diccionario/articulos-principales/desvincular', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    familia_id: famId ? parseInt(famId) : null, 
                    termino: terminoVal,
                    articulo_principal_id: termId
                })
            });
            const json = await res.json();
            if (json.success) {
                Swal.fire('Atributo Desvinculado', json.message, 'success');
                // 1. Recargar lista de principales para la familia
                await cargarPrincipales(famId);
                // 2. Si quedan otros principales, seleccionar el primero disponible
                const firstOpt = Array.from(selectPrinc.options).find(o => o.value && o.value !== '__NUEVO_PRINCIPAL__');
                if (firstOpt) {
                    selectPrinc.value = firstOpt.value;
                } else {
                    selectPrinc.value = '';
                }
                await window.cargarJerarquia();
            } else {
                Swal.fire('Error', json.error || 'No se pudo desvincular el artículo principal.', 'error');
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
