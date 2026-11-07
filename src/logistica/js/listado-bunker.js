let articulosBunkerGlobal = [];
let listaSeleccionadaGlobal = 1; // Default a Lista 1
window.articulosSeleccionadosMasa = new Set();
window.articulosVisiblesActualmente = [];

// =========================================================================
// BLINDAJE ESTRUCTURAL DEL BUSCADOR PRINCIPAL (ISOLATION GUARD)
// =========================================================================
let debounceTimerBunkerBusqueda = null;

window.filtrarBunkerEnVivo = function() {
    clearTimeout(debounceTimerBunkerBusqueda);
    debounceTimerBunkerBusqueda = setTimeout(() => {
        const input = document.getElementById('filtro-busqueda');
        if (input) {
            localStorage.setItem('bunker_last_search', input.value);
        }
        if (typeof window.aplicarFiltrosYOrdenamiento === 'function') {
            window.aplicarFiltrosYOrdenamiento();
        }
    }, 100);
};

window.normalizarTextoBunker = function(text) {
    if (!text) return '';
    return String(text)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
};

window.obtenerTextoBusquedaArticulo = function(art) {
    if (!art) return '';

    const tokens = [];

    // 1. Descripciones y nomenclador
    if (art.descripcion_generada) tokens.push(art.descripcion_generada);
    if (art.descripcion && art.descripcion !== art.descripcion_generada) {
        tokens.push(art.descripcion);
    }
    if (art.description && art.description !== art.descripcion_generada) {
        tokens.push(art.description);
    }
    if (art.descripcion_legacy) {
        tokens.push(art.descripcion_legacy);
    }

    // 2. Identificadores clave
    if (art.articulo_id) tokens.push(art.articulo_id);
    if (art.articulo_numero) tokens.push(art.articulo_numero);
    if (art.codigo_barras) tokens.push(art.codigo_barras);

    // 3. Taxonomía de Familia y Rubros
    const famNombre = art.familia_nombre || art.familia || art.nombre_familia || art.propiedades_dinamicas?.familia_nombre;
    if (famNombre) tokens.push(famNombre);
    if (art.rubro) tokens.push(art.rubro);
    if (art.sub_rubro) tokens.push(art.sub_rubro);
    if (art.articulo_principal_nombre) tokens.push(art.articulo_principal_nombre);

    // 4. Atributos descriptivos completos (incluyendo silenciosos, abreviaturas, sinónimos colapsados y variantes de género)
    let pd = art.propiedades_dinamicas;
    if (typeof pd === 'string') {
        try { pd = JSON.parse(pd); } catch (e) {}
    }

    if (pd && typeof pd === 'object') {
        if (pd.articulo_principal) tokens.push(pd.articulo_principal);
        if (pd.familia_nombre) tokens.push(pd.familia_nombre);

        const posObj = pd.posiciones || pd;
        if (posObj && typeof posObj === 'object') {
            Object.keys(posObj).forEach(key => {
                if (key.startsWith('asistente_') || key.startsWith('rendimiento_') || key.startsWith('tostadero_') || key.startsWith('_meta')) {
                    return;
                }
                const item = posObj[key];
                if (item && typeof item === 'object') {
                    if (item.valor) {
                        tokens.push(item.valor);
                        // Términos compuestos colapsados (ej: "Non Pareil" -> "NonPareil" para que "nonpareil" coincida)
                        if (/\s+/.test(item.valor)) {
                            tokens.push(item.valor.replace(/\s+/g, ''));
                        }
                        // Tolerancia a flexiones de género en atributos (ej: tostado <-> tostada, pelado <-> pelada)
                        const words = String(item.valor).split(/\s+/);
                        words.forEach(w => {
                            if (w.length > 4) {
                                if (w.endsWith('o') || w.endsWith('os')) {
                                    tokens.push(w.slice(0, -1) + 'a');
                                    tokens.push(w.slice(0, -1) + 'as');
                                } else if (w.endsWith('a') || w.endsWith('as')) {
                                    tokens.push(w.slice(0, -1) + 'o');
                                    tokens.push(w.slice(0, -1) + 'os');
                                }
                            }
                        });
                    }
                    if (item.abreviatura) tokens.push(item.abreviatura);
                    if (item.eje) tokens.push(item.eje);
                } else if (typeof item === 'string' && key !== 'articulo_principal' && key !== 'familia_nombre') {
                    tokens.push(item);
                }
            });
        }
    }

    // Normalización: minúsculas y sin acentos
    return tokens
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
};

// Parser de términos de búsqueda con soporte de almohadilla (#) para aislar números
window.parsearTerminosBusquedaBunker = function(queryRaw) {
    if (!queryRaw) return [];
    const normalized = window.normalizarTextoBunker(queryRaw);
    const rawTokens = normalized.split(/\s+/).filter(Boolean);

    const terms = [];
    for (let i = 0; i < rawTokens.length; i++) {
        const t = rawTokens[i];
        // Caso 1: token "#" aislado y el anterior era un número: "1 #"
        if (t === '#' && terms.length > 0) {
            const prev = terms[terms.length - 1];
            if (typeof prev === 'string' && /^\d+([.,]\d+)?$/.test(prev)) {
                const num = terms.pop();
                terms.push({ type: 'isolated_num', value: num, regex: new RegExp(`(?<!\\d)${num.replace('.', '\\.')}(?!\\d)`, 'i') });
                continue;
            }
        }
        // Caso 2: token "#" aislado y el siguiente es un número: "# 1"
        if (t === '#' && i + 1 < rawTokens.length && /^\d+([.,]\d+)?$/.test(rawTokens[i + 1])) {
            const num = rawTokens[i + 1];
            i++;
            terms.push({ type: 'isolated_num', value: num, regex: new RegExp(`(?<!\\d)${num.replace('.', '\\.')}(?!\\d)`, 'i') });
            continue;
        }
        // Caso 3: número pegado con almohadilla: "1#" o "#1"
        const m1 = t.match(/^(\d+([.,]\d+)?)#$/);
        const m2 = t.match(/^#(\d+([.,]\d+)?)$/);
        if (m1) {
            const num = m1[1];
            terms.push({ type: 'isolated_num', value: num, regex: new RegExp(`(?<!\\d)${num.replace('.', '\\.')}(?!\\d)`, 'i') });
        } else if (m2) {
            const num = m2[1];
            terms.push({ type: 'isolated_num', value: num, regex: new RegExp(`(?<!\\d)${num.replace('.', '\\.')}(?!\\d)`, 'i') });
        } else {
            const cleanT = t.replace(/#/g, '').trim();
            if (cleanT) terms.push(cleanT);
        }
    }
    return terms;
};

// Validador de si un artículo cumple con todos los términos de búsqueda (AND acumulativo)
window.articuloCumpleTerminosBunker = function(art, searchTerms) {
    if (!searchTerms || searchTerms.length === 0) return true;
    const textToSearch = window.obtenerTextoBusquedaArticulo(art);
    return searchTerms.every(term => {
        if (typeof term === 'object' && term.type === 'isolated_num') {
            return term.regex.test(textToSearch);
        }
        return textToSearch.includes(term);
    });
};

window.limpiarBuscador = function() {
    const input = document.getElementById('filtro-busqueda');
    if (input) {
        input.value = '';
        localStorage.removeItem('bunker_last_search');
        window.filtrarBunkerEnVivo();
    }
};

window.filtroCapas = [ { id: 1, propiedad: '', exclusions: [] } ]; // Inicializar con capa 1 estática
window.capaCounter = 1;
window.propSortAscending = true;  // Dirección de ordenamiento

window.cargarPreferenciasGridBunker = function() {
    try {
        const inputEl = document.getElementById('filtro-busqueda');
        if (inputEl) {
            const savedSearch = localStorage.getItem('bunker_last_search');
            if (savedSearch !== null) {
                inputEl.value = savedSearch;
            }
        }
        const toggleInactivos = document.getElementById('toggle-filtro-inactivos');
        if (toggleInactivos) {
            const savedState = localStorage.getItem('bunker_ocultar_inactivos');
            if (savedState !== null) {
                toggleInactivos.checked = (savedState === 'true');
            }
        }
        const toggleAgruparFam = document.getElementById('toggle-agrupar-familia');
        if (toggleAgruparFam) {
            const savedAgrupar = localStorage.getItem('bunker_agrupar_familia');
            if (savedAgrupar !== null) {
                toggleAgruparFam.checked = (savedAgrupar === 'true');
            }
        }
        const toggleAgruparCat = document.getElementById('toggle-agrupar-categoria-principal');
        if (toggleAgruparCat) {
            const savedAgruparCat = localStorage.getItem('bunker_agrupar_categoria_principal');
            if (savedAgruparCat !== null) {
                toggleAgruparCat.checked = (savedAgruparCat === 'true');
            }
        }
        if (typeof window.actualizarVisibilidadToggleCategoriaPrincipal === 'function') {
            window.actualizarVisibilidadToggleCategoriaPrincipal();
        }
        const storedFamColapsadas = localStorage.getItem('bunker_familias_colapsadas');
        if (storedFamColapsadas) {
            const parsedArr = JSON.parse(storedFamColapsadas);
            window.familiasColapsadas = new Set(Array.isArray(parsedArr) ? parsedArr : []);
        } else if (!window.familiasColapsadas) {
            window.familiasColapsadas = new Set();
        }
        const storedSubfamColapsadas = localStorage.getItem('bunker_subfamilias_colapsadas');
        if (storedSubfamColapsadas) {
            try {
                const parsedSubArr = JSON.parse(storedSubfamColapsadas);
                window.subfamiliasColapsadas = new Set(
                    Array.isArray(parsedSubArr) ? parsedSubArr.filter(k => typeof k === 'string' && k.includes('___')) : []
                );
            } catch (e) {
                window.subfamiliasColapsadas = new Set();
            }
        }
        if (!window.subfamiliasColapsadas) {
            window.subfamiliasColapsadas = new Set();
        }
    } catch (err) {
        console.error("⚠️ [BUNKER] Error cargando preferencias del grid:", err);
        if (!window.familiasColapsadas) window.familiasColapsadas = new Set();
        if (!window.subfamiliasColapsadas) window.subfamiliasColapsadas = new Set();
    }
};

window.guardarPreferenciaBunkerRemota = function(clave, valor) {
    try {
        if (!clave) return;
        fetch('/api/logistica/bunker/preferencias-ui', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
            body: JSON.stringify({ clave, valor })
        }).catch(() => {});
    } catch (_) {}
};

window.sincronizarPreferenciasBunkerDesdeServidor = async function() {
    const keysToSync = [
        'bunker_grid_preferences',
        'bunker_grid_col_widths',
        'lamda_v4_grid_state',
        'bunker_pdf_columns_config_v2',
        'bunker_cotizador_prefs'
    ];
    try {
        const res = await fetch('/api/logistica/bunker/preferencias-ui');
        if (!res.ok) return;
        const payload = await res.json();
        const remotePrefs = (payload && payload.data && typeof payload.data === 'object') ? payload.data : {};
        const toUpload = {};
        let changedGridCols = false;
        let changedColWidths = false;

        for (const [key, remoteVal] of Object.entries(remotePrefs)) {
            if (key.startsWith('pdf_design_state_') && remoteVal !== undefined && remoteVal !== null) {
                const remoteStr = typeof remoteVal === 'string' ? remoteVal : JSON.stringify(remoteVal);
                if (localStorage.getItem(key) !== remoteStr) {
                    localStorage.setItem(key, remoteStr);
                }
            }
        }

        for (const key of keysToSync) {
            const localRaw = localStorage.getItem(key);
            const remoteVal = remotePrefs[key];

            if (remoteVal !== undefined && remoteVal !== null) {
                const remoteStr = typeof remoteVal === 'string' ? remoteVal : JSON.stringify(remoteVal);
                if (localRaw !== remoteStr) {
                    localStorage.setItem(key, remoteStr);
                    if (key === 'bunker_grid_preferences') changedGridCols = true;
                    if (key === 'bunker_grid_col_widths') changedColWidths = true;
                }
            } else if (localRaw !== null) {
                try {
                    toUpload[key] = JSON.parse(localRaw);
                } catch (_) {
                    toUpload[key] = localRaw;
                }
            }
        }

        if (Object.keys(toUpload).length > 0) {
            fetch('/api/logistica/bunker/preferencias-ui', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true,
                body: JSON.stringify({ preferencias: toUpload })
            }).catch(() => {});
        }

        if (changedGridCols) {
            initColumnToggler();
        }
        if (changedColWidths) {
            aplicarAnchosColumnasGuardados('tabla-bunker');
        }
    } catch (err) {
        console.warn('⚠️ [BUNKER] No se pudieron sincronizar preferencias UI remotas:', err);
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    window.cargarPreferenciasGridBunker();
    const inputEl = document.getElementById('filtro-busqueda');
    if (inputEl) {
        inputEl.addEventListener('input', window.filtrarBunkerEnVivo);
        inputEl.addEventListener('keyup', (e) => {
            if (e.key === 'Escape') window.limpiarBuscador();
        });
    }
    initColumnToggler();
    await window.sincronizarPreferenciasBunkerDesdeServidor();
    await cargarListasPreciosFiltro();
    await cargarDataGrid();
    await cargarDesplegableClientesAutoseleccion();
    initScannerExpressListener();
    initTableResizableColumns('tabla-bunker');
    await cargarColaboradoresAsistente();
});

window.clienteAutoseleccionadoActual = null;
window.bunkerClientesAutoseleccionCache = [];
let highlightedComboboxIndex = -1;

async function cargarDesplegableClientesAutoseleccion() {
    try {
        const input = document.getElementById('input-buscar-cliente-autoseleccion');
        const dropdown = document.getElementById('dropdown-clientes-autoseleccion');
        const container = document.getElementById('container-combobox-cliente');
        if (!input || !dropdown) return;

        const res = await fetch('/api/logistica/bunker/clientes');
        if (!res.ok) return;

        const result = await res.json();
        const clientes = (result && Array.isArray(result.data)) ? result.data : (Array.isArray(result) ? result : []);
        window.bunkerClientesAutoseleccionCache = clientes;

        // Listener de tipeo en el input (filtrado en RAM en tiempo real)
        input.addEventListener('input', (e) => {
            highlightedComboboxIndex = -1;
            window.filtrarDesplegableClientes(e.target.value);
        });

        // Listener de foco en el input (abre dropdown con lista completa o filtrada)
        input.addEventListener('focus', () => {
            highlightedComboboxIndex = -1;
            window.filtrarDesplegableClientes(input.value);
        });

        // Listener de teclado para navegación accesible (flechas, Enter, Escape)
        input.addEventListener('keydown', (e) => {
            const items = dropdown.querySelectorAll('.cliente-autoseleccion-item');
            if (dropdown.style.display !== 'block' || items.length === 0) {
                if (e.key === 'ArrowDown') {
                    window.filtrarDesplegableClientes(input.value);
                }
                return;
            }

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                highlightedComboboxIndex = (highlightedComboboxIndex + 1) % items.length;
                actualizarHighlightCombobox(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                highlightedComboboxIndex = (highlightedComboboxIndex - 1 + items.length) % items.length;
                actualizarHighlightCombobox(items);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (highlightedComboboxIndex >= 0 && highlightedComboboxIndex < items.length) {
                    items[highlightedComboboxIndex].click();
                } else if (items.length > 0) {
                    items[0].click();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                dropdown.style.display = 'none';
            }
        });

        // Auto-resolver si el operador escribió un código o texto pero no clickeó explícitamente en el dropdown
        const autoResolverClienteInput = () => {
            const selectHidden = document.getElementById('select-cliente-autoseleccion');
            const val = (input.value || '').trim();
            if (val && (!selectHidden || !selectHidden.value)) {
                const clientes = window.bunkerClientesAutoseleccionCache || [];
                const valNum = val.replace(/\D/g, '');
                const valNumInt = valNum ? parseInt(valNum, 10) : null;
                
                // Prioridad 1: Match por ID Legacy numérico (ej: "055", "55", "0055")
                let matchExacto = clientes.find(c => {
                    const lomas = String(c.lomas_soft_id || '').trim();
                    const lomasInt = lomas ? parseInt(lomas, 10) : null;
                    return lomas === val || lomas === val.padStart(4, '0') || (valNumInt !== null && lomasInt !== null && valNumInt === lomasInt);
                });

                // Prioridad 2: Match por Código Búnker (ej: "CB-0011", "11")
                if (!matchExacto) {
                    matchExacto = clientes.find(c => {
                        const cb = String(c.codigo_bunker_cliente || '').toLowerCase().trim();
                        return cb === val.toLowerCase() || cb === `cb-${val.toLowerCase()}` || cb === `cb-${val.padStart(4, '0')}`;
                    });
                }

                // Prioridad 3: Única coincidencia por nombre / razón social
                if (!matchExacto) {
                    const terminos = val.toLowerCase().split(/\s+/).filter(Boolean);
                    const filtrados = clientes.filter(c => {
                        const searchBag = [c.cliente_nombre, c.razon_social].filter(Boolean).join(' ').toLowerCase();
                        return terminos.every(t => searchBag.includes(t));
                    });
                    if (filtrados.length === 1) matchExacto = filtrados[0];
                }

                if (matchExacto) {
                    window.seleccionarClienteCombobox(matchExacto.id);
                }
            }
        };

        input.addEventListener('blur', () => {
            setTimeout(autoResolverClienteInput, 200);
        });

        // Cerrar al hacer clic fuera del componente y auto-resolver si corresponde
        document.addEventListener('click', (e) => {
            if (container && !container.contains(e.target)) {
                dropdown.style.display = 'none';
                autoResolverClienteInput();
            }
        });

    } catch (e) {
        console.error('Error cargando clientes para auto-selección:', e);
    }
}

function actualizarHighlightCombobox(items) {
    items.forEach((item, idx) => {
        if (idx === highlightedComboboxIndex) {
            item.style.backgroundColor = '#e0f2fe';
            item.setAttribute('data-highlighted', 'true');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.style.backgroundColor = '';
            item.removeAttribute('data-highlighted');
        }
    });
}

/**
 * Filtrador Predictivo Multi-Token (Política Universal de Búsqueda LAMDA - Fase 49)
 */
window.filtrarDesplegableClientes = function(query) {
    const dropdown = document.getElementById('dropdown-clientes-autoseleccion');
    if (!dropdown) return;

    const rawQuery = (query || '').trim();
    const queryLower = rawQuery.toLowerCase();
    const qNum = rawQuery.replace(/\D/g, '');
    const qNumInt = qNum ? parseInt(qNum, 10) : null;
    const terminos = queryLower.split(/\s+/).filter(Boolean);
    const clientes = window.bunkerClientesAutoseleccionCache || [];

    if (terminos.length === 0) {
        dropdown.style.display = 'none';
        return;
    }

    const filtradosConScore = [];

    clientes.forEach(c => {
        let score = 0;
        const lomasId = String(c.lomas_soft_id || '').trim();
        const lomasNum = lomasId.replace(/\D/g, '');
        const lomasInt = lomasNum ? parseInt(lomasNum, 10) : null;
        const codBunker = String(c.codigo_bunker_cliente || '').toLowerCase().trim();
        const codBunkerNum = codBunker.replace(/\D/g, '');
        const codBunkerNumInt = codBunkerNum ? parseInt(codBunkerNum, 10) : null;
        const razon = String(c.razon_social || '').toLowerCase();
        const fantasia = String(c.cliente_nombre || '').toLowerCase();
        const contacto = String(c.email_portal_nombre || '').toLowerCase();
        const cuit = String(c.cuit_cuil || '').replace(/\D/g, '');

        let isLegacyMatch = false;

        // 1. COINCIDENCIA POR ID LEGACY (Lomas Soft ID) -> MÁXIMA PRIORIDAD
        if (qNum) {
            if (lomasId === rawQuery || lomasId === rawQuery.padStart(4, '0') || (lomasInt !== null && qNumInt !== null && lomasInt === qNumInt)) {
                score += 10000;
                isLegacyMatch = true;
            } else if (lomasId.startsWith(rawQuery) || (lomasNum && lomasNum.startsWith(qNum))) {
                score += 4500;
                isLegacyMatch = true;
            } else if (lomasId.includes(rawQuery)) {
                score += 2000;
            }

            // Coincidencia por Código Búnker (ej: "CB-0055" o "55")
            if (codBunker === queryLower || codBunker === `cb-${queryLower}` || codBunker === `cb-${qNum.padStart(4, '0')}` || (codBunkerNumInt !== null && qNumInt !== null && codBunkerNumInt === qNumInt)) {
                score += 8000;
            } else if (codBunker.startsWith(queryLower) || codBunker.includes(queryLower)) {
                score += 3000;
            }

            // Coincidencia por CUIT
            if (cuit === qNum) {
                score += 5000;
            } else if (cuit.startsWith(qNum)) {
                score += 1500;
            } else if (qNum.length >= 4 && cuit.includes(qNum)) {
                score += 200;
            }
        }

        // 2. COINCIDENCIA POR TEXTO (Razón Social, Nombre de Fantasía, Contacto)
        if (razon === queryLower || fantasia === queryLower) {
            score += 6000;
        } else if (razon.startsWith(queryLower) || fantasia.startsWith(queryLower)) {
            score += 3500;
        } else if (razon.includes(queryLower) || fantasia.includes(queryLower)) {
            score += 1500;
        } else if (terminos.every(t => `${razon} ${fantasia} ${contacto}`.includes(t))) {
            score += 800;
        }

        // Búsqueda de teléfono SOLO si el usuario ingresó al menos 6 dígitos numéricos
        if (qNum.length >= 6) {
            const rawWp = String(c.whatsapp_facturas || '');
            if (rawWp.replace(/\D/g, '').includes(qNum)) {
                score += 500;
            }
        }

        if (score > 0) {
            filtradosConScore.push({ cliente: c, score, isLegacyMatch });
        }
    });

    if (filtradosConScore.length === 0) {
        dropdown.innerHTML = `
            <div style="padding: 12px; font-size: 0.82em; color: #64748b; text-align: center;">
                🔍 No se encontraron clientes que coincidan con <b>"${query}"</b>
            </div>
        `;
        dropdown.style.display = 'block';
        return;
    }

    // Ordenar de mayor a menor relevancia
    filtradosConScore.sort((a, b) => b.score - a.score);

    dropdown.innerHTML = filtradosConScore.map(({ cliente: c, isLegacyMatch }) => {
        const razonSocial = c.razon_social || c.cliente_nombre || `Cliente #${c.id}`;
        const nombreFantasia = c.cliente_nombre && c.cliente_nombre !== c.razon_social ? c.cliente_nombre : null;
        const codBunker = c.codigo_bunker_cliente || null;
        const codLegacy = c.lomas_soft_id || null;
        const contacto = c.email_portal_nombre || null;
        const cuit = c.cuit_cuil || null;

        return `
            <div class="cliente-autoseleccion-item" data-id="${c.id}" onclick="window.seleccionarClienteCombobox(${c.id})" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f1f5f9; transition: background 0.15s ease;" onmouseenter="this.style.backgroundColor='#f0f9ff'" onmouseleave="if(this.getAttribute('data-highlighted') !== 'true') this.style.backgroundColor=''">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                    <span style="font-weight: 700; color: #0f172a; font-size: 0.88em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
                        ${razonSocial}
                    </span>
                    <div style="display: flex; gap: 5px; align-items: center; flex-shrink: 0;">
                        ${codBunker ? `<span style="background: #e0e7ff; color: #3730a3; font-size: 0.73em; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${codBunker}</span>` : ''}
                        ${codLegacy ? `<span style="background: ${isLegacyMatch ? '#fef3c7' : '#f1f5f9'}; color: ${isLegacyMatch ? '#92400e' : '#334155'}; border: 1px solid ${isLegacyMatch ? '#f59e0b' : '#cbd5e1'}; font-size: 0.73em; font-weight: 800; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${isLegacyMatch ? '⭐ ' : ''}ID: ${codLegacy}</span>` : ''}
                    </div>
                </div>
                <div style="font-size: 0.76em; color: #64748b; margin-top: 3px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                    ${nombreFantasia ? `<span>👤 <strong>${nombreFantasia}</strong></span>` : ''}
                    ${codLegacy ? `<span style="color: #475569; font-weight: 600;">🏷️ Legacy Lomas: <strong>${codLegacy}</strong>${!isNaN(parseInt(codLegacy, 10)) && parseInt(codLegacy, 10).toString() !== codLegacy ? ` (#${parseInt(codLegacy, 10)})` : ''}</span>` : ''}
                    ${contacto ? `<span>🤝 Contacto: ${contacto}</span>` : ''}
                    ${cuit ? `<span>🆔 CUIT: ${cuit}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');

    dropdown.style.display = 'block';
};

window.seleccionarClienteCombobox = function(clienteId) {
    const input = document.getElementById('input-buscar-cliente-autoseleccion');
    const selectHidden = document.getElementById('select-cliente-autoseleccion');
    const btnLimpiar = document.getElementById('btn-limpiar-cliente-autoseleccion');
    const dropdown = document.getElementById('dropdown-clientes-autoseleccion');

    const clientes = window.bunkerClientesAutoseleccionCache || [];
    const cliente = clientes.find(c => Number(c.id) === Number(clienteId));

    if (cliente) {
        window.clienteAutoseleccionadoActual = cliente;
    }

    if (cliente && input) {
        const nom = cliente.razon_social || cliente.cliente_nombre || `Cliente #${cliente.id}`;
        const ref = cliente.codigo_bunker_cliente ? ` [${cliente.codigo_bunker_cliente}]` : (cliente.lomas_soft_id ? ` [ID: ${cliente.lomas_soft_id}]` : '');
        input.value = `${nom}${ref}`;
    }

    if (selectHidden) selectHidden.value = clienteId;
    if (btnLimpiar) btnLimpiar.style.display = 'inline-block';
    if (dropdown) dropdown.style.display = 'none';

    window.cargarESeleccionarArticulosCliente(clienteId);
};

window.limpiarClienteCombobox = function() {
    const input = document.getElementById('input-buscar-cliente-autoseleccion');
    const selectHidden = document.getElementById('select-cliente-autoseleccion');
    const btnLimpiar = document.getElementById('btn-limpiar-cliente-autoseleccion');
    const btnToggleHistorial = document.getElementById('btn-toggle-historial-cliente');
    const dropdown = document.getElementById('dropdown-clientes-autoseleccion');

    if (input) input.value = '';
    if (selectHidden) selectHidden.value = '';
    if (btnLimpiar) btnLimpiar.style.display = 'none';
    if (btnToggleHistorial) {
        btnToggleHistorial.style.display = 'none';
        btnToggleHistorial.setAttribute('data-estado', 'liberar');
    }
    if (dropdown) dropdown.style.display = 'none';

    window.articulosHistoricosClienteActual = null;
    window.cargarESeleccionarArticulosCliente('');
};

window.cargarESeleccionarArticulosCliente = async function(clienteIdStr) {
    if (!clienteIdStr) {
        window.clienteAutoseleccionadoActual = null;
        window.articulosSeleccionadosMasa.clear();
        window.actualizarEstadoBotonMasivo();
        const inputs = document.querySelectorAll('.chk-articulo-masa');
        inputs.forEach(input => { input.checked = false; });
        return;
    }

    const clienteId = parseInt(clienteIdStr, 10);
    if (isNaN(clienteId) || clienteId <= 0) return;

    Swal.fire({
        title: 'Consultando Historial B2B...',
        text: 'Obteniendo artículos comprados y facturados al cliente...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    const startTime = performance.now();

    try {
        const res = await fetch(`/api/logistica/bunker/clientes/${clienteId}/articulos-comprados`);
        const result = await res.json();

        const durationMs = Math.round(performance.now() - startTime);

        if (!res.ok || !result.success) {
            throw new Error(result.error || 'Error al obtener historial de compras del cliente');
        }

        const articulosComprados = result.data || [];
        const clientePrev = window.clienteAutoseleccionadoActual || (window.bunkerClientesAutoseleccionCache || []).find(c => Number(c.id) === Number(clienteId));
        window.clienteAutoseleccionadoActual = {
            ...(clientePrev || {}),
            ...(result.cliente || {})
        };

        if (articulosComprados.length === 0) {
            console.group(`🛒 [VIGÍA DEPURADOR F12 - HISTORIAL CLIENTE] Cliente ID=${clienteId}`);
            console.log('📌 Cliente:', result.cliente);
            console.log('📊 Artículos Comprados Backend:', 0);
            console.log('⏱️ Tiempo de Respuesta API:', `${durationMs} ms`);
            console.groupEnd();

            Swal.fire({
                title: 'Sin Historial Registrado',
                text: `El cliente "${result.cliente.razon_social}" no posee artículos facturados o cotizados previamente.`,
                icon: 'info'
            });
            return;
        }

        // Limpiar selección actual
        window.articulosSeleccionadosMasa.clear();

        // Obtener la colección completa de artículos Búnker disponibles en RAM
        const todosBunker = (typeof articulosBunkerGlobal !== 'undefined' && Array.isArray(articulosBunkerGlobal) && articulosBunkerGlobal.length > 0)
            ? articulosBunkerGlobal
            : (window.articulosVisiblesActualmente || []);

        let marcadosCount = 0;
        const coincidenciaDetalle = [];

        articulosComprados.forEach(ac => {
            const acIdStr = String(ac.articulo_id).trim().toLowerCase();
            const acDescStr = String(ac.descripcion || '').trim().toLowerCase();

            // Buscar coincidencia relacional estricta por ID único de artículo
            const match = todosBunker.find(a => String(a.articulo_id).trim().toLowerCase() === acIdStr);

            if (match) {
                window.articulosSeleccionadosMasa.add(match.articulo_id);
                marcadosCount++;
                coincidenciaDetalle.push({
                    articulo_id: match.articulo_id,
                    descripcion: match.nomenclatura || match.descripcion,
                    frecuencia: ac.frecuencia_compra,
                    ultima_compra: ac.ultima_compra
                });
            }
        });

        // Guardar conjunto histórico del cliente actual para alternar (liberar / restaurar)
        window.articulosHistoricosClienteActual = new Set(coincidenciaDetalle.map(x => x.articulo_id));

        const btnToggleHistorial = document.getElementById('btn-toggle-historial-cliente');
        if (btnToggleHistorial) {
            btnToggleHistorial.innerHTML = `🧹 Liberar (${marcadosCount})`;
            btnToggleHistorial.style.display = 'inline-flex';
            btnToggleHistorial.setAttribute('data-estado', 'liberar');
            btnToggleHistorial.style.background = '#ffffff';
            btnToggleHistorial.style.color = '#0284c7';
            btnToggleHistorial.style.borderColor = '#93c5fd';
            btnToggleHistorial.title = `Deseleccionar los ${marcadosCount} artículos habituales de este cliente sin quitar el cliente`;
        }

        // 1. Refrescar casillas de verificación individuales del DOM
        const inputs = document.querySelectorAll('.chk-articulo-masa');
        inputs.forEach(input => {
            const id = input.getAttribute('data-articulo-id');
            input.checked = window.articulosSeleccionadosMasa.has(id);
        });

        // 2. Refrescar estado de botones masivos superiores (Márgenes, Catálogo, Enviar Precios)
        window.actualizarEstadoBotonMasivo();

        // 3. Refrescar capas y grilla visible si aplica
        if (typeof window.actualizarCheckboxesTodasLasCapas === 'function') {
            window.actualizarCheckboxesTodasLasCapas();
        }
        if (window.articulosVisiblesActualmente && window.articulosVisiblesActualmente.length > 0) {
            renderizarGrid(window.articulosVisiblesActualmente);
        }

        // 4. Vigía Depurador F12 Rico
        console.group(`🛒 [VIGÍA DEPURADOR F12 - HISTORIAL CLIENTE] Cliente ID=${clienteId}`);
        console.log('📌 Cliente Seleccionado:', result.cliente);
        console.log('⏱️ Tiempo de Respuesta Backend:', `${durationMs} ms`);
        console.log('📊 Artículos Históricos en BD:', articulosComprados.length, articulosComprados);
        console.log('📊 Artículos Búnker Evaluados en RAM:', todosBunker.length);
        console.log(`✅ Coincidencias Auto-seleccionadas: ${marcadosCount} de ${articulosComprados.length}`, coincidenciaDetalle);
        console.log('📋 IDs en Set articulosSeleccionadosMasa:', Array.from(window.articulosSeleccionadosMasa));
        console.groupEnd();

        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: `👤 ${result.cliente.razon_social}`,
            text: `Se auto-seleccionaron ${marcadosCount} artículos del historial de compras (${durationMs}ms).`,
            showConfirmButton: false,
            timer: 3500
        });

    } catch (e) {
        console.error('❌ [VIGÍA DEPURADOR F12] Error al auto-seleccionar artículos de cliente:', e);
        Swal.fire({
            title: 'Error de Consulta',
            text: e.message || 'No se pudo obtener el historial de compras.',
            icon: 'error'
        });
    }
};

window.toggleHistorialClienteSeleccion = function() {
    const btn = document.getElementById('btn-toggle-historial-cliente');
    if (!btn || !window.articulosHistoricosClienteActual || window.articulosHistoricosClienteActual.size === 0) return;

    const estado = btn.getAttribute('data-estado') || 'liberar';

    if (estado === 'liberar') {
        window.articulosHistoricosClienteActual.forEach(id => {
            window.articulosSeleccionadosMasa.delete(id);
        });

        const inputs = document.querySelectorAll('.chk-articulo-masa');
        inputs.forEach(input => {
            const id = input.getAttribute('data-articulo-id');
            input.checked = window.articulosSeleccionadosMasa.has(id);
        });

        btn.innerHTML = `🔄 Restaurar (${window.articulosHistoricosClienteActual.size})`;
        btn.setAttribute('data-estado', 'restaurar');
        btn.style.background = '#f0fdf4';
        btn.style.color = '#15803d';
        btn.style.borderColor = '#86efac';
        btn.title = `Volver a marcar los ${window.articulosHistoricosClienteActual.size} artículos habituales de este cliente`;

        window.actualizarEstadoBotonMasivo();

        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'info',
            title: 'Selección Liberada',
            text: `Se liberaron los artículos habituales. El cliente sigue seleccionado para tu cotización manual.`,
            showConfirmButton: false,
            timer: 2500
        });
    } else {
        window.articulosHistoricosClienteActual.forEach(id => {
            window.articulosSeleccionadosMasa.add(id);
        });

        const inputs = document.querySelectorAll('.chk-articulo-masa');
        inputs.forEach(input => {
            const id = input.getAttribute('data-articulo-id');
            input.checked = window.articulosSeleccionadosMasa.has(id);
        });

        btn.innerHTML = `🧹 Liberar (${window.articulosHistoricosClienteActual.size})`;
        btn.setAttribute('data-estado', 'liberar');
        btn.style.background = '#ffffff';
        btn.style.color = '#0284c7';
        btn.style.borderColor = '#93c5fd';
        btn.title = `Deseleccionar los ${window.articulosHistoricosClienteActual.size} artículos habituales sin quitar el cliente`;

        window.actualizarEstadoBotonMasivo();

        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: 'Historial Restaurado',
            text: `Se volvieron a seleccionar los ${window.articulosHistoricosClienteActual.size} artículos habituales.`,
            showConfirmButton: false,
            timer: 2500
        });
    }
};


// Click outside to close column settings dropdown
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('col-toggler-dropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
    }
    const insumoResults = document.getElementById('gp-insumo-resultados');
    if (insumoResults && !insumoResults.contains(e.target) && e.target.id !== 'gp-buscar-insumo') {
        insumoResults.style.display = 'none';
    }
});

async function cargarListasPreciosFiltro() {
    try {
        const res = await fetch('/api/logistica/bunker/listas');
        const result = await res.json();
        const select = document.getElementById('filtro-lista-precios');
        
        if (res.ok && result.success && result.data.length > 0) {
            select.innerHTML = '';
            result.data.forEach(lista => {
                const opt = document.createElement('option');
                opt.value = lista.id;
                opt.textContent = lista.nombre;
                select.appendChild(opt);
            });

            // 🔑 PERSISTENCIA EN LOCALSTORAGE Y VIGÍA DEPURADOR F12
            const savedListaId = localStorage.getItem('bunker_lista_seleccionada_id');
            if (savedListaId && result.data.some(l => Number(l.id) === Number(savedListaId))) {
                select.value = savedListaId;
                console.log(`🚨 [VIGÍA DEPURADOR - AUDITORÍA F12] Lista de Precios activa restaurada desde localStorage: ID=${savedListaId}`);
            } else {
                console.log(`🚨 [VIGÍA DEPURADOR - AUDITORÍA F12] Lista de Precios inicializada por defecto: ID=${select.value}`);
            }

            listaSeleccionadaGlobal = parseInt(select.value) || 1;
            
            // Inicializar gp_listasFinancieras con datos base para permitir previsualizar/imprimir directamente
            gp_listasFinancieras = result.data.map(lista => ({
                lista_id: lista.id,
                nombre_lista: lista.nombre
            }));
            window.listasCatalogoMaestras = result.data.map(lista => ({
                lista_id: Number(lista.id),
                nombre_lista: lista.nombre
            }));
            gp_activeTabIdx = 0;
        } else {
            select.innerHTML = '<option value="1">L1 Base</option>';
        }
    } catch(e) {
        console.error('Error cargando listas:', e);
    }
}

window.cambiarListaPreciosDataGrid = async function(nuevaListaId) {
    listaSeleccionadaGlobal = parseInt(nuevaListaId);
    localStorage.setItem('bunker_lista_seleccionada_id', listaSeleccionadaGlobal);
    console.log(`🚨 [VIGÍA DEPURADOR - AUDITORÍA F12] Preferencia de Lista de Precios guardada en localStorage: ID=${listaSeleccionadaGlobal}`);
    
    // Sincronizar el tab activo del gestor financiero
    if (gp_listasFinancieras && gp_listasFinancieras.length > 0) {
        const idx = gp_listasFinancieras.findIndex(l => Number(l.lista_id) === Number(nuevaListaId));
        if (idx !== -1) {
            gp_activeTabIdx = idx;
        }
    }
    
    await cargarDataGrid();
};

// --- LOGICA DE VISIBILIDAD DE COLUMNAS ---
const BUNKER_COLUMNS = [
    { id: 0, name: 'ID Pivote', defaultVisible: true },
    { id: 1, name: 'Art. Principal / Rubro', defaultVisible: true },
    { id: 2, name: 'Nomenclatura (Prod)', defaultVisible: true },
    { id: 3, name: 'Propiedades (Intel)', defaultVisible: true },
    { id: 4, name: '% IVA', defaultVisible: false },
    { id: 5, name: 'Costo s/IVA', defaultVisible: false },
    { id: 6, name: 'IIBB (4%)', defaultVisible: false },
    { id: 7, name: 'Ganancia Neta', defaultVisible: false },
    { id: 8, name: 'Precio Final c/IVA', defaultVisible: true },
    { id: 9, name: 'Precio x Kg (c/IVA)', defaultVisible: true },
    { id: 10, name: 'Margen Base', defaultVisible: true },
    { id: 11, name: 'Total Entrante (Un)', defaultVisible: true },
    { id: 12, name: 'Total Entrante (Kg)', defaultVisible: true },
    { id: 13, name: 'Stock Disponible (Neto)', defaultVisible: true },
    { id: 14, name: 'Catálogo', defaultVisible: true }
];

let bunkerGridPreferences = {};

function initColumnToggler() {
    const saved = localStorage.getItem('bunker_grid_preferences');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object') {
                bunkerGridPreferences = parsed;
            }
        } catch(e) {}
    }

    const container = document.getElementById('col-toggler-list');
    if (!container) return;
    container.innerHTML = '';

    BUNKER_COLUMNS.forEach(col => {
        const storedVal = bunkerGridPreferences[col.id] !== undefined
            ? bunkerGridPreferences[col.id]
            : bunkerGridPreferences[String(col.id)];
        if (storedVal === undefined) {
            bunkerGridPreferences[col.id] = col.defaultVisible;
        } else {
            bunkerGridPreferences[col.id] = Boolean(storedVal);
        }

        const isVisible = bunkerGridPreferences[col.id];
        aplicarVisibilidadColumna(col.id, isVisible);

        const label = document.createElement('label');
        label.className = 'settings-dropdown-label';
        label.innerHTML = `
            <input type="checkbox" value="${col.id}" ${isVisible ? 'checked' : ''} onchange="toggleBunkerColumn(${col.id}, this.checked)">
            ${col.name}
        `;
        container.appendChild(label);
    });
}

window.toggleBunkerColumn = function(colId, isVisible) {
    bunkerGridPreferences[colId] = Boolean(isVisible);
    localStorage.setItem('bunker_grid_preferences', JSON.stringify(bunkerGridPreferences));
    if (typeof window.guardarPreferenciaBunkerRemota === 'function') {
        window.guardarPreferenciaBunkerRemota('bunker_grid_preferences', bunkerGridPreferences);
    }
    aplicarVisibilidadColumna(colId, Boolean(isVisible));
};

function aplicarVisibilidadColumna(colId, isVisible) {
    const table = document.getElementById('tabla-bunker');
    if (!table) return;
    const hideClass = `hide-col-${colId}`;
    if (isVisible) {
        table.classList.remove(hideClass);
    } else {
        table.classList.add(hideClass);
    }
}
// ------------------------------------------

window.articulosLegacyConStockGlobal = window.articulosLegacyConStockGlobal || [];

async function cargarDataGrid() {
    window.articulosSeleccionadosMasa.clear();
    const tbody = document.getElementById('tbody-bunker');
    tbody.innerHTML = '<tr><td colspan="17" style="text-align: center; padding: 20px;">Cargando Búnker...</td></tr>';
    
    try {
        const params = new URLSearchParams();
        if (listaSeleccionadaGlobal) params.append('lista_id', listaSeleccionadaGlobal);
        
        const [res, resLegacy] = await Promise.all([
            fetch(`/api/logistica/bunker/listado?${params.toString()}`),
            fetch(`/api/logistica/bunker/legacy-con-stock-pendientes`).catch(() => null)
        ]);
        const result = await res.json();
        if (resLegacy && resLegacy.ok) {
            const legacyJson = await resLegacy.json().catch(() => null);
            if (legacyJson && legacyJson.success && Array.isArray(legacyJson.data)) {
                window.articulosLegacyConStockGlobal = legacyJson.data;
            }
        }
        
        if (res.ok && result.success) {
            articulosBunkerGlobal = result.data;
            window.actualizarCheckboxesTodasLasCapas();
            window.aplicarFiltrosYOrdenamiento();
        } else {
            throw new Error(result.error);
        }
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="17" style="color: red; text-align: center;">Error de conexión: ${e.message}</td></tr>`;
    }
}

window.familiasColapsadas = window.familiasColapsadas || new Set();
window.subfamiliasColapsadas = window.subfamiliasColapsadas || new Set();

function obtenerFamiliaId(art) {
    if (art && art.familia_id !== undefined && art.familia_id !== null && !isNaN(Number(art.familia_id))) {
        return Number(art.familia_id);
    }
    return 0;
}

// =========================================================================
// CLASIFICACIÓN UNIVERSAL DE LÍNEAS DE NEGOCIO (LDN 1 A 6) - TALLER LAMDA
// =========================================================================
window.determinarLineaDeNegocio = function(art) {
    if (!art) {
        return { id: 1, tag: 'LDN 1', nombre: 'LDN 1: Bulto Cerrado (Directo)', color: '#334155', bgColor: '#f1f5f9', borderColor: '#cbd5e1', esComercial: false };
    }
    const code = String(art.articulo_id || art.sku_proveedor || '').trim().toLowerCase();
    const desc = String(art.descripcion_generada || art.descripcion || '').trim().toLowerCase();
    const props = (typeof art.propiedades_dinamicas === 'object' && art.propiedades_dinamicas !== null) ? art.propiedades_dinamicas : {};
    const tieneReceta = !!(art.receta_id || (art.total_recetas && parseInt(art.total_recetas) > 0) || (Array.isArray(art.receta_ingredientes) && art.receta_ingredientes.length > 0));
    const tienePackHijo = !!(art.pack_hijo_codigo && String(art.pack_hijo_codigo).trim() !== '');
    const noProducido = art.no_producido_por_lambda === true || art.no_producido_por_lambda === 'true';
    const kilosUnidad = parseFloat(art.kilos_unidad || 0);

    // Identificar artículos internos de transición (Artículos Puente AP/UP) o envases vacíos (0 kg)
    const esWipPuente = code.startsWith('prod ap') || code.startsWith('prod up') || desc.startsWith('articulo puente') || desc.startsWith('prod ap') || desc.startsWith('prod up') || !!props.presentacion_variable_wip;
    const esInsumoEnvase = !esWipPuente && kilosUnidad <= 0 && (/^(bolsa|caja|envase|etiqueta|film)\b/i.test(desc) || /^b\d+x\d+/i.test(code) || code.startsWith('bpku'));
    const esBaja = art._estado_delta === 'BAJA' || art.estado === 'BAJA';
    const esComercial = !esWipPuente && !esInsumoEnvase && !esBaja;

    // LDN 5: Barritas UP Externa
    if (code.startsWith('bf') || code.includes('bfx') || desc.includes('barrita') || desc.includes('barr.')) {
        return { id: 5, tag: 'LDN 5', nombre: 'LDN 5: Barritas (Bi-fásica UP)', color: '#9f1239', bgColor: '#fff1f2', borderColor: '#fecdd3', esComercial };
    }
    // LDN 6: Granolas Doble Mezcla
    if (code.startsWith('gr') || desc.includes('granola') || desc.includes('grana')) {
        return { id: 6, tag: 'LDN 6', nombre: 'LDN 6: Granolas (Doble Mezcla)', color: '#0369a1', bgColor: '#f0f9ff', borderColor: '#bae6fd', esComercial };
    }
    // LDN 4: UP Tostadero Simple (requiere ser artículo puente UP o producto elaborado con receta/pack hijo; las cajas cerradas compradas ya tostadas sin receta son LDN 1)
    if (code.startsWith('prod up') || props.presentacion_variable_wip || ((tieneReceta || tienePackHijo) && (code.includes('tostad') || desc.includes('tostad')))) {
        return { id: 4, tag: 'LDN 4', nombre: 'LDN 4: UP Tostadero', color: '#92400e', bgColor: '#fffbeb', borderColor: '#fde68a', esComercial };
    }
    // LDN 3: Mixes / Carros Granel (evitando falso positivo de code.startsWith('m') con Maíz, Maní o Miel en bulto cerrado)
    const esCodigoMix = /^m(fs|sx|ct)/i.test(code) || desc.includes('mix') || code.startsWith('prod ap');
    const tieneMultiplesIngredientes = Array.isArray(art.receta_ingredientes) && art.receta_ingredientes.filter(i => !/bolsa|caja|pack/i.test(i.nombre_ingrediente || '')).length > 1;
    if (esCodigoMix || tieneMultiplesIngredientes) {
        return { id: 3, tag: 'LDN 3', nombre: 'LDN 3: Mixes (Carro Granel)', color: '#5b21b6', bgColor: '#f5f3ff', borderColor: '#c4b5fd', esComercial };
    }
    // LDN 2: Fraccionado Mono-Ingrediente 100% Puro
    if ((tieneReceta || tienePackHijo) && !noProducido) {
        return { id: 2, tag: 'LDN 2', nombre: 'LDN 2: Fraccionado Mono-Ingrediente', color: '#15803d', bgColor: '#f0fdf4', borderColor: '#86efac', esComercial };
    }
    // LDN 1: Bulto Cerrado Directo (Default)
    return { id: 1, tag: 'LDN 1', nombre: 'LDN 1: Bulto Cerrado (Directo)', color: '#334155', bgColor: '#f1f5f9', borderColor: '#cbd5e1', esComercial };
};

function obtenerFamiliaNombre(art) {
    if (art && art.familia_nombre && String(art.familia_nombre).trim()) {
        return String(art.familia_nombre).trim();
    }
    if (art && art.rubro && String(art.rubro).trim()) {
        return String(art.rubro).trim();
    }
    return 'Sin Familia';
}

function obtenerCategoriaPrincipalId(art) {
    if (art && art.articulo_principal_id !== undefined && art.articulo_principal_id !== null && !isNaN(Number(art.articulo_principal_id))) {
        return Number(art.articulo_principal_id);
    }
    return 0;
}

function obtenerCategoriaPrincipalNombre(art) {
    if (art && art.articulo_principal_nombre && String(art.articulo_principal_nombre).trim()) {
        return String(art.articulo_principal_nombre).trim();
    }
    if (art && art.propiedades_dinamicas && typeof art.propiedades_dinamicas === 'object') {
        const pd = art.propiedades_dinamicas;
        if (pd.articulo_principal) {
            const rawVal = pd.articulo_principal;
            const valStr = (rawVal && typeof rawVal === 'object') ? rawVal.valor : rawVal;
            if (valStr && String(valStr).trim()) {
                return String(valStr).trim();
            }
        }
    }
    if (art && art.sub_rubro && String(art.sub_rubro).trim()) {
        return String(art.sub_rubro).trim();
    }
    return 'Sin Atributo Principal';
}

window.actualizarVisibilidadToggleCategoriaPrincipal = function() {
    const toggleFam = document.getElementById('toggle-agrupar-familia');
    const containerCat = document.getElementById('container-agrupar-categoria-principal');
    if (containerCat) {
        if (toggleFam && toggleFam.checked) {
            containerCat.style.display = 'flex';
        } else {
            containerCat.style.display = 'none';
        }
    }
};

window.toggleAgruparPorFamilia = function() {
    const toggle = document.getElementById('toggle-agrupar-familia');
    if (toggle) {
        localStorage.setItem('bunker_agrupar_familia', toggle.checked ? 'true' : 'false');
    }
    window.actualizarVisibilidadToggleCategoriaPrincipal();
    window.aplicarFiltrosYOrdenamiento();
};

window.toggleAgruparPorCategoriaPrincipal = function() {
    const toggle = document.getElementById('toggle-agrupar-categoria-principal');
    if (toggle) {
        localStorage.setItem('bunker_agrupar_categoria_principal', toggle.checked ? 'true' : 'false');
    }
    window.aplicarFiltrosYOrdenamiento();
};

window.actualizarVisibilidadAcordeonesInPlace = function() {
    const tbody = document.getElementById('tbody-bunker');
    if (!tbody) return;

    const agruparFamilia = document.getElementById('toggle-agrupar-familia')?.checked;
    const agruparCatPrincipal = agruparFamilia && document.getElementById('toggle-agrupar-categoria-principal')?.checked;

    console.group('👁️ [VIGÍA BUNKER] Visibilidad de Acordeones In-Place');
    console.log('🔹 Agrupar Familia:', agruparFamilia);
    console.log('🔹 Agrupar Cat. Principal:', agruparCatPrincipal);
    console.log('📦 Familias colapsadas en Set:', Array.from(window.familiasColapsadas || []));
    console.log('🏷️ Subfamilias colapsadas en Set:', Array.from(window.subfamiliasColapsadas || []));

    // 1. Actualizar cabeceras de familia
    const famHeaders = tbody.querySelectorAll('.tr-familia-header');
    famHeaders.forEach(tr => {
        const famKey = tr.dataset.famKey;
        const isCollapsed = agruparFamilia && window.familiasColapsadas.has(famKey);
        
        const iconSpan = tr.querySelector('.icon-colapso-fam');
        if (iconSpan) iconSpan.textContent = isCollapsed ? '▶' : '▼';

        const textSpan = tr.querySelector('.text-colapso-fam');
        if (textSpan) textSpan.textContent = isCollapsed ? 'Desplegar' : 'Replegar';

        const btnIconSpan = tr.querySelector('.btn-icon-fam');
        if (btnIconSpan) btnIconSpan.textContent = isCollapsed ? '➕' : '➖';
    });

    // 2. Actualizar cabeceras de subfamilia
    const subfamHeaders = tbody.querySelectorAll('.tr-subfamilia-header');
    subfamHeaders.forEach(tr => {
        const famKey = tr.dataset.famKey;
        const subfamKey = tr.dataset.subfamKey;
        
        const isFamCollapsed = agruparFamilia && window.familiasColapsadas.has(famKey);
        const isSubCollapsed = agruparFamilia && agruparCatPrincipal && window.subfamiliasColapsadas.has(subfamKey);

        tr.style.display = isFamCollapsed ? 'none' : '';

        const iconSpan = tr.querySelector('.icon-colapso-sub');
        if (iconSpan) iconSpan.textContent = isSubCollapsed ? '▶' : '▼';

        const textSpan = tr.querySelector('.text-colapso-sub');
        if (textSpan) textSpan.textContent = isSubCollapsed ? 'Desplegar' : 'Replegar';

        const btnIconSpan = tr.querySelector('.btn-icon-sub');
        if (btnIconSpan) btnIconSpan.textContent = isSubCollapsed ? '➕' : '➖';
    });

    // 3. Actualizar filas de artículos y desgloses
    let articulosVisiblesCount = 0;
    let articulosOcultosCount = 0;

    const articleRows = tbody.querySelectorAll('.tr-articulo-row, .expandable-row');
    articleRows.forEach(tr => {
        const famKey = tr.dataset.famKey;
        const subfamKey = tr.dataset.subfamKey;

        const isFamCollapsed = agruparFamilia && window.familiasColapsadas.has(famKey);
        const isSubCollapsed = agruparFamilia && agruparCatPrincipal && window.subfamiliasColapsadas.has(subfamKey);

        if (isFamCollapsed || isSubCollapsed) {
            tr.style.display = 'none';
            articulosOcultosCount++;
        } else {
            if (tr.classList.contains('expandable-row')) {
                tr.style.display = tr.classList.contains('open') ? 'table-row' : 'none';
            } else {
                tr.style.display = '';
                articulosVisiblesCount++;
            }
        }
    });

    console.log(`📊 Total Filas Evaluadas: ${articleRows.length} | Visibles: ${articulosVisiblesCount} | Ocultas: ${articulosOcultosCount}`);
    console.groupEnd();
};

function auditarYObtenerScrollActivo() {
    const mainContent = document.querySelector('.main-content');
    const containerDiv = document.querySelector('.container');
    const docEl = document.documentElement;
    const body = document.body;

    const candidatos = [
        { nombre: 'window.scrollY', val: window.scrollY || window.pageYOffset || 0, el: window },
        { nombre: 'documentElement.scrollTop', val: docEl ? docEl.scrollTop : 0, el: docEl },
        { nombre: 'body.scrollTop', val: body ? body.scrollTop : 0, el: body },
        { nombre: '.main-content.scrollTop', val: mainContent ? mainContent.scrollTop : 0, el: mainContent },
        { nombre: '.container.scrollTop', val: containerDiv ? containerDiv.scrollTop : 0, el: containerDiv }
    ];

    const activo = candidatos.find(c => c.val > 0) || candidatos[0];
    return { candidatos, activo };
}

function auditarEstadoScrollSecuencial(etapaLabel, el) {
    const mainContent = document.querySelector('.main-content');
    const docEl = document.documentElement;
    const body = document.body;

    const winScroll = window.scrollY || window.pageYOffset || 0;
    const docScroll = docEl ? docEl.scrollTop : 0;
    const bodyScroll = body ? body.scrollTop : 0;
    const mainScroll = mainContent ? mainContent.scrollTop : 0;

    const rectTop = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect().top : 'N/A';

    console.log(`📌 [SECUENCIAL: ${etapaLabel}] window.scrollY=${winScroll}px | docEl.scrollTop=${docScroll}px | body.scrollTop=${bodyScroll}px | .main-content.scrollTop=${mainScroll}px | elem.rectTop=${rectTop}px`);
    return { winScroll, docScroll, bodyScroll, mainScroll, rectTop };
}

function bloquearYRestaurarScrollAsincrono(targetState, el) {
    if (!targetState) return;

    const restaurar = (origenLabel) => {
        const mainContent = document.querySelector('.main-content');
        const docEl = document.documentElement;

        let huboCorreccion = false;

        if (mainContent && targetState.mainScroll > 0 && Math.abs(mainContent.scrollTop - targetState.mainScroll) > 1) {
            console.log(`🛡️ [VIGÍA BUNKER SCROLL LOCK - ${origenLabel}] Interceptado reset de .main-content.scrollTop! Detectado: ${mainContent.scrollTop}px -> Restaurando a: ${targetState.mainScroll}px`);
            mainContent.scrollTop = targetState.mainScroll;
            huboCorreccion = true;
        }

        if (targetState.winScroll > 0 && Math.abs(window.scrollY - targetState.winScroll) > 1) {
            console.log(`🛡️ [VIGÍA BUNKER SCROLL LOCK - ${origenLabel}] Interceptado reset de window.scrollY! Detectado: ${window.scrollY}px -> Restaurando a: ${targetState.winScroll}px`);
            window.scrollTo(0, targetState.winScroll);
            huboCorreccion = true;
        }

        if (docEl && targetState.docScroll > 0 && Math.abs(docEl.scrollTop - targetState.docScroll) > 1) {
            console.log(`🛡️ [VIGÍA BUNKER SCROLL LOCK - ${origenLabel}] Interceptado reset de documentElement.scrollTop! Detectado: ${docEl.scrollTop}px -> Restaurando a: ${targetState.docScroll}px`);
            docEl.scrollTop = targetState.docScroll;
            huboCorreccion = true;
        }

        if (huboCorreccion && el && typeof el.getBoundingClientRect === 'function') {
            console.log(`✅ [VIGÍA BUNKER POST-LOCK] elem.rectTop corregido final: ${el.getBoundingClientRect().top.toFixed(1)}px (Objetivo inicial: ${targetState.rectTop}px)`);
        }
    };

    // 1. Restauración Sincrónica Inmediata (0ms)
    restaurar('Sincrónico 0ms');

    // 2. Microtask (antes del primer render gráfico)
    queueMicrotask(() => restaurar('Microtask 0ms'));

    // 3. Primer requestAnimationFrame (antes del dibujado de cuadro)
    requestAnimationFrame(() => {
        restaurar('rAF 1');
        // 4. Segundo rAF por si el reflow ocurrió en el siguiente cuadro
        requestAnimationFrame(() => restaurar('rAF 2'));
    });

    // 5. Timers ultra-rápidos de alta frecuencia (0ms, 10ms, 25ms, 50ms, 100ms)
    setTimeout(() => restaurar('Timer 0ms'), 0);
    setTimeout(() => restaurar('Timer 10ms'), 10);
    setTimeout(() => restaurar('Timer 25ms'), 25);
    setTimeout(() => restaurar('Timer 50ms'), 50);
    setTimeout(() => restaurar('Timer 100ms'), 100);
}

window.toggleColapsarFamilia = function(famKey, el) {
    if (!famKey) return;
    const keyStr = String(famKey).trim();

    console.group(`🌳 [VIGÍA BUNKER SECUENCIAL] Clic en Acordeón Familia: [${keyStr}]`);
    const statePre = auditarEstadoScrollSecuencial('PASO 1: Pre-Toggle', el);

    window.familiasColapsadas = window.familiasColapsadas || new Set();
    const isNowColapsando = !window.familiasColapsadas.has(keyStr);

    if (isNowColapsando) {
        window.familiasColapsadas.add(keyStr);
        console.log(`🔴 [PASO 2: Estado] Colapsando Familia: ${keyStr}`);
    } else {
        window.familiasColapsadas.delete(keyStr);
        console.log(`🟢 [PASO 2: Estado] Descolapsando Familia: ${keyStr}`);
    }

    try {
        localStorage.setItem('bunker_familias_colapsadas', JSON.stringify(Array.from(window.familiasColapsadas)));
    } catch (e) {
        console.error('Error guardando bunker_familias_colapsadas en localStorage:', e);
    }

    // PASO 3: Pura actualización del DOM in-place
    window.actualizarVisibilidadAcordeonesInPlace();
    console.log(`👁️ [PASO 3: DOM] Visibilidad de filas in-place actualizada en el DOM`);

    // Inyectar bloqueo y restauración asíncrona contra el reset a 0px
    bloquearYRestaurarScrollAsincrono(statePre, el);

    // PASO 4: Monitoreo post-toggle inmediato
    auditarEstadoScrollSecuencial('PASO 4: Post-Toggle Inmediato', el);

    // PASO 5: Monitoreo diferido a los 100ms para auditar resultado final
    setTimeout(() => {
        auditarEstadoScrollSecuencial('PASO 5: Post-Toggle (+100ms async)', el);
        console.groupEnd();
    }, 100);
};

window.toggleColapsarSubfamilia = function(subfamKey, el) {
    if (!subfamKey) return;
    const keyStr = String(subfamKey).trim();

    console.group(`🏷️ [VIGÍA BUNKER SECUENCIAL] Clic en Acordeón Subfamilia: [${keyStr}]`);
    const statePre = auditarEstadoScrollSecuencial('PASO 1: Pre-Toggle', el);

    window.subfamiliasColapsadas = window.subfamiliasColapsadas || new Set();
    const isNowColapsando = !window.subfamiliasColapsadas.has(keyStr);

    if (isNowColapsando) {
        window.subfamiliasColapsadas.add(keyStr);
        console.log(`🔴 [PASO 2: Estado] Colapsando Subfamilia: ${keyStr}`);
    } else {
        window.subfamiliasColapsadas.delete(keyStr);
        console.log(`🟢 [PASO 2: Estado] Descolapsando Subfamilia: ${keyStr}`);
    }

    try {
        localStorage.setItem('bunker_subfamilias_colapsadas', JSON.stringify(Array.from(window.subfamiliasColapsadas)));
    } catch (e) {
        console.error('Error guardando bunker_subfamilias_colapsadas en localStorage:', e);
    }

    // PASO 3: Pura actualización del DOM in-place
    window.actualizarVisibilidadAcordeonesInPlace();
    console.log(`👁️ [PASO 3: DOM] Visibilidad de filas in-place actualizada en el DOM`);

    // Inyectar bloqueo y restauración asíncrona contra el reset a 0px
    bloquearYRestaurarScrollAsincrono(statePre, el);

    // PASO 4: Monitoreo post-toggle inmediato
    auditarEstadoScrollSecuencial('PASO 4: Post-Toggle Inmediato', el);

    // PASO 5: Monitoreo diferido a los 100ms para auditar resultado final
    setTimeout(() => {
        auditarEstadoScrollSecuencial('PASO 5: Post-Toggle (+100ms async)', el);
        console.groupEnd();
    }, 100);
};

function obtenerScrollContainer() {
    const mainContent = document.querySelector('.main-content');
    if (mainContent && mainContent.scrollHeight > mainContent.clientHeight) {
        return mainContent;
    }
    return document.documentElement || document.body;
}

function obtenerFamiliaKey(art) {
    const famId = obtenerFamiliaId(art);
    const famName = obtenerFamiliaNombre(art);
    return famId > 0 ? `fam_${famId}` : `fam_name_${famName.toUpperCase().trim()}`;
}

function obtenerSubfamiliaKey(art) {
    const famKey = obtenerFamiliaKey(art);
    const catId = obtenerCategoriaPrincipalId(art);
    const catName = obtenerCategoriaPrincipalNombre(art);
    const catKey = catId > 0 ? `cat_${catId}` : `cat_name_${catName.toUpperCase().trim()}`;
    return `${famKey}___${catKey}`;
}

function renderizarGrid(articulos) {
    const scrollContainer = obtenerScrollContainer();
    const savedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

    const tbody = document.getElementById('tbody-bunker');
    tbody.innerHTML = '';
    
    if (articulos.length === 0) {
         tbody.innerHTML = '<tr><td colspan="17" style="text-align: center; padding: 20px;">No se encontraron artículos en el Búnker.</td></tr>';
         const masterCheckbox = document.getElementById('chk-seleccionar-todo-visible');
         if (masterCheckbox) masterCheckbox.checked = false;
         window.actualizarEstadoBotonMasivo();
         return;
    }
    
    const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    const stockFormatter = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const agruparFamilia = document.getElementById('toggle-agrupar-familia')?.checked;
    const agruparCatPrincipal = agruparFamilia && document.getElementById('toggle-agrupar-categoria-principal')?.checked;

    let articulosAProcesar = articulos;
    if (agruparFamilia) {
        articulosAProcesar = [...articulos].sort((a, b) => {
            const famNameA = obtenerFamiliaNombre(a);
            const famNameB = obtenerFamiliaNombre(b);
            const cmpFam = famNameA.localeCompare(famNameB);
            if (cmpFam !== 0 || !agruparCatPrincipal) return cmpFam;

            const catNameA = obtenerCategoriaPrincipalNombre(a);
            const catNameB = obtenerCategoriaPrincipalNombre(b);
            return catNameA.localeCompare(catNameB);
        });
    }

    let ultimaFamiliaIdKey = null;
    let ultimaSubfamiliaKey = null;

    articulosAProcesar.forEach((art, rowIndex) => {
        const famIdKey = obtenerFamiliaKey(art);
        const famName = obtenerFamiliaNombre(art);

        const catName = obtenerCategoriaPrincipalNombre(art);
        const subfamKey = obtenerSubfamiliaKey(art);

        if (agruparFamilia && famIdKey !== ultimaFamiliaIdKey) {
            ultimaFamiliaIdKey = famIdKey;
            ultimaSubfamiliaKey = null;
            const isCollapsed = window.familiasColapsadas.has(famIdKey);
            const countFam = articulosAProcesar.filter(a => obtenerFamiliaKey(a) === famIdKey).length;

            const famHeaderTr = document.createElement('tr');
            famHeaderTr.id = `fam_header_${famIdKey}`;
            famHeaderTr.className = 'tr-familia-header';
            famHeaderTr.dataset.famKey = famIdKey;
            famHeaderTr.style.cssText = 'cursor: pointer; user-select: none;';
            famHeaderTr.onclick = function(e) {
                if (e) {
                    if (typeof e.preventDefault === 'function') e.preventDefault();
                    if (typeof e.stopPropagation === 'function') e.stopPropagation();
                }
                window.toggleColapsarFamilia(famIdKey, this);
            };

            const artsFamElig = articulosAProcesar.filter(a => obtenerFamiliaKey(a) === famIdKey);
            const isFamAllChecked = artsFamElig.length > 0 && artsFamElig.every(a => window.articulosSeleccionadosMasa.has(a.articulo_id));

            famHeaderTr.innerHTML = `
                <td colspan="17" style="padding: 10px 16px; border-top: 2px solid #ddd6fe; border-bottom: 2px solid #e9d5ff; background: linear-gradient(90deg, #f5f3ff 0%, #faf5ff 100%); border-left: 6px solid #7e22ce;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 10px; font-weight: bold; color: #581c87; font-size: 1.02em;">
                            <input type="checkbox" class="chk-familia-grupo" data-fam-key="${famIdKey}" ${isFamAllChecked ? 'checked' : ''} onclick="event.stopPropagation(); window.toggleSeleccionFamiliaGrupo('${famIdKey}', this.checked)" style="width: 18px; height: 18px; cursor: pointer; accent-color: #7e22ce;" title="Seleccionar/Deseleccionar todos los artículos de ${famName.toUpperCase()}">
                            <span class="icon-colapso-fam" style="font-size: 0.9em; width: 14px; display: inline-block; text-align: center; color: #7e22ce;">${isCollapsed ? '▶' : '▼'}</span>
                            <span>🌳 FAMILIA: <strong style="color: #6b21a8;">${famName.toUpperCase()}</strong></span>
                            <span style="background: #e9d5ff; color: #581c87; padding: 3px 10px; border-radius: 12px; font-size: 0.82em; font-weight: 700; box-shadow: 0 1px 2px rgba(126,34,206,0.1);">${countFam} artículo${countFam === 1 ? '' : 's'}</span>
                        </div>
                        <div style="font-size: 0.82em; color: #7e22ce; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                            <span class="text-colapso-fam">${isCollapsed ? 'Desplegar' : 'Replegar'}</span>
                            <span class="btn-icon-fam" style="font-size: 1.1em;">${isCollapsed ? '➕' : '➖'}</span>
                        </div>
                    </div>
                </td>
            `;
            tbody.appendChild(famHeaderTr);
        }

        const isFamCollapsed = agruparFamilia && window.familiasColapsadas.has(famIdKey);

        if (agruparFamilia && agruparCatPrincipal && subfamKey !== ultimaSubfamiliaKey) {
            ultimaSubfamiliaKey = subfamKey;
            const isSubCollapsed = window.subfamiliasColapsadas.has(subfamKey);
            const countSub = articulosAProcesar.filter(a => obtenerSubfamiliaKey(a) === subfamKey).length;
            const artsSubElig = articulosAProcesar.filter(a => obtenerSubfamiliaKey(a) === subfamKey);
            const isSubAllChecked = artsSubElig.length > 0 && artsSubElig.every(a => window.articulosSeleccionadosMasa.has(a.articulo_id));

            const subHeaderTr = document.createElement('tr');
            subHeaderTr.id = `subfam_header_${subfamKey}`;
            subHeaderTr.className = 'tr-subfamilia-header';
            subHeaderTr.dataset.famKey = famIdKey;
            subHeaderTr.dataset.subfamKey = subfamKey;
            subHeaderTr.style.cssText = 'cursor: pointer; user-select: none;';
            if (isFamCollapsed) {
                subHeaderTr.style.display = 'none';
            }
            subHeaderTr.onclick = function(e) {
                if (e) {
                    if (typeof e.preventDefault === 'function') e.preventDefault();
                    if (typeof e.stopPropagation === 'function') e.stopPropagation();
                }
                window.toggleColapsarSubfamilia(subfamKey, this);
            };

            subHeaderTr.innerHTML = `
                <td colspan="17" style="padding: 8px 16px 8px 36px; border-top: 1px solid #e0f2fe; border-bottom: 1px solid #bae6fd; background: linear-gradient(90deg, #f0f9ff 0%, #e0f2fe 100%); border-left: 5px solid #0284c7;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 10px; font-weight: bold; color: #0369a1; font-size: 0.95em;">
                            <input type="checkbox" class="chk-subfamilia-grupo" data-subfam-key="${subfamKey}" data-fam-key="${famIdKey}" ${isSubAllChecked ? 'checked' : ''} onclick="event.stopPropagation(); window.toggleSeleccionSubfamiliaGrupo('${subfamKey}', this.checked)" style="width: 17px; height: 17px; cursor: pointer; accent-color: #0284c7;" title="Seleccionar/Deseleccionar todos los artículos de ${catName.toUpperCase()}">
                            <span class="icon-colapso-sub" style="font-size: 0.85em; width: 14px; display: inline-block; text-align: center; color: #0284c7;">${isSubCollapsed ? '▶' : '▼'}</span>
                            <span>🏷️ ATRIBUTO PRINCIPAL: <strong style="color: #0284c7;">${catName.toUpperCase()}</strong></span>
                            <span style="background: #bae6fd; color: #0369a1; padding: 2px 8px; border-radius: 10px; font-size: 0.78em; font-weight: 700;">${countSub} artículo${countSub === 1 ? '' : 's'}</span>
                        </div>
                        <div style="font-size: 0.78em; color: #0284c7; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                            <span class="text-colapso-sub">${isSubCollapsed ? 'Desplegar' : 'Replegar'}</span>
                            <span class="btn-icon-sub" style="font-size: 1.0em;">${isSubCollapsed ? '➕' : '➖'}</span>
                        </div>
                    </div>
                </td>
            `;
            tbody.appendChild(subHeaderTr);
        }

        const isSubCollapsed = agruparFamilia && agruparCatPrincipal && window.subfamiliasColapsadas.has(subfamKey);

        const costo = parseFloat(art.costo_base || 0);
        const iva = parseFloat(art.porcentaje_iva || 21);
        
        // Parsear JSONB a Tooltip
        let propSummary = '<span style="color:#94a3b8; font-size: 0.8em;">Sin Propiedades</span>';
        if (art.propiedades_dinamicas && typeof art.propiedades_dinamicas === 'object') {
            const keys = Object.keys(art.propiedades_dinamicas);
            if (keys.length > 0) {
                if (keys.length === 1) {
                    const rawVal = art.propiedades_dinamicas[keys[0]];
                    const valStr = (rawVal && typeof rawVal === 'object') ? rawVal.valor : (rawVal || '');
                    propSummary = `<span style="font-size: 0.9em;">${keys[0].toUpperCase()}: ${valStr}</span>`;
                } else {
                    propSummary = `<span style="font-size: 0.9em;">[ ${keys.length} Propiedades ]</span>`;
                }

                let badgesHtml = '';
                keys.forEach((key, index) => {
                    const rawVal = art.propiedades_dinamicas[key];
                    const valStr = (rawVal && typeof rawVal === 'object') ? rawVal.valor : (rawVal || '');
                    const isVisible = (rawVal && typeof rawVal === 'object') ? (rawVal.visible !== false) : true;
                    const eyeIcon = isVisible ? '' : ' 🙈';
                    const colorClass = `color-${index % 6}`;
                    badgesHtml += `<span class="badge ${colorClass}">
                        <span class="badge-cat">${key.toUpperCase()}:</span> ${valStr}${eyeIcon}
                    </span>`;
                });

                propSummary = `
                    <div class="badge-tooltip-container">
                        ${propSummary}
                        <div class="tooltip-content" style="width: auto; max-width: 400px; display: flex; flex-wrap: wrap;">${badgesHtml}</div>
                    </div>
                `;
            }
        }
        
        let disponibleActiva = true;
        let margenPrincipalText = 'N/A';
        let precioFinalDinamicoHtml = `<span style="color:#94a3b8;">N/D</span>`;
        let precioKiloHtml = `<span style="color:#94a3b8; font-size: 0.9em;">-</span>`;
        let ivaStr = `${iva.toFixed(2)}%`;
        let costoSivaStr = `<span style="color:#94a3b8;">N/D</span>`;
        let iibbStr = `<span style="color:#94a3b8;">N/D</span>`;
        let gananciaNetaStr = `<span style="color:#94a3b8;">N/D</span>`;
        let expandedGridHtml = '';
        
        let isOutdated = false;
        
        if (art.margenes && Array.isArray(art.margenes) && art.margenes.length > 0) {
            art.margenes.sort((a,b) => a.lista_id - b.lista_id);
            
            // Buscar el margen de la lista enfocada globalmente
            const mFocused = art.margenes.find(m => m.lista_id === listaSeleccionadaGlobal) || art.margenes[0];
            if (mFocused) {
                disponibleActiva = mFocused.disponible !== false;
            }
            const pctMargen = parseFloat(mFocused.margen_porcentaje);
            margenPrincipalText = `${pctMargen.toFixed(2)} %`;
            
            // Si el costo está desactualizado, se tiñe la fila
            if (mFocused && mFocused.costo_desactualizado === true) {
                isOutdated = true;
            }
            
            const precioC_iva = parseFloat(mFocused.precio_final || 0);
            const dynamicIva = parseFloat(mFocused.iva || iva);
            const precioS_iva = precioC_iva / (1 + (dynamicIva / 100));
            ivaStr = `${dynamicIva.toFixed(2)}%`;
            
            // Costo real (para visualizaciones del dashboard)
            const cTiempo = parseFloat(mFocused.costo_tiempo || 0);
            const cBase = mFocused.costo_base_sobrescrito !== null ? parseFloat(mFocused.costo_base_sobrescrito) : parseFloat(mFocused.costo_ingrediente_en_vivo || costo);
            const cInsumos = parseFloat(mFocused.costo_insumos_en_vivo || 0);
            const cIntegrado = cBase + cInsumos;
            
            // Cálculos financieros derivados
            const montoIibb = (precioC_iva * 4) / 100; // Impuestos Brutos 4%
            const gananciaNeta = (precioS_iva - cTiempo) - cIntegrado;

            // Cálculo determinista de Precio por Kilo
            const kilosUnidad = parseFloat(art.kilos_unidad || 0);
            if (kilosUnidad > 0 && precioC_iva > 0) {
                const precioPorKilo = precioC_iva / kilosUnidad;
                precioKiloHtml = `<span style="font-weight: 700; color: #0284c7; font-size: 1.0em;">${formatter.format(precioPorKilo)}</span><span style="font-size: 0.78em; color: #64748b;"> /kg</span>`;
            }

            precioFinalDinamicoHtml = `<span style="font-weight:bold; color: #15803d; font-size: 1.1em;">${formatter.format(precioC_iva)}</span>`;
            if (isOutdated) {
                precioFinalDinamicoHtml += ` <span style="cursor:help; font-size:1.15em; color:#d97706;" title="Alerta: Costo base o receta cambió. Margen implícito disminuido en esta lista. Click en Finanzas para recalibrar.">⚠️</span>`;
            }
            
            costoSivaStr = formatter.format(precioS_iva);
            iibbStr = formatter.format(montoIibb);
            gananciaNetaStr = formatter.format(gananciaNeta);
            
            expandedGridHtml = `
                <table class="mini-grid">
                    <thead>
                        <tr>
                            <th>Lista de Venta</th>
                            <th>Modo</th>
                            <th>Margen Ganancia</th>
                            <th>Costo Integrado</th>
                            <th>Costo Tiempo</th>
                            <th>Precio c/IVA (Final)</th>
                            <th>Estado Costo</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            art.margenes.forEach(m => {
                const isSel = m.lista_id === listaSeleccionadaGlobal;
                const rowStyle = isSel ? 'background-color: #fef08a;' : '';
                const fwStyle = isSel ? 'font-weight:bold;' : '';
                const lBase = m.costo_base_sobrescrito !== null ? parseFloat(m.costo_base_sobrescrito) : parseFloat(m.costo_ingrediente_en_vivo || costo);
                const lInsumos = parseFloat(m.costo_insumos_en_vivo || 0);
                
                expandedGridHtml += `
                    <tr style="${rowStyle}">
                        <td style="text-align:center; ${fwStyle}">Lista ${m.lista_id}</td>
                        <td style="${fwStyle}">${m.modo_calculo}</td>
                        <td style="${fwStyle}">${parseFloat(m.margen_porcentaje).toFixed(2)} %</td>
                        <td style="${fwStyle}">${formatter.format(lBase + lInsumos)}</td>
                        <td style="${fwStyle}">${formatter.format(parseFloat(m.costo_tiempo || 0))}</td>
                        <td style="font-weight:bold; color: #15803d;">${formatter.format(parseFloat(m.precio_final))}</td>
                        <td style="${fwStyle}">${m.costo_desactualizado ? '<span style="color:#d97706; font-weight:bold;">⚠️ Outdated</span>' : '<span style="color:#16a34a;">🟢 OK</span>'}</td>
                    </tr>
                `;
            });
            expandedGridHtml += `</tbody></table>`;
        }

        const hasMargins = expandedGridHtml !== '';
        const toggleIcon = hasMargins ? `<span class="toggle-icon" onclick="toggleRow('details_${rowIndex}', this)">▶</span>` : '';

        const trMain = document.createElement('tr');
        trMain.className = 'tr-articulo-row';
        trMain.dataset.articuloId = art.articulo_id;
        trMain.dataset.famKey = famIdKey;
        trMain.dataset.subfamKey = subfamKey;

        if (isOutdated) {
            trMain.style.cssText = 'background-color: #fffbeb; border-left: 4px solid #d97706;';
        }
        if (!disponibleActiva) {
            trMain.classList.add('articulo-excluido');
        }

        const ldnInfo = window.determinarLineaDeNegocio(art);
        const badgeLDN = `<span class="badge-ldn" title="${ldnInfo.nombre}" style="display: inline-block; font-size: 0.70em; font-weight: 700; padding: 1px 5px; border-radius: 4px; margin-left: 6px; vertical-align: middle; border: 1px solid ${ldnInfo.borderColor}; background: ${ldnInfo.bgColor}; color: ${ldnInfo.color}; cursor: default; letter-spacing: 0.5px;">${ldnInfo.tag}</span>`;
        const badgeExcluido = disponibleActiva ? '' : ' <span class="badge badge-excluido-row" style="background-color: #64748b; color: white; padding: 2px 6px; font-size: 0.75em; border-radius: 4px; vertical-align: middle; margin-left: 5px;">🚫 Excluido</span>';

        trMain.innerHTML = `
            <td style="text-align: center; width: 40px;">
                <input type="checkbox" class="chk-articulo-masa" data-articulo-id="${art.articulo_id}" ${window.articulosSeleccionadosMasa.has(art.articulo_id) ? 'checked' : ''} onchange="window.toggleSeleccionArticuloMasa('${art.articulo_id}', this.checked)" style="width: 18px; height: 18px; cursor: pointer;">
            </td>
            <td style="font-family: monospace; font-weight: bold; color: #3b82f6;">${art.articulo_id}</td>
            <td class="td-art-principal">
                <strong>${art.descripcion}</strong>${badgeLDN}${badgeExcluido}<br>
                <span style="font-size: 0.8em; color: #64748b;">${art.rubro || 'Sin Rubro'} > ${art.sub_rubro || ''}</span>
            </td>
            <td class="td-art-nomenclatura" style="font-family: monospace; font-size: 0.9em;"><span class="nom-text">${art.descripcion_generada || '-'}</span>${badgeExcluido}</td>
            <td>${propSummary}</td>
            <td style="text-align: center; color: #475569;">${ivaStr}</td>
            <td style="text-align: right; color: #0f172a;">${costoSivaStr}</td>
            <td style="text-align: right; color: #ea580c;">${iibbStr}</td>
            <td style="text-align: right; color: #16a34a; font-weight: bold;">${gananciaNetaStr}</td>
            <td style="text-align: right; background-color: #f8fafc;">
                ${precioFinalDinamicoHtml}
            </td>
            <td style="text-align: right; background-color: #f0f9ff;" title="${parseFloat(art.kilos_unidad || 0) > 0 ? 'Precio final dividido por ' + parseFloat(art.kilos_unidad) + ' kg' : 'Sin peso de presentación cargado'}">
                ${precioKiloHtml}
            </td>
            <td style="text-align: right; border-left: 1px dashed #cbd5e1;" title="Click en flecha para ver Desglose Financiero">
                ${toggleIcon} ${margenPrincipalText}
            </td>
            <td style="text-align: center; font-weight: bold; font-size: 1.1em; ${art.stock_unidades > 0 ? 'color: #3b82f6;' : 'color: #ef4444; opacity: 0.7;'}">
                ${stockFormatter.format(art.stock_unidades || 0)}
            </td>
            <td style="text-align: center; font-weight: bold; font-size: 1.1em; ${art.stock_kilos > 0 ? 'color: #10b981;' : 'color: #ef4444; opacity: 0.7;'}">
                ${stockFormatter.format(art.stock_kilos || 0)}
            </td>
            ${(() => {
                const fisVal = parseFloat(art.stock_fisico !== undefined ? art.stock_fisico : (art.stock_legacy || 0)) || 0;
                const resVal = parseFloat(art.stock_reservado || 0) || 0;
                const dispVal = parseFloat(art.stock_disponible !== undefined ? art.stock_disponible : (art.stock_legacy || 0)) || 0;
                const tuvoLotes = (parseFloat(art.total_entrante_unidades || art.stock_unidades || 0) > 0) || (parseInt(art.cantidad_lotes_activos || 0) > 0);
                const badgeAgotado = (dispVal <= 0 && tuvoLotes)
                    ? `<div style="font-size: 0.66rem; color: #be123c; background: #ffe4e6; border: 1px solid #fecdd3; border-radius: 6px; padding: 1px 5px; font-weight: 800; display: inline-block; margin-top: 2px; line-height: 1.1;" title="Este artículo tuvo ingresos/lotes previos y su stock disponible quedó agotado en 0">Agotado</div>`
                    : '';
                if (resVal > 0) {
                    return `
                    <td style="text-align: center; font-weight: bold; font-size: 1.05em; ${dispVal > 0 ? 'color: #7c3aed;' : 'color: #ef4444; opacity: 0.85;'}" title="Físico: ${stockFormatter.format(fisVal)} | Reservado en pedidos: ${stockFormatter.format(resVal)} | Disponible: ${stockFormatter.format(dispVal)}">
                        <div>${stockFormatter.format(dispVal)}</div>
                        <div style="font-size: 0.72rem; color: #f59e0b; font-weight: 600; margin-top: 2px;">
                           (${stockFormatter.format(resVal)} res.)
                        </div>
                        ${badgeAgotado}
                    </td>
                    `;
                } else {
                    return `
                    <td style="text-align: center; font-weight: bold; font-size: 1.1em; ${dispVal > 0 ? 'color: #7c3aed;' : 'color: #ef4444; opacity: 0.85;'}" title="Stock Físico / Disponible: ${stockFormatter.format(dispVal)}">
                        <div>${stockFormatter.format(dispVal)}</div>
                        ${badgeAgotado}
                    </td>
                    `;
                }
            })()}
            <td class="td-art-catalogo" style="text-align: center;">
                ${window.generarHtmlBotonCatalogo ? window.generarHtmlBotonCatalogo(art) : `<button type="button" class="btn-catalogo-listas estado-activo" onclick="window.mostrarPopoverListas(event, '${art.articulo_id}')">📋 Listas</button>`}
            </td>
            <td style="text-align: center;">
                <div style="display: flex; justify-content: center; align-items: center; gap: 8px;">
                    <button type="button" style="background: #8e4785; color: white; padding: 8px 12px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.9em; display: flex; gap: 5px; align-items: center; box-shadow: 0 2px 4px rgba(142,71,133,0.15);" onclick="abrirGestorPrecios('${art.articulo_id}', '${art.descripcion_generada || art.descripcion}', ${iva})" title="Gestor de Precios Independiente">
                        💰 Finanzas
                    </button>
                    <button class="btn-edit" onclick="editarArticulo('${art.articulo_id}')">✏️ Editar</button>
                    <button class="btn-edit" style="background-color: #6366f1;" onclick="clonarArticulo('${art.articulo_id}')" title="Clonar / Crear variante a imagen y semejanza">📋 Clonar</button>
                    <button class="btn-edit" style="background-color: #10b981;" onclick="imprimirEtiquetaBunker('${art.articulo_id}')" title="Imprimir Etiqueta Asimétrica Doble (Zebra)">🖨️ Imprimir</button>
                    <button type="button" style="background: transparent; border: none; cursor: pointer; font-size: 1.3em; padding: 0; display: flex; transition: transform 0.2s; color: #ef4444;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'" title="Eliminar del Búnker" onclick="eliminarArticuloBunker('${art.articulo_id}')">🗑️</button>
                </div>
            </td>
        `;

        if (isFamCollapsed || isSubCollapsed) {
            trMain.style.display = 'none';
        }

        tbody.appendChild(trMain);

        if (hasMargins) {
            const trDetails = document.createElement('tr');
            trDetails.id = `details_${rowIndex}`;
            trDetails.className = 'expandable-row';
            trDetails.dataset.famKey = famIdKey;
            trDetails.dataset.subfamKey = subfamKey;
            if (isFamCollapsed || isSubCollapsed) {
                trDetails.style.display = 'none';
            }
            trDetails.innerHTML = `
                <td colspan="17" style="padding: 10px 40px; background-color: #f1f5f9;">
                    <div style="margin-bottom: 5px; font-weight: 600; color: #334155; font-size: 0.9em;">👇 Desglose Financiero de Listas de Precios Búnker</div>
                    ${expandedGridHtml}
                </td>
            `;
            tbody.appendChild(trDetails);
        }
    });

    // Actualizar checkbox maestro basado en artículos elegibles visibles
    const masterCheckbox = document.getElementById('chk-seleccionar-todo-visible');
    if (masterCheckbox) {
        const eligibleIds = articulos.filter(a => {
            const mFocused = a.margenes ? a.margenes.find(m => m.lista_id === listaSeleccionadaGlobal) : null;
            const disponibleActiva = mFocused ? (mFocused.disponible !== false) : true;
            const isBaja = a._estado_delta === 'BAJA' || a.estado === 'BAJA';
            return disponibleActiva && !isBaja;
        }).map(a => a.articulo_id);
        const allChecked = eligibleIds.length > 0 && eligibleIds.every(id => window.articulosSeleccionadosMasa.has(id));
        masterCheckbox.checked = allChecked;
    }
    window.actualizarEstadoBotonMasivo();
}

window.toggleRow = function(targetId, elIcon) {
    const row = document.getElementById(targetId);
    if (!row) return;
    if (row.classList.contains('open')) {
        row.classList.remove('open');
        elIcon.innerText = '▶';
    } else {
        row.classList.add('open');
        elIcon.innerText = '▼';
    }
};

window.editarArticulo = function(id) {
    window.location.href = `bunker.html?edit=${encodeURIComponent(id)}`;
};

window.clonarArticulo = function(id) {
    window.location.href = `bunker.html?clone=${encodeURIComponent(id)}`;
};

window.eliminarArticuloBunker = async function(id) {
    Swal.fire({
        title: 'Baja del Búnker',
        text: '¿Está seguro que desea eliminar este artículo del Búnker? Esta acción no afectará al sistema Lomasoft, pero se perderán los atributos y márgenes configurados localmente.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, Eliminar Definitivamente',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                Swal.fire({ title: 'Procesando Baja...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                const response = await fetch(`/api/logistica/bunker/articulos/${encodeURIComponent(id)}`, {
                    method: 'DELETE'
                });
                const res = await response.json();
                
                if (response.ok && res.success) {
                    Swal.fire({
                        title: 'Eliminado',
                        text: 'El artículo ha sido purgado del ecosistema Búnker.',
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    await cargarDataGrid();
                } else {
                    Swal.fire('Error', res.error || 'No se pudo eliminar el artículo', 'error');
                }
            } catch (e) {
                Swal.fire('Error', 'Fallo de red al intentar comunicarse con el servidor.', 'error');
            }
        }
    });
};

// ==========================================
// MÓDULO: GESTOR DE PRECIOS PARALELO (AVANZADO)
// ==========================================

let gp_listasFinancieras = [];
let gp_activeTabIdx = 0;
let gp_ivaGlobal = 21;
let gp_liveIngredienteCost = 0;
let gp_loteVal = null;
let gp_stockUnidadesVal = 0;
let gp_stockKilosVal = 0;
let gp_factorPresentacion = 1.00;

// Utilidad de Debounce estándar en español
function debounce(func, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(this, args), delay);
    };
}

const debouncedRecalcular = debounce(() => {
    recalcularPreciosGestor();
    if (typeof window.actualizarIconosCandados === "function") window.actualizarIconosCandados();
}, 500);

let gp_costoLomasoftKilo = 0;
let gp_reposicionOfertas = [];

// Variables globales del artículo padre (ingrediente base - Fase 4)
let gp_packHijoCodigo = null;
let gp_parentLote = null;
let gp_parentCostoBaseManual = null;
let gp_parentCostoLomasoft = null;
let gp_parentKilosUnidad = 1;
let gp_parentDescripcion = '';
let gp_childListsCosts = [];
let gp_parentPorcentajeIva = 21.00;

function renderOfertasReposicion(ofertas) {
    gp_reposicionOfertas = ofertas || [];
    
    // Actualizar el contador dinámico en la cabecera del gestor
    const contadorEl = document.getElementById('gp-reposicion-contador');
    if (contadorEl) {
        const count = gp_reposicionOfertas.length;
        contadorEl.innerText = count > 0 ? `• ${count} oferta${count > 1 ? 's' : ''} seleccionada${count > 1 ? 's' : ''}` : '';
    }

    const container = document.getElementById('gp-ofertas-reposicion-container');
    if (!container) return;

    if (!ofertas || ofertas.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: #64748b; font-style: italic; font-size: 0.82em; padding: 15px;">
                Sin ofertas de reposición vigentes
            </div>
        `;
        return;
    }

    const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    let html = '';
    
    ofertas.forEach(of => {
        const costoKilo = of.precio_unitario || 0;
        const costoBulto = gp_factorPresentacion > 0 ? (costoKilo * gp_factorPresentacion) : 0;
        
        const dias = of.dias_antiguedad;
        const badgeText = dias === 0 ? 'Hoy' : `Hace ${dias} día${dias > 1 ? 's' : ''}`;
        
        const heredadoBadge = of.heredado ? `<span style="font-size: 0.76em; background: #fef3c7; color: #d97706; border: 1px solid #fde68a; padding: 0px 4px; border-radius: 3px; font-weight: 700;">Heredado</span>` : '';
        
        // Formato de presentación comercial (ej: 1 x 10, 1 x 25, 1 x 18)
        let presentacionBadge = '';
        const bultoVal = of.cant_bult !== undefined && of.cant_bult !== null && of.cant_bult !== '' ? of.cant_bult : 1;
        const valorVal = of.cant_valor !== undefined && of.cant_valor !== null && of.cant_valor !== '' ? of.cant_valor : '';
        if (valorVal) {
            presentacionBadge = `<span style="font-size: 0.76em; background: #f3e8ff; color: #7e22ce; border: 1px solid #d8b4fe; padding: 1px 6px; border-radius: 4px; font-weight: 700; white-space: nowrap;" title="Presentación: ${bultoVal} x ${valorVal}">${bultoVal} x ${valorVal}</span>`;
        }
        
        html += `
            <div class="reposicion-offer-card" onclick="window.aplicarCostoBaseManual(${costoKilo}, null, 'REPOSICION_BLIND')" style="display: flex; flex-direction: column; gap: 4px; padding: 8px; background: white; border: 1px solid #e9d5ff; border-radius: 6px; font-size: 0.82em; box-shadow: 0 1px 2px rgba(107, 33, 168, 0.05);" title="Haga clic para inyectar este costo ($${costoKilo.toFixed(2)}/kg) en la calculadora">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                    <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; flex: 1;">
                        <span style="font-weight: 700; color: #6b21a8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;" title="${of.nombre_proveedor}">${of.nombre_proveedor}</span>
                        ${presentacionBadge}
                        ${heredadoBadge}
                    </div>
                    <span class="badge" style="font-size: 0.78em; background: #faf5ff; color: #6b21a8; border: 1px solid #e9d5ff; padding: 1px 6px; border-radius: 4px; font-weight: 600; flex-shrink: 0;">
                        ${badgeText}
                    </span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-family: monospace; font-size: 1.15em; border-top: 1px dashed rgba(107, 33, 168, 0.15); padding-top: 4px;">
                    <span style="color: #64748b;">${costoKilo > 0 ? currencyFormatter.format(costoKilo) + '/kg' : 'N/A'}</span>
                    <strong style="color: #6b21a8;">${costoBulto > 0 ? currencyFormatter.format(costoBulto) + '/blt' : 'N/A'}</strong>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

window.abrirGestorPrecios = async function(articulo_id, descripcion, iva) {
    document.getElementById('gp-producto').innerText = descripcion;
    document.getElementById('gp-articulo-id').value = articulo_id;
    gp_ivaGlobal = parseFloat(iva) || 21;
    gp_activeTabIdx = 0;
    
    // Heredar contexto del artículo activo para el Tostadero
    window.gp_current_articulo_data = {
        articulo_id: articulo_id,
        nombre: descripcion,
        descripcion: descripcion
    };
    
    // Reset global parent variables (Fase 4)
    gp_packHijoCodigo = null;
    gp_parentLote = null;
    gp_parentCostoBaseManual = null;
    gp_parentCostoLomasoft = null;
    gp_parentKilosUnidad = 1;
    gp_parentDescripcion = '';
    
    const alertPadreDiv = document.getElementById('gp-alerta-ingrediente-padre');
    if (alertPadreDiv) alertPadreDiv.style.display = 'none';
    
    // UI Reset & Teardown de Estado Tostadero (Fase 17: Fuga de Memoria)
    if (typeof window.resetEstadoTostadero === 'function') {
        window.resetEstadoTostadero();
    }
    
    document.getElementById('gp-costo-integrado').innerText = '$ 0,00';
    document.getElementById('gp-costo-manual').value = '';
    document.getElementById('gp-buscar-insumo').value = '';
    document.getElementById('gp-insumos-tbody').innerHTML = '<tr><td colspan="4" style="text-align:center;">Cargando...</td></tr>';
    document.getElementById('gp-receta-ingredientes').innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #64748b; font-style: italic;">Cargando estructura de receta...</div>';
    document.getElementById('gp-tabs-container').innerHTML = '<span style="color:#64748b; font-style:italic; padding: 5px;">Cargando listas...</span>';
    document.getElementById('gp-alerta-desactualizado').style.display = 'none';
    const bannerMetricas = document.getElementById('gp-banner-metricas-campo');
    if (bannerMetricas) bannerMetricas.style.display = 'none';
    const linkMetricas = document.getElementById('gp-link-metricas-campo');
    if (linkMetricas) linkMetricas.style.display = 'none';
    window.gp_metricas_campo_activas = null;
    // 🔑 DELEGACIÓN GLOBAL DE EVENTOS DE SIMULACIÓN (v5.32)
    const modalPrecios = document.getElementById('modal-gestor-precios');
    if (modalPrecios) {
        modalPrecios.style.display = 'flex';
        if (!modalPrecios.dataset.listenerSimuladorActivo) {
            modalPrecios.dataset.listenerSimuladorActivo = 'true';
            const handlerSim = (e) => {
                if (e.target && (e.target.id === 'gp-sim-descuento' || e.target.name === 'sim-descuento')) {
                    if (typeof calcularPreciosFila === 'function') calcularPreciosFila();
                }
            };
            modalPrecios.addEventListener('input', handlerSim);
            modalPrecios.addEventListener('keyup', handlerSim);
            modalPrecios.addEventListener('change', handlerSim);
        }
    }
    
    const simDescEl = document.getElementById('gp-sim-descuento');
    if (simDescEl) simDescEl.value = '0';
    
    try {
        const res = await fetch(`/api/logistica/bunker/finanzas/${encodeURIComponent(articulo_id)}`);
        const result = await res.json();
        
        if (res.ok && result.success) {
            const data = result.data;
            
            // Poblar y sincronizar datos del artículo activo
            window.gp_current_articulo_data = Object.assign({}, data, {
                articulo_id: articulo_id,
                nombre: descripcion,
                descripcion: descripcion
            });
            
            // Poblar variables globales del artículo padre (Fase 4)
            gp_packHijoCodigo = data.pack_hijo_codigo || null;
            gp_parentLote = data.parent_lote || null;
            gp_parentCostoBaseManual = data.parent_costo_base_manual !== undefined && data.parent_costo_base_manual !== null ? parseFloat(data.parent_costo_base_manual) : null;
            gp_parentCostoLomasoft = data.parent_costo_lomasoft !== undefined && data.parent_costo_lomasoft !== null ? parseFloat(data.parent_costo_lomasoft) : null;
            gp_parentKilosUnidad = parseFloat(data.parent_kilos_unidad) || 1;
            gp_parentDescripcion = data.parent_descripcion || '';
            gp_childListsCosts = data.child_lists_costs || [];
            gp_parentPorcentajeIva = data.parent_porcentaje_iva !== undefined && data.parent_porcentaje_iva !== null ? parseFloat(data.parent_porcentaje_iva) : 21.00;

            gp_loteVal = data.lote;
            gp_stockUnidadesVal = data.stock_unidades || 0;
            gp_stockKilosVal = data.stock_kilos || 0;
            gp_factorPresentacion = parseFloat(data.kilos_unidad) > 0 ? parseFloat(data.kilos_unidad) : 1.00;
            
            const factorEl = document.getElementById('gp-factor-presentacion');
            if (factorEl) {
                factorEl.innerText = `${gp_factorPresentacion.toFixed(2)} kg`;
            }
            
            // Calcular Costo de Ingrediente en Vivo por KILO (Costo de Producción Origen) (Comentarios en español)
            let rawIngredienteCost = 0;
            if (data.receta_id && data.receta_ingredientes && data.receta_ingredientes.length > 0) {
                let recipeTotalCost = 0;
                data.receta_ingredientes.forEach(ing => {
                    const cKilo = parseFloat(ing.costo_patron) || 0; // Utilizar costo patrón dinámico resuelto
                    const qty = parseFloat(ing.cantidad) || 0;
                    recipeTotalCost += cKilo * qty;
                });
                // La receta representa el costo del bulto total, lo dividimos por el factor para tener el costo por kilo
                rawIngredienteCost = recipeTotalCost / gp_factorPresentacion;
            }
            if (rawIngredienteCost === 0) {
                if (data.lote) {
                    // El costo del lote directo ya está expresado por kilogramo
                    rawIngredienteCost = parseFloat(data.lote.costo_kilo_al_momento) || 0;
                } else {
                    // El costo manual guardado representa el bulto total, por ende lo dividimos para obtener costo por kilo
                    rawIngredienteCost = (parseFloat(data.costo_base_manual) || 0) / gp_factorPresentacion;
                }
            }
            gp_liveIngredienteCost = rawIngredienteCost;

            // Despliegue Informativo y Normalizado de Costo Lomasoft (Fase 1: Multi-Fuente)
            // Decisión de diseño: Se formatea el bulto y se divide por el factor para tener el costo por kilo normalizado.
            // Se inyecta también la alícuota impositiva legacy en formato de porcentaje.
            const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
            const costoLomasoftBulto = parseFloat(data.costo_lomasoft) || 0;
            const costoLomasoftKilo = gp_factorPresentacion > 0 ? (costoLomasoftBulto / gp_factorPresentacion) : 0;
            gp_costoLomasoftKilo = costoLomasoftKilo;

            const lomaValEl = document.getElementById('gp-costo-lomasoft-val');
            const lomaBultoEl = document.getElementById('gp-costo-lomasoft-bulto');
            const lomaIvaEl = document.getElementById('gp-iva-lomasoft-val');
            if (lomaValEl && lomaBultoEl && lomaIvaEl) {
                lomaValEl.innerText = costoLomasoftKilo > 0 ? currencyFormatter.format(costoLomasoftKilo) : 'N/A';
                lomaBultoEl.innerText = costoLomasoftBulto > 0 ? currencyFormatter.format(costoLomasoftBulto) : 'N/A';
                
                const ivaLomasoftVal = parseFloat(data.iva_lomasoft);
                lomaIvaEl.innerText = !isNaN(ivaLomasoftVal) ? `${ivaLomasoftVal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : 'N/A';
                
                // Click-to-Calculate interactivo
                if (costoLomasoftKilo > 0) {
                    lomaValEl.className = 'clickable-cost-val lomasoft';
                    lomaValEl.setAttribute('onclick', `window.aplicarCostoBaseManual(${costoLomasoftKilo}, ${!isNaN(ivaLomasoftVal) ? ivaLomasoftVal : 'null'}, 'LOMASOFT')`);
                    lomaValEl.title = `Haga clic para inyectar este costo ($${costoLomasoftKilo.toFixed(2)}/kg)`;
                } else {
                    lomaValEl.className = '';
                    lomaValEl.removeAttribute('onclick');
                    lomaValEl.removeAttribute('title');
                }
            }

            // Despliegue Informativo de Lote Reciente Embudo (Fase 2: Multi-Fuente)
            // Decisión de diseño: Si no existe el lote, mostramos 'Sin registros' de forma explícita.
            const loteValEl = document.getElementById('gp-costo-lote-val');
            const loteBultoEl = document.getElementById('gp-costo-lote-bulto');
            const loteIvaEl = document.getElementById('gp-iva-lote-val');
            const loteFechaEl = document.getElementById('gp-lote-fecha-val');

            if (loteValEl && loteBultoEl && loteIvaEl && loteFechaEl) {
                if (data.lote) {
                    const costoLoteKilo = parseFloat(data.lote.costo_kilo_al_momento) || 0;
                    const costoLoteBulto = gp_factorPresentacion > 0 ? (costoLoteKilo * gp_factorPresentacion) : 0;
                    const ivaLoteVal = parseFloat(data.lote.impuesto_iva);
                    
                    let fechaFmt = 'N/A';
                    if (data.lote.fecha_vinculacion) {
                        const dateObj = new Date(data.lote.fecha_vinculacion);
                        const day = String(dateObj.getDate()).padStart(2, '0');
                        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                        const year = dateObj.getFullYear();
                        fechaFmt = `${day}/${month}/${year}`;
                    }

                    loteValEl.innerText = costoLoteKilo > 0 ? currencyFormatter.format(costoLoteKilo) : 'N/A';
                    loteBultoEl.innerText = costoLoteBulto > 0 ? currencyFormatter.format(costoLoteBulto) : 'N/A';
                    loteIvaEl.innerText = !isNaN(ivaLoteVal) ? `${ivaLoteVal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : 'N/A';
                    loteFechaEl.innerText = fechaFmt;
                    
                    loteValEl.style.color = '#10b981';
                    loteBultoEl.style.color = '#10b981';
                    loteIvaEl.style.color = '#10b981';
                    loteFechaEl.style.color = '#10b981';
                    
                    // Click-to-Calculate interactivo
                    if (costoLoteKilo > 0) {
                        loteValEl.className = 'clickable-cost-val lote';
                        loteValEl.setAttribute('onclick', `window.aplicarCostoBaseManual(${costoLoteKilo}, ${!isNaN(ivaLoteVal) ? ivaLoteVal : 'null'}, 'LOTE')`);
                        loteValEl.title = `Haga clic para inyectar este costo ($${costoLoteKilo.toFixed(2)}/kg)`;
                    } else {
                        loteValEl.className = '';
                        loteValEl.removeAttribute('onclick');
                        loteValEl.removeAttribute('title');
                    }
                } else {
                    loteValEl.innerText = 'Sin registros';
                    loteBultoEl.innerText = 'Sin registros';
                    loteIvaEl.innerText = 'Sin registros';
                    loteFechaEl.innerText = 'Sin registros';
                    
                    loteValEl.style.color = '#64748b';
                    loteBultoEl.style.color = '#64748b';
                    loteIvaEl.style.color = '#64748b';
                    loteFechaEl.style.color = '#64748b';
                    
                    loteValEl.className = '';
                    loteValEl.removeAttribute('onclick');
                    loteValEl.removeAttribute('title');
                }
            }

            // Sincronización Dinámica de Stock Físico (Ampliación Fase 2)
            // Decisión de diseño: Si el stock es mayor a 0, mostramos en badge verde. Si es 0, mostramos 'Stock: 0' en gris de control.
            const stockBadgeEl = document.getElementById('gp-lote-stock-badge');
            if (stockBadgeEl) {
                const stockUnidades = parseFloat(data.stock_unidades) || 0;
                const stockKilos = parseFloat(data.stock_kilos) || 0;
                
                if (stockUnidades > 0) {
                    stockBadgeEl.innerText = `Stock: ${stockUnidades.toLocaleString('es-AR', { maximumFractionDigits: 2 })} u. (${stockKilos.toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg)`;
                    stockBadgeEl.style.background = '#dcfce7';
                    stockBadgeEl.style.color = '#166534';
                    stockBadgeEl.style.borderColor = '#bbf7d0';
                } else {
                    stockBadgeEl.innerText = 'Stock: 0';
                    stockBadgeEl.style.background = '#f1f5f9';
                    stockBadgeEl.style.color = '#64748b';
                    stockBadgeEl.style.borderColor = '#cbd5e1';
                }
            }

            // Sincronización impositiva de IVA en la Calculadora de Precios superior
            const loteIvaCalcEl = document.getElementById('gp-iva-lote-val-calc');
            if (loteIvaCalcEl) {
                let initialIvaVal = 21.00;
                if (data.lote && !isNaN(parseFloat(data.lote.impuesto_iva))) {
                    initialIvaVal = parseFloat(data.lote.impuesto_iva);
                } else if (!isNaN(parseFloat(data.porcentaje_iva))) {
                    initialIvaVal = parseFloat(data.porcentaje_iva);
                }
                loteIvaCalcEl.value = initialIvaVal.toFixed(2);
            }

            // TARJETA 3: COSTO COMPUESTO POR RECETA / INGREDIENTES (Fase 3)
            // Decisión de diseño: Renderizar el costo por receta de forma elástica en azul, o 'Sin registros' si no posee receta.
            const recKiloEl = document.getElementById('gp-costo-receta-kilo');
            const recBultoEl = document.getElementById('gp-costo-receta-bulto');
            const recTipoEl = document.getElementById('gp-receta-tipo-val');
            const recBadgeEl = document.getElementById('gp-receta-origen-badge');

            if (recKiloEl && recBultoEl && recTipoEl && recBadgeEl) {
                const hasRecipe = !!data.receta_id;

                if (hasRecipe) {
                    let recKiloVal = gp_liveIngredienteCost;
                    let estructuraTipo = 'Receta';
                    let origenTexto = `ID: ${data.receta_id}`;

                    const recBultoVal = recKiloVal * gp_factorPresentacion;

                    recKiloEl.innerText = recKiloVal > 0 ? currencyFormatter.format(recKiloVal) : 'N/A';
                    recBultoEl.innerText = recBultoVal > 0 ? currencyFormatter.format(recBultoVal) : 'N/A';
                    recTipoEl.innerText = estructuraTipo;
                    recBadgeEl.innerText = origenTexto;

                    recKiloEl.style.color = '#0284c7';
                    recBultoEl.style.color = '#0284c7';
                    recTipoEl.style.color = '#0284c7';
                    
                    recBadgeEl.style.background = '#e0f2fe';
                    recBadgeEl.style.color = '#0369a1';
                    recBadgeEl.style.borderColor = '#bae6fd';
                    
                    // Click-to-Calculate interactivo
                    if (recKiloVal > 0) {
                        recKiloEl.className = 'clickable-cost-val receta';
                        recKiloEl.setAttribute('onclick', `window.aplicarCostoBaseManual(${recKiloVal}, null, 'RECETA')`);
                        recKiloEl.title = `Haga clic para inyectar este costo ($${recKiloVal.toFixed(2)}/kg) en la calculadora`;
                    } else {
                        recKiloEl.className = '';
                        recKiloEl.removeAttribute('onclick');
                        recKiloEl.removeAttribute('title');
                    }
                } else {
                    recKiloEl.innerText = 'Sin registros';
                    recBultoEl.innerText = 'Sin registros';
                    recTipoEl.innerText = 'N/A';
                    recBadgeEl.innerText = 'Sin registros';

                    recKiloEl.style.color = '#64748b';
                    recBultoEl.style.color = '#64748b';
                    recTipoEl.style.color = '#64748b';

                    recBadgeEl.style.background = '#f1f5f9';
                    recBadgeEl.style.color = '#64748b';
                    recBadgeEl.style.borderColor = '#cbd5e1';
                    
                    recKiloEl.className = '';
                    recKiloEl.removeAttribute('onclick');
                    recKiloEl.removeAttribute('title');
                }
            }

            // Hydrate Tarjeta 5: Estructura Pack Hijo
            if (typeof window.actualizarTarjetaPackHijo === 'function') {
                window.actualizarTarjetaPackHijo();
            }

            // Renderizar la Receta Activa de Origen
            const recetaInfoBadge = document.getElementById('gp-receta-info-badge');
            const recetaIngredientes = document.getElementById('gp-receta-ingredientes');
            const btnEliminarReceta = document.getElementById('gp-btn-eliminar-receta');
            
            if (recetaInfoBadge && recetaIngredientes) {
                if (data.receta_id) {
                    if (btnEliminarReceta) btnEliminarReceta.style.display = 'inline-flex';
                    recetaInfoBadge.innerText = `RECETA ID: ${data.receta_id}`;
                    recetaInfoBadge.style.background = '#dbeafe';
                    recetaInfoBadge.style.color = '#1e40af';
                    
                    let html = '';
                    if (data.receta_ingredientes && data.receta_ingredientes.length > 0) {
                        const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
                        let rowsHtml = '';
                        let recetaTotalCost = 0;
                        
                        data.receta_ingredientes.forEach(ing => {
                            const costoUnitario = parseFloat(ing.costo_patron || 0);
                            const cantidad = parseFloat(ing.cantidad || 0);
                            const subtotal = cantidad * costoUnitario;
                            recetaTotalCost += subtotal;
                            
                            rowsHtml += `
                                <tr style="border-bottom: 1px solid #cbd5e1;">
                                    <td style="padding: 10px 12px; text-align: left; font-weight: 600; color: #1e293b;">
                                        ${ing.nombre_ingrediente}
                                    </td>
                                    <td style="padding: 10px 12px; text-align: center; font-family: monospace; font-weight: bold; color: #475569; background: #f8fafc;">
                                        ${cantidad.toLocaleString('es-AR', {minimumFractionDigits: 3, maximumFractionDigits: 3})} ${ing.unidad_medida}
                                    </td>
                                    <td style="padding: 10px 12px; text-align: right; font-family: monospace; color: #475569;">
                                        ${currencyFormatter.format(costoUnitario)}/${ing.unidad_medida === 'u' ? 'u' : 'kg'}
                                    </td>
                                    <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-weight: bold; color: #1e3a8a; background: #f8fafc;">
                                        ${currencyFormatter.format(subtotal)}
                                    </td>
                                </tr>
                            `;
                        });

                        recetaIngredientes.style.display = 'block'; // Quitar grid layout para compatibilidad de tabla
                        html = `
                            <table class="tabla-financiera" style="width: 100%; border-collapse: collapse; margin-top: 8px; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                                <thead>
                                    <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                                        <th style="text-align: left; padding: 10px 12px; color: #475569; font-weight: 700; font-size: 0.88em;">Componente de Receta</th>
                                        <th style="text-align: center; padding: 10px 12px; width: 130px; color: #475569; font-weight: 700; font-size: 0.88em;">Cantidad</th>
                                        <th style="text-align: right; padding: 10px 12px; width: 165px; color: #475569; font-weight: 700; font-size: 0.88em;">Costo Unitario (Patrón)</th>
                                        <th style="text-align: right; padding: 10px 12px; width: 170px; color: #475569; font-weight: 700; font-size: 0.88em;">Subtotal de Línea</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rowsHtml}
                                </tbody>
                                <tfoot>
                                    <tr style="background-color: #e2e8f0; font-weight: 800; border-top: 2px solid #94a3b8; font-size: 1.02em;">
                                        <td colspan="3" style="text-align: left; padding: 12px; color: #1e293b;">
                                            💰 Costo Total de Producción (Origen)
                                        </td>
                                        <td id="gp-receta-total-cost-origen" onclick="window.confirmarRecetaOrigenTotalCost(${recetaTotalCost / gp_factorPresentacion}, ${recetaTotalCost})" class="clickable-cost-val receta" style="text-align: right; padding: 12px; color: #1e3a8a; font-family: monospace; font-size: 1.15em; cursor: pointer;" title="Haga clic para inyectar este costo equivalente ($${(recetaTotalCost / gp_factorPresentacion).toFixed(2)}/kg) en la calculadora">
                                            ${currencyFormatter.format(recetaTotalCost)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        `;
                    }
                    recetaIngredientes.innerHTML = html || '<div style="grid-column: 1/-1; text-align: center; color: #64748b; font-style: italic; padding: 10px;">La receta no posee ingredientes configurados.</div>';
                } else {
                    if (btnEliminarReceta) btnEliminarReceta.style.display = 'none';
                    recetaInfoBadge.innerText = 'Sin Receta';
                    recetaInfoBadge.style.background = '#fef3c7';
                    recetaInfoBadge.style.color = '#d97706';
                    recetaIngredientes.style.display = 'block'; // Quitar grid
                    recetaIngredientes.innerHTML = `
                        <div style="grid-column: 1/-1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; background: #fffbeb; border: 1px dashed #fcd34d; border-radius: 6px; color: #b45309; font-weight: 500; font-size: 0.9em;">
                            ⚠️ Este artículo no posee una receta de producción activa.
                        </div>
                    `;
                }
            }
            
            window.gp_receta_id_existente = data.receta_id || null;

            // Poblar y reconectar campos del asistente de mano de obra y servicios desde propiedades_dinamicas
            const props = data.propiedades_dinamicas || {};
            
            // Garantizar que la lista de colaboradores y mapa de tarifas estén cargados
            if (typeof window.cargarColaboradoresAsistente === 'function') {
                await window.cargarColaboradoresAsistente();
            }

            const colabSelect = document.getElementById('gp-asistente-colaborador');
            const minutosInput = document.getElementById('gp-asistente-minutos');
            if (colabSelect) {
                colabSelect.value = props.asistente_colaborador_id !== undefined && props.asistente_colaborador_id !== null ? props.asistente_colaborador_id : '';
            }
            if (minutosInput) {
                minutosInput.value = props.asistente_minutos !== undefined && props.asistente_minutos !== null ? props.asistente_minutos : '';
            }

            // Si hay un colaborador o minutos de servicio asignados, ejecutar el cálculo automático del asistente
            if (typeof window.calcularCostoAsistente === 'function' && (props.asistente_colaborador_id || parseFloat(props.asistente_minutos) > 0)) {
                window.calcularCostoAsistente();
            }

            // Sincronizar y consultar métricas reales de planta (Fase de Métricas de Campo)
            if (typeof window.consultarMetricasCampoArticulo === 'function') {
                await window.consultarMetricasCampoArticulo(articulo_id);
            }

            gp_listasFinancieras = data.listas_margenes;

            // Pre-calcular flag asistente_override
            let colabId = props.asistente_colaborador_id;
            let minutos = parseFloat(props.asistente_minutos) || 0;
            let tarifa = colabId ? (window.gp_colaboradores_tarifas_map[colabId] || 0) : 0;
            let calculatedCost = (tarifa * minutos) / 60;

            gp_listasFinancieras.forEach(l => {
                let costTiempo = parseFloat(l.costo_tiempo) || 0;
                if (calculatedCost > 0) {
                    l.asistente_override = (Math.abs(costTiempo - calculatedCost) > 0.01);
                } else {
                    l.asistente_override = (costTiempo > 0);
                }
            });

            renderTabs();
            
            // Sincronizar solapa con la lista activa en la grilla principal (listaSeleccionadaGlobal)
            let targetTabIdx = gp_listasFinancieras.findIndex(l => Number(l.lista_id) === Number(listaSeleccionadaGlobal));
            if (targetTabIdx === -1) {
                targetTabIdx = 0;
            }
            selectTab(targetTabIdx);

            // FASE 20 & FASE 21: Sonda de Vínculos UP (Carro Externo / Tostadero) con Reconexión Homologada
            const cardTostaderoEl = document.getElementById('gp-card-tostadero');
            const tostaderoCrudoValEl = document.getElementById('gp-tostadero-crudo-val');
            const tostaderoMermaValEl = document.getElementById('gp-tostadero-merma-val');
            const tostaderoBadgeEl = document.getElementById('gp-tostadero-badge');

            let crudoNombreResolved = data.nombre_ingrediente_ref || data.parent_descripcion || null;
            let mermaValResolved = (props && props.tostadero_simulacion && props.tostadero_simulacion.merma !== undefined)
                ? props.tostadero_simulacion.merma
                : (data.porcentaje_merma !== undefined && data.porcentaje_merma !== null ? data.porcentaje_merma : null);
            let isVinculadoDirectoUP = false;
            const querySku = (data && (data.articulo_id || data.articulo_numero)) || articulo_id || (data && data.nombre) || (data && data.descripcion) || '';

            // Consultar Sonda UP (Unidad Productiva) de Carro Externo desde mermas-historicas
            try {
                console.log(`🔍 [SONDA UP FRONTEND HARD-DEBUG] abrirGestorPrecios fetch mermas-historicas querySku: "${querySku}" (articulo_id: "${articulo_id}")`);
                const resMer = await fetch(`/api/logistica/bunker/mermas-historicas?sku_salida=${encodeURIComponent(querySku)}`);
                if (resMer.ok) {
                    const merData = await resMer.json();
                    console.log("🔍 [SONDA UP FRONTEND HARD-DEBUG] Response merData:", merData);
                    if (merData.enlazado && merData.vinculo_directo && merData.descripcion_entrada && merData.descripcion_entrada !== 'Sin vincular') {
                        crudoNombreResolved = merData.descripcion_entrada;
                        isVinculadoDirectoUP = true;
                        if (mermaValResolved === null && merData.merma_promedio !== undefined) {
                            mermaValResolved = merData.merma_promedio;
                        }
                    }
                }
            } catch (errMer) {
                console.error("Error al consultar Sonda UP de Tostadero:", errMer);
            }
            window.gp_isVinculadoDirectoUP = isVinculadoDirectoUP;
            const currentArtId = data ? (data.articulo_id || data.articulo_numero) : articulo_id;
            const currentSku = querySku || (data ? (data.articulo_numero || data.sku) : '');
            window.currentArticuloIdGlobal = currentArtId;
            window.currentSkuGlobal = currentSku;

            const keyId = currentArtId ? `bunker_modo_unidad_${currentArtId}` : null;
            const keySku = currentSku ? `bunker_modo_unidad_${currentSku}` : null;
            const modoSaved = (keyId ? localStorage.getItem(keyId) : null) || (keySku ? localStorage.getItem(keySku) : null);
            const chkEl = document.getElementById('gp-tostadero-modo-unidad-check');
            const piezasContainer = document.getElementById('gp-tostadero-piezas-container');
            const piezasInput = document.getElementById('gp-tostadero-piezas-input');

            const isModoPiezasActive = (modoSaved === 'UNIDAD');
            if (chkEl) {
                chkEl.checked = isModoPiezasActive;
            }
            if (piezasContainer) {
                piezasContainer.style.display = isModoPiezasActive ? 'flex' : 'none';
            }

            // Persistencia e Inmunidad de Piezas (v5.74)
            const simData = props ? props.tostadero_simulacion : null;
            const piezasSavedBD = simData ? parseInt(simData.cantidad_piezas) : null;
            const keyPiezasId = currentArtId ? `bunker_piezas_qty_${currentArtId}` : null;
            const keyPiezasSku = currentSku ? `bunker_piezas_qty_${currentSku}` : null;
            const piezasSavedLS = (keyPiezasId ? localStorage.getItem(keyPiezasId) : null) || (keyPiezasSku ? localStorage.getItem(keyPiezasSku) : null);
            const piezasResolved = piezasSavedBD || (piezasSavedLS ? parseInt(piezasSavedLS) : null) || parseInt(data.pack_unidades) || 20;

            if (piezasInput) {
                piezasInput.value = piezasResolved;
                piezasInput.oninput = (e) => {
                    const newQty = parseInt(e.target.value) || 1;
                    if (keyPiezasId) localStorage.setItem(keyPiezasId, newQty);
                    if (keyPiezasSku) localStorage.setItem(keyPiezasSku, newQty);
                    if (!window.gp_current_articulo_data) window.gp_current_articulo_data = {};
                    if (!window.gp_current_articulo_data.propiedades_dinamicas) window.gp_current_articulo_data.propiedades_dinamicas = {};
                    if (!window.gp_current_articulo_data.propiedades_dinamicas.tostadero_simulacion) window.gp_current_articulo_data.propiedades_dinamicas.tostadero_simulacion = {};
                    window.gp_current_articulo_data.propiedades_dinamicas.tostadero_simulacion.cantidad_piezas = newQty;
                    
                    if (typeof window.recalcularSimulacionTostadero === 'function') {
                        window.recalcularSimulacionTostadero();
                    }
                };
            }

            if (chkEl) {
                chkEl.onchange = (e) => {
                    const isChecked = e.target.checked;
                    if (piezasContainer) piezasContainer.style.display = isChecked ? 'flex' : 'none';
                    const modeVal = isChecked ? 'UNIDAD' : 'KILO';
                    if (keyId) localStorage.setItem(keyId, modeVal);
                    if (keySku) localStorage.setItem(keySku, modeVal);
                    if (typeof window.recalcularSimulacionTostadero === 'function') {
                        window.recalcularSimulacionTostadero();
                    }
                };
            }

            if (isVinculadoDirectoUP) {
                if (cardTostaderoEl) cardTostaderoEl.style.display = 'flex';
                if (tostaderoCrudoValEl) {
                    tostaderoCrudoValEl.innerText = crudoNombreResolved;
                    tostaderoCrudoValEl.style.color = '#b45309';
                    tostaderoCrudoValEl.title = `Materia prima / Mezcla de UP enlazada: ${crudoNombreResolved}`;
                }

                let mermaText = '- %';
                if (mermaValResolved !== null && mermaValResolved !== undefined) {
                    mermaText = `${parseFloat(mermaValResolved).toFixed(1)} %`;
                }
                
                if (tostaderoMermaValEl) {
                    tostaderoMermaValEl.innerText = mermaText;
                    tostaderoMermaValEl.style.color = '#b45309';
                }

                if (tostaderoBadgeEl) {
                    if (props && props.tostadero_simulacion) {
                        tostaderoBadgeEl.innerText = '🔥 Estacionado';
                        tostaderoBadgeEl.style.background = '#fde68a';
                        tostaderoBadgeEl.style.color = '#78350f';
                    } else {
                        tostaderoBadgeEl.innerText = '📌 Vinc. Activa';
                        tostaderoBadgeEl.style.background = '#fef3c7';
                        tostaderoBadgeEl.style.color = '#b45309';
                    }
                }
            } else {
                if (cardTostaderoEl) cardTostaderoEl.style.display = 'none';
            }

            if (simData && parseFloat(simData.costo_final) > 0) {
                const costVal = parseFloat(simData.costo_final) || 0;
                window.gp_costoTostaderoKilo = costVal;
                
                const tostaderoValEl = document.getElementById('gp-costo-tostadero-val');
                if (tostaderoValEl) {
                    tostaderoValEl.innerText = currencyFormatter.format(costVal);
                    tostaderoValEl.setAttribute('onclick', `window.confirmarTostaderoTotalCost(${costVal})`);
                    tostaderoValEl.title = `Haga clic para inyectar este costo ($${costVal.toFixed(2)}/kg) en la calculadora`;
                }
            }

            // FASE 4: Costo de Reposición Vivo (Mapeo Manual Curado)
            renderOfertasReposicion(data.reposicion_ofertas || []);
        } else {
            throw new Error(result.error);
        }
    } catch(e) {
        console.error("Error opening financial manager:", e);
        Swal.fire('Error', e.message || 'Error de conexión', 'error');
    }
};

window.actualizarUiBotonPatron = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    const btn = document.getElementById('gp-btn-patron');
    if (!btn || !list) return;
    
    if (list.es_patron === true || list.es_patron === 'true') {
        btn.innerHTML = '<span>⭐ Patrón Activo</span>';
        btn.style.background = '#8e4785';
        btn.style.color = 'white';
        btn.style.borderColor = '#8e4785';
        btn.style.boxShadow = '0 2px 5px rgba(142, 71, 133, 0.2)';
    } else {
        btn.innerHTML = '<span>☆ Setear como Patrón</span>';
        btn.style.background = 'transparent';
        btn.style.color = '#64748b';
        btn.style.borderColor = '#cbd5e1';
        btn.style.boxShadow = 'none';
    }
};

window.toggleArticuloPatron = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    list.es_patron = !list.es_patron;
    actualizarUiBotonPatron();
    
    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 1500,
        timerProgressBar: true
    });
    Toast.fire({
        icon: 'success',
        title: list.es_patron ? 'Establecido como Artículo Patrón' : 'Quitado estado de Artículo Patrón'
    });
};

window.actualizarTratamientoIva = function(modo) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    list.modo_iva = modo;
    recalcularPreciosGestor();
};

window.toggleMaximizarGestorPrecios = function() {
    const modalContent = document.getElementById('gp-modal-content');
    const btnMaximizar = document.getElementById('gp-btn-maximizar');
    if (!modalContent || !btnMaximizar) return;
    
    const isMaximized = modalContent.getAttribute('data-maximized') === 'true';
    if (isMaximized) {
        // Restaurar
        modalContent.style.width = '95%';
        modalContent.style.maxWidth = '1150px';
        modalContent.style.height = '';
        modalContent.style.maxHeight = '90vh';
        modalContent.style.borderRadius = '12px';
        btnMaximizar.innerHTML = '🗖';
        btnMaximizar.title = 'Maximizar';
        modalContent.setAttribute('data-maximized', 'false');
    } else {
        // Maximizar
        modalContent.style.width = '100vw';
        modalContent.style.maxWidth = '100vw';
        modalContent.style.height = '100vh';
        modalContent.style.maxHeight = '100vh';
        modalContent.style.borderRadius = '0';
        btnMaximizar.innerHTML = '🗗';
        btnMaximizar.title = 'Restaurar';
        modalContent.setAttribute('data-maximized', 'true');
    }
};

window.resetEstadoTostadero = function() {
    // 1. Reset de Variables de Estado Globales
    window.gp_costoTostaderoKilo = null;
    if (window.gp_current_articulo_data) {
        delete window.gp_current_articulo_data.propiedades_dinamicas;
    }
    
    // 2. Reset visual y ocultamiento por defecto de la Tarjeta 4 "Costo Tostadero (Carro Externo)"
    const cardTostaderoEl = document.getElementById('gp-card-tostadero');
    if (cardTostaderoEl) {
        cardTostaderoEl.style.display = 'none';
    }

    const tostaderoValEl = document.getElementById('gp-costo-tostadero-val');
    if (tostaderoValEl) {
        tostaderoValEl.innerText = '$ 0,00';
        tostaderoValEl.removeAttribute('onclick');
        tostaderoValEl.removeAttribute('title');
        tostaderoValEl.style.boxShadow = 'none';
        tostaderoValEl.style.borderColor = '';
        tostaderoValEl.className = 'clickable-cost-val tostadero';
    }

    const tostaderoBadge = document.getElementById('gp-tostadero-badge');
    if (tostaderoBadge) {
        tostaderoBadge.innerText = 'Simular';
        tostaderoBadge.style.background = '#fef3c7';
        tostaderoBadge.style.color = '#b45309';
    }

    const tostaderoCrudoVal = document.getElementById('gp-tostadero-crudo-val');
    if (tostaderoCrudoVal) {
        tostaderoCrudoVal.innerText = 'Sin vincular';
    }

    const tostaderoMermaVal = document.getElementById('gp-tostadero-merma-val');
    if (tostaderoMermaVal) {
        tostaderoMermaVal.innerText = '- %';
    }

    const calcSimBtn = document.getElementById('btn-simulador-costo');
    if (calcSimBtn) {
        calcSimBtn.innerText = '⚙️ Simular Tostadero';
        calcSimBtn.style.background = '#fcd34d';
        calcSimBtn.style.color = '#78350f';
    }
};

window.cerrarGestorPrecios = function() {
    document.getElementById('modal-gestor-precios').style.display = 'none';
    const modalContent = document.getElementById('gp-modal-content');
    const btnMaximizar = document.getElementById('gp-btn-maximizar');
    if (modalContent && modalContent.getAttribute('data-maximized') === 'true') {
        modalContent.style.width = '95%';
        modalContent.style.maxWidth = '1150px';
        modalContent.style.height = '';
        modalContent.style.maxHeight = '90vh';
        modalContent.style.borderRadius = '12px';
        if (btnMaximizar) {
            btnMaximizar.innerHTML = '🗖';
            btnMaximizar.title = 'Maximizar';
        }
        modalContent.setAttribute('data-maximized', 'false');
    }
    
    // FASE 17 & FASE 19: Teardown / Reset de Higiene Estricta de Estado del Tostadero, Tarjeta 4 y Re-activación del Buscador Principal (Ley I)
    if (typeof window.resetEstadoTostadero === 'function') {
        window.resetEstadoTostadero();
    }

    // Re-vincular listener y restablecer foco en el buscador principal (#filtro-busqueda)
    const inputBusqueda = document.getElementById('filtro-busqueda');
    if (inputBusqueda) {
        inputBusqueda.removeEventListener('input', window.filtrarBunkerEnVivo);
        inputBusqueda.addEventListener('input', window.filtrarBunkerEnVivo);
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }
    }

    // Refrescar reactivamente la grilla y filtro en vivo
    if (typeof window.aplicarFiltrosYOrdenamiento === 'function') {
        window.aplicarFiltrosYOrdenamiento();
    }
};

/**
 * MÓDULO INTERACTIVO BÚNKER - CLICK-TO-CALCULATE
 * Inyecta un costo base seleccionado por el operador directamente en la calculadora superior.
 */
window.confirmarIvaNativoManual = function(val) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;

    let parseFloatVal = parseFloat(val);
    // Observación B: Si el operador borró el texto (caja vacía o NaN), asumir 0.00% temporalmente sin congelar
    if (isNaN(parseFloatVal)) {
        parseFloatVal = 0.00;
    }

    list.iva = parseFloatVal;
    list.modo_origen_iva = 'PERSONALIZADO';

    const labelEl = document.getElementById('gp-iva-label-text');
    if (labelEl) {
        labelEl.innerText = "IVA Personalizado:";
    }

    if (typeof window.recalcularPreciosGestor === 'function') {
        window.recalcularPreciosGestor();
    }
};

window.propagarIvaGlobalBoton = async function() {
    const list = (typeof gp_listasFinancieras !== 'undefined' && Array.isArray(gp_listasFinancieras)) 
        ? gp_listasFinancieras[gp_activeTabIdx] 
        : null;

    const inputEl = document.getElementById('gp-iva-lote-val-calc');
    let targetIva = inputEl ? parseFloat(inputEl.value) : (list ? parseFloat(list.iva) : 21.00);

    if (isNaN(targetIva) || targetIva < 0) {
        targetIva = 21.00;
    }

    // 💬 MODAL INTERACTIVO DE DECISIÓN EXPLÍCITA (SweetAlert2)
    const result = await Swal.fire({
        title: '¿Propagar alícuota de IVA?',
        html: `¿Desea aplicar la alícuota de <strong>${targetIva.toFixed(2)}%</strong> de IVA a <strong>todas las listas de precios</strong> de este artículo?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#8e4785',
        cancelButtonColor: '#64748b',
        confirmButtonText: '🌐 Sí, Propagar a todas',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        // 🚀 OPCIÓN B: PROPAGACIÓN GLOBAL EN MEMORIA Y RECALCULO REACTIVO EN DOM
        if (typeof gp_parentPorcentajeIva !== 'undefined') {
            gp_parentPorcentajeIva = targetIva;
        }
        
        if (typeof gp_listasFinancieras !== 'undefined' && Array.isArray(gp_listasFinancieras)) {
            gp_listasFinancieras.forEach(l => {
                l.iva = targetIva;
                l.modo_origen_iva = 'PERSONALIZADO'; // 🛡️ ENUM UNIFICADO DE BASE DE DATOS
            });
        }
        if (typeof gp_childListsCosts !== 'undefined' && Array.isArray(gp_childListsCosts)) {
            gp_childListsCosts.forEach(l => {
                l.iva = targetIva;
                l.modo_origen_iva = 'PERSONALIZADO'; // 🛡️ ENUM UNIFICADO DE BASE DE DATOS
            });
        }

        // 🛡️ INVOCACIÓN SEGURA DE RENDERIZADO GLOBAL
        if (typeof window.recalcularPreciosGestor === 'function') {
            window.recalcularPreciosGestor();
        }

        if (typeof Swal !== 'undefined') {
            Swal.fire({
                title: 'Vista Previa Actualizada',
                text: `Alícuota de ${targetIva.toFixed(2)}% de IVA aplicada a todas las listas en vista previa (Pendiente de guardado final).`,
                icon: 'info',
                timer: 2200,
                showConfirmButton: false
            });
        }
    }
};

window.aplicarCostoBaseManual = async function(costVal, ivaVal = null, fuenteOrigen = 'MANUAL', etiquetaTexto = null) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    // Blindaje de nulos
    if (costVal === undefined || costVal === null || isNaN(costVal) || parseFloat(costVal) <= 0) return;
    
    let finalCostKilo = parseFloat(costVal);
    const factorKg = parseFloat(gp_factorPresentacion || 1.0);

    // 1️⃣ DESAMBIGUACIÓN BULTO VS KILO PARA ETIQUETAS DE COSTOS VIVOS Y OFERTAS DE PROVEEDORES
    if (fuenteOrigen !== 'MANUAL') {
        const fmtVal = finalCostKilo.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fmtKiloIfBulto = (finalCostKilo / (factorKg || 1)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const unitChoice = await Swal.fire({
            title: '⚖️ ¿El Importe es por Bulto o por Kilo?',
            html: `
                <div style="text-align: left; font-size: 0.95em; color: #334155;">
                    <p style="margin-bottom: 10px;">El importe seleccionado es de <strong style="color: #6b21a8; font-size: 1.1em;">$ ${fmtVal}</strong>.</p>
                    <p style="margin-bottom: 12px; color: #475569;">
                        ¿Este valor corresponde al <strong>precio del BULTO completo</strong> (${factorKg > 0 ? (factorKg < 1 ? Math.round(factorKg*1000) + ' g' : factorKg.toFixed(2) + ' kg') : '1 bulto'}) o al <strong>precio por KILO</strong>?
                    </p>
                    <div style="background: #faf5ff; border: 1px solid #e9d5ff; padding: 10px; border-radius: 6px; font-size: 0.85em; color: #6b21a8;">
                        • Si es <strong>BULTO</strong>: Se calculará como <strong>$ ${fmtKiloIfBulto} / kg</strong> ($ ${fmtVal} / ${factorKg} kg).<br>
                        • Si es <strong>KILO</strong>: Se mantendrá como <strong>$ ${fmtVal} / kg</strong>.
                    </div>
                </div>
            `,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: `📦 Precio por BULTO ($ ${fmtKiloIfBulto}/kg)`,
            denyButtonText: `⚖️ Precio por KILO ($ ${fmtVal}/kg)`,
            showDenyButton: true,
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#7e22ce',
            denyButtonColor: '#0284c7',
            cancelButtonColor: '#64748b'
        });

        if (unitChoice.isDismissed) return;

        if (unitChoice.isConfirmed) {
            // Se declaró como Precio por Bulto -> Convertir a Kilo
            finalCostKilo = finalCostKilo / (factorKg || 1);
        } else if (unitChoice.isDenied) {
            // Se declaró como Precio por Kilo directamente
            finalCostKilo = finalCostKilo;
        }
    }

    let scopeSelection = 'ALL';

    // 2️⃣ SELECCIÓN DE ALCANCE E IVA
    if (fuenteOrigen === 'REPOSICION_BLIND' && (ivaVal === null || ivaVal === undefined)) {
        const defaultIva = (list.iva !== undefined && list.iva !== null) ? list.iva : 21.00;
        const fmtCost = finalCostKilo.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        
        const { value: formValues, isDismissed } = await Swal.fire({
            title: '🛍️ Oferta de Proveedor (Declaración & Alcance)',
            html: `
                <div style="text-align: left; font-size: 0.95em;">
                    <p style="margin-bottom: 10px;">Costo por kilo resultador: <b style="color:#7e22ce; font-size:1.1em;">$ ${fmtCost}/kg</b>.</p>
                    <label style="font-weight: bold; color: #1e293b; display: block; margin-bottom: 4px;">Alícuota de IVA aplicable (%):</label>
                    <input id="swal-input-iva" type="number" step="0.01" min="0" max="100" class="swal2-input" value="${defaultIva}" style="width: 100%; margin: 0 0 15px 0; box-sizing: border-box;">
                    
                    <label style="font-weight: bold; color: #1e293b; display: block; margin-bottom: 4px;">Alcance de la Inyección de Costo:</label>
                    <select id="swal-select-scope" class="swal2-select" style="width: 100%; margin: 0; padding: 8px; border-radius: 6px; border: 1px solid #cbd5e1; font-weight: bold;">
                        <option value="ALL" selected>🌐 Aplicar a TODAS las listas de precios (Recomendado)</option>
                        <option value="SINGLE">🎯 Aplicar SOLO a la lista actual ("${list.nombre_lista}")</option>
                    </select>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Aplicar Costo',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const ivaValInput = document.getElementById('swal-input-iva').value;
                const scopeValSelect = document.getElementById('swal-select-scope').value;
                if (!ivaValInput || isNaN(parseFloat(ivaValInput))) {
                    Swal.showValidationMessage('Ingrese una alícuota de IVA válida');
                    return false;
                }
                return {
                    iva: parseFloat(ivaValInput),
                    scope: scopeValSelect
                };
            }
        });
        
        if (isDismissed || !formValues) return;
        ivaVal = formValues.iva;
        scopeSelection = formValues.scope;
    } else {
        const fmtCost = finalCostKilo.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fuenteDesc = etiquetaTexto ? etiquetaTexto.replace(':', '') : (
            fuenteOrigen === 'LOMASOFT' ? 'Historial Lomasoft' :
            fuenteOrigen === 'LOTE' ? 'Lote Reciente' :
            fuenteOrigen === 'RECETA' ? 'Matriz Receta' : 'Costo Manual'
        );

        const { value: scopeChoice, isDismissed } = await Swal.fire({
            title: 'Alcance de Inyección de Costo',
            html: `¿Dónde desea inyectar el costo base de <b style="color:#7e22ce; font-size:1.1em;">$ ${fmtCost}/kg</b> (${fuenteDesc})?`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: '🌐 Aplicar a TODAS las Listas',
            denyButtonText: '🎯 Aplicar SOLO a esta Lista',
            showDenyButton: true,
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#7e22ce',
            denyButtonColor: '#0284c7',
            cancelButtonColor: '#64748b'
        });

        if (isDismissed) return;
        scopeSelection = scopeChoice === true ? 'ALL' : 'SINGLE';
    }

    // Desactivar la herencia automática en la UI
    const heredarCheckbox = document.getElementById('gp-heredar-costo');
    if (heredarCheckbox) {
        heredarCheckbox.checked = false;
    }

    // Aplicar propagación según el alcance seleccionado
    if (scopeSelection === 'ALL') {
        gp_listasFinancieras.forEach(l => {
            l.costo_base_sobrescrito = finalCostKilo;
            if (ivaVal !== null && ivaVal !== undefined && !isNaN(parseFloat(ivaVal))) {
                l.iva = parseFloat(ivaVal);
                l.modo_origen_iva = fuenteOrigen;
            }
        });
    } else {
        list.costo_base_sobrescrito = finalCostKilo;
        if (ivaVal !== null && ivaVal !== undefined && !isNaN(parseFloat(ivaVal))) {
            list.iva = parseFloat(ivaVal);
            list.modo_origen_iva = fuenteOrigen;
        }
    }

    // Actualizar alícuota en el DOM activo
    if (ivaVal !== null && ivaVal !== undefined && !isNaN(parseFloat(ivaVal))) {
        const inputIvaEl = document.getElementById('gp-iva-lote-val-calc');
        if (inputIvaEl) {
            inputIvaEl.value = parseFloat(ivaVal).toFixed(2);
        }
    }

    const labelEl = document.getElementById('gp-iva-label-text');
    if (labelEl) {
        if (etiquetaTexto) {
            labelEl.innerText = etiquetaTexto;
        } else if (fuenteOrigen === 'LOMASOFT') {
            labelEl.innerText = "IVA Lomasoft:";
        } else if (fuenteOrigen === 'LOTE') {
            labelEl.innerText = "IVA Nativo Lote:";
        } else if (fuenteOrigen === 'REPOSICION' || fuenteOrigen === 'REPOSICION_BLIND') {
            labelEl.innerText = "IVA Oferta Proveedor:";
        } else if (fuenteOrigen === 'RECETA') {
            labelEl.innerText = "IVA Matriz Receta:";
        } else if (fuenteOrigen === 'PACK_HIJO') {
            labelEl.innerText = "IVA Nativo Hijo:";
        } else {
            labelEl.innerText = "IVA Personalizado:";
        }
    }
    
    const manualInput = document.getElementById('gp-costo-manual');
    if (manualInput) {
        manualInput.disabled = false;
        manualInput.style.backgroundColor = 'white';
        manualInput.value = parseFloat(costVal).toFixed(2);
        
        // Efecto visual premium glow verde instantáneo
        manualInput.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.6)';
        manualInput.style.borderColor = '#10b981';
        setTimeout(() => {
            manualInput.style.boxShadow = 'none';
            manualInput.style.borderColor = '#cbd5e1';
        }, 1500);
    }
    
    // Cadena polinómica de recálculo reactivo en tiempo real
    if (scopeSelection === 'ALL' && typeof window.recalcularTodasLasListasFinancieras === 'function') {
        window.recalcularTodasLasListasFinancieras();
    } else {
        recalcularPreciosGestor();
    }
    
    // Confirmación visual Toast adaptativa
    const scopeToastText = scopeSelection === 'ALL' ? 'propagado a TODAS las listas' : `aplicado a "${list.nombre_lista}"`;
    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true
    });
    Toast.fire({
        icon: 'success',
        title: `Costo $${parseFloat(costVal).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg ${scopeToastText}`
    });
};

window.confirmarRecetaOrigenTotalCost = async function(costoKilo, costoTotalBulto) {
    const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    const fmtKilo = currencyFormatter.format(costoKilo || 0);
    const fmtBulto = currencyFormatter.format(costoTotalBulto || 0);

    const activeList = (typeof gp_listasFinancieras !== 'undefined' && Array.isArray(gp_listasFinancieras)) ? gp_listasFinancieras[gp_activeTabIdx] : null;
    const currentBaseCost = activeList ? ((activeList.costo_base_sobrescrito !== null && activeList.costo_base_sobrescrito !== undefined && parseFloat(activeList.costo_base_sobrescrito) > 0) ? parseFloat(activeList.costo_base_sobrescrito) : (parseFloat(gp_liveIngredienteCost) || parseFloat(gp_costoLomasoftKilo) || 0)) : 0;
    const kVal = parseFloat(costoKilo) || 0;
    const finalSummedCost = Number((currentBaseCost + kVal).toFixed(2));
    const fmtSummed = currencyFormatter.format(finalSummedCost);

    const isUP = !!window.gp_isVinculadoDirectoUP;
    let userAction = null; // 'REPLACE_ALL', 'REPLACE_ONE', 'SUM_ALL', 'SUM_ONE'

    if (!isUP) {
        // Artículos comunes / fraccionados: Reemplazo por defecto (2 opciones)
        const result = await Swal.fire({
            title: '¿Dónde desea inyectar el costo de Receta / Origen?',
            html: `Ha seleccionado el costo de producción/origen de <b style="color: #0284c7; font-size: 1.1em;">${fmtKilo} / kg</b> (${fmtBulto} total bulto).<br><br><b>Regla de Reemplazo:</b> Este valor <b>reemplazará</b> el costo base actual.<br><br>¿Desea aplicar este reemplazo a todas las listas de precios o solo a la lista actual?`,
            icon: 'question',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: '🌐 Reemplazar en TODAS las listas',
            denyButtonText: '🎯 Reemplazar Solamente en ESTA lista',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#0284c7',
            denyButtonColor: '#059669',
            cancelButtonColor: '#64748b'
        });

        if (result.isConfirmed) userAction = 'REPLACE_ALL';
        else if (result.isDenied) userAction = 'REPLACE_ONE';
    } else {
        // Artículos vinculados a UP de Carro Externo: 4 Opciones (Reemplazo vs. Suma)
        await Swal.fire({
            title: 'Inyección de Receta en Artículo UP (Carro Externo)',
            html: `
                <div style="text-align: left; font-size: 0.92em; color: #334155; line-height: 1.4;">
                    Ha seleccionado el costo de producción origen de <b style="color: #0284c7; font-size: 1.1em;">${fmtKilo} / kg</b>.<br>
                    Este artículo posee un <b>Vínculo Directo a Unidad Productiva</b>.<br><br>
                    Elija la acción y el alcance deseado:
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 14px;">
                    <button id="btn-swal-rep-all" class="swal2-confirm swal2-styled" style="background-color: #0284c7; margin: 0; width: 100%;">🌐 Reemplazar en TODAS las listas</button>
                    <button id="btn-swal-rep-one" class="swal2-deny swal2-styled" style="background-color: #059669; margin: 0; width: 100%;">🎯 Reemplazar Solamente en ESTA lista</button>
                    <button id="btn-swal-sum-all" class="swal2-confirm swal2-styled" style="background-color: #d97706; margin: 0; width: 100%;">🟡 Sumar a TODAS las listas (Estilo UP - ${fmtSummed}/kg)</button>
                    <button id="btn-swal-sum-one" class="swal2-deny swal2-styled" style="background-color: #b45309; margin: 0; width: 100%;">🟧 Sumar Solamente a ESTA lista (Estilo UP - ${fmtSummed}/kg)</button>
                </div>
            `,
            showConfirmButton: false,
            showCancelButton: true,
            cancelButtonText: 'Cancelar',
            cancelButtonColor: '#64748b',
            didOpen: () => {
                const b1 = document.getElementById('btn-swal-rep-all');
                const b2 = document.getElementById('btn-swal-rep-one');
                const b3 = document.getElementById('btn-swal-sum-all');
                const b4 = document.getElementById('btn-swal-sum-one');

                if (b1) b1.onclick = () => { userAction = 'REPLACE_ALL'; Swal.close(); };
                if (b2) b2.onclick = () => { userAction = 'REPLACE_ONE'; Swal.close(); };
                if (b3) b3.onclick = () => { userAction = 'SUM_ALL'; Swal.close(); };
                if (b4) b4.onclick = () => { userAction = 'SUM_ONE'; Swal.close(); };
            }
        });
    }

    if (!userAction) return;

    if (userAction === 'REPLACE_ALL') {
        if (typeof gp_listasFinancieras !== 'undefined' && Array.isArray(gp_listasFinancieras)) {
            gp_listasFinancieras.forEach(list => {
                list.costo_base_sobrescrito = Number(kVal.toFixed(2));
                list.costo_receta_adicional = 0;
            });
        }
        const heredarCheck = document.getElementById('gp-heredar-costo');
        if (heredarCheck) heredarCheck.checked = false;
        const inputManual = document.getElementById('gp-costo-manual');
        if (inputManual) inputManual.value = kVal.toFixed(2);
        if (typeof window.recalcularPreciosGestor === 'function') window.recalcularPreciosGestor();
        Swal.fire('¡Reemplazado con Éxito!', `Se reemplazó el costo base en TODAS las listas por ${fmtKilo}/kg.`, 'success');
    } else if (userAction === 'REPLACE_ONE') {
        if (activeList) {
            activeList.costo_base_sobrescrito = Number(kVal.toFixed(2));
            activeList.costo_receta_adicional = 0;
        }
        const heredarCheck = document.getElementById('gp-heredar-costo');
        if (heredarCheck) heredarCheck.checked = false;
        const inputManual = document.getElementById('gp-costo-manual');
        if (inputManual) inputManual.value = kVal.toFixed(2);
        if (typeof window.recalcularPreciosGestor === 'function') window.recalcularPreciosGestor();
        Swal.fire('¡Reemplazado con Éxito!', `Se reemplazó el costo base en ESTA lista por ${fmtKilo}/kg.`, 'success');
    } else if (userAction === 'SUM_ALL') {
        if (typeof gp_listasFinancieras !== 'undefined' && Array.isArray(gp_listasFinancieras)) {
            gp_listasFinancieras.forEach(list => {
                const baseVal = (list.costo_base_sobrescrito !== null && list.costo_base_sobrescrito !== undefined && parseFloat(list.costo_base_sobrescrito) > 0) ? parseFloat(list.costo_base_sobrescrito) : (parseFloat(gp_liveIngredienteCost) || parseFloat(gp_costoLomasoftKilo) || 0);
                list.costo_base_sobrescrito = Number((baseVal + kVal).toFixed(2));
                list.costo_receta_adicional = kVal;
            });
        }
        const heredarCheck = document.getElementById('gp-heredar-costo');
        if (heredarCheck) heredarCheck.checked = false;
        const inputManual = document.getElementById('gp-costo-manual');
        if (inputManual) inputManual.value = finalSummedCost.toFixed(2);
        if (typeof window.recalcularPreciosGestor === 'function') window.recalcularPreciosGestor();
        Swal.fire('¡Sumado con Éxito (UP)!', `Se sumó el costo de producción de origen de ${fmtKilo}/kg a TODAS las listas.`, 'success');
    } else if (userAction === 'SUM_ONE') {
        if (activeList) {
            activeList.costo_base_sobrescrito = Number((currentBaseCost + kVal).toFixed(2));
            activeList.costo_receta_adicional = kVal;
        }
        const heredarCheck = document.getElementById('gp-heredar-costo');
        if (heredarCheck) heredarCheck.checked = false;
        const inputManual = document.getElementById('gp-costo-manual');
        if (inputManual) inputManual.value = finalSummedCost.toFixed(2);
        if (typeof window.recalcularPreciosGestor === 'function') window.recalcularPreciosGestor();
        Swal.fire('¡Sumado con Éxito (UP)!', `Se sumó el costo de producción de origen de ${fmtKilo}/kg a ESTA lista.`, 'success');
    }
};

window.confirmarTostaderoTotalCost = async function(costoKilo) {
    const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    const fmtKilo = currencyFormatter.format(costoKilo || 0);

    const result = await Swal.fire({
        title: '¿Dónde desea aplicar el costo de Tostadero?',
        html: `Ha seleccionado el costo simulado de Tostadero Carro Externo de <b style="color: #d97706; font-size: 1.1em;">${fmtKilo} / kg</b>.<br><br>¿Desea inyectar este costo base a todas las listas de precios o solo a la lista actual?`,
        icon: 'question',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '🌐 Aplicar a TODAS las listas',
        denyButtonText: '🎯 Solamente a ESTA lista',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#0284c7',
        denyButtonColor: '#059669',
        cancelButtonColor: '#64748b'
    });

    if (result.isConfirmed) {
        if (typeof gp_listasFinancieras !== 'undefined' && Array.isArray(gp_listasFinancieras)) {
            gp_listasFinancieras.forEach(list => {
                list.costo_base_sobrescrito = parseFloat(costoKilo) || 0;
            });
            const heredarCheck = document.getElementById('gp-heredar-costo');
            if (heredarCheck) heredarCheck.checked = false;
            const inputManual = document.getElementById('gp-costo-manual');
            if (inputManual) inputManual.value = (parseFloat(costoKilo) || 0).toFixed(2);
            
            if (typeof window.recalcularPreciosGestor === 'function') {
                window.recalcularPreciosGestor();
            }
            Swal.fire('¡Aplicado!', `Se inyectó el costo base de Tostadero de ${fmtKilo}/kg a TODAS las listas de precios.`, 'success');
        }
    } else if (result.isDenied) {
        if (typeof window.aplicarCostoBaseManual === 'function') {
            window.aplicarCostoBaseManual(costoKilo);
        }
        Swal.fire('¡Aplicado!', `Se inyectó el costo base de Tostadero de ${fmtKilo}/kg únicamente a la lista actual.`, 'success');
    }
};

/**
 * MÓDULO INTERACTIVO BÚNKER - DEFAULT PINNING
 * Alterna y fija la fuente de costos predeterminada para la lista de precios activa.
 */
window.establecerFuenteDefault = function(event, fuente) {
    if (event) event.stopPropagation(); // Evitar cascada de clics
    
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    // Validar si la fuente tiene registros válidos (Anti-Erreores)
    if (fuente === 'LOMASOFT' && !(gp_costoLomasoftKilo > 0)) return;
    if (fuente === 'LOTE' && !gp_loteVal) return;
    if (fuente === 'RECETA' && !(gp_liveIngredienteCost > 0)) return;
    if (fuente === 'REPOSICION' && !(gp_reposicionOfertas && gp_reposicionOfertas.length > 0)) return;
    
    // Alternar selección (Toggle)
    if (list.fuente_costo_default === fuente) {
        list.fuente_costo_default = null;
    } else {
        list.fuente_costo_default = fuente;
    }
    
    // Sincronizar visual de pines
    window.actualizarUiPines();
    
    // Toast de convalidación
    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 1500,
        timerProgressBar: true
    });
    Toast.fire({
        icon: 'success',
        title: list.fuente_costo_default 
          ? `Fuente '${fuente}' fijada como predeterminada`
          : 'Fijación de fuente desmarcada'
    });
};

/**
 * Sincroniza visualmente el estado de los pines 📌 activos y pasivos.
 */
window.actualizarUiPines = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    const activeFuente = list.fuente_costo_default;
    
    const syncPin = (pinId, fuenteName, isValid) => {
        const el = document.getElementById(pinId);
        if (!el) return;
        
        if (!isValid) {
            el.className = 'gp-pin-btn disabled';
            return;
        }
        
        if (activeFuente === fuenteName) {
            el.className = 'gp-pin-btn active';
            el.title = `Fijado como predeterminado (${fuenteName})`;
        } else {
            el.className = 'gp-pin-btn';
            el.title = `Fijar '${fuenteName}' como predeterminado`;
        }
    };
    
    syncPin('gp-pin-lomasoft', 'LOMASOFT', gp_costoLomasoftKilo > 0);
    syncPin('gp-pin-lote', 'LOTE', !!gp_loteVal);
    syncPin('gp-pin-receta', 'RECETA', gp_liveIngredienteCost > 0);
    syncPin('gp-pin-reposicion', 'REPOSICION', gp_reposicionOfertas && gp_reposicionOfertas.length > 0);
};

/**
 * Obtiene el valor numérico en caliente de la fuente default seleccionada.
 */
window.obtenerValorFuenteDefault = function(fuente) {
    if (fuente === 'LOMASOFT' && gp_costoLomasoftKilo > 0) {
        return gp_costoLomasoftKilo;
    }
    if (fuente === 'LOTE' && gp_loteVal) {
        return parseFloat(gp_loteVal.costo_kilo_al_momento);
    }
    if (fuente === 'RECETA' && gp_liveIngredienteCost > 0) {
        return gp_liveIngredienteCost;
    }
    if (fuente === 'REPOSICION' && gp_reposicionOfertas && gp_reposicionOfertas.length > 0) {
        return parseFloat(gp_reposicionOfertas[0].precio_unitario);
    }
    return null;
};

function renderTabs() {
    const tabsContainer = document.getElementById('gp-tabs-container');
    tabsContainer.innerHTML = '';
    
    gp_listasFinancieras.forEach((list, idx) => {
        const tab = document.createElement('button');
        tab.className = `btn-secondary`;
        tab.style.cssText = `padding: 8px 16px; border: none; border-radius: 6px 6px 0 0; cursor: pointer; font-weight: bold; font-size: 0.9em; transition: all 0.2s; border-bottom: 2px solid transparent;`;
        
        if (idx === gp_activeTabIdx) {
            tab.style.background = '#8e4785';
            tab.style.color = 'white';
        } else {
            tab.style.background = '#f1f5f9';
            tab.style.color = '#475569';
        }
        tab.innerText = list.nombre_lista;
        tab.onclick = () => selectTab(idx);
        tabsContainer.appendChild(tab);
    });
}

function selectTab(idx) {
    gp_activeTabIdx = idx;
    renderTabs();
    
    const list = gp_listasFinancieras[idx];
    if (!list) return;
    
    // 🔑 SANEAMIENTO CONTROL MANUAL ABSOLUTO (v5.29):
    // Se anula la sobrescritura automática de costo_base_sobrescrito en selectTab().
    // El costo manual ingresado en el Búnker es la regla por defecto en todas las listas.
    /*
    if (list.fuente_costo_default && !gp_packHijoCodigo) {
        const valDefault = window.obtenerValorFuenteDefault(list.fuente_costo_default);
        if (valDefault !== null && valDefault > 0) {
            list.costo_base_sobrescrito = valDefault;
        }
    }
    */
    
    // Configurar Disponibilidad en Catálogo
    const dispCheckbox = document.getElementById('gp-disponibilidad-lista');
    if (dispCheckbox) {
        dispCheckbox.checked = list.disponible !== false;
    }

    // Configurar Exención Operativa de Costos
    const exencionCheckbox = document.getElementById('gp-exencion-operativa');
    if (exencionCheckbox) {
        exencionCheckbox.checked = list.exencion_operativa === true;
    }

    // Configurar Costo Base (🔑 DESELECCIONADO POR DEFECTO PARA ALTAS Y EDICIÓN INICIAL v5.84)
    const inherits = list.heredar_costo_base === true;
    const heredarCheckbox = document.getElementById('gp-heredar-costo');
    if (heredarCheckbox) {
        heredarCheckbox.checked = inherits;
        console.log(`🚨 [VIGÍA DEPURADOR - AUDITORÍA F12] Gestor de Precios (Lista "${list.nombre_lista || list.lista_id}"): Checkbox 'Heredar costo base automático' set a: ${inherits}`);
    }
    
    const manualInput = document.getElementById('gp-costo-manual');
    if (inherits) {
        manualInput.value = gp_liveIngredienteCost.toFixed(2);
        manualInput.disabled = true;
        manualInput.style.backgroundColor = '#f1f5f9';
    } else {
        const valManual = (list.costo_base_sobrescrito !== null && list.costo_base_sobrescrito !== undefined) ? parseFloat(list.costo_base_sobrescrito) : gp_liveIngredienteCost;
        manualInput.value = valManual.toFixed(2);
        manualInput.disabled = false;
        manualInput.style.backgroundColor = 'white';
    }
    
    // Configurar Insumos
    renderInsumosGrid();
    
    // Configurar Costo Tiempo y Sincronización UI Mano de Obra
    document.getElementById('gp-costo-tiempo').value = parseFloat(list.costo_tiempo || 0).toFixed(2);
    if (typeof window.sincronizarManoObraUI === 'function') {
        window.sincronizarManoObraUI();
    }
    
    // Configurar IVA y tratamiento impositivo
    const ivaLoteEl = document.getElementById('gp-iva-lote-val');
    if (ivaLoteEl) {
        ivaLoteEl.innerText = `${gp_ivaGlobal.toFixed(2)}%`;
    }
    const modoIvaSelect = document.getElementById('gp-modo-iva-select');
    if (modoIvaSelect) {
        modoIvaSelect.value = list.modo_iva || 'COMPLETO';
    }

    // Rehidratación visual de Alícuota y Etiqueta de Origen de IVA en UI
    const inputIvaEl = document.getElementById('gp-iva-lote-val-calc');
    if (inputIvaEl && list.iva !== undefined && list.iva !== null) {
        inputIvaEl.value = parseFloat(list.iva).toFixed(2);
    }
    const labelEl = document.getElementById('gp-iva-label-text');
    if (labelEl) {
        if (list.modo_origen_iva === 'LOMASOFT') {
            labelEl.innerText = "IVA Lomasoft:";
        } else if (list.modo_origen_iva === 'LOTE') {
            labelEl.innerText = "IVA Nativo Lote:";
        } else if (list.modo_origen_iva === 'REPOSICION' || list.modo_origen_iva === 'REPOSICION_BLIND') {
            labelEl.innerText = "IVA Oferta Proveedor:";
        } else if (list.modo_origen_iva === 'RECETA') {
            labelEl.innerText = "IVA Matriz Receta:";
        } else if (list.modo_origen_iva === 'PACK_HIJO') {
            labelEl.innerText = "IVA Nativo Hijo:";
        } else {
            labelEl.innerText = "IVA Personalizado:";
        }
    }

    // Configurar estado del botón de Artículo Patrón
    actualizarUiBotonPatron();
    
    // Sincronizar visual de pines 📌
    window.actualizarUiPines();

    // Sincronizar Tarjeta 5: Estructura Pack Hijo
    if (typeof window.actualizarTarjetaPackHijo === 'function') {
        window.actualizarTarjetaPackHijo();
    }

    // Sincronizar estado visual de los candados (🔒 / 🔓)
    if (typeof window.actualizarIconosCandados === 'function') {
        window.actualizarIconosCandados();
    }
    
    // Recalcular & renderizar precios
    recalcularPreciosGestor();
}

window.toggleHeredarCosto = function(checked) {
    const manualInput = document.getElementById('gp-costo-manual');
    const currentVal = parseFloat(manualInput ? manualInput.value : 0) || gp_liveIngredienteCost;
    
    if (Array.isArray(gp_listasFinancieras)) {
        gp_listasFinancieras.forEach(l => {
            l.heredar_costo_base = checked;
            if (checked) {
                l.costo_base_sobrescrito = null;
            } else {
                l.costo_base_sobrescrito = currentVal;
            }
        });
    }

    console.log(`🚨 [VIGÍA DEPURADOR - AUDITORÍA F12] Checkbox 'Heredar costo base automático' modificado manualmente a: ${checked}`);
    
    if (checked) {
        manualInput.value = gp_liveIngredienteCost.toFixed(2);
        manualInput.disabled = true;
        manualInput.style.backgroundColor = '#f1f5f9';
    } else {
        manualInput.value = currentVal.toFixed(2);
        manualInput.disabled = false;
        manualInput.style.backgroundColor = 'white';
    }
    if (typeof window.recalcularTodasLasListasFinancieras === 'function') {
        window.recalcularTodasLasListasFinancieras();
    } else {
        recalcularPreciosGestor();
    }
};

window.propagarCostoManualActual = function() {
    const manualInput = document.getElementById('gp-costo-manual');
    const val = parseFloat(manualInput ? manualInput.value : 0) || 0;

    const heredarCheckbox = document.getElementById('gp-heredar-costo');
    if (heredarCheckbox) {
        heredarCheckbox.checked = false;
    }

    if (Array.isArray(gp_listasFinancieras)) {
        gp_listasFinancieras.forEach(l => {
            l.costo_base_sobrescrito = val;
        });
    }

    if (manualInput) {
        manualInput.value = val.toFixed(2);
        manualInput.disabled = false;
        manualInput.style.backgroundColor = 'white';
    }

    if (typeof window.recalcularTodasLasListasFinancieras === 'function') {
        window.recalcularTodasLasListasFinancieras();
    } else {
        recalcularPreciosGestor();
    }

    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: 'Costo Manual Propagado',
            text: `Se aplicó el costo de $ ${val.toFixed(2)}/kg a las ${gp_listasFinancieras.length} listas y se desactivó la herencia automática.`,
            icon: 'success',
            timer: 1500,
            showConfirmButton: false
        });
    }
};

function renderInsumosGrid() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    const tbody = document.getElementById('gp-insumos-tbody');
    tbody.innerHTML = '';
    
    let totalInsumos = 0;
    
    if (!list.insumos || list.insumos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#94a3b8; font-style:italic;">Sin insumos cargados</td></tr>';
        document.getElementById('gp-insumos-total-badge').innerText = '$ 0,00';
        return;
    }
    
    const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    
    list.insumos.forEach((ins, subIdx) => {
        const qty = parseFloat(ins.cantidad || 1);
        const uCost = parseFloat(ins.costo_unitario_capturado || 0);
        const subtotal = qty * uCost;
        
        const isIncluido = (ins.incluido === true || ins.incluido === 'true');
        if (isIncluido) {
            totalInsumos += subtotal;
        }
        
        // Alerta de desfase en insumo
        const liveCost = parseFloat(ins.costo_unitario_en_vivo || uCost);
        const isDiff = Math.abs(liveCost - uCost) > 0.01;
        const diffBadge = isDiff ? ` <span style="color:#d97706; cursor:help;" title="Live cost: ${formatter.format(liveCost)} (Discrepancia detectada)">⚠️</span>` : '';
        
        const activeText = isIncluido ? 'Incluido' : 'Excluido';
        const activeColor = isIncluido ? '#15803d' : '#ef4444';
        const activeBg = isIncluido ? '#dcfce7' : '#fef2f2';
        const activeBorder = isIncluido ? '#bbf7d0' : '#fecaca';

        const tr = document.createElement('tr');
        tr.style.opacity = isIncluido ? '1' : '0.75';
        tr.style.backgroundColor = isIncluido ? 'transparent' : '#f8fafc';
        
        tr.innerHTML = `
            <td>
                <strong>${ins.descripcion || ins.insumo_articulo_numero}</strong><br>
                <span style="font-family: monospace; font-size: 0.8em; color: #64748b;">${ins.insumo_articulo_numero}</span>
            </td>
            <td>
                <input type="number" step="0.0001" value="${qty}" style="width: 100%; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; text-align:center;" oninput="actualizarInsumoQty(${subIdx}, this.value)">
            </td>
            <td style="text-align: right;">
                <div style="display:flex; flex-direction:column; align-items:flex-end; gap: 3px;">
                    <div style="display:flex; justify-content: flex-end; align-items:center; gap: 4px;">
                        <input type="number" step="0.01" value="${uCost.toFixed(2)}" style="width: 70px; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; text-align:right; font-family: monospace; ${isIncluido ? 'background-color:#f0fdf4;' : 'background-color:#f1f5f9; color:#94a3b8;'}" oninput="actualizarInsumoCost(${subIdx}, this.value)">
                        ${diffBadge}
                    </div>
                    <span onclick="window.toggleInsumoInclusion(${subIdx})" style="cursor:pointer; font-size:0.75em; padding: 2px 6px; border-radius: 4px; font-weight:bold; border: 1px solid ${activeBorder}; background-color:${activeBg}; color:${activeColor}; user-select:none;" title="Haz clic para alternar inclusión de este costo en la calculadora financiera">
                        ${activeText}
                    </span>
                </div>
            </td>
            <td style="text-align: center;">
                <button type="button" style="background:transparent; border:none; cursor:pointer; color:#ef4444; font-size:1.1em;" onclick="removerInsumo(${subIdx})">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    document.getElementById('gp-insumos-total-badge').innerText = formatter.format(totalInsumos);
}

window.actualizarInsumoQty = function(idx, val) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (list && list.insumos && list.insumos[idx]) {
        list.insumos[idx].cantidad = parseFloat(val) || 0;
        propagarCostosOperativos();
        renderInsumosGrid();
        recalcularPreciosGestor();
    }
};

window.actualizarInsumoCost = function(idx, val) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (list && list.insumos && list.insumos[idx]) {
        list.insumos[idx].costo_unitario_capturado = parseFloat(val) || 0;
        propagarCostosOperativos();
        renderInsumosGrid();
        recalcularPreciosGestor();
    }
};

window.toggleInsumoInclusion = async function(idx) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list || !list.insumos || !list.insumos[idx]) return;

    const ins = list.insumos[idx];
    const currentState = (ins.incluido === true || ins.incluido === 'true');
    const newState = !currentState;
    const estadoTexto = newState ? 'INCLUIR' : 'EXCLUIR';
    const nombreInsumo = ins.descripcion || ins.insumo_articulo_numero;
    const nombreLista = list.nombre_lista || 'Lista Actual';

    if (typeof Swal !== 'undefined') {
        const result = await Swal.fire({
            title: `¿${estadoTexto} costo de insumo en calculadora?`,
            html: `<div style="text-align: left; font-size: 0.92em; color: #334155; line-height: 1.4;">` +
                  `Insumo: <b style="color: #0284c7;">${nombreInsumo}</b><br>` +
                  `Nuevo estado: <b style="color: ${newState ? '#16a34a' : '#dc2626'};">${newState ? 'INCLUIDO' : 'EXCLUIDO'}</b><br><br>` +
                  `¿Desea aplicar este cambio solo a la lista activa (<b>${nombreLista}</b>) o propagarlo a <b>todas las listas</b> de este artículo?` +
                  `</div>`,
            icon: 'question',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: '🌐 Aplicar a TODAS las listas',
            denyButtonText: `🎯 Solo a "${nombreLista}"`,
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#7e22ce',
            denyButtonColor: '#0284c7',
            cancelButtonColor: '#64748b'
        });

        if (result.isConfirmed) {
            // Aplicar a todas las listas
            gp_listasFinancieras.forEach(l => {
                if (Array.isArray(l.insumos)) {
                    const match = l.insumos.find(i => String(i.insumo_articulo_numero).trim() === String(ins.insumo_articulo_numero).trim());
                    if (match) {
                        match.incluido = newState;
                    } else {
                        l.insumos.push({
                            ...JSON.parse(JSON.stringify(ins)),
                            incluido: newState
                        });
                    }
                    if (typeof recalcularValoresDeListaEnMemoria === 'function') {
                        recalcularValoresDeListaEnMemoria(l);
                    }
                }
            });
            renderInsumosGrid();
            recalcularPreciosGestor();
            Swal.fire({
                title: 'Insumo Actualizado',
                text: `Se configuró como ${newState ? 'INCLUIDO' : 'EXCLUIDO'} en las ${gp_listasFinancieras.length} listas.`,
                icon: 'success',
                timer: 1500,
                showConfirmButton: false
            });
        } else if (result.isDenied) {
            // Solo a esta lista activa
            ins.incluido = newState;
            renderInsumosGrid();
            recalcularPreciosGestor();
        }
    } else {
        ins.incluido = newState;
        renderInsumosGrid();
        recalcularPreciosGestor();
    }
};

window.removerInsumo = async function(idx) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list || !list.insumos || !list.insumos[idx]) return;

    const ins = list.insumos[idx];
    const nombreInsumo = ins.descripcion || ins.insumo_articulo_numero;
    const nombreLista = list.nombre_lista || 'Lista Actual';

    if (typeof Swal !== 'undefined') {
        const result = await Swal.fire({
            title: `¿Eliminar insumo de la lista?`,
            html: `<div style="text-align: left; font-size: 0.92em; color: #334155; line-height: 1.4;">` +
                  `Insumo: <b style="color: #ef4444;">${nombreInsumo}</b><br><br>` +
                  `¿Desea remover este insumo únicamente de la lista activa (<b>${nombreLista}</b>) o de <b>todas las listas</b> de este artículo?` +
                  `</div>`,
            icon: 'warning',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: '🌐 Eliminar de TODAS las listas',
            denyButtonText: `🎯 Solo de "${nombreLista}"`,
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#ef4444',
            denyButtonColor: '#d97706',
            cancelButtonColor: '#64748b'
        });

        if (result.isConfirmed) {
            gp_listasFinancieras.forEach(l => {
                if (Array.isArray(l.insumos)) {
                    l.insumos = l.insumos.filter(i => String(i.insumo_articulo_numero).trim() !== String(ins.insumo_articulo_numero).trim());
                    if (typeof recalcularValoresDeListaEnMemoria === 'function') {
                        recalcularValoresDeListaEnMemoria(l);
                    }
                }
            });
            renderInsumosGrid();
            recalcularPreciosGestor();
            Swal.fire({
                title: 'Insumo Eliminado',
                text: `Se eliminó el insumo de todas las listas.`,
                icon: 'success',
                timer: 1500,
                showConfirmButton: false
            });
        } else if (result.isDenied) {
            list.insumos.splice(idx, 1);
            renderInsumosGrid();
            recalcularPreciosGestor();
        }
    } else {
        list.insumos.splice(idx, 1);
        renderInsumosGrid();
        recalcularPreciosGestor();
    }
};

// Autocomplete buscador de insumos
let insumoTimer = null;
window.buscarInsumoInput = function(val) {
    clearTimeout(insumoTimer);
    const resultsDiv = document.getElementById('gp-insumo-resultados');
    
    if (val.trim().length < 2) {
        resultsDiv.style.display = 'none';
        return;
    }
    
    insumoTimer = setTimeout(async () => {
        try {
            const res = await fetch(`/api/logistica/bunker/buscar-insumos?q=${encodeURIComponent(val)}`);
            const result = await res.json();
            
            if (res.ok && result.success && result.data.length > 0) {
                resultsDiv.innerHTML = '';
                result.data.forEach(art => {
                    const row = document.createElement('div');
                    row.style.cssText = 'padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #e2e8f0; hover: background-color: #f8fafc;';
                    row.innerHTML = `<strong>${art.descripcion}</strong> <span style="font-family:monospace; color:#64748b;">(${art.id})</span>`;
                    row.onclick = () => selectInsumoParaAgregar(art);
                    resultsDiv.appendChild(row);
                });
                resultsDiv.style.display = 'block';
            } else {
                resultsDiv.style.display = 'none';
            }
        } catch(e) {
            console.error('Error fetching insumos:', e);
        }
    }, 300);
};

function selectInsumoParaAgregar(art) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    if (!list.insumos) list.insumos = [];
    
    // Evitar duplicados en el mismo artículo
    if (list.insumos.some(ins => ins.insumo_articulo_numero === art.id)) {
        Swal.fire('Insumo ya agregado', 'El insumo secundario ya figura cargado en esta lista.', 'info');
        document.getElementById('gp-buscar-insumo').value = '';
        document.getElementById('gp-insumo-resultados').style.display = 'none';
        return;
    }
    
    list.insumos.push({
        insumo_articulo_numero: art.id,
        descripcion: art.descripcion,
        cantidad: 1.0000,
        costo_unitario_capturado: parseFloat(art.costo_base || 0),
        costo_unitario_en_vivo: parseFloat(art.costo_base || 0),
        incluido: true // Activado por defecto al agregarlo para impacto inmediato
    });
    
    propagarCostosOperativos();
    document.getElementById('gp-buscar-insumo').value = '';
    document.getElementById('gp-insumo-resultados').style.display = 'none';
    renderInsumosGrid();
    recalcularPreciosGestor();
}

// Recalcular integralmente todas las listas financieras en memoria (Fase 62)
window.recalcularTodasLasListasFinancieras = function() {
    if (!Array.isArray(gp_listasFinancieras)) return;

    const heredarCheckbox = document.getElementById('gp-heredar-costo');
    const isHeredar = heredarCheckbox ? heredarCheckbox.checked : true;
    const manualInputVal = parseFloat(document.getElementById('gp-costo-manual')?.value) || 0;

    gp_listasFinancieras.forEach((list) => {
        if (isHeredar) {
            list.costo_base_sobrescrito = null;
        }

        const cBase = (list.costo_base_sobrescrito !== null && list.costo_base_sobrescrito !== undefined)
            ? parseFloat(list.costo_base_sobrescrito)
            : gp_liveIngredienteCost;

        let cInsumos = 0;
        if (list.insumos && list.insumos.length > 0) {
            list.insumos.forEach(ins => {
                if (ins.incluido === true || ins.incluido === 'true') {
                    cInsumos += parseFloat(ins.cantidad || 1) * parseFloat(ins.costo_unitario_capturado || 0);
                }
            });
        }

        const isManoObraActiva = (list.mano_obra_activa === true);
        const cTiempo = isManoObraActiva ? (parseFloat(list.costo_tiempo) || 0) : 0;
        const cTotalPresentacion = cBase * gp_factorPresentacion;
        const cBulto = cTotalPresentacion + cInsumos;

        const modoIva = list.modo_iva || 'COMPLETO';
        let ivaBaseInput = (list.iva !== undefined && list.iva !== null) ? parseFloat(list.iva) : 21.00;
        let ivaVal = ivaBaseInput;
        if (modoIva === 'MEDIO') ivaVal = ivaBaseInput / 2;
        else if (modoIva === 'SIN') ivaVal = 0.00;
        const ivaCoeff = 1 + (ivaVal / 100);

        let margen = parseFloat(list.margen_ganancia) || parseFloat(list.margen_porcentaje) || 0;
        if (list.modo_calculo === 'AUTOMATIC' && !list.has_manual_override && margen === 0 && list.margen_patron_heredado !== null && list.margen_patron_heredado !== undefined) {
            margen = parseFloat(list.margen_patron_heredado);
        }

        if (list.modo_calculo === 'AUTOMATIC') {
            const precioS_ivaBase = cBulto * (1 + (margen / 100)) + cTiempo;
            list.precio_final = precioS_ivaBase * ivaCoeff;
        } else {
            const precioFinal = parseFloat(list.precio_final) || 0;
            const precioS_iva = precioFinal / ivaCoeff;
            if (cBulto > 0) {
                list.margen_ganancia = ((precioS_iva - cTiempo) / cBulto - 1) * 100;
            }
        }
    });

    if (typeof window.recalcularPreciosGestor === 'function') {
        window.recalcularPreciosGestor();
    }
};

// Lógica de cálculo bidireccional y alertas
window.recalcularPreciosGestor = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    
    // 1. Obtener Costos
    const heredarCheckbox = document.getElementById('gp-heredar-costo');
    const isHeredar = heredarCheckbox.checked;
    
    const manualInputVal = parseFloat(document.getElementById('gp-costo-manual').value) || 0;
    if (isHeredar) {
        list.costo_base_sobrescrito = null;
    } else {
        list.costo_base_sobrescrito = manualInputVal;
    }
    
    const cBase = isHeredar ? gp_liveIngredienteCost : manualInputVal;
    
    // Sumar insumos secundarios (a nivel bulto)
    let cInsumos = 0;
    if (list.insumos && list.insumos.length > 0) {
        list.insumos.forEach(ins => {
            if (ins.incluido === true || ins.incluido === 'true') {
                cInsumos += parseFloat(ins.cantidad || 1) * parseFloat(ins.costo_unitario_capturado || 0);
            }
        });
    }
    
    // Sintonización limpia de Costo de Tiempo / Servicios (Fase 12)
    const manoObraCheck = document.getElementById('gp-mano-obra-activa');
    if (manoObraCheck) {
        manoObraCheck.checked = (list.mano_obra_activa === true);
    }
    
    const isManoObraActiva = list.mano_obra_activa === true;
    const isServiceActive = isManoObraActiva;
    
    // Si la mano de obra está activa (ON), tomar list.costo_tiempo. Si está inactiva (OFF), el costo es estrictamente $ 0 en la ecuación financiera.
    const cTiempo = isManoObraActiva ? (parseFloat(list.costo_tiempo) || 0) : 0;
    
    // Sincronizar input DOM #gp-costo-tiempo preservando el costo nominal/borrador del Asistente
    const inputCostoTiempo = document.getElementById('gp-costo-tiempo');
    if (inputCostoTiempo && document.activeElement !== inputCostoTiempo) {
        const costoNominalVisual = parseFloat(list.costo_tiempo) || 0;
        inputCostoTiempo.value = costoNominalVisual.toFixed(2);
    }
    
    // Costo base por kilo
    document.getElementById('gp-costo-integrado').innerText = formatter.format(cBase);
    
    // Costo Total de la Presentación (Costo Bulto Base: Costo Kilo * Factor)
    const cTotalPresentacion = cBase * gp_factorPresentacion;
    
    // Costo Total del Bulto Integrado (sumando insumos secundarios)
    const cBulto = cTotalPresentacion + cInsumos;
    const bultoEl = document.getElementById('gp-costo-bulto-val');
    if (bultoEl) {
        bultoEl.innerText = formatter.format(cBulto);
    }
    
    // FASE 20 & FASE 21: Ecuación Visual de Costo Transparente Desarmada (Origen Puro + Receta + Mano Obra)
    const elCalcOrigenLabel = document.getElementById('gp-calc-origen-label');
    const elCalcOrigenVal = document.getElementById('gp-calc-origen-val');
    const elCalcInsumos = document.getElementById('gp-calc-insumos-val');
    const elCalcServicio = document.getElementById('gp-calc-servicio-val');
    const elCalcNetoTotal = document.getElementById('gp-calc-costo-neto-total');
    const containerRecetaAdicional = document.getElementById('gp-container-calc-receta-adicional');
    const elCalcRecetaAdicional = document.getElementById('gp-calc-receta-adicional-val');
    const containerInsumos = document.getElementById('gp-container-calc-insumos');

    const cRecetaAdicionalKilo = parseFloat(list.costo_receta_adicional) || 0;
    const cRecetaAdicionalBulto = cRecetaAdicionalKilo * gp_factorPresentacion;

    const esOrigenTostadero = !!(window.gp_costoTostaderoKilo > 0 || list.fuente_costo_default === 'tostadero');
    const cOrigenPuroKilo = esOrigenTostadero ? window.gp_costoTostaderoKilo : Math.max(0, cBase - cRecetaAdicionalKilo);
    const cOrigenPuroBulto = cOrigenPuroKilo * gp_factorPresentacion;

    if (elCalcOrigenLabel) {
        elCalcOrigenLabel.innerText = esOrigenTostadero ? 'Tostadero' : 'Costo Lista';
    }
    if (elCalcOrigenVal) {
        elCalcOrigenVal.innerText = formatter.format(cOrigenPuroBulto);
    }

    if (elCalcInsumos) elCalcInsumos.innerText = formatter.format(cInsumos);
    if (elCalcServicio) elCalcServicio.innerText = formatter.format(cTiempo);
    if (elCalcNetoTotal) elCalcNetoTotal.innerText = formatter.format(cBulto + cTiempo);

    if (cRecetaAdicionalBulto > 0 && containerRecetaAdicional && elCalcRecetaAdicional) {
        containerRecetaAdicional.setAttribute('style', 'display: inline-flex !important; align-items: center; gap: 4px; background: #e0f2fe; padding: 2px 6px; border-radius: 4px; border: 1px solid #bae6fd; color: #0369a1; font-weight: bold;');
        elCalcRecetaAdicional.innerText = formatter.format(cRecetaAdicionalBulto);
    } else if (containerRecetaAdicional) {
        containerRecetaAdicional.setAttribute('style', 'display: none !important;');
    }

    if (cInsumos > 0 && containerInsumos && elCalcInsumos) {
        containerInsumos.setAttribute('style', 'display: inline-flex !important; align-items: center; gap: 4px; background: #fef3c7; padding: 2px 6px; border-radius: 4px; border: 1px solid #fde68a; color: #92400e; font-weight: bold;');
        elCalcInsumos.innerText = formatter.format(cInsumos);
    } else if (containerInsumos) {
        containerInsumos.setAttribute('style', 'display: none !important;');
    }
    
    const modoIva = (document.getElementById('gp-modo-iva-select') && document.getElementById('gp-modo-iva-select').value) || 'COMPLETO';
    list.modo_iva = modoIva;

    const ivaInputEl = document.getElementById('gp-iva-lote-val-calc');
    let ivaBaseInput = NaN;
    if (ivaInputEl && ivaInputEl.value !== '') {
        ivaBaseInput = parseFloat(ivaInputEl.value);
    }
    
    // Observación B: Si el casillero está vacío o NaN (backspace del usuario), asumir 0.00% sin congelar
    if (isNaN(ivaBaseInput)) {
        ivaBaseInput = (list.iva !== undefined && list.iva !== null) ? parseFloat(list.iva) : 0.00;
    }
    list.iva = ivaBaseInput;

    let ivaVal = ivaBaseInput;
    if (modoIva === 'MEDIO') {
        ivaVal = ivaBaseInput / 2;
    } else if (modoIva === 'SIN') {
        ivaVal = 0.00;
    }
    const ivaCoeff = 1 + (ivaVal / 100);
    
    // 2. Modos de cálculo bidireccionales
    const margenInput = document.getElementById('gp-margen');
    let margen = parseFloat(list.margen_ganancia) || parseFloat(list.margen_porcentaje) || 0;
    let usandoHeredado = false;
    
    // Aplicar herencia parental del patrón si el margen de este es 0 y posee patrón (solo si es AUTOMÁTICO y no fue sobrescrito a mano)
    if (list.modo_calculo === 'AUTOMATIC' && !list.has_manual_override && margen === 0 && list.margen_patron_heredado !== null && list.margen_patron_heredado !== undefined) {
        margen = parseFloat(list.margen_patron_heredado);
        usandoHeredado = true;
    }

    const advertenciaEl = document.getElementById('gp-margen-advertencia');
    if (margenInput) {
        if (usandoHeredado) {
            margenInput.style.border = '2px solid #8e4785';
            margenInput.style.backgroundColor = '#faeef7';
            margenInput.title = `Margen heredado del artículo patrón (${margen.toFixed(2)}%)`;
            if (advertenciaEl) {
                advertenciaEl.innerText = `⚠️ Margen prescrito por Artículo Patrón (${list.descripcion_patron || 'Bolsa 25kg'})`;
                advertenciaEl.style.display = 'block';
            }
        } else {
            margenInput.style.border = '1px solid #cbd5e1';
            margenInput.style.backgroundColor = 'white';
            margenInput.title = '';
            if (advertenciaEl) {
                advertenciaEl.style.display = 'none';
            }
        }
    }

    // Simulación de Descuento
    const simDescEl = document.getElementById('gp-sim-descuento');
    const simDescuentoVal = simDescEl ? (parseFloat(simDescEl.value) || 0) : 0;

    if (list.modo_calculo === 'AUTOMATIC') {
        // Evitar sobreescritura si el usuario está enfocado
        if (document.activeElement.id !== 'gp-margen' && margenInput) {
            margenInput.value = margen.toFixed(2);
        }
        
        // Precio Final del Bulto = [ Costo Total Bulto * (1 + Margen/100) + Costo Tiempo ] * (1 + IVA)
        const precioS_ivaBase = cBulto * (1 + (margen / 100)) + cTiempo;
        const precioFinalBase = precioS_ivaBase * ivaCoeff;
        
        list.precio_final = precioFinalBase;
        if (document.activeElement.id !== 'gp-precio-final') {
            document.getElementById('gp-precio-final').value = precioFinalBase.toFixed(2);
        }
        
        // Simulación de Descuento Venta (Casillero Interactivo)
        const precioFinalDescontado = precioFinalBase * (1 - simDescuentoVal / 100);
        const precioS_ivaDescontado = precioFinalDescontado / ivaCoeff;
        
        // Métricas secundarias basadas en el precio descontado
        const iibb = precioFinalDescontado * 0.04;
        const gananciaNeta = precioS_ivaDescontado - cTiempo - cBulto;
        const gananciaSinIIBB = gananciaNeta - iibb;
        
        // Cálculo complementario de IVA y Diferencia a rendir (AFIP)
        const ivaVenta = precioS_ivaDescontado * (ivaVal / 100);
        const ivaCompra = cBulto * (gp_ivaGlobal / 100);
        const diferenciaIva = ivaVenta - ivaCompra;
        const diferenciaARendir = Math.max(0, diferenciaIva);
        const gananciaReal = gananciaSinIIBB - diferenciaARendir;
        
        const simFacturadoEl = document.getElementById('gp-precio-facturado-simulado');
        if (simFacturadoEl) {
            simFacturadoEl.innerText = formatter.format(precioFinalDescontado);
        }
        
        document.getElementById('gp-precio-sin-iva').innerText = formatter.format(precioS_ivaDescontado);
        document.getElementById('gp-iibb').innerText = formatter.format(iibb);
        
        const gNetaEl = document.getElementById('gp-ganancia-neta');
        if (gNetaEl) {
            gNetaEl.innerText = formatter.format(gananciaNeta);
            gNetaEl.style.color = gananciaNeta >= 0 ? '#475569' : '#ef4444'; // Color neutro si es positivo
        }
        
        const gSinIibbEl = document.getElementById('gp-ganancia-sin-iibb');
        if (gSinIibbEl) {
            gSinIibbEl.innerText = formatter.format(gananciaSinIIBB);
            gSinIibbEl.style.color = gananciaSinIIBB >= 0 ? '#475569' : '#ef4444'; // Color neutro si es positivo
        }
        
        const gRealEl = document.getElementById('gp-ganancia-real');
        if (gRealEl) {
            gRealEl.innerText = formatter.format(gananciaReal);
            gRealEl.style.color = gananciaReal >= 0 ? '#15803d' : '#ef4444'; // Destacado verde si es positivo
        }
    } else {
        // Modo MANUAL
        const precioFinalBase = parseFloat(list.precio_final) || 0;
        if (document.activeElement.id !== 'gp-precio-final') {
            document.getElementById('gp-precio-final').value = precioFinalBase.toFixed(2);
        }
        
        // Margen Implícito = ( (Precio Final / (1+IVA) - Costo Tiempo) / Costo Total Bulto - 1 ) * 100
        const precioS_ivaBase = precioFinalBase / ivaCoeff;
        let margenImplicito = 0;
        if (cBulto > 0) {
            margenImplicito = ((precioS_ivaBase - cTiempo) / cBulto - 1) * 100;
        }
        
        list.margen_porcentaje = margenImplicito; // compatibilidad
        list.margen_ganancia = margenImplicito;
        if (document.activeElement.id !== 'gp-margen' && margenInput) {
            margenInput.value = margenImplicito.toFixed(2);
        }
        
        // Simulación de Descuento Venta (Casillero Interactivo)
        const precioFinalDescontado = precioFinalBase * (1 - simDescuentoVal / 100);
        const precioS_ivaDescontado = precioFinalDescontado / ivaCoeff;
        
        // Métricas secundarias basadas en el precio descontado
        const iibb = precioFinalDescontado * 0.04;
        const gananciaNeta = precioS_ivaDescontado - cTiempo - cBulto;
        const gananciaSinIIBB = gananciaNeta - iibb;
        
        // Cálculo complementario de IVA y Diferencia a rendir (AFIP)
        const ivaVenta = precioS_ivaDescontado * (ivaVal / 100);
        const ivaCompra = cBulto * (gp_ivaGlobal / 100);
        const diferenciaIva = ivaVenta - ivaCompra;
        const diferenciaARendir = Math.max(0, diferenciaIva);
        const gananciaReal = gananciaSinIIBB - diferenciaARendir;
        
        const simFacturadoEl = document.getElementById('gp-precio-facturado-simulado');
        if (simFacturadoEl) {
            simFacturadoEl.innerText = formatter.format(precioFinalDescontado);
        }
        
        document.getElementById('gp-precio-sin-iva').innerText = formatter.format(precioS_ivaDescontado);
        document.getElementById('gp-iibb').innerText = formatter.format(iibb);
        
        const gNetaEl = document.getElementById('gp-ganancia-neta');
        if (gNetaEl) {
            gNetaEl.innerText = formatter.format(gananciaNeta);
            gNetaEl.style.color = gananciaNeta >= 0 ? '#475569' : '#ef4444'; // Color neutro si es positivo
        }
        
        const gSinIibbEl = document.getElementById('gp-ganancia-sin-iibb');
        if (gSinIibbEl) {
            gSinIibbEl.innerText = formatter.format(gananciaSinIIBB);
            gSinIibbEl.style.color = gananciaSinIIBB >= 0 ? '#475569' : '#ef4444'; // Color neutro si es positivo
        }
        
        const gRealEl = document.getElementById('gp-ganancia-real');
        if (gRealEl) {
            gRealEl.innerText = formatter.format(gananciaReal);
            gRealEl.style.color = gananciaReal >= 0 ? '#15803d' : '#ef4444'; // Destacado verde si es positivo
        }
    }
    
    // 3. Evaluar alerta de desactualización (costos en vivo vs costo calibrado)
    let liveInsumosCost = 0;
    if (list.insumos) {
        list.insumos.forEach(ins => {
            liveInsumosCost += parseFloat(ins.cantidad || 1) * parseFloat(ins.costo_unitario_en_vivo || ins.costo_unitario_capturado);
        });
    }
    
    // Costo total bulto en caliente: (Costo Ingrediente Kilo * Factor) + Insumos
    const liveCostoTotalBulto = (gp_liveIngredienteCost * gp_factorPresentacion) + liveInsumosCost;
    
    // Calculamos el margen implícito en caliente
    const pS_iva = parseFloat(list.precio_final) / ivaCoeff;
    let margenImplicitoVivo = 0;
    if (liveCostoTotalBulto > 0) {
        margenImplicitoVivo = ((pS_iva - cTiempo) / liveCostoTotalBulto - 1) * 100;
    }
    
    const targetMargen = parseFloat(list.margen_ganancia || list.margen_porcentaje);
    const diff = targetMargen - margenImplicitoVivo;
    const isOutdated = Math.abs(diff) > 0.1;
    
    const alertaDiv = document.getElementById('gp-alerta-desactualizado');
    if (isOutdated && liveCostoTotalBulto > 0) {
        document.getElementById('gp-margen-implicito-val').innerText = margenImplicitoVivo.toFixed(2);
        alertaDiv.style.display = 'flex';
    } else {
        alertaDiv.style.display = 'none';
    }

    // 4. Evaluar alerta de nuevo costo en ingrediente base padre (Fase 4)
    const alertPadreDiv = document.getElementById('gp-alerta-ingrediente-padre');
    if (alertPadreDiv) {
        const esPackPadre = window.gp_current_articulo_data && (window.gp_current_articulo_data.es_pack === true || parseInt(window.gp_current_articulo_data.pack_unidades || 0) > 1);
        if (gp_packHijoCodigo && !esPackPadre) {
            let parentLiveCostKilo = 0;
            if (gp_parentLote) {
                parentLiveCostKilo = parseFloat(gp_parentLote.costo_kilo_al_momento) || 0;
            } else if (gp_parentCostoBaseManual !== null) {
                parentLiveCostKilo = parseFloat(gp_parentCostoBaseManual) / gp_parentKilosUnidad;
            } else if (gp_parentCostoLomasoft !== null) {
                parentLiveCostKilo = parseFloat(gp_parentCostoLomasoft) / gp_parentKilosUnidad;
            }

            // Umbral estricto de desvío de $0.05/kg
            const diffPadre = Math.abs(cBase - parentLiveCostKilo);
            if (parentLiveCostKilo > 0 && diffPadre > 0.05) {
                const pNombreEl = document.getElementById('gp-ingrediente-padre-nombre');
                const fCostoEl = document.getElementById('gp-fraccion-costo-actual-val');
                const pCostoEl = document.getElementById('gp-ingrediente-padre-nuevo-val');
                const btnAplicarPadre = document.getElementById('gp-btn-aplicar-padre');

                if (pNombreEl) pNombreEl.innerText = gp_parentDescripcion || gp_packHijoCodigo;
                if (fCostoEl) fCostoEl.innerText = formatter.format(cBase);
                if (pCostoEl) pCostoEl.innerText = formatter.format(parentLiveCostKilo);
                if (btnAplicarPadre) {
                    btnAplicarPadre.onclick = () => window.aplicarCostoBaseManual(parentLiveCostKilo);
                }

                alertPadreDiv.style.display = 'flex';
            } else {
                alertPadreDiv.style.display = 'none';
            }
        } else {
            alertPadreDiv.style.display = 'none';
        }
    }

    // FASE 4: Actualizar las filas de advertencia y costos en la Tarjeta 3 de ingredientes en caliente
    if (typeof window.actualizarAlertasIngredienteBase === 'function') {
        window.actualizarAlertasIngredienteBase();
    }
};

window.actualizarPorMargen = function(val) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    list.margen_ganancia = parseFloat(val) || 0;
    list.margen_porcentaje = parseFloat(val) || 0; // compatibilidad
    list.has_manual_override = true; // Desactivar herencia de patrón permanentemente para esta sesión
    
    // UI instant feedback when overriding inheritance
    const margenInput = document.getElementById('gp-margen');
    const advertenciaEl = document.getElementById('gp-margen-advertencia');
    if (margenInput) {
        margenInput.style.border = '1px solid #cbd5e1';
        margenInput.style.backgroundColor = 'white';
        margenInput.title = '';
    }
    if (advertenciaEl) {
        advertenciaEl.style.display = 'none';
    }
    
    debouncedRecalcular();
};

window.actualizarPorPrecio = function(val) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    list.precio_final = parseFloat(val) || 0;
    list.has_manual_override = true; // Desactivar herencia de patrón permanentemente para esta sesión
    
    debouncedRecalcular();
};

window.actualizarPorCostoTiempo = function(val) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    list.costo_tiempo = parseFloat(val) || 0;
    
    // Validar si el cambio fue manual o vino del calculador asistido
    const select = document.getElementById('gp-asistente-colaborador');
    const inputMinutos = document.getElementById('gp-asistente-minutos');
    let calculated = -1;
    if (select && inputMinutos) {
        const selectedOpt = select.options[select.selectedIndex];
        if (selectedOpt && selectedOpt.value) {
            const tarifaHoraria = parseFloat(selectedOpt.dataset.tarifa) || 0;
            const minutos = parseFloat(inputMinutos.value) || 0;
            calculated = (tarifaHoraria * minutos) / 60;
        }
    }
    
    if (calculated !== -1 && Math.abs(list.costo_tiempo - calculated) < 0.01) {
        list.asistente_override = false;
    } else {
        list.asistente_override = true;
    }
    
    propagarCostosOperativos();
    debouncedRecalcular();
};

window.actualizarPorCostoManual = function(val) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    const numVal = parseFloat(val);
    const heredarCheckbox = document.getElementById('gp-heredar-costo');
    if (!isNaN(numVal) && numVal >= 0) {
        if (heredarCheckbox) {
            heredarCheckbox.checked = false;
        }
        list.costo_base_sobrescrito = numVal;
    } else if (val === '' || val === null || val === undefined) {
        if (heredarCheckbox) {
            heredarCheckbox.checked = true;
        }
        list.costo_base_sobrescrito = null;
    }
    
    debouncedRecalcular();
};

window.aplicarCostoManualEstaLista = function() {
    const manualInput = document.getElementById('gp-costo-manual');
    const val = parseFloat(manualInput ? manualInput.value : 0) || 0;
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;

    const heredarCheckbox = document.getElementById('gp-heredar-costo');
    if (heredarCheckbox) {
        heredarCheckbox.checked = false;
    }

    list.costo_base_sobrescrito = val;

    if (manualInput) {
        manualInput.value = val.toFixed(2);
        manualInput.disabled = false;
        manualInput.style.backgroundColor = 'white';
    }

    recalcularPreciosGestor();

    if (typeof Swal !== 'undefined') {
        const Toast = Swal.mixin({
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true
        });
        Toast.fire({
            icon: 'success',
            title: `Costo $ ${val.toFixed(2)}/kg aplicado a "${list.nombre_lista || 'Lista Actual'}"`
        });
    }
};

window.sincronizarCostoAlerta = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    // 1. Sincronizar Insumos Secundarios a sus costos vivos
    if (list.insumos) {
        list.insumos.forEach(ins => {
            ins.costo_unitario_capturado = parseFloat(ins.costo_unitario_en_vivo || ins.costo_unitario_capturado);
        });
    }
    
    // 2. Si no estaba heredando (costo sobrescrito), forzar la herencia o actualizar al vivo
    const heredarCheckbox = document.getElementById('gp-heredar-costo');
    heredarCheckbox.checked = true;
    list.costo_base_sobrescrito = null;
    document.getElementById('gp-costo-manual').disabled = true;
    document.getElementById('gp-costo-manual').value = gp_liveIngredienteCost.toFixed(2);
    document.getElementById('gp-costo-manual').style.backgroundColor = '#f1f5f9';
    
    // 3. Recalcular precio basándonos en el target de margen original
    list.modo_calculo = 'AUTOMATIC';
    
    Swal.fire({
        title: 'Costo Sincronizado',
        text: 'Los costos base e insumos secundarios han sido sincronizados a sus valores en caliente. Se restableció la rentabilidad original en el cálculo del precio.',
        icon: 'success',
        timer: 3000,
        showConfirmButton: false
    });
    
    propagarCostosOperativos();
    renderInsumosGrid();
    recalcularPreciosGestor();
};

window.guardarEstructuraFinanciera = async function() {
    const articulo_id = document.getElementById('gp-articulo-id').value;
    
    // Asegurar recálculo consistente de todas las listas antes del commit
    if (typeof window.recalcularTodasLasListasFinancieras === 'function') {
        window.recalcularTodasLasListasFinancieras();
    }

    // Obtener campos del asistente
    const colabSelect = document.getElementById('gp-asistente-colaborador');
    const minutosInput = document.getElementById('gp-asistente-minutos');
    const asistente_colaborador_id = colabSelect && colabSelect.value ? parseInt(colabSelect.value) : null;
    const asistente_minutos = minutosInput && minutosInput.value ? parseFloat(minutosInput.value) : null;

    // Mapear configuraciones completas para backend
    const configsPayload = gp_listasFinancieras.map(l => {
        // Sincronizar insumos a enviar
        const insPayload = (l.insumos || []).map(ins => ({
            insumo_articulo_numero: ins.insumo_articulo_numero,
            cantidad: parseFloat(ins.cantidad) || 1.0000,
            costo_unitario_capturado: parseFloat(ins.costo_unitario_capturado) || 0,
            incluido: ins.incluido === true || ins.incluido === 'true'
        }));
        
        return {
            lista_id: l.lista_id,
            margen_ganancia: parseFloat(l.margen_ganancia || l.margen_porcentaje) || 0,
            costo_base_sobrescrito: l.costo_base_sobrescrito !== undefined && l.costo_base_sobrescrito !== null ? parseFloat(l.costo_base_sobrescrito) : null,
            costo_tiempo: parseFloat(l.costo_tiempo) || 0,
            iva: parseFloat(l.iva || gp_ivaGlobal) || 21,
            precio_final: parseFloat(l.precio_final) || 0,
            modo_calculo: l.modo_calculo || 'AUTOMATIC',
            modo_iva: l.modo_iva || 'COMPLETO',
            es_patron: l.es_patron === true || l.es_patron === 'true',
            fuente_costo_default: l.fuente_costo_default || null,
            disponible: l.disponible !== false,
            exencion_operativa: l.exencion_operativa === true,
            mano_obra_activa: l.mano_obra_activa === true,
            insumos: insPayload
        };
    });
    
    Swal.fire({ title: 'Guardando Estructuras Financieras...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    try {
        const res = await fetch(`/api/logistica/bunker/finanzas/${encodeURIComponent(articulo_id)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                configs: configsPayload,
                asistente_colaborador_id,
                asistente_minutos
            })
        });
        const result = await res.json();
        
        if (res.ok && result.success) {
            Swal.fire('Guardado Exitoso', 'Estructura financiera y calibración de precios guardada en el Búnker.', 'success');
            cerrarGestorPrecios();
            await cargarDataGrid(); // Refrescar grilla general
        } else {
            throw new Error(result.error);
        }
    } catch(e) {
        Swal.fire('Error', e.message || 'Error de conexión', 'error');
    }
};

window.crearNuevaListaDesdeUI = async function(abrirEnModal = false) {
    Swal.fire({
        title: 'Crear Nueva Lista de Precios Búnker',
        text: 'Ingrese el nombre para la nueva lista de simulación:',
        input: 'text',
        inputPlaceholder: 'Ej: Simulación Trigo, Mayorista Mayo...',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Crear Lista',
        cancelButtonText: 'Cancelar',
        inputValidator: (value) => {
            if (!value || !value.trim()) {
                return 'El nombre de la lista no puede estar vacío.';
            }
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const nombre = result.value.trim();
            try {
                Swal.fire({ title: 'Creando Lista...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                const res = await fetch('/api/logistica/bunker/listas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, descripcion: 'Simulación dinámica creada desde la UI', activa: true })
                });
                const resJson = await res.json();
                
                if (res.ok && resJson.success) {
                    Swal.fire({
                        title: 'Lista Creada',
                        text: `La lista "${nombre}" ha sido creada exitosamente.`,
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    
                    // Refrescar el selector general en la grilla
                    await cargarListasPreciosFiltro();
                    await cargarDataGrid(); // Recargar grilla
                    
                    // Si estamos dentro del modal de finanzas, recargamos la radiografía financiera y enfocamos la nueva pestaña
                    if (abrirEnModal) {
                        const articulo_id = document.getElementById('gp-articulo-id').value;
                        const gp_producto = document.getElementById('gp-producto').innerText;
                        const rawIva = parseFloat(document.getElementById('gp-iva-select').value) || 21;
                        await abrirGestorPrecios(articulo_id, gp_producto, rawIva);
                        
                        // Enfocar la lista recién creada
                        const nuevaListaIdx = gp_listasFinancieras.findIndex(l => l.nombre_lista.toLowerCase() === nombre.toLowerCase());
                        if (nuevaListaIdx !== -1) {
                            selectTab(nuevaListaIdx);
                        }
                    }
                } else {
                    Swal.fire('Error', resJson.error || 'No se pudo crear la lista', 'error');
                }
            } catch (e) {
                Swal.fire('Error', 'Fallo de red al intentar conectarse al servidor.', 'error');
            }
        }
    });
};

window.renombrarListaActiva = async function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    Swal.fire({
        title: 'Renombrar Lista de Precios',
        text: `Ingrese el nuevo nombre para la lista "${list.nombre_lista}":`,
        input: 'text',
        inputValue: list.nombre_lista,
        showCancelButton: true,
        confirmButtonColor: '#f59e0b',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Renombrar',
        cancelButtonText: 'Cancelar',
        inputValidator: (value) => {
            if (!value || !value.trim()) {
                return 'El nombre no puede estar vacío.';
            }
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const nuevoNombre = result.value.trim();
            if (nuevoNombre === list.nombre_lista) return;
            
            try {
                Swal.fire({ title: 'Actualizando Nombre...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                const res = await fetch(`/api/logistica/bunker/listas/${list.lista_id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre: nuevoNombre })
                });
                const resJson = await res.json();
                
                if (res.ok && resJson.success) {
                    Swal.fire({
                        title: 'Actualizado',
                        text: 'La lista ha sido renombrada exitosamente.',
                        icon: 'success',
                        timer: 1500,
                        showConfirmButton: false
                    });
                    
                    const articulo_id = document.getElementById('gp-articulo-id').value;
                    const gp_producto = document.getElementById('gp-producto').innerText;
                    const rawIva = parseFloat(document.getElementById('gp-iva-select').value) || 21;
                    
                    const activeTabBackup = gp_activeTabIdx;
                    await cargarListasPreciosFiltro();
                    await abrirGestorPrecios(articulo_id, gp_producto, rawIva);
                    selectTab(activeTabBackup);
                } else {
                    Swal.fire('Error', resJson.error || 'No se pudo actualizar el nombre', 'error');
                }
            } catch (e) {
                Swal.fire('Error', 'Fallo de red al intentar conectarse al servidor.', 'error');
            }
        }
    });
};

window.eliminarListaActiva = async function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    Swal.fire({
        title: '¿Eliminar Lista de Precios?',
        text: `Esta acción eliminará de forma permanente la lista "${list.nombre_lista}" y todas sus calibraciones de precios e insumos secundarios de artículos. ¿Desea proceder?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, Eliminar Lista',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                Swal.fire({ title: 'Eliminando Lista...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                const res = await fetch(`/api/logistica/bunker/listas/${list.lista_id}`, {
                    method: 'DELETE'
                });
                const resJson = await res.json();
                
                if (res.ok && resJson.success) {
                    Swal.fire({
                        title: 'Eliminada',
                        text: 'La lista de precios ha sido purgada.',
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    
                    const articulo_id = document.getElementById('gp-articulo-id').value;
                    const gp_producto = document.getElementById('gp-producto').innerText;
                    const rawIva = parseFloat(document.getElementById('gp-iva-select').value) || 21;
                    
                    await cargarListasPreciosFiltro();
                    await abrirGestorPrecios(articulo_id, gp_producto, rawIva);
                    // Regresar al primer tab disponible
                    selectTab(0);
                    await cargarDataGrid();
                } else {
                    Swal.fire('Error', resJson.error || 'No se pudo eliminar la lista', 'error');
                }
            } catch (e) {
                Swal.fire('Error', 'Fallo de red al intentar conectarse al servidor.', 'error');
            }
        }
    });
};

// --- Persistencia del Configurador en localStorage (LAMDA Work Policy Compliance) ---
let pdfColumnsOrder = [
    { id: 'codigo', label: 'Código', checked: true, align: 'left', baseWidth: 65 },
    { id: 'descripcion', label: 'Descripción', checked: true, align: 'left', baseWidth: 190 },
    { id: 'presentacion', label: 'Presentación', checked: true, align: 'left', baseWidth: 100 },
    { id: 'kilo', label: 'Precio Kilo (Neto)', checked: true, align: 'right', baseWidth: 70 },
    { id: 'bulto', label: 'Precio Bulto (Neto)', checked: true, align: 'right', baseWidth: 70 },
    { id: 'final_kilo', label: 'Precio Kilo Final', checked: true, align: 'right', baseWidth: 70 },
    { id: 'final_bulto', label: 'Precio Bulto Final', checked: true, align: 'right', baseWidth: 70 }
];

window.guardarConfiguracionColumnas = function() {
    try {
        const toSave = pdfColumnsOrder.map(c => ({ id: c.id, checked: c.checked }));
        localStorage.setItem('bunker_pdf_columns_config_v2', JSON.stringify(toSave));
        if (typeof window.guardarPreferenciaBunkerRemota === 'function') {
            window.guardarPreferenciaBunkerRemota('bunker_pdf_columns_config_v2', toSave);
        }
    } catch (e) {
        console.error("Error guardando configuración de columnas:", e);
    }
};

window.cargarConfiguracionColumnas = function() {
    try {
        const stored = localStorage.getItem('bunker_pdf_columns_config_v2');
        if (stored) {
            const loaded = JSON.parse(stored);
            if (Array.isArray(loaded)) {
                const merged = [];
                loaded.forEach(item => {
                    const original = pdfColumnsOrder.find(o => o.id === item.id);
                    if (original) {
                        merged.push({
                            ...original,
                            checked: item.checked !== undefined ? !!item.checked : original.checked
                        });
                    }
                });
                pdfColumnsOrder.forEach(o => {
                    if (!merged.some(m => m.id === o.id)) {
                        merged.push(o);
                    }
                });
                pdfColumnsOrder = merged;
            }
        }
    } catch (e) {
        console.error("Error cargando configuración de columnas:", e);
    }
};

window.renderConfiguradorColumnas = function() {
    const listContainer = document.getElementById('pdf-columns-order-list');
    if (!listContainer) return;
    
    listContainer.innerHTML = '';
    
    pdfColumnsOrder.forEach((col, idx) => {
        const item = document.createElement('div');
        item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: white; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.9em; box-shadow: 0 1px 2px rgba(0,0,0,0.02); gap: 10px;';
        
        // Izquierda: checkbox + label
        const left = document.createElement('label');
        left.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 500; color: #334155; margin: 0; flex: 1;';
        
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = col.checked;
        chk.style.cssText = 'width: 16px; height: 16px; cursor: pointer;';
        chk.onchange = (e) => {
            col.checked = e.target.checked;
            window.guardarConfiguracionColumnas();
            window.guardarDisenoPDF();
            window.actualizarPrevisualizacionPDF();
        };
        
        const labelSpan = document.createElement('span');
        labelSpan.innerText = col.label;
        
        left.appendChild(chk);
        left.appendChild(labelSpan);
        
        // Derecha: Controles de Flecha Arriba/Abajo 🔼/🔽
        const right = document.createElement('div');
        right.style.cssText = 'display: flex; align-items: center; gap: 4px;';
        
        const btnUp = document.createElement('button');
        btnUp.type = 'button';
        btnUp.innerHTML = '🔼';
        btnUp.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.9em; padding: 2px; transition: transform 0.1s; outline: none;';
        btnUp.disabled = idx === 0;
        if (idx === 0) btnUp.style.opacity = '0.2';
        btnUp.onclick = () => {
            window.moverColumnaPDF(idx, idx - 1);
        };
        
        const btnDown = document.createElement('button');
        btnDown.type = 'button';
        btnDown.innerHTML = '🔽';
        btnDown.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.9em; padding: 2px; transition: transform 0.1s; outline: none;';
        btnDown.disabled = idx === pdfColumnsOrder.length - 1;
        if (idx === pdfColumnsOrder.length - 1) btnDown.style.opacity = '0.2';
        btnDown.onclick = () => {
            window.moverColumnaPDF(idx, idx + 1);
        };
        
        right.appendChild(btnUp);
        right.appendChild(btnDown);
        
        item.appendChild(left);
        item.appendChild(right);
        listContainer.appendChild(item);
    });
};

window.moverColumnaPDF = function(fromIdx, toIdx) {
    if (toIdx < 0 || toIdx >= pdfColumnsOrder.length) return;
    
    // Intercambiar
    const temp = pdfColumnsOrder[fromIdx];
    pdfColumnsOrder[fromIdx] = pdfColumnsOrder[toIdx];
    pdfColumnsOrder[toIdx] = temp;
    
    window.guardarConfiguracionColumnas();
    window.guardarDisenoPDF();
    window.renderConfiguradorColumnas();
    window.actualizarPrevisualizacionPDF();
};

window.pdfRubrosState = [];
window.pdfCapaCState = null; // Guardará el estado detallado granular
window.pdfCapaCExpanded = { legacy: false, lotes: false, receta: false, reposicion: false };

// Helper robusto para extracción de valor de ordenamiento Capa D
function obtenerValorOrdenamientoCapaD(art, attribute) {
    if (!art.propiedades_dinamicas) return 0;
    const prop = art.propiedades_dinamicas[attribute];
    if (!prop) return 0;
    const val = typeof prop === 'object' ? prop.valor : prop;
    if (!val) return 0;

    // 1. Intentar extraer número de presentación (ej: "10 kg", "envases por 10 kg", "500 g")
    const match = String(val).match(/(\d+(?:\.\d+)?)\s*(kg|g|u|l|ml|unidad)?/i);
    if (match) {
        let num = parseFloat(match[1]);
        let unit = (match[2] || '').toLowerCase();
        if (unit === 'g' || unit === 'ml') {
            num = num / 1000.0; // Normalizar gramos/mililitros
        }
        return num;
    }

    // 2. Fallback semántico cualitativo para ordenamiento de variables nominales comerciales
    const valStr = String(val).toLowerCase();
    if (valStr.includes('grande') || valStr.includes('mayor')) {
        return 100;
    } else if (valStr.includes('medio') || valStr.includes('mediano')) {
        return 50;
    } else if (valStr.includes('chico') || valStr.includes('pequeño')) {
        return 10;
    }

    return String(val); // Fallback a ordenamiento alfabético
}

// Helper para obtener el valor formateado comercial de la Capa D
function obtenerValorFormateadoCapaD(art, attribute) {
    if (!art.propiedades_dinamicas) return 'Sin Especificar';
    const prop = art.propiedades_dinamicas[attribute];
    if (!prop) return 'Sin Especificar';
    return typeof prop === 'object' ? prop.valor : prop;
}

// Inicializar el estado de los acordeones y los artículos individuales de la Capa C
window.inicializarCapaCState = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    const listaId = list.lista_id;

    // Obtener artículos asociados a esta lista de precios
    const articulosDeLista = articulosBunkerGlobal.filter(art => {
        return art.margenes && art.margenes.some(m => Number(m.lista_id) === Number(listaId));
    });

    const oldState = window.pdfCapaCState || {
        legacy: { checked: true, items: [] },
        lotes: { checked: true, items: [] },
        receta: { checked: true, items: [] },
        reposicion: { checked: true, items: [] }
    };

    const categories = {
        legacy: [],
        lotes: [],
        receta: [],
        reposicion: []
    };

    articulosDeLista.forEach(art => {
        const isLegacyOnly = parseFloat(art.costo_base) > 0 &&
                             parseInt(art.total_lotes_historicos || 0) === 0 &&
                             parseInt(art.total_recetas || 0) === 0 &&
                             parseInt(art.total_mapeos_reposicion || 0) === 0;

        const hasLotes = parseInt(art.total_lotes_historicos || 0) > 0;
        const hasRecetas = parseInt(art.total_recetas || 0) > 0;
        const hasReposicion = parseInt(art.total_mapeos_reposicion || 0) > 0;

        const artItem = {
            articulo_id: art.articulo_id,
            descripcion: art.descripcion_generada || art.descripcion,
            costo_base: parseFloat(art.costo_base)
        };

        if (isLegacyOnly) categories.legacy.push(artItem);
        if (hasLotes) categories.lotes.push(artItem);
        if (hasRecetas) categories.receta.push(artItem);
        if (hasReposicion) categories.reposicion.push(artItem);
    });

    const syncCategory = (catKey) => {
        const oldCat = oldState[catKey] || { checked: true, items: [] };
        const newItems = categories[catKey].map(item => {
            const oldItem = oldCat.items.find(i => i.articulo_id === item.articulo_id);
            return {
                ...item,
                checked: oldItem ? oldItem.checked : true
            };
        });
        
        // El estado maestro de la categoría debe sincronizarse con si todos están checkeados
        const allChecked = newItems.length > 0 && newItems.every(i => i.checked);
        return {
            checked: oldCat.items.length > 0 ? allChecked : oldCat.checked,
            items: newItems
        };
    };

    window.pdfCapaCState = {
        legacy: syncCategory('legacy'),
        lotes: syncCategory('lotes'),
        receta: syncCategory('receta'),
        reposicion: syncCategory('reposicion')
    };
};

window.inicializarArbolCategorias = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    const listaId = list.lista_id;
    
    // Si no está inicializado el estado de la Capa C, lo creamos
    if (!window.pdfCapaCState) {
        window.inicializarCapaCState();
    }



    // Filtrar los artículos que tienen esta lista activa y cumplen los filtros individuales de la Capa C
    const articulosFiltrados = articulosBunkerGlobal.filter(art => {
        const hasMargin = art.margenes && art.margenes.some(m => Number(m.lista_id) === Number(listaId));
        if (!hasMargin) return false;

        const isLegacyOnly = parseFloat(art.costo_base) > 0 &&
                             parseInt(art.total_lotes_historicos || 0) === 0 &&
                             parseInt(art.total_recetas || 0) === 0 &&
                             parseInt(art.total_mapeos_reposicion || 0) === 0;

        const hasLotes = parseInt(art.total_lotes_historicos || 0) > 0;
        const hasRecetas = parseInt(art.total_recetas || 0) > 0;
        const hasReposicion = parseInt(art.total_mapeos_reposicion || 0) > 0;

        // Comprobación granular
        if (isLegacyOnly) {
            const item = window.pdfCapaCState.legacy.items.find(i => i.articulo_id === art.articulo_id);
            if (item && !item.checked) return false;
        }
        if (hasLotes) {
            const item = window.pdfCapaCState.lotes.items.find(i => i.articulo_id === art.articulo_id);
            if (item && !item.checked) return false;
        }
        if (hasRecetas) {
            const item = window.pdfCapaCState.receta.items.find(i => i.articulo_id === art.articulo_id);
            if (item && !item.checked) return false;
        }
        if (hasReposicion) {
            const item = window.pdfCapaCState.reposicion.items.find(i => i.articulo_id === art.articulo_id);
            if (item && !item.checked) return false;
        }

        return true;
    });

    // Agrupar por Rubro y Sub-rubro
    const rawMap = {};
    articulosFiltrados.forEach(art => {
        const rName = (art.rubro || 'SIN RUBRO').trim();
        const sName = (art.sub_rubro || 'SIN SUB-RUBRO').trim();
        
        if (!rawMap[rName]) {
            rawMap[rName] = {};
        }
        if (!rawMap[rName][sName]) {
            rawMap[rName][sName] = [];
        }
        rawMap[rName][sName].push(art);
    });

    // Mantener la persistencia del estado previo de checks y secuencias de rubros
    const oldState = window.pdfRubrosState || [];
    const newState = [];

    const oldRubrosOrder = oldState.map(r => r.name);
    const allNewRubros = Object.keys(rawMap);
    
    // Respetar la secuencia geométrica previa de rubros
    let orderedRubros = [];
    oldRubrosOrder.forEach(rName => {
        if (allNewRubros.includes(rName)) {
            orderedRubros.push(rName);
        }
    });
    allNewRubros.forEach(rName => {
        if (!orderedRubros.includes(rName)) {
            orderedRubros.push(rName);
        }
    });

    orderedRubros.forEach(rName => {
        const oldR = oldState.find(r => r.name === rName);
        const rChecked = oldR ? oldR.checked : true;

        const subRubrosList = [];
        const oldSubRubrosOrder = oldR ? oldR.subRubros.map(s => s.name) : [];
        const allNewSubRubros = Object.keys(rawMap[rName]);
        
        let orderedSubRubros = [];
        oldSubRubrosOrder.forEach(sName => {
            if (allNewSubRubros.includes(sName)) {
                orderedSubRubros.push(sName);
            }
        });
        allNewSubRubros.forEach(sName => {
            if (!orderedSubRubros.includes(sName)) {
                orderedSubRubros.push(sName);
            }
        });

        orderedSubRubros.forEach(sName => {
            const oldS = oldR ? oldR.subRubros.find(s => s.name === sName) : null;
            const sChecked = oldS ? oldS.checked : true;
            
            // Copiar los artículos y aplicar ordenamiento por múltiples atributos prioritarios de la Capa D
            const sortedItems = [...rawMap[rName][sName]];
            const activeAttrs = window.pdfCapaDAttributes ? window.pdfCapaDAttributes.filter(a => a.checked).map(a => a.id) : [];
            
            if (activeAttrs.length > 0) {
                sortedItems.sort((a, b) => {
                    for (const attr of activeAttrs) {
                        const valA = obtenerValorOrdenamientoCapaD(a, attr);
                        const valB = obtenerValorOrdenamientoCapaD(b, attr);
                        if (valA !== valB) {
                            if (typeof valA === 'number' && typeof valB === 'number') {
                                return valB - valA; // Descendente por tamaño/peso
                            }
                            return String(valA).localeCompare(String(valB));
                        }
                    }
                    return 0;
                });
            }

            subRubrosList.push({
                name: sName,
                checked: sChecked,
                items: sortedItems
            });
        });

        newState.push({
            name: rName,
            checked: rChecked,
            subRubros: subRubrosList
        });
    });

    window.pdfRubrosState = newState;
};

window.renderArbolCategorias = function() {
    const treeContainer = document.getElementById('pdf-category-tree');
    if (!treeContainer) return;
    
    treeContainer.innerHTML = '';
    
    window.pdfRubrosState.forEach((rubro, rIdx) => {
        const rContainer = document.createElement('div');
        rContainer.style.cssText = 'display: flex; flex-direction: column; gap: 4px; padding: 4px; border-bottom: 1px solid #f1f5f9;';

        const rHeader = document.createElement('div');
        rHeader.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px;';

        // Checkbox + Nombre de Rubro Padre
        const left = document.createElement('label');
        left.style.cssText = 'display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: bold; color: #8e4785; font-size: 0.85em; margin: 0; flex: 1;';
        
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = rubro.checked;
        chk.style.cssText = 'width: 14px; height: 14px; cursor: pointer;';
        chk.onchange = (e) => {
            rubro.checked = e.target.checked;
            // Sincronizar todos sus subrubros hijos
            rubro.subRubros.forEach(s => {
                s.checked = e.target.checked;
            });
            window.renderArbolCategorias();
            window.actualizarPrevisualizacionPDF();
        };

        const span = document.createElement('span');
        span.innerText = `■ ${rubro.name.toUpperCase()}`;

        left.appendChild(chk);
        left.appendChild(span);

        // Controles de Posición (🔼/🔽) para Rubros
        const right = document.createElement('div');
        right.style.cssText = 'display: flex; align-items: center; gap: 2px;';

        const btnUp = document.createElement('button');
        btnUp.type = 'button';
        btnUp.innerHTML = '🔼';
        btnUp.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.8em; padding: 1px; outline: none;';
        btnUp.disabled = rIdx === 0;
        if (rIdx === 0) btnUp.style.opacity = '0.2';
        btnUp.onclick = () => {
            window.moverRubroPDF(rIdx, rIdx - 1);
        };

        const btnDown = document.createElement('button');
        btnDown.type = 'button';
        btnDown.innerHTML = '🔽';
        btnDown.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.8em; padding: 1px; outline: none;';
        btnDown.disabled = rIdx === window.pdfRubrosState.length - 1;
        if (rIdx === window.pdfRubrosState.length - 1) btnDown.style.opacity = '0.2';
        btnDown.onclick = () => {
            window.moverRubroPDF(rIdx, rIdx + 1);
        };

        right.appendChild(btnUp);
        right.appendChild(btnDown);

        rHeader.appendChild(left);
        rHeader.appendChild(right);
        rContainer.appendChild(rHeader);

        // Sub-rubros
        const subList = document.createElement('div');
        subList.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin-left: 15px; margin-top: 2px;';

        rubro.subRubros.forEach((sub, sIdx) => {
            const sHeader = document.createElement('div');
            sHeader.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 6px;';

            const sLeft = document.createElement('label');
            sLeft.style.cssText = 'display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 500; color: #475569; font-size: 0.8em; margin: 0; flex: 1;';

            const sChk = document.createElement('input');
            sChk.type = 'checkbox';
            sChk.checked = sub.checked;
            sChk.style.cssText = 'width: 12px; height: 12px; cursor: pointer;';
            sChk.onchange = (e) => {
                sub.checked = e.target.checked;
                if (e.target.checked) {
                    rubro.checked = true;
                } else {
                    const anyChecked = rubro.subRubros.some(s => s.checked);
                    if (!anyChecked) {
                        rubro.checked = false;
                    }
                }
                window.renderArbolCategorias();
                window.actualizarPrevisualizacionPDF();
            };

            const sSpan = document.createElement('span');
            sSpan.innerText = `↳ ${sub.name}`;

            sLeft.appendChild(sChk);
            sLeft.appendChild(sSpan);

            // Controles posicionales para Subrubros
            const sRight = document.createElement('div');
            sRight.style.cssText = 'display: flex; align-items: center; gap: 2px;';

            const sBtnUp = document.createElement('button');
            sBtnUp.type = 'button';
            sBtnUp.innerHTML = '▲';
            sBtnUp.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.75em; padding: 1px; outline: none;';
            sBtnUp.disabled = sIdx === 0;
            if (sIdx === 0) sBtnUp.style.opacity = '0.2';
            sBtnUp.onclick = () => {
                window.moverSubrubroPDF(rIdx, sIdx, sIdx - 1);
            };

            const sBtnDown = document.createElement('button');
            sBtnDown.type = 'button';
            sBtnDown.innerHTML = '▼';
            sBtnDown.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.75em; padding: 1px; outline: none;';
            sBtnDown.disabled = sIdx === rubro.subRubros.length - 1;
            if (sIdx === rubro.subRubros.length - 1) sBtnDown.style.opacity = '0.2';
            sBtnDown.onclick = () => {
                window.moverSubrubroPDF(rIdx, sIdx, sIdx + 1);
            };

            sRight.appendChild(sBtnUp);
            sRight.appendChild(sBtnDown);

            sHeader.appendChild(sLeft);
            sHeader.appendChild(sRight);
            subList.appendChild(sHeader);
        });

        rContainer.appendChild(subList);
        treeContainer.appendChild(rContainer);
    });
};

window.moverRubroPDF = function(fromIdx, toIdx) {
    if (toIdx < 0 || toIdx >= window.pdfRubrosState.length) return;
    
    const temp = window.pdfRubrosState[fromIdx];
    window.pdfRubrosState[fromIdx] = window.pdfRubrosState[toIdx];
    window.pdfRubrosState[toIdx] = temp;
    
    window.renderArbolCategorias();
    window.actualizarPrevisualizacionPDF();
};

window.moverSubrubroPDF = function(rubroIdx, fromIdx, toIdx) {
    const rubro = window.pdfRubrosState[rubroIdx];
    if (!rubro || toIdx < 0 || toIdx >= rubro.subRubros.length) return;
    
    const temp = rubro.subRubros[fromIdx];
    rubro.subRubros[fromIdx] = rubro.subRubros[toIdx];
    rubro.subRubros[toIdx] = temp;
    
    window.renderArbolCategorias();
    window.actualizarPrevisualizacionPDF();
};

window.moverCapaDAttr = function(fromIdx, toIdx) {
    if (toIdx < 0 || toIdx >= window.pdfCapaDAttributes.length) return;
    const temp = window.pdfCapaDAttributes[fromIdx];
    window.pdfCapaDAttributes[fromIdx] = window.pdfCapaDAttributes[toIdx];
    window.pdfCapaDAttributes[toIdx] = temp;
    
    window.renderCapaDPriorityList();
    window.actualizarPrevisualizacionPDF();
};

window.renderCapaDPriorityList = function() {
    const container = document.getElementById('pdf-capad-priority-list');
    if (!container) return;
    container.innerHTML = '';
    
    window.pdfCapaDAttributes.forEach((attr, idx) => {
        const item = document.createElement('div');
        item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 6px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px;';
        
        const label = document.createElement('label');
        label.style.cssText = 'display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.85em; color: #334155; margin: 0; font-weight: 500; flex: 1;';
        
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = attr.checked;
        chk.style.cssText = 'width: 14px; height: 14px; cursor: pointer;';
        chk.onchange = (e) => {
            attr.checked = e.target.checked;
            window.actualizarPrevisualizacionPDF();
        };
        
        const span = document.createElement('span');
        span.innerHTML = attr.label;
        
        label.appendChild(chk);
        label.appendChild(span);
        
        const controls = document.createElement('div');
        controls.style.cssText = 'display: flex; align-items: center; gap: 2px;';
        
        const btnUp = document.createElement('button');
        btnUp.type = 'button';
        btnUp.innerHTML = '▲';
        btnUp.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.75em; padding: 1px; outline: none;';
        btnUp.disabled = idx === 0;
        if (idx === 0) btnUp.style.opacity = '0.2';
        btnUp.onclick = () => {
            window.moverCapaDAttr(idx, idx - 1);
        };
        
        const btnDown = document.createElement('button');
        btnDown.type = 'button';
        btnDown.innerHTML = '▼';
        btnDown.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.75em; padding: 1px; outline: none;';
        btnDown.disabled = idx === window.pdfCapaDAttributes.length - 1;
        if (idx === window.pdfCapaDAttributes.length - 1) btnDown.style.opacity = '0.2';
        btnDown.onclick = () => {
            window.moverCapaDAttr(idx, idx + 1);
        };
        
        controls.appendChild(btnUp);
        controls.appendChild(btnDown);
        
        item.appendChild(label);
        item.appendChild(controls);
        container.appendChild(item);
    });
};

window.toggleColapsarSidebar = function(event) {
    if (event) event.stopPropagation();
    const sidebar = document.getElementById('pdf-config-sidebar');
    const btn = document.getElementById('pdf-btn-collapse-sidebar');
    if (!sidebar || !btn) return;
    
    const isCollapsed = sidebar.style.width === '0px';
    if (isCollapsed) {
        sidebar.style.width = '320px';
        sidebar.style.padding = '15px';
        sidebar.style.opacity = '1';
        sidebar.style.marginRight = '0px';
        btn.innerHTML = '◀';
        btn.style.left = '-6px';
    } else {
        sidebar.style.width = '0px';
        sidebar.style.padding = '0px';
        sidebar.style.opacity = '0';
        sidebar.style.marginRight = '-12px';
        btn.innerHTML = '▶';
        btn.style.left = '0px';
    }
    window.guardarDisenoPDF();
};

window.inicializarSplitterDrag = function() {
    const splitter = document.getElementById('pdf-sidebar-splitter');
    const sidebar = document.getElementById('pdf-config-sidebar');
    if (!splitter || !sidebar) return;
    if (splitter.dataset.dragInitialized) return;
    splitter.dataset.dragInitialized = 'true';
    
    let startX, startWidth;
    
    splitter.addEventListener('mousedown', function(e) {
        if (e.target.id === 'pdf-btn-collapse-sidebar') return;
        startX = e.clientX;
        startWidth = parseInt(document.defaultView.getComputedStyle(sidebar).width, 10);
        
        sidebar.style.transition = 'none';
        
        function doDrag(e) {
            const newWidth = startWidth + (e.clientX - startX);
            if (newWidth >= 200 && newWidth <= 500) {
                sidebar.style.width = newWidth + 'px';
            }
        }
        
        function stopDrag() {
            document.documentElement.removeEventListener('mousemove', doDrag, false);
            document.documentElement.removeEventListener('mouseup', stopDrag, false);
            sidebar.style.transition = 'width 0.3s ease, padding 0.3s ease, margin 0.3s ease, opacity 0.3s ease';
            window.guardarDisenoPDF();
        }
        
        document.documentElement.addEventListener('mousemove', doDrag, false);
        document.documentElement.addEventListener('mouseup', stopDrag, false);
    });
    
    splitter.addEventListener('dblclick', function(e) {
        if (e.target.id === 'pdf-btn-collapse-sidebar') return;
        window.toggleColapsarSidebar();
    });
};

window.guardarDisenoPDF = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list || !list.lista_id) return;
    const listaId = list.lista_id;
    
    const capaA = pdfColumnsOrder.map(c => ({ id: c.id, checked: c.checked }));
    
    const capaB = window.pdfRubrosState ? window.pdfRubrosState.map(r => ({
        name: r.name,
        checked: r.checked,
        subRubros: r.subRubros.map(s => ({ name: s.name, checked: s.checked }))
    })) : [];
    
    const capaC = window.pdfCapaCState ? {
        legacy: { checked: window.pdfCapaCState.legacy.checked, items: window.pdfCapaCState.legacy.items.map(i => ({ id: i.articulo_id, checked: i.checked })) },
        lotes: { checked: window.pdfCapaCState.lotes.checked, items: window.pdfCapaCState.lotes.items.map(i => ({ id: i.articulo_id, checked: i.checked })) },
        receta: { checked: window.pdfCapaCState.receta.checked, items: window.pdfCapaCState.receta.items.map(i => ({ id: i.articulo_id, checked: i.checked })) },
        reposicion: { checked: window.pdfCapaCState.reposicion.checked, items: window.pdfCapaCState.reposicion.items.map(i => ({ id: i.articulo_id, checked: i.checked })) }
    } : null;
    
    const capaD = window.pdfCapaDAttributes ? window.pdfCapaDAttributes.map(a => ({ id: a.id, checked: a.checked })) : [];
    
    const sidebar = document.getElementById('pdf-config-sidebar');
    const sidebarWidth = sidebar ? sidebar.style.width : '320px';
    const sidebarCollapsed = sidebar ? (sidebar.style.width === '0px') : false;
    
    const designState = {
        capaA,
        capaB,
        capaC,
        capaD,
        sidebarWidth,
        sidebarCollapsed
    };
    
    localStorage.setItem(`pdf_design_state_${listaId}`, JSON.stringify(designState));
    if (typeof window.guardarPreferenciaBunkerRemota === 'function') {
        window.guardarPreferenciaBunkerRemota(`pdf_design_state_${listaId}`, designState);
    }
};

window.cargarDisenoPDF = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list || !list.lista_id) return;
    const listaId = list.lista_id;
    
    const saved = localStorage.getItem(`pdf_design_state_${listaId}`);
    if (!saved) {
        window.pdfCapaDAttributes = [
            { id: 'variedad', label: '🌾 Variedad comercial', checked: false },
            { id: 'presentacion', label: '📦 Presentación del empaque', checked: true },
            { id: 'marca', label: '🏷️ Marca comercial', checked: false },
            { id: 'origen', label: '🌍 Origen / Procedencia', checked: false }
        ];
        return;
    }
    
    try {
        const state = JSON.parse(saved);
        
        if (state.capaA && !localStorage.getItem('bunker_pdf_columns_config_v2')) {
            const merged = [];
            state.capaA.forEach(savedCol => {
                const original = pdfColumnsOrder.find(c => c.id === savedCol.id);
                if (original) {
                    merged.push({
                        ...original,
                        checked: savedCol.checked !== undefined ? !!savedCol.checked : original.checked
                    });
                }
            });
            pdfColumnsOrder.forEach(o => {
                if (!merged.some(m => m.id === o.id)) {
                    merged.push(o);
                }
            });
            pdfColumnsOrder = merged;
        }
        
        if (state.capaB) {
            const restoredRubros = [];
            state.capaB.forEach(savedRubro => {
                const origRubro = window.pdfRubrosState ? window.pdfRubrosState.find(r => r.name === savedRubro.name) : null;
                if (origRubro) {
                    const restoredSubRubros = [];
                    savedRubro.subRubros.forEach(savedSub => {
                        const origSub = origRubro.subRubros.find(s => s.name === savedSub.name);
                        if (origSub) {
                            origSub.checked = savedSub.checked;
                            restoredSubRubros.push(origSub);
                        }
                    });
                    origRubro.subRubros.forEach(s => {
                        if (!restoredSubRubros.some(rs => rs.name === s.name)) {
                            restoredSubRubros.push(s);
                        }
                    });
                    origRubro.checked = savedRubro.checked;
                    origRubro.subRubros = restoredSubRubros;
                    restoredRubros.push(origRubro);
                }
            });
            if (window.pdfRubrosState) {
                window.pdfRubrosState.forEach(r => {
                    if (!restoredRubros.some(rr => rr.name === r.name)) {
                        restoredRubros.push(r);
                    }
                });
                window.pdfRubrosState = restoredRubros;
            }
        }
        
        if (state.capaC && window.pdfCapaCState) {
            const syncCapaCCategory = (catKey) => {
                const savedCat = state.capaC[catKey];
                const origCat = window.pdfCapaCState[catKey];
                if (savedCat && origCat) {
                    origCat.checked = savedCat.checked;
                    savedCat.items.forEach(savedItem => {
                        const origItem = origCat.items.find(i => i.articulo_id === savedItem.id);
                        if (origItem) origItem.checked = savedItem.checked;
                    });
                }
            };
            syncCapaCCategory('legacy');
            syncCapaCCategory('lotes');
            syncCapaCCategory('receta');
            syncCapaCCategory('reposicion');
        }
        
        if (state.capaD) {
            const restoredCapaD = [];
            state.capaD.forEach(savedAttr => {
                restoredCapaD.push({
                    id: savedAttr.id,
                    label: savedAttr.id === 'variedad' ? '🌾 Variedad comercial' :
                           savedAttr.id === 'presentacion' ? '📦 Presentación del empaque' :
                           savedAttr.id === 'marca' ? '🏷️ Marca comercial' : '🌍 Origen / Procedencia',
                    checked: savedAttr.checked
                });
            });
            const attrs = ['variedad', 'presentacion', 'marca', 'origen'];
            attrs.forEach(id => {
                if (!restoredCapaD.some(a => a.id === id)) {
                    restoredCapaD.push({
                        id,
                        label: id === 'variedad' ? '🌾 Variedad comercial' :
                               id === 'presentacion' ? '📦 Presentación del empaque' :
                               id === 'marca' ? '🏷️ Marca comercial' : '🌍 Origen / Procedencia',
                        checked: id === 'presentacion'
                    });
                }
            });
            window.pdfCapaDAttributes = restoredCapaD;
        } else {
            window.pdfCapaDAttributes = [
                { id: 'variedad', label: '🌾 Variedad comercial', checked: false },
                { id: 'presentacion', label: '📦 Presentación del empaque', checked: true },
                { id: 'marca', label: '🏷️ Marca comercial', checked: false },
                { id: 'origen', label: '🌍 Origen / Procedencia', checked: false }
            ];
        }
        
        const sidebar = document.getElementById('pdf-config-sidebar');
        if (sidebar) {
            if (state.sidebarWidth) {
                sidebar.style.width = state.sidebarWidth;
            }
            if (state.sidebarCollapsed) {
                sidebar.style.width = '0px';
                sidebar.style.padding = '0px';
                sidebar.style.opacity = '0';
                sidebar.style.marginRight = '-12px';
                const btn = document.getElementById('pdf-btn-collapse-sidebar');
                if (btn) {
                    btn.innerHTML = '▶';
                    btn.style.left = '0px';
                }
            }
        }
    } catch (e) {
        console.error("VIGÍA: Error cargando diseño", e);
    }
};

window.renderCapaCMatrix = function() {
    const container = document.getElementById('pdf-capac-matrix');
    if (!container) return;

    if (!window.pdfCapaCState) {
        window.inicializarCapaCState();
    }

    const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

    const sources = [
        { key: 'legacy', label: '🕰️ Historial Legacy (Lomas)', icon: '🕰️' },
        { key: 'lotes', label: '📦 Compra Física de Lotes', icon: '📦' },
        { key: 'receta', label: '📜 Estructura de Recetas (Ingr.)', icon: '📜' },
        { key: 'reposicion', label: '📡 Ofertas de Reposición', icon: '📡' }
    ];

    let html = '';
    sources.forEach(src => {
        const cat = window.pdfCapaCState[src.key];
        if (!cat) return;

        const isExpanded = window.pdfCapaCExpanded && window.pdfCapaCExpanded[src.key];
        const arrow = isExpanded ? '▼' : '▶';
        const displayStyle = isExpanded ? 'block' : 'none';
        const itemsCount = cat.items.length;

        // Comprobar si todos los hijos están marcados para poner el master checkbox
        const allChecked = cat.items.length > 0 && cat.items.every(i => i.checked);
        const masterChecked = cat.checked && allChecked;

        html += `
            <div class="capac-card" style="border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; margin-bottom: 6px; background: #f8fafc; transition: all 0.2s ease;">
                <!-- Header -->
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: #e2e8f0; cursor: pointer; user-select: none;" onclick="window.toggleCapaCAccordion(event, '${src.key}')">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 0.75em; color: #64748b; font-family: monospace; width: 12px; text-align: center;">${arrow}</span>
                        <input type="checkbox" id="capac-master-${src.key}" ${masterChecked ? 'checked' : ''} onclick="window.toggleCapaCMaster(event, '${src.key}', this.checked)" style="cursor: pointer; width: 14px; height: 14px; margin: 0;">
                        <span style="font-size: 0.82em; font-weight: bold; color: #1e293b;">${src.label}</span>
                    </div>
                    <span style="background: #cbd5e1; color: #475569; font-size: 0.72em; padding: 2px 6px; border-radius: 10px; font-weight: bold;">${itemsCount}</span>
                </div>
                <!-- Items Drawer -->
                <div id="capac-drawer-${src.key}" style="display: ${displayStyle}; max-height: 150px; overflow-y: auto; background: white; padding: 6px 10px; border-top: 1px solid #cbd5e1;">
                    ${itemsCount === 0 ? `
                        <div style="text-align: center; color: #94a3b8; font-style: italic; padding: 6px; font-size: 0.78em;">No hay artículos</div>
                    ` : cat.items.map(item => `
                        <label style="display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 0.78em; color: #475569; cursor: pointer; border-bottom: 1px dashed #f1f5f9; transition: color 0.2s;" onmouseover="this.style.color='#8e4785'" onmouseout="this.style.color='#475569'">
                            <input type="checkbox" id="capac-item-${src.key}-${item.articulo_id}" ${item.checked ? 'checked' : ''} onchange="window.toggleCapaCItemChild('${src.key}', '${item.articulo_id}', this.checked)" style="cursor: pointer; width: 13px; height: 13px; margin: 0;">
                            <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.descripcion}">${item.descripcion}</span>
                            <strong style="color: #64748b; font-family: monospace;">(${formatter.format(item.costo_base)})</strong>
                        </label>
                    `).join('')}
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
};

window.toggleCapaCAccordion = function(e, key) {
    if (e.target.type === 'checkbox') return;
    window.pdfCapaCExpanded[key] = !window.pdfCapaCExpanded[key];
    window.renderCapaCMatrix();
};

window.toggleCapaCMaster = function(e, key, checked) {
    e.stopPropagation();
    const cat = window.pdfCapaCState[key];
    if (cat) {
        cat.checked = checked;
        cat.items.forEach(item => {
            item.checked = checked;
        });
        window.renderCapaCMatrix();
        window.inicializarArbolCategorias();
        window.renderArbolCategorias();
        window.actualizarPrevisualizacionPDF();
    }
};

window.toggleCapaCItemChild = function(key, articulo_id, checked) {
    const cat = window.pdfCapaCState[key];
    if (cat) {
        const item = cat.items.find(i => i.articulo_id === articulo_id);
        if (item) {
            item.checked = checked;
        }
        
        const allChecked = cat.items.every(i => i.checked);
        cat.checked = allChecked;
        
        window.renderCapaCMatrix();
        window.inicializarArbolCategorias();
        window.renderArbolCategorias();
        window.actualizarPrevisualizacionPDF();
    }
};

window.cambiarFiltroCostosCapaC = function() {
    window.inicializarArbolCategorias();
    window.renderArbolCategorias();
    window.actualizarPrevisualizacionPDF();
};

window.cambiarAtributoCapaD = function() {
    window.inicializarArbolCategorias();
    window.renderArbolCategorias();
    window.actualizarPrevisualizacionPDF();
};

window.abrirPrevisualizadorPDFGlobal = function() {
    if (gp_listasFinancieras && gp_listasFinancieras.length > 0) {
        const idx = gp_listasFinancieras.findIndex(l => Number(l.lista_id) === Number(listaSeleccionadaGlobal));
        if (idx !== -1) {
            gp_activeTabIdx = idx;
        }
    }
    window.abrirPrevisualizadorPDF();
};

window.abrirPrevisualizadorPDF = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list || !list.lista_id) {
        Swal.fire('Error', 'No se pudo determinar la lista activa en el Gestor de Precios.', 'error');
        return;
    }

    // Poblar de manera dinámica el dropdown del selector de lista comercial activa del previsualizador
    const pdfSelect = document.getElementById('pdf-seleccion-lista');
    if (pdfSelect) {
        pdfSelect.innerHTML = '';
        gp_listasFinancieras.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.lista_id;
            opt.textContent = l.nombre_lista;
            pdfSelect.appendChild(opt);
        });
        pdfSelect.value = list.lista_id;
    }
    
    if (document.getElementById('pdf-prev-lista-nombre')) {
        document.getElementById('pdf-prev-lista-nombre').innerText = list.nombre_lista;
    }
    
    const hoy = new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
    if (document.getElementById('pdf-prev-emision-fecha')) {
        document.getElementById('pdf-prev-emision-fecha').innerText = hoy;
    }
    
    // Cargar la configuración guardada de columnas desde localStorage antes de renderizar
    window.cargarConfiguracionColumnas();
    
    // Inicializar y renderizar Capa C y Capa B con persistencia atómica
    window.inicializarCapaCState();
    window.inicializarArbolCategorias();
    window.cargarDisenoPDF(); // Carga la memoria del localStorage indexada por ID de lista
    window.cargarConfiguracionColumnas();
    window.renderConfiguradorColumnas();
    window.inicializarArbolCategorias(); // Re-inicializa con el orden y estados cargados
    window.renderCapaCMatrix();
    window.renderArbolCategorias();
    window.renderCapaDPriorityList();
    window.inicializarSplitterDrag();
    
    // Asegurar Higiene Clean Slate para el maximizado
    const contentEl = document.getElementById('pdf-modal-content');
    if (contentEl) {
        contentEl.classList.remove('vr-maximized');
    }
    const btnMax = document.getElementById('pdf-btn-maximize');
    if (btnMax) {
        btnMax.innerHTML = '🗖';
        btnMax.title = 'Maximizar';
    }
    
    const modalEl = document.getElementById('modal-preimpresion-pdf');
    if (modalEl) {
        modalEl.style.display = 'flex';
    }
    
    window.actualizarPrevisualizacionPDF();
};

window.cerrarPrevisualizadorPDF = function() {
    // Limpieza de maximizado al cerrar
    const contentEl = document.getElementById('pdf-modal-content');
    if (contentEl) {
        contentEl.classList.remove('vr-maximized');
    }
    const btnMax = document.getElementById('pdf-btn-maximize');
    if (btnMax) {
        btnMax.innerHTML = '🗖';
        btnMax.title = 'Maximizar';
    }
    
    const modalEl = document.getElementById('modal-preimpresion-pdf');
    if (modalEl) {
        modalEl.style.display = 'none';
    }
};

window.cambiarListaPreciosPDF = function(listaId) {
    console.log("=== VIGÍA DEPURADOR: INICIO DE CAMBIO DE LISTA EN PREVISUALIZADOR PDF ===");
    // 1. Guardar el diseño actual de la lista que se está abandonando
    window.guardarDisenoPDF();

    // 2. Resolver el índice de la nueva lista seleccionada
    const idx = gp_listasFinancieras.findIndex(l => Number(l.lista_id) === Number(listaId));
    if (idx !== -1) {
        gp_activeTabIdx = idx;
        const list = gp_listasFinancieras[idx];
        console.log(`VIGÍA: Cambiando a listaId ${listaId} (${list.nombre_lista}) en gp_activeTabIdx: ${gp_activeTabIdx}`);

        // 3. Actualizar la cabecera de la hoja simulada
        if (document.getElementById('pdf-prev-lista-nombre')) {
            document.getElementById('pdf-prev-lista-nombre').innerText = list.nombre_lista;
        }

        // 4. Cargar el diseño de columnas/categorías específico de la nueva lista
        window.cargarDisenoPDF();
        window.cargarConfiguracionColumnas();
        window.renderConfiguradorColumnas();

        // 5. Re-inicializar y renderizar las capas comerciales
        window.inicializarArbolCategorias();
        window.renderArbolCategorias();
        window.renderCapaCMatrix();
        window.renderCapaDPriorityList();

        // 6. Forzar actualización de la previsualización adaptativa
        window.actualizarPrevisualizacionPDF();
    } else {
        console.error(`VIGÍA: No se encontró la listaId ${listaId} en gp_listasFinancieras`);
    }
};

window.actualizarPrevisualizacionPDF = function() {
    console.log("=== VIGÍA DEPURADOR: INICIO DE ACTUALIZAR PREVISUALIZACIÓN ===");
    const list = gp_listasFinancieras[gp_activeTabIdx];
    console.log("VIGÍA: Active list object:", list, "at gp_activeTabIdx:", gp_activeTabIdx);
    if (!list) {
        console.warn("VIGÍA: No list found in gp_listasFinancieras at active tab index", gp_activeTabIdx);
        return;
    }
    const listaId = list.lista_id;
    console.log("VIGÍA: Active listaId:", listaId);
    
    // Guardar estado actual de columnas y diseño con persistencia atómica
    window.guardarConfiguracionColumnas();
    window.guardarDisenoPDF();
    
    // 1. Obtener Columnas Activas de Capa A
    const cols = pdfColumnsOrder.filter(c => c.checked);
    console.log("VIGÍA: Columnas activas (cols):", cols.map(c => c.id));
    
    if (cols.length === 0) {
        const descCol = pdfColumnsOrder.find(c => c.id === 'descripcion');
        if (descCol) {
            cols.push(descCol);
        } else {
            cols.push({ id: 'descripcion', label: 'Descripción', align: 'left', baseWidth: 190 });
        }
        console.log("VIGÍA: cols was empty, pushed fallback:", cols.map(c => c.id));
    }
    
    // 2. Calcular anchos elásticos proporcionales (ancho total de tabla es 100%)
    let totalBase = cols.reduce((sum, c) => sum + c.baseWidth, 0);
    cols.forEach(c => {
        c.percentWidth = ((c.baseWidth / totalBase) * 100).toFixed(2) + '%';
    });
    console.log("VIGÍA: Calculated percent widths:", cols.map(c => `${c.id}: ${c.percentWidth}`));
    
    // 3. Renderizar el visor central dinamico agrupado en `#pdf-prev-table-container`
    const prevContainer = document.getElementById('pdf-prev-table-container');
    if (!prevContainer) {
        console.error("VIGÍA: #pdf-prev-table-container NOT FOUND in DOM!");
        return;
    }
    prevContainer.innerHTML = '';
    
    const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

    // Filtrar rubros activos
    const activeRubros = window.pdfRubrosState.filter(r => r.checked);
    console.log("VIGÍA: Active Rubros (Capa B):", activeRubros.map(r => r.name));
    
    if (activeRubros.length === 0) {
        console.warn("VIGÍA: No active rubros to previsualize.");
        prevContainer.innerHTML = `<div style="text-align: center; padding: 40px; color: #94a3b8; font-style: italic;">No hay rubros activos para previsualizar. Seleccione al menos un rubro en la Capa B.</div>`;
        return;
    }

    activeRubros.forEach(rubro => {
        console.log(`VIGÍA: Processing Rubro: ${rubro.name}`);
        // Filtrar sub-rubros activos para este rubro
        const activeSubRubros = rubro.subRubros.filter(s => s.checked);
        console.log(`VIGÍA: Active SubRubros for ${rubro.name}:`, activeSubRubros.map(s => s.name));
        if (activeSubRubros.length === 0) return;

        // Banner del Rubro Principal
        const rubroTitle = document.createElement('div');
        rubroTitle.style.cssText = 'font-size: 1.1em; font-weight: bold; color: #8e4785; margin-top: 15px; border-bottom: 2px solid #8e4785; padding-bottom: 4px; text-transform: uppercase; text-align: left;';
        rubroTitle.innerText = `■ ${rubro.name}`;
        prevContainer.appendChild(rubroTitle);

        activeSubRubros.forEach(sub => {
            console.log(`VIGÍA: Processing Sub-Rubro ${sub.name} (items count: ${sub.items.length})`);
            if (sub.items.length === 0) {
                console.log(`VIGÍA: Sub-Rubro ${sub.name} has 0 items, skipping table.`);
                return;
            }

            // Sub-divisor de Categoría
            const subTitle = document.createElement('div');
            subTitle.style.cssText = 'font-size: 0.9em; font-weight: bold; font-style: italic; color: #475569; margin-left: 10px; margin-top: 8px; margin-bottom: 6px; text-align: left;';
            subTitle.innerText = `↳ ${sub.name}`;
            prevContainer.appendChild(subTitle);

            try {
                // Tabla para esta sección
                const tableWrapper = document.createElement('div');
                tableWrapper.style.cssText = 'width: 100%; overflow-x: auto; margin-left: 10px; width: calc(100% - 10px);';

                const table = document.createElement('table');
                table.className = 'tabla-financiera';
                table.style.cssText = 'width: 100%; box-shadow: none; border: 1px solid #e2e8f0; font-size: 0.85em; border-collapse: collapse; margin-bottom: 15px;';

                // thead
                const thead = document.createElement('thead');
                thead.style.cssText = 'background-color: #8e4785; color: white;';
                let theadHtml = '<tr>';
                cols.forEach(c => {
                    theadHtml += `<th style="width: ${c.percentWidth}; text-align: ${c.align}; padding: 8px; text-transform: uppercase; font-size: 0.8em; letter-spacing: 0.5px;">${c.label}</th>`;
                });
                theadHtml += '</tr>';
                thead.innerHTML = theadHtml;
                table.appendChild(thead);

                // tbody
                const tbody = document.createElement('tbody');
                let renderedRowsCount = 0;
                
                // Atributos activos prioritarios de la Capa D
                const activeAttrs = window.pdfCapaDAttributes ? window.pdfCapaDAttributes.filter(a => a.checked).map(a => a.id) : [];
                let lastAttrVals = {};
                
                sub.items.forEach((art, index) => {
                    try {
                        // Comprobar si cambian los valores de los atributos activos
                        let changedIdx = -1;
                        const currentAttrVals = {};
                        activeAttrs.forEach((attr, idx) => {
                            const val = obtenerValorFormateadoCapaD(art, attr);
                            currentAttrVals[attr] = val;
                            if (changedIdx === -1 && val !== lastAttrVals[attr]) {
                                changedIdx = idx;
                            }
                        });
                        
                        if (changedIdx !== -1) {
                            // Al menos uno cambió. Dibujamos sub-cabeceras para los niveles de prioridad modificados
                            for (let i = changedIdx; i < activeAttrs.length; i++) {
                                const attr = activeAttrs[i];
                                const attrVal = currentAttrVals[attr];
                                lastAttrVals[attr] = attrVal;
                                
                                // Anular los valores de los sub-atributos siguientes para forzar su re-dibujo
                                for (let j = i + 1; j < activeAttrs.length; j++) {
                                    lastAttrVals[activeAttrs[j]] = null;
                                }
                                
                                const level = i + 1;
                                const indent = 24 * level;
                                
                                const subHeaderTr = document.createElement('tr');
                                subHeaderTr.style.backgroundColor = 'transparent';
                                subHeaderTr.innerHTML = `
                                    <td colspan="${cols.length}" style="padding: 6px 12px 6px ${indent}px; font-style: italic; font-weight: 600; color: #64748b; font-size: 0.8em; text-align: left; border: none;">
                                        ${attrVal}
                                    </td>
                                `;
                                tbody.appendChild(subHeaderTr);
                            }
                        }
                        if (!art.margenes) {
                            console.warn(`VIGÍA: Article ${art.articulo_id} lacks 'margenes' array!`);
                            return;
                        }
                        // Encontrar configuración del artículo para esta lista con casting robusto
                        const mFocused = art.margenes.find(m => Number(m.lista_id) === Number(listaId));
                        if (!mFocused) {
                            console.warn(`VIGÍA: Article ${art.articulo_id} has no margin config for listId ${listaId}`);
                            return;
                        }
                        
                        const pFinal = parseFloat(mFocused.precio_final || 0);
                        const ivaVal = parseFloat(mFocused.iva || 21.00);
                        const factorKilos = parseFloat(art.kilos_unidad || 0);
                        
                        const precioBultoNeto = pFinal / (1 + (ivaVal / 100));
                        const precioKiloNeto = factorKilos > 0 ? (precioBultoNeto / factorKilos) : precioBultoNeto;
                        const precioBultoFinal = pFinal;
                        const precioKiloFinal = factorKilos > 0 ? (pFinal / factorKilos) : pFinal;
                        
                        let presentacionText = '';
                        if (art.propiedades_dinamicas && art.propiedades_dinamicas.presentacion) {
                            const pres = art.propiedades_dinamicas.presentacion;
                            const presVal = typeof pres === 'object' ? pres.valor : pres;
                            presentacionText = `${presVal} x ${factorKilos.toFixed(2)} kg`;
                        } else {
                            presentacionText = `Bulto x ${factorKilos.toFixed(2)} kg`;
                        }
                        
                        const tr = document.createElement('tr');
                        if (index % 2 === 1) {
                            tr.style.backgroundColor = '#f8fafc';
                        }
                        
                        let rowHtml = '';
                        cols.forEach(c => {
                            let val = '';
                            if (c.id === 'codigo') val = art.articulo_id;
                            else if (c.id === 'descripcion') val = art.descripcion_generada || art.descripcion;
                            else if (c.id === 'presentacion') val = presentacionText;
                            else if (c.id === 'kilo') val = formatter.format(precioKiloNeto);
                            else if (c.id === 'bulto') val = formatter.format(precioBultoNeto);
                            else if (c.id === 'final_kilo') val = formatter.format(precioKiloFinal);
                            else if (c.id === 'final_bulto') val = formatter.format(precioBultoFinal);
                            
                            rowHtml += `<td style="padding: 8px; text-align: ${c.align}; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 0.9em;">${val}</td>`;
                        });
                        
                        tr.innerHTML = rowHtml;
                        tbody.appendChild(tr);
                        renderedRowsCount++;
                    } catch (artErr) {
                        console.error(`VIGÍA: Error processing article ${art ? art.articulo_id : 'unknown'}:`, artErr);
                    }
                });

                console.log(`VIGÍA: Sub-Rubro ${sub.name} - Rendered rows in tbody: ${renderedRowsCount}`);
                table.appendChild(tbody);
                tableWrapper.appendChild(table);
                prevContainer.appendChild(tableWrapper);
                console.log(`VIGÍA: Successfully appended tableWrapper for ${sub.name} to DOM.`);
            } catch (tableErr) {
                console.error(`VIGÍA: Critical error building table for Sub-Rubro ${sub.name}:`, tableErr);
            }
        });
    });
    console.log("=== VIGÍA DEPURADOR: FIN DE ACTUALIZAR PREVISUALIZACIÓN ===");
};

window.confirmarEImprimirPDF = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    // 1. Obtener columnas activas secuenciales de Capa A
    const cols = pdfColumnsOrder.filter(c => c.checked).map(c => c.id);
    if (cols.length === 0) {
        cols.push('descripcion');
    }
    const colsQuery = cols.join(',');
    
    // 2. Obtener la secuencia ordenada de Rubros Activos de Capa B
    const rubrosActivos = window.pdfRubrosState.filter(r => r.checked).map(r => r.name);
    const rubrosQuery = encodeURIComponent(rubrosActivos.join(','));

    // 3. Obtener la lista de Sub-rubros Ocultos de Capa B
    const subrubrosOcultos = [];
    window.pdfRubrosState.forEach(rubro => {
        rubro.subRubros.forEach(sub => {
            if (!sub.checked) {
                subrubrosOcultos.push(sub.name);
            }
        });
    });
    const subrubrosQuery = encodeURIComponent(subrubrosOcultos.join(','));

    // 4. Obtener artículos excluidos de la Capa C basado en el estado granular de cada categoría
    const excludedCapaC = [];
    if (window.pdfCapaCState) {
        const categoriesKeys = ['legacy', 'lotes', 'receta', 'reposicion'];
        articulosBunkerGlobal.forEach(art => {
            let isPresentInSomeCategory = false;
            let isExcluded = false;

            categoriesKeys.forEach(catKey => {
                const cat = window.pdfCapaCState[catKey];
                if (cat) {
                    const item = cat.items.find(i => i.articulo_id === art.articulo_id);
                    if (item) {
                        isPresentInSomeCategory = true;
                        if (!item.checked) {
                            isExcluded = true;
                        }
                    }
                }
            });

            if (isPresentInSomeCategory && isExcluded) {
                excludedCapaC.push(art.articulo_id);
            }
        });
    }
    const excludeQuery = encodeURIComponent(excludedCapaC.join(','));

    // 5. Obtener los atributos activos prioritarios de la Capa D
    const capadActiveAttrs = window.pdfCapaDAttributes ? window.pdfCapaDAttributes.filter(a => a.checked).map(a => a.id).join(',') : 'none';

    // 6. Obtener la secuencia posicional personalizada de todos los Sub-rubros de la Capa B
    const subrubrosOrder = [];
    window.pdfRubrosState.forEach(rubro => {
        rubro.subRubros.forEach(sub => {
            subrubrosOrder.push(sub.name);
        });
    });
    const subrubrosOrderQuery = encodeURIComponent(subrubrosOrder.join(','));

    // Cerrar previsualizador para mejorar UX
    cerrarPrevisualizadorPDF();
    
    // Abrir descarga en nueva pestaña transmitiendo los parámetros de capas, reordenación posicional y anidamiento
    window.open(`/api/logistica/bunker/exportar-pdf/${list.lista_id}?columns=${colsQuery}&rubros_order=${rubrosQuery}&hidden_subrubros=${subrubrosQuery}&exclude_articles=${excludeQuery}&capa_d_attributes=${capadActiveAttrs}&subrubros_order=${subrubrosOrderQuery}`, '_blank');
};

window.toggleMaximizarPrevisualizador = function() {
    const contentEl = document.getElementById('pdf-modal-content');
    const btnMax = document.getElementById('pdf-btn-maximize');
    if (!contentEl) return;
    
    const isMaximized = contentEl.classList.toggle('vr-maximized');
    if (btnMax) {
        if (isMaximized) {
            btnMax.innerHTML = '🗗';
            btnMax.title = 'Restaurar';
        } else {
            btnMax.innerHTML = '🗖';
            btnMax.title = 'Maximizar';
        }
    }
};

// ==========================================
// VINCULADOR MANUAL DE OFERTAS DE REPOSICION
// ==========================================

let vr_todasOfertas = [];
let vr_mapeosActivos = [];
let currentExternalFilter = 'VIVOS'; // 'VIVOS', 'NUEVOS', 'MODIFICADOS', 'DISCONTINUADOS'
let currentProveedorFilter = 'ALL'; // Filtro de proveedor seleccionado en combo

// ✅ ESTRUCTURA DE COLUMNAS PARA AG GRID (GRILLA V4.1)
const columnDefs = [
    {
        headerName: '',
        width: 50,
        pinned: 'left',
        checkboxSelection: true,
        headerCheckboxSelection: true,
        suppressHeaderMenuButton: true,
        suppressMovable: true,
        resizable: false,
        sortable: false
    },
    {
        headerName: 'Código',
        field: 'sku_proveedor',
        colId: 'sku_proveedor',
        width: 120,
        sortable: true,
        resizable: true
    },
    {
        headerName: 'Proveedor',
        field: 'nombre_proveedor',
        colId: 'nombre_proveedor',
        width: 160,
        sortable: true,
        resizable: true
    },
    {
        headerName: 'Descripción',
        field: 'descripcion',
        colId: 'descripcion',
        width: 320,
        sortable: true,
        resizable: true,
        cellRenderer: (params) => {
            if (!params.value) return '';
            const isBaja = params.data && params.data._estado_delta === 'BAJA';
            if (isBaja) {
                return `<span class="badge" style="background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; font-size: 0.75em; padding: 2px 6px; border-radius: 4px; font-weight: bold; margin-right: 8px;">DISCONTINUADO</span>${params.value}`;
            }
            return params.value;
        }
    },
    {
        headerName: 'Rubro',
        field: 'rubro',
        colId: 'rubro',
        width: 130,
        sortable: true,
        resizable: true
    },
    {
        headerName: 'Cant. Bulto',
        field: 'cant_bult',
        colId: 'cant_bult',
        width: 115,
        sortable: true,
        resizable: true
    },
    {
        headerName: 'Cant. Valor',
        field: 'cant_valor',
        colId: 'cant_valor',
        width: 115,
        sortable: true,
        resizable: true
    },
    {
        headerName: 'Costo Kilo',
        field: 'precio_unitario',
        colId: 'precio_unitario',
        width: 125,
        sortable: true,
        resizable: true,
        filter: 'agNumberColumnFilter',
        valueFormatter: (params) => {
            if (params.value == null) return '';
            return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(params.value);
        }
    },
    {
        headerName: 'Antigüedad',
        field: 'dias_antiguedad',
        colId: 'dias_antiguedad',
        width: 115,
        sortable: true,
        resizable: true,
        filter: 'agNumberColumnFilter',
        cellRenderer: (params) => {
            if (params.value == null) return '';
            const dias = params.value;
            let badgeColor = '';
            if (dias === 0) badgeColor = 'background: #dcfce7; color: #166534; border: 1px solid #bbf7d0;';
            else if (dias <= 5) badgeColor = 'background: #fef9c3; color: #713f12; border: 1px solid #fef08a;';
            else badgeColor = 'background: #fee2e2; color: #991b1b; border: 1px solid #fecaca;';
            
            const badgeFmt = dias === 0 ? 'Hoy' : `Hace ${dias} d`;
            return `<span class="badge" style="font-size: 0.85em; padding: 2px 8px; border-radius: 4px; font-weight: bold; ${badgeColor}">${badgeFmt}</span>`;
        }
    },
    {
        headerName: 'Última Actualización',
        field: 'dias_actualizacion',
        colId: 'dias_actualizacion',
        width: 155,
        sortable: true,
        resizable: true,
        filter: 'agNumberColumnFilter',
        cellRenderer: (params) => {
            if (params.value == null) return '';
            const dias = params.value;
            let badgeStyle = 'display: inline-flex; align-items: center; font-size: 0.82em; padding: 4px 10px; border-radius: 6px; font-weight: bold; gap: 6px; border: 1px solid; ';
            let dotHtml = '';
            
            if (dias <= 30) {
                // Rango Verde (0 a 30 días)
                badgeStyle += 'background-color: rgba(16, 185, 129, 0.1); color: #34d399; border-color: rgba(16, 185, 129, 0.3);';
                dotHtml = '<span style="width: 6px; height: 6px; border-radius: 50%; display: inline-block; background-color: #34d399;"></span>';
            } else if (dias <= 45) {
                // Rango Ámbar (31 a 45 días)
                badgeStyle += 'background-color: rgba(245, 158, 11, 0.1); color: #fbbf24; border-color: rgba(245, 158, 11, 0.3);';
                dotHtml = '<span style="width: 6px; height: 6px; border-radius: 50%; display: inline-block; background-color: #fbbf24;"></span>';
            } else {
                // Rango Rojo con Pulso Animado (Mayor a 45 días)
                badgeStyle += 'background-color: rgba(244, 63, 94, 0.1); color: #fb7185; border-color: rgba(244, 63, 94, 0.3); box-shadow: 0 0 8px rgba(239, 68, 68, 0.1);';
                dotHtml = `
                    <span style="position: relative; display: inline-flex; width: 6px; height: 6px; align-items: center;">
                        <span style="animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite; position: absolute; display: inline-flex; height: 100%; width: 100%; border-radius: 50%; background-color: #fb7185; opacity: 0.75;"></span>
                        <span style="position: relative; display: inline-flex; border-radius: 50%; height: 6px; width: 6px; background-color: #f43f5e;"></span>
                    </span>
                `;
            }
            
            const text = dias === 0 ? 'Hoy' : (dias === 1 ? 'Ayer' : `${dias} días`);
            return `<span style="${badgeStyle}">${dotHtml} • ${text}</span>`;
        }
    },
    {
        headerName: 'Procedencia',
        field: 'procedencia',
        colId: 'procedencia',
        width: 130,
        sortable: true,
        resizable: true,
        hide: true
    },
    {
        headerName: 'Marca',
        field: 'marca',
        colId: 'marca',
        width: 130,
        sortable: true,
        resizable: true,
        hide: true
    },
    {
        headerName: 'Tipo Envase',
        field: 'tipo_envase',
        colId: 'tipo_envase',
        width: 120,
        sortable: true,
        resizable: true,
        hide: true
    },
    {
        headerName: 'Unidad Medida',
        field: 'unidad_medida',
        colId: 'unidad_medida',
        width: 115,
        sortable: true,
        resizable: true,
        hide: true
    },
    {
        headerName: 'Presentación',
        field: 'presentacion',
        colId: 'presentacion',
        width: 120,
        sortable: true,
        resizable: true,
        hide: true
    },
    {
        headerName: 'IVA',
        field: 'iva',
        colId: 'iva',
        width: 90,
        sortable: true,
        resizable: true,
        hide: true
    },
    {
        headerName: 'Promo',
        field: 'promo',
        colId: 'promo',
        width: 110,
        sortable: true,
        resizable: true,
        hide: true
    },
    {
        headerName: 'Descuento',
        field: 'descuento',
        colId: 'descuento',
        width: 110,
        sortable: true,
        resizable: true,
        hide: true
    },
    {
        headerName: 'EAN Unidad',
        field: 'ean_unidad',
        colId: 'ean_unidad',
        width: 125,
        sortable: true,
        resizable: true,
        hide: true
    },
    {
        headerName: 'DUN Bulto',
        field: 'dun_bulto',
        colId: 'dun_bulto',
        width: 125,
        sortable: true,
        resizable: true,
        hide: true
    },
    {
        headerName: 'Certificado',
        field: 'certificado',
        colId: 'certificado',
        width: 120,
        sortable: true,
        resizable: true,
        hide: true
    }
];

// ✅ DEFINICIÓN POR DEFECTO CON MOTOR DE FILTRADO MULTI-TOKEN UNICODE AVANZADO (DEBOUNCE 500MS)
const defaultColDef = {
    flex: 1,
    minWidth: 50,
    filter: 'agTextColumnFilter',
    floatingFilter: true,
    filterParams: {
        debounceMs: 500, // Cortafuegos de Rendimiento (Debounce)
        textFormatter: (r) => {
            if (r == null) return null;
            return String(r).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        },
        textMatcher: (params) => {
            const filterOption = params.filterOption || params.type;
            const cleanStr = (s) => {
                if (s == null) return "";
                return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            };
            
            const cellValue = cleanStr(params.value);
            const filterText = cleanStr(params.filterText);
            
            if (!filterText) return true;
            if (!cellValue && !filterText.includes('[vacio]')) return false;
            
            if (filterOption === 'contains') {
                const processedFText = filterText.replace(/#/g, ' #');
                const rawTokens = processedFText.split(/\s+/).filter(t => t.length > 0);
                
                for (const rawToken of rawTokens) {
                    if (rawToken === '#') continue;
                    
                    const isNeg = rawToken.startsWith('#');
                    let effectiveToken = rawToken;
                    if (isNeg) effectiveToken = effectiveToken.substring(1);
                    effectiveToken = effectiveToken.replace(/#/g, '');
                    if (effectiveToken.length === 0) continue;
                    
                    if (effectiveToken === '[vacio]') {
                        if (isNeg) {
                            if (cellValue === "") return false;
                        } else {
                            if (cellValue !== "") return false;
                        }
                    } else {
                        let matchFound = false;
                        if (effectiveToken.includes('%')) {
                            let escapedToken = effectiveToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            let regexStr = escapedToken.replace(/%/g, '(?:^|\\s|$)');
                            let regex = new RegExp(regexStr);
                            matchFound = regex.test(cellValue);
                        } else {
                            matchFound = cellValue.includes(effectiveToken);
                        }
                        
                        if (isNeg) {
                            if (matchFound) return false;
                        } else {
                            if (!matchFound) return false;
                        }
                    }
                }
                return true;
            }
            if (filterOption === 'equals') return cellValue === filterText;
            if (filterOption === 'notEqual') return cellValue !== filterText;
            if (filterOption === 'startsWith') return cellValue.startsWith(filterText);
            if (filterOption === 'endsWith') return cellValue.endsWith(filterText);
            
            return false;
        }
    }
};

// ✅ CONFIGURACIÓN GENERAL DEL AG GRID
const gridOptions = {
    columnDefs: columnDefs,
    defaultColDef: defaultColDef,
    rowSelection: 'multiple',
    rowMultiSelectWithClick: true,
    suppressRowClickSelection: false,
    getRowStyle: (params) => {
        if (params.data && params.data._estado_delta === 'BAJA') {
            return { opacity: 0.5, 'text-decoration': 'line-through' };
        }
        return null;
    },
    
    // Filtro Externo para Pills
    isExternalFilterPresent: () => {
        return true; 
    },
    doesExternalFilterPass: (node) => {
        if (!node.data) return true;
        
        // 1. Intersección por Estado Delta (Pills)
        const estado = node.data._estado_delta || 'INTACTO';
        let passEstado = true;
        if (currentExternalFilter === 'VIVOS') {
            passEstado = (estado !== 'BAJA');
        } else if (currentExternalFilter === 'NUEVOS') {
            passEstado = (estado === 'ALTA');
        } else if (currentExternalFilter === 'MODIFICADOS') {
            passEstado = (estado === 'MODIFICADO');
        } else if (currentExternalFilter === 'DISCONTINUADOS') {
            passEstado = (estado === 'BAJA');
        }
        
        if (!passEstado) return false;
        
        // 2. Intersección por Proveedor (Combo #vr-filtro-proveedor)
        if (currentProveedorFilter && currentProveedorFilter !== 'ALL') {
            const proveedor = node.data._proveedor || node.data.nombre_proveedor || '';
            if (String(proveedor).trim() !== String(currentProveedorFilter).trim()) {
                return false;
            }
        }
        
        return true;
    },
    
    // Persistencia Geométrica (Column State)
    onColumnResized: () => window.guardarGridState(),
    onColumnMoved: () => window.guardarGridState(),
    onColumnVisible: () => window.guardarGridState(),
    onSortChanged: () => window.guardarGridState(),
    
    // Ganchos del Barómetro & Contador
    onFilterChanged: () => {
        window.updateFmtStatusBar();
    },
    onModelUpdated: () => {
        window.updateFmtStatusBar();
    },
    onSelectionChanged: () => {
        if (window.v4GridApi) {
            const count = window.v4GridApi.getSelectedNodes().length;
            document.getElementById('vr-contador-seleccionados').innerText = count;
        }
    }
};


// ✅ APERTURA DEL VINCULADOR (ABRIR & CARGAR DATOS)
window.abrirVinculadorReposicion = async function() {
    const articulo_id = document.getElementById('gp-articulo-id').value;
    const articulo_nombre = document.getElementById('gp-producto').innerText;
    
    if (!articulo_id) {
        Swal.fire('Error', 'No hay ningún artículo seleccionado en el gestor.', 'error');
        return;
    }

    // Setear títulos en el modal
    document.getElementById('vr-articulo-nombre-titulo').innerText = articulo_nombre;
    document.getElementById('vr-articulo-id-titulo').innerText = articulo_id;
    
    // Higiene Obligatoria (Clean Slate):
    localStorage.removeItem('lamda_v4_filter_state');
    currentExternalFilter = 'VIVOS';
    currentProveedorFilter = 'ALL';

    // Limpiar maximizado residual en modal content
    const modalContent = document.getElementById('vr-modal-content');
    const maximizeBtn = document.getElementById('vr-btn-maximize');
    if (modalContent) modalContent.classList.remove('vr-maximized');
    if (maximizeBtn) {
        maximizeBtn.innerHTML = '🗖';
        maximizeBtn.title = 'Maximizar';
    }
    
    // Sincronizar pills de UI
    document.querySelectorAll('.vr-pill').forEach(pill => {
        pill.classList.remove('active');
        if (pill.getAttribute('data-filter') === 'VIVOS') {
            pill.classList.add('active');
        }
    });

    // Mostrar modal
    const modal = document.getElementById('modal-vinculador-reposicion');
    modal.style.display = 'flex';

    const gridDiv = document.getElementById('vr-ag-grid');
    gridDiv.innerHTML = '<div style="color: #cbd5e1; text-align: center; padding: 40px; font-style: italic;">Cargando catálogo de ofertas de reposición en vivo...</div>';

    try {
        // 1. Obtener mapeos activos locales para este artículo
        const mapeoRes = await fetch(`/api/logistica/bunker/reposicion/mapeo/${encodeURIComponent(articulo_id)}`);
        if (!mapeoRes.ok) throw new Error('Error al cargar vinculaciones locales');
        const mapeoPayload = await mapeoRes.json();
        vr_mapeosActivos = mapeoPayload.data || [];

        // 2. Obtener todas las cotizaciones del proxy remoto
        const todasRes = await fetch('/api/supabase/reposicion/todas');
        if (!todasRes.ok) throw new Error('Error al cargar ofertas remotas de Supabase');
        vr_todasOfertas = await todasRes.json();
        
        console.log("🔍 [VINCULADOR-REPOSICION-V4.1] Ofertas cargadas desde Supabase. Total:", vr_todasOfertas.length, "Muestra primer oferta:", vr_todasOfertas[0]);
        
        // Agregar campo cant_value mapeando a cant_valor para robustez técnica total
        vr_todasOfertas.forEach(o => {
            o.cant_value = o.cant_valor;
        });

        // Poblar dinámicamente selector de proveedores (#vr-filtro-proveedor)
        const selectProveedor = document.getElementById('vr-filtro-proveedor');
        if (selectProveedor) {
            // Extraer lista única y ordenada de proveedores activos (evitando nulos)
            const proveedoresUnicos = [...new Set(vr_todasOfertas.map(o => o.nombre_proveedor || o._proveedor).filter(Boolean))].sort();
            selectProveedor.innerHTML = '<option value="ALL">-- Todos los Proveedores --</option>';
            proveedoresUnicos.forEach(prov => {
                const opt = document.createElement('option');
                opt.value = prov;
                opt.textContent = prov;
                selectProveedor.appendChild(opt);
            });
            selectProveedor.value = 'ALL';
        }

        // 1. Destruir instancia anterior de forma segura antes de tocar el DOM para evitar excepciones NotFoundError
        if (window.v4GridApi) {
            try {
                window.v4GridApi.destroy();
            } catch (err) {
                console.warn("[AG-GRID] Error destruyendo instancia anterior:", err);
            }
            window.v4GridApi = null;
        }

        // 2. Limpiar spinner o contenido
        gridDiv.innerHTML = '';

        // Crear grilla de AG Grid bloqueando escrituras prematuras de flex-resize
        window.v4GridReady = false;
        window.v4GridApi = agGrid.createGrid(gridDiv, gridOptions);
        
        // Cargar datos
        window.v4GridApi.setGridOption('rowData', vr_todasOfertas);
        
        // Restaurar estado geométrico (Persistencia)
        window.cargarGridState();
        window.v4GridReady = true;
        
        // Aplicar Clean Slate ( filterModel en null )
        window.v4GridApi.setFilterModel(null);
        
        // Pre-seleccionar mapeados
        window.v4GridApi.forEachNode(node => {
            const of = node.data;
            const estaMapeado = vr_mapeosActivos.some(m => 
                String(m.proveedor_id).trim() === String(of.proveedor_id).trim() && 
                String(m.proveedor_producto_codigo).trim().toLowerCase() === String(of.sku_proveedor).trim().toLowerCase()
            );
            if (estaMapeado) {
                node.setSelected(true);
            }
        });

        // Sincronizar UI de checkboxes de columnas
        sincronizarDropdownCampos();

        // Actualizar Barómetro
        window.updateFmtStatusBar();

    } catch (err) {
        console.error("Error abriendo vinculador manual AG Grid:", err);
        gridDiv.innerHTML = `
            <div style="text-align: center; color: #ef4444; padding: 40px; font-weight: bold;">
                ❌ Error de conexión: ${err.message}
            </div>
        `;
    }
};

// ✅ CONTROL DEL SELECTOR DE PROVEEDORES
window.onProveedorFilterChanged = function() {
    const selectProveedor = document.getElementById('vr-filtro-proveedor');
    if (selectProveedor) {
        currentProveedorFilter = selectProveedor.value;
        if (window.v4GridApi) {
            window.v4GridApi.onFilterChanged();
        }
    }
};

// ✅ CONTROL DEL TOGGLE DE MAXIMIZADO DE PANTALLA COMPLETA
window.toggleMaximizarVinculador = function() {
    const modalContent = document.getElementById('vr-modal-content');
    const maximizeBtn = document.getElementById('vr-btn-maximize');
    if (!modalContent || !maximizeBtn) return;
    
    const isMaximized = modalContent.classList.toggle('vr-maximized');
    if (isMaximized) {
        maximizeBtn.innerHTML = '🗗';
        maximizeBtn.title = 'Restaurar';
    } else {
        maximizeBtn.innerHTML = '🗖';
        maximizeBtn.title = 'Maximizar';
    }
};

window.cerrarVinculadorReposicion = function() {
    // Higiene Obligatoria (Clean Slate) al cerrar
    localStorage.removeItem('lamda_v4_filter_state');
    if (window.v4GridApi) {
        window.v4GridApi.setFilterModel(null);
    }
    document.getElementById('modal-vinculador-reposicion').style.display = 'none';
};

// ✅ GUARDAR VINCULACIÓN EN BASE DE DATOS
window.guardarVinculacionReposicion = async function() {
    const articulo_id = document.getElementById('gp-articulo-id').value;
    if (!articulo_id) return;

    if (!window.v4GridApi) {
        Swal.fire('Error', 'La grilla no está inicializada.', 'error');
        return;
    }

    // Recopilar selección usando API nativa
    const selectedNodes = window.v4GridApi.getSelectedNodes();
    const mapeos = selectedNodes.map(node => ({
        proveedor_id: node.data.proveedor_id,
        proveedor_producto_codigo: node.data.sku_proveedor
    }));

    try {
        const res = await fetch(`/api/logistica/bunker/reposicion/mapeo/${encodeURIComponent(articulo_id)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ mapeos })
        });

        if (!res.ok) throw new Error('Error al guardar vinculación en base de datos');
        const resJson = await res.json();

        if (resJson.success) {
            Swal.fire({
                title: '¡Guardado!',
                text: 'Las equivalencias de reposición se guardaron exitosamente.',
                icon: 'success',
                timer: 1500,
                showConfirmButton: false
            });
            
            // Higiene Obligatoria (Clean Slate) al guardar
            localStorage.removeItem('lamda_v4_filter_state');
            window.v4GridApi.setFilterModel(null);
            
            // Cerrar el vinculador
            cerrarVinculadorReposicion();
            
            // Refrescar el modal principal (Radiografía Financiera)
            const desc = document.getElementById('gp-producto').innerText;
            abrirGestorPrecios(articulo_id, desc);
        } else {
            throw new Error(resJson.error || 'Error desconocido');
        }

    } catch (err) {
        console.error("Error al guardar vinculación:", err);
        Swal.fire('Error', `No se pudo guardar la vinculación: ${err.message}`, 'error');
    }
};

// ✅ PERSISTENCIA DE PREFERENCIAS GEOMÉTRICAS (localStorage + PostgreSQL)
window.guardarGridState = function() {
    if (!window.v4GridApi || !window.v4GridReady) return;
    const state = window.v4GridApi.getColumnState();
    localStorage.setItem('lamda_v4_grid_state', JSON.stringify(state));
    if (typeof window.guardarPreferenciaBunkerRemota === 'function') {
        window.guardarPreferenciaBunkerRemota('lamda_v4_grid_state', state);
    }
    console.log("💾 [VINCULADOR-REPOSICION-V4.1] Guardando estado de columnas en localStorage:", state);
};

window.cargarGridState = function() {
    if (!window.v4GridApi) return;
    const prevReady = window.v4GridReady;
    window.v4GridReady = false;
    const stored = localStorage.getItem('lamda_v4_grid_state');
    if (stored) {
        try {
            const state = JSON.parse(stored);
            window.v4GridApi.applyColumnState({ state: state, applyOrder: true });
            console.log("📂 [VINCULADOR-REPOSICION-V4.1] Estado de columnas restaurado desde localStorage:", state);
        } catch (e) {
            console.error('Error al restaurar firma geométrica de AG Grid:', e);
        }
    }
    window.v4GridReady = prevReady;
};

// ✅ CONFIGURADOR EN VIVO DE VISIBILIDAD DE CAMPOS (⚙️ Campos)
window.toggleColumnaVinculador = function(colId, isVisible) {
    console.log("⚙️ [VINCULADOR-REPOSICION-V4.1] Toggle visibilidad columna:", colId, "Visible:", isVisible);
    if (window.v4GridApi) {
        window.v4GridApi.setColumnsVisible([colId], isVisible);
        window.guardarGridState();
    }
};

window.resetearVisibilidadColumnas = function() {
    if (window.v4GridApi) {
        const defaultColumns = ['sku_proveedor', 'nombre_proveedor', 'descripcion', 'rubro', 'cant_bult', 'cant_valor', 'precio_unitario', 'dias_antiguedad', 'dias_actualizacion'];
        const secondaryColumns = ['procedencia', 'marca', 'tipo_envase', 'unidad_medida', 'presentacion', 'iva', 'promo', 'descuento', 'ean_unidad', 'dun_bulto', 'certificado'];
        
        window.v4GridApi.setColumnsVisible(defaultColumns, true);
        window.v4GridApi.setColumnsVisible(secondaryColumns, false);
        window.guardarGridState();
        sincronizarDropdownCampos();
    }
};

function sincronizarDropdownCampos() {
    if (!window.v4GridApi) return;
    console.log("🔄 [VINCULADOR-REPOSICION-V4.1] Sincronizando estado de checkboxes de campos...");
    
    const columnToChkMap = {
        'sku_proveedor': 'chk-col-sku',
        'nombre_proveedor': 'chk-col-prov',
        'descripcion': 'chk-col-desc',
        'rubro': 'chk-col-rubro',
        'cant_bult': 'chk-col-cant-bult',
        'cant_valor': 'chk-col-cant-valor',
        'precio_unitario': 'chk-col-costo',
        'dias_antiguedad': 'chk-col-ant',
        'dias_actualizacion': 'chk-col-ultact',
        'procedencia': 'chk-col-procedencia',
        'marca': 'chk-col-marca',
        'tipo_envase': 'chk-col-tipo-envase',
        'unidad_medida': 'chk-col-unidad-medida',
        'presentacion': 'chk-col-presentacion',
        'iva': 'chk-col-iva',
        'promo': 'chk-col-promo',
        'descuento': 'chk-col-descuento',
        'ean_unidad': 'chk-col-ean-unidad',
        'dun_bulto': 'chk-col-dun-bulto',
        'certificado': 'chk-col-certificado'
    };
    
    const state = window.v4GridApi.getColumnState();
    
    Object.entries(columnToChkMap).forEach(([colId, chkId]) => {
        const colState = state.find(s => s.colId === colId);
        const isVisible = colState ? !colState.hide : true;
        
        const chk = document.getElementById(chkId);
        if (chk) {
            chk.checked = isVisible;
        }
    });
}

window.toggleDropdownCampos = function(event) {
    event.stopPropagation();
    const dropdown = document.getElementById('vr-dropdown-campos');
    const isHidden = dropdown.style.display === 'none' || !dropdown.style.display;
    dropdown.style.display = isHidden ? 'flex' : 'none';
};

// Cerrar dropdown al hacer click afuera
document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('vr-dropdown-campos');
    if (dropdown && dropdown.style.display === 'flex') {
        const button = event.target.closest('button');
        const container = event.target.closest('#vr-dropdown-campos');
        if (!container && (!button || !button.innerText.includes('Campos'))) {
            dropdown.style.display = 'none';
        }
    }
});

// ✅ REACTIVIDAD DE PILLS EXTERNOS
window.setExternalFilter = function(filterType) {
    currentExternalFilter = filterType;
    
    document.querySelectorAll('.vr-pill').forEach(pill => {
        pill.classList.remove('active');
        if (pill.getAttribute('data-filter') === filterType) {
            pill.classList.add('active');
        }
    });
    
    if (window.v4GridApi) {
        window.v4GridApi.onFilterChanged();
    }
};

// ✅ SINCRONIZACIÓN DEL BARÓMETRO DE CONTROL (METRICAS)
window.updateFmtStatusBar = function() {
    if (!window.v4GridApi) return;
    
    const count = window.v4GridApi.getDisplayedRowCount();
    document.getElementById('fmtTotalVisualizados').innerText = count;
    
    let maxTimestamp = 0;
    let providerCount = new Set();
    
    window.v4GridApi.forEachNodeAfterFilterAndSort(node => {
        if (node.data && node.data._timestamp) {
            const ts = new Date(node.data._timestamp).getTime();
            if (ts > maxTimestamp) maxTimestamp = ts;
        }
        if (node.data && node.data._proveedor) {
            providerCount.add(node.data._proveedor);
        }
    });
    
    const txtDate = document.getElementById('fmtUltimaExtraccion');
    if (maxTimestamp > 0) {
        let diffDays = Math.floor((new Date() - maxTimestamp) / (1000 * 60 * 60 * 24));
        const dateStr = new Date(maxTimestamp).toLocaleDateString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const daysStr = diffDays === 0 ? "Hoy" : `Hace ${diffDays} ${diffDays === 1 ? 'día' : 'días'}`;
        
        if (providerCount.size === 1) {
            txtDate.innerHTML = `
                <span class="text-blue-400 font-bold">${Array.from(providerCount)[0]}</span>: 
                <span class="tracking-wide">${dateStr}</span> 
                <span class="text-[9px] text-slate-500 font-normal">(${daysStr})</span> 
                <span class="ml-2 inline-flex items-center gap-1 bg-blue-900/40 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded text-[9px] font-bold tracking-widest uppercase">
                    ${count} registros
                </span>`;
        } else {
            txtDate.innerHTML = `${dateStr} <span class="text-[9px] text-slate-500 font-normal">(${daysStr})</span>`;
        }
    } else {
        txtDate.innerText = '--';
    }
};

// =========================================================================
// FASE 61: TARJETA 5 EXCLUSIVA PARA PACKS HIJOS (CON COSTO TIEMPO E IVA NATIVO PER-LISTA)
// =========================================================================
window.actualizarTarjetaPackHijo = function() {
    const cardEl = document.getElementById('gp-card-pack-hijo');
    if (!cardEl) return;

    if (gp_packHijoCodigo) {
        cardEl.style.display = 'flex';

        const currentList = gp_listasFinancieras[gp_activeTabIdx];
        const currentListaId = currentList ? (currentList.lista_id || currentList.id) : null;

        const activeChildConfig = (gp_childListsCosts || []).find(c => c.lista_id === currentListaId);

        let childTotalKiloCost = 0;
        let childBaseCost = 0;
        let childTiempoCost = 0;
        let childNativeIva = gp_parentPorcentajeIva || 21.00;

        if (activeChildConfig) {
            childBaseCost = parseFloat(activeChildConfig.costo_base || 0);
            childTiempoCost = parseFloat(activeChildConfig.costo_tiempo || 0);
            childTotalKiloCost = parseFloat(activeChildConfig.costo_total || 0) / (gp_parentKilosUnidad || 1);
            if (activeChildConfig.iva !== undefined && activeChildConfig.iva !== null) {
                childNativeIva = parseFloat(activeChildConfig.iva);
            }
        } else {
            let parentCostBase = 0;
            if (gp_parentLote) {
                parentCostBase = parseFloat(gp_parentLote.costo_kilo_al_momento) || 0;
            } else if (gp_parentCostoBaseManual !== null) {
                parentCostBase = parseFloat(gp_parentCostoBaseManual) / (gp_parentKilosUnidad || 1);
            } else if (gp_parentCostoLomasoft !== null) {
                parentCostBase = parseFloat(gp_parentCostoLomasoft) / (gp_parentKilosUnidad || 1);
            }
            childBaseCost = parentCostBase * gp_parentKilosUnidad;
            childTotalKiloCost = parentCostBase;
        }

        const packBultoVal = childTotalKiloCost * gp_factorPresentacion;
        const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

        const unitCostEl = document.getElementById('gp-costo-hijo-unitario');
        const kiloCostEl = document.getElementById('gp-costo-hijo-kilo');
        const bultoCostEl = document.getElementById('gp-costo-hijo-bulto');
        const desgloseEl = document.getElementById('gp-packhijo-desglose');
        const ivaValEl = document.getElementById('gp-packhijo-iva-val');
        const badgeEl = document.getElementById('gp-packhijo-origen-badge');

        const unitCostVal = childTotalKiloCost * (gp_parentKilosUnidad || 1);
        if (unitCostEl) unitCostEl.innerText = unitCostVal > 0 ? currencyFormatter.format(unitCostVal) : 'N/A';
        if (kiloCostEl) kiloCostEl.innerText = childTotalKiloCost > 0 ? currencyFormatter.format(childTotalKiloCost) : 'N/A';
        if (bultoCostEl) bultoCostEl.innerText = packBultoVal > 0 ? currencyFormatter.format(packBultoVal) : 'N/A';

        if (desgloseEl) {
            desgloseEl.innerText = `${currencyFormatter.format(childBaseCost)} + ${currencyFormatter.format(childTiempoCost)}`;
        }
        if (ivaValEl) {
            ivaValEl.innerText = `${childNativeIva.toFixed(2)}%`;
        }
        if (badgeEl) {
            badgeEl.innerText = `PADRE: ${gp_parentDescripcion || gp_packHijoCodigo}`;
        }

        if (kiloCostEl && childTotalKiloCost > 0) {
            kiloCostEl.className = 'clickable-cost-val pack-hijo';
            kiloCostEl.setAttribute('onclick', `window.aplicarCostoBaseManual(${childTotalKiloCost}, ${childNativeIva}, 'PACK_HIJO', 'IVA Nativo Hijo:')`);
            kiloCostEl.title = `Haga clic para inyectar este costo ($${childTotalKiloCost.toFixed(2)}/kg) con IVA nativo (${childNativeIva.toFixed(2)}%)`;
        } else if (kiloCostEl) {
            kiloCostEl.className = '';
            kiloCostEl.removeAttribute('onclick');
            kiloCostEl.removeAttribute('title');
        }
    } else {
        cardEl.style.display = 'none';
    }
};

// =========================================================================
// FASE 4: EXPOSICIÓN DE NUEVOS HITOS DE COSTOS DE INGREDIENTES EN FRACCIONES
// =========================================================================
window.actualizarAlertasIngredienteBase = function() {
    const parentLoteRow = document.getElementById('gp-parent-lote-row');
    const parentRepRow = document.getElementById('gp-parent-rep-row');
    const parentAlertEl = document.getElementById('gp-parent-alert');
    const parentLoteCostEl = document.getElementById('gp-costo-parent-lote');
    const parentRepCostEl = document.getElementById('gp-costo-parent-rep');

    if (!parentLoteRow || !parentRepRow || !parentAlertEl || !parentLoteCostEl || !parentRepCostEl) return;

    // Reset default hidden
    parentLoteRow.style.display = 'none';
    parentRepRow.style.display = 'none';
    parentAlertEl.style.display = 'none';

    // Si es un producto fraccionado/derivado (tiene pack_hijo_codigo activo) pero NO es un Pack Padre
    const esPackPadre = window.gp_current_articulo_data && (window.gp_current_articulo_data.es_pack === true || parseInt(window.gp_current_articulo_data.pack_unidades || 0) > 1);
    if (gp_packHijoCodigo && !esPackPadre) {
        const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

        // 1. Costo Lote Padre (Kilo)
        let parentLoteKilo = 0;
        if (gp_parentLote) {
            parentLoteKilo = parseFloat(gp_parentLote.costo_kilo_al_momento) || 0;
        } else if (gp_parentCostoBaseManual !== null) {
            parentLoteKilo = parseFloat(gp_parentCostoBaseManual) / gp_parentKilosUnidad;
        } else if (gp_parentCostoLomasoft !== null) {
            parentLoteKilo = parseFloat(gp_parentCostoLomasoft) / gp_parentKilosUnidad;
        }

        if (parentLoteKilo > 0) {
            parentLoteRow.style.display = 'flex';
            parentLoteCostEl.innerText = currencyFormatter.format(parentLoteKilo);
            parentLoteCostEl.setAttribute('onclick', `window.aplicarCostoBaseManual(${parentLoteKilo})`);
            parentLoteCostEl.title = `Haga clic para inyectar costo de lote de ingrediente base ($${parentLoteKilo.toFixed(2)}/kg)`;
        }

        // 2. Costo Reposición Padre (de Supabase cotizaciones)
        let parentRepKilo = 0;
        if (gp_reposicionOfertas && gp_reposicionOfertas.length > 0) {
            const validOffers = gp_reposicionOfertas.filter(o => o.precio_unitario > 0);
            if (validOffers.length > 0) {
                parentRepKilo = parseFloat(validOffers[0].precio_unitario) || 0;
            }
        }
        if (parentRepKilo > 0) {
            parentRepRow.style.display = 'flex';
            parentRepCostEl.innerText = currencyFormatter.format(parentRepKilo);
            parentRepCostEl.setAttribute('onclick', `window.aplicarCostoBaseManual(${parentRepKilo})`);
            parentRepCostEl.title = `Haga clic para inyectar costo de reposición de ingrediente base ($${parentRepKilo.toFixed(2)}/kg)`;
        }

        // 3. Alertas Contextuales de Advertencia (Comparar con el costo manual actual)
        const manualInput = document.getElementById('gp-costo-manual');
        if (manualInput) {
            const inputCostoManual = parseFloat(manualInput.value) || 0;
            let tieneVariacion = false;

            if (parentLoteKilo > 0 && Math.abs(parentLoteKilo - inputCostoManual) > 0.05) {
                tieneVariacion = true;
            }
            if (parentRepKilo > 0 && Math.abs(parentRepKilo - inputCostoManual) > 0.05) {
                tieneVariacion = true;
            }

            if (tieneVariacion) {
                parentAlertEl.style.display = 'block';
            }
        }
    }
};

// 🖨️ [FASE 4 - IMPRESIÓN ASIMÉTRICA] Envío directo de orden de impresión doble al backend
window.imprimirEtiquetaBunker = async function(id) {
    try {
        Swal.fire({
            title: 'Preparando Impresión',
            text: 'Enviando orden a la impresora Zebra...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const response = await fetch(`/api/logistica/bunker/articulos/${encodeURIComponent(id)}/imprimir`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ destino_id: id })
        });
        const res = await response.json();

        if (response.ok && res.success) {
            Swal.fire({
                title: '¡Impresión Enviada!',
                text: 'La etiqueta doble asimétrica se ha enviado a la Zebra con éxito.',
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });
        } else {
            Swal.fire('Error al Imprimir', res.error || 'No se pudo enviar la orden a la impresora.', 'error');
        }
    } catch (e) {
        console.error('Error de red al imprimir:', e);
        Swal.fire('Error de Red', 'Fallo de comunicación con el servidor de logística.', 'error');
    }
};

// 📟 [FASE 4 - BUSCADOR OMNICANAL ESCÁNER]
window.procesarEscaneoBuscador = async function() {
    const input = document.getElementById('buscador-escaner');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;

    console.log(`📟 [ESCÁNER] Procesando código escaneado: "${val}"`);

    // Inyectar en el campo de búsqueda convencional para reflejar el estado actual
    const filtroBusqueda = document.getElementById('filtro-busqueda');
    if (filtroBusqueda) {
        filtroBusqueda.value = val;
    }

    // Refrescar el grid con el filtro aplicado
    await cargarDataGrid();

    // Limpiar el campo del escáner
    input.value = '';
    // Devolver el foco al campo del escáner para dejarlo listo para la siguiente lectura
    input.focus();
};

function initScannerExpressListener() {
    const scannerInput = document.getElementById('buscador-escaner');
    if (scannerInput) {
        // Enviar al presionar la tecla Enter (comportamiento por defecto de las lectoras de emulación de teclado)
        scannerInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.procesarEscaneoBuscador();
            }
        });

        // Asegurar que el foco vuelva al buscador de escáner tras des-enfoques accidentales
        // pero respetando la navegación a otros campos editables del listado
        scannerInput.addEventListener('blur', () => {
            setTimeout(() => {
                const active = document.activeElement;
                if (active && (
                    active.tagName === 'INPUT' || 
                    active.tagName === 'SELECT' || 
                    active.tagName === 'TEXTAREA' || 
                    active.tagName === 'BUTTON' ||
                    active.closest('.swal2-container') // No quitar foco si hay un SweetAlert2 abierto
                )) {
                    return;
                }
                scannerInput.focus();
            }, 150);
        });
    }
}

function aplicarAnchosColumnasGuardados(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const savedRaw = localStorage.getItem('bunker_grid_col_widths');
    if (!savedRaw) return;
    try {
        const savedWidths = JSON.parse(savedRaw);
        if (!savedWidths || typeof savedWidths !== 'object') return;
        const cols = table.querySelectorAll('thead th');
        cols.forEach((col, idx) => {
            const w = savedWidths[idx] || savedWidths[String(idx)];
            if (w && typeof w === 'string' && w.endsWith('px')) {
                col.style.width = w;
            }
        });
    } catch (_) {}
}

function guardarAnchosColumnasTabla(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const widths = {};
    const cols = table.querySelectorAll('thead th');
    cols.forEach((col, idx) => {
        if (col.style && col.style.width) {
            widths[idx] = col.style.width;
        }
    });
    localStorage.setItem('bunker_grid_col_widths', JSON.stringify(widths));
    if (typeof window.guardarPreferenciaBunkerRemota === 'function') {
        window.guardarPreferenciaBunkerRemota('bunker_grid_col_widths', widths);
    }
}

function initTableResizableColumns(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    aplicarAnchosColumnasGuardados(tableId);
    const cols = table.querySelectorAll('thead th');
    
    cols.forEach(col => {
        // Evitar duplicar resizers si ya existen, y no poner resizer en la columna Acciones
        if (col.querySelector('.resizer') || col.textContent.trim() === 'Acciones') return;
        
        const resizer = document.createElement('div');
        resizer.className = 'resizer';
        col.appendChild(resizer);
        
        let startX, startWidth;
        
        const mouseMoveHandler = (e) => {
            const width = startWidth + (e.pageX - startX);
            if (width > 50) { // Ancho mínimo de 50px
                col.style.width = `${width}px`;
            }
        };
        
        const mouseUpHandler = () => {
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);
            table.classList.remove('resizing');
            guardarAnchosColumnasTabla(tableId);
        };

        resizer.addEventListener('mousedown', (e) => {
            startX = e.pageX;
            startWidth = col.offsetWidth;
            
            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
            table.classList.add('resizing');
            e.preventDefault();
        });
    });
}

// =========================================================================
// 🚫 CONTROL DE EXCLUSIONES Y ORDENAMIENTO DE PROPIEDADES DINÁMICAS (FASE 4)
// =========================================================================

window.filtroCapas = [ { id: 1, propiedad: '', exclusions: [] } ]; // Inicializar con capa 1 estática
window.capaCounter = 1;

// Agrega una nueva capa de filtro dinámico
window.agregarCapaFiltro = function() {
    window.capaCounter++;
    const capaId = window.capaCounter;
    
    // Crear el objeto de estado de la capa
    window.filtroCapas.push({
        id: capaId,
        propiedad: '',
        exclusions: []
    });

    const container = document.getElementById('filtro-capas-container');
    if (!container) return;

    // Crear el elemento HTML
    const capaDiv = document.createElement('div');
    capaDiv.id = `capa-filtro-${capaId}`;
    capaDiv.className = 'capa-filtro-row';
    capaDiv.style.cssText = 'margin-top: 8px; width: 100%; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; font-weight: normal; text-align: left; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 6px;';
    
    capaDiv.innerHTML = `
        <div style="display: flex; gap: 4px; align-items: center; justify-content: space-between;">
            <select class="select-propiedad-capa" data-capa-id="${capaId}" style="flex: 1; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 4px; font-size: 0.8em; font-weight: normal; color: #1e293b; background: white;" onchange="window.cambiarPropiedadCapa(${capaId}, this.value)">
                <option value="">-- Seleccionar --</option>
                <option value="tipo">Tipo</option>
                <option value="color">Color</option>
                <option value="cosecha">Cosecha</option>
                <option value="variedad">Variedad</option>
                <option value="presentacion">Presentación</option>
            </select>
            <button type="button" class="btn-eliminar-capa" style="background: #ef4444; color: white; border: none; border-radius: 4px; padding: 2px 6px; cursor: pointer; font-size: 0.8em; font-weight: bold; height: 21px; display: flex; align-items: center; justify-content: center;" onclick="window.eliminarCapaFiltro(${capaId})" title="Eliminar Capa (➖)">
                ➖
            </button>
        </div>
        <div class="capa-calificativos-container" id="capa-calificativos-container-${capaId}" style="display: none;">
            <div style="font-size: 0.75em; font-weight: bold; color: #475569; text-transform: uppercase; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px;">
                <span>Calificativos:</span>
                <span style="color: #3b82f6; cursor: pointer; text-transform: none; font-size: 0.85em; font-weight: bold;" onclick="window.limpiarFiltrosCalificativosCapa(${capaId})" title="Mostrar Todo">🔄 Todo</span>
            </div>
            <div class="capa-checkboxes-list" id="capa-checkboxes-list-${capaId}" style="display: flex; flex-direction: column; gap: 4px; max-height: 100px; overflow-y: auto; padding-right: 4px;">
                <!-- Se poblará dinámicamente -->
            </div>
        </div>
    `;

    container.appendChild(capaDiv);
    window.actualizarDropdownsCapas();
};

// Elimina una capa de filtro y refresca la vista
window.eliminarCapaFiltro = function(capaId) {
    window.filtroCapas = window.filtroCapas.filter(c => c.id !== capaId);
    
    const capaDiv = document.getElementById(`capa-filtro-${capaId}`);
    if (capaDiv) {
        capaDiv.remove();
    }

    window.actualizarDropdownsCapas();
    window.aplicarFiltrosYOrdenamiento();
};

// Actualiza los dropdowns de propiedades excluyendo las que ya están seleccionadas
window.actualizarDropdownsCapas = function() {
    window.rebuildingDropdowns = true;
    try {
        const listadoPropiedades = [
            { value: 'tipo', label: 'Tipo' },
            { value: 'color', label: 'Color' },
            { value: 'cosecha', label: 'Cosecha' },
            { value: 'variedad', label: 'Variedad' },
            { value: 'presentacion', label: 'Presentación' }
        ];

        // Recopilar qué propiedades están seleccionadas en qué capas
        const seleccionadas = {};
        window.filtroCapas.forEach(capa => {
            if (capa.propiedad) {
                seleccionadas[capa.id] = capa.propiedad;
            }
        });

    // 2.5. Filtrado Multipalabra por Buscador General (Interpretación del ESPACIO como separador AND y almohadilla #)
    const inputBusqueda = document.getElementById('filtro-busqueda');
    const queryRaw = inputBusqueda ? inputBusqueda.value : '';
    const searchTerms = window.parsearTerminosBusquedaBunker(queryRaw);

    if (searchTerms.length > 0) {
        articulosFiltrados = articulosFiltrados.filter(art => window.articuloCumpleTerminosBunker(art, searchTerms));
    }


        // Para cada capa, re-generar las opciones de su select
        window.filtroCapas.forEach(capa => {
            const select = capa.id === 1
                ? document.getElementById('sort-propiedad')
                : document.querySelector(`.select-propiedad-capa[data-capa-id="${capa.id}"]`);
            if (!select) return;

            const valorActual = select.value || capa.propiedad;

            // Limpiar
            select.innerHTML = capa.id === 1 
                ? '<option value="">-- Sin Ordenar --</option>' 
                : '<option value="">-- Seleccionar --</option>';

            listadoPropiedades.forEach(item => {
                // Mostrar la propiedad si:
                // 1. No está seleccionada por ninguna otra capa
                // 2. O es la seleccionada por esta capa actual
                const estaEnOtraCapa = Object.entries(seleccionadas).some(([id, prop]) => parseInt(id) !== capa.id && prop === item.value);

                if (!estaEnOtraCapa) {
                    const opt = document.createElement('option');
                    opt.value = item.value;
                    opt.textContent = item.label;
                    if (item.value === valorActual) {
                        opt.selected = true;
                    }
                    select.appendChild(opt);
                }
            });

            // Forzar el valor seleccionado explícitamente para evitar pérdida de estado en la interfaz
            select.value = valorActual;
        });
    } finally {
        window.rebuildingDropdowns = false;
    }
};

// Cambia la propiedad asignada a una capa
window.cambiarPropiedadCapa = function(capaId, prop) {
    if (window.rebuildingDropdowns) return;

    const capa = window.filtroCapas.find(c => c.id === capaId);
    if (!capa) return;

    if (capa.propiedad === prop) return;

    capa.propiedad = prop;
    capa.exclusions = []; // Limpiar exclusiones previas

    window.actualizarDropdownsCapas();
    window.aplicarFiltrosYOrdenamiento();
};

// Renderiza los checkboxes de calificativos de una capa específica (soporta cascada)
window.renderizarCheckboxesCapa = function(capaId, articulos) {
    const capa = window.filtroCapas.find(c => c.id === capaId);
    if (!capa) return;

    const subMenu = capa.id === 1
        ? document.getElementById('sub-menu-calificativos')
        : document.getElementById(`capa-calificativos-container-${capa.id}`);
    const listado = capa.id === 1
        ? document.getElementById('listado-calificativos-checkboxes')
        : document.getElementById(`capa-checkboxes-list-${capa.id}`);
    if (!subMenu || !listado) return;

    const prop = capa.propiedad;
    if (!prop) {
        subMenu.style.display = 'none';
        listado.innerHTML = '';
        return;
    }

    // Utilizar los artículos sobrevivientes de las capas superiores
    const dataset = articulos || articulosBunkerGlobal;

    const mapaValores = new Set();
    dataset.forEach(art => {
        if (art.propiedades_dinamicas && typeof art.propiedades_dinamicas === 'object') {
            const rawVal = art.propiedades_dinamicas[prop];
            const valStr = (rawVal && typeof rawVal === 'object') ? rawVal.valor : (rawVal || '');
            if (valStr !== undefined && valStr !== null && String(valStr).trim() !== '') {
                mapaValores.add(String(valStr).trim());
            }
        }
    });

    if (mapaValores.size === 0) {
        subMenu.style.display = 'none';
        listado.innerHTML = '';
        return;
    }

    subMenu.style.display = 'block';
    let html = '';
    const valoresOrdenados = Array.from(mapaValores).sort();

    valoresOrdenados.forEach(val => {
        const estaExcluido = capa.exclusions.includes(val);
        const isChecked = !estaExcluido;

        html += `
            <label style="display: flex; align-items: center; gap: 6px; font-size: 0.82em; color: #334155; cursor: pointer; user-select: none; margin: 0; padding: 2px 0;">
                <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="window.cambiarExclusionCalificativoCapa(${capaId}, '${val.replace(/'/g, "\\'")}', this.checked)" style="cursor: pointer; margin: 0;">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${val}">${val}</span>
            </label>
        `;
    });

    listado.innerHTML = html;
};

// Alterna la exclusión de un calificativo en una capa
window.cambiarExclusionCalificativoCapa = function(capaId, val, isChecked) {
    const capa = window.filtroCapas.find(c => c.id === capaId);
    if (!capa) return;

    if (isChecked) {
        capa.exclusions = capa.exclusions.filter(v => v !== val);
    } else {
        if (!capa.exclusions.includes(val)) {
            capa.exclusions.push(val);
        }
    }

    window.aplicarFiltrosYOrdenamiento();
};

// Limpia todas las exclusiones de una capa
window.limpiarFiltrosCalificativosCapa = function(capaId) {
    const capa = window.filtroCapas.find(c => c.id === capaId);
    if (!capa) return;

    capa.exclusions = [];
    window.aplicarFiltrosYOrdenamiento();
};

// Sincroniza todos los checkboxes de todas las capas aplicando reactividad en cascada descendente
window.actualizarCheckboxesTodasLasCapas = function() {
    let articulosSurviving = [...articulosBunkerGlobal];

    window.filtroCapas.forEach((capa) => {
        // Renderizar los checkboxes de la capa usando solo los artículos que sobrevivieron a las capas superiores
        window.renderizarCheckboxesCapa(capa.id, articulosSurviving);

        // Filtrar los sobrevivientes para pasárselos a las capas de más abajo
        const prop = capa.propiedad;
        if (prop && capa.exclusions.length > 0) {
            articulosSurviving = articulosSurviving.filter(art => {
                if (!art.propiedades_dinamicas) return true;
                const rawVal = art.propiedades_dinamicas[prop];
                const valStr = (rawVal && typeof rawVal === 'object') ? rawVal.valor : (rawVal || '');
                if (valStr !== undefined && valStr !== null) {
                    const valTrimmed = String(valStr).trim();
                    if (capa.exclusions.includes(valTrimmed)) {
                        return false;
                    }
                }
                return true;
            });
        }
    });
};

// Evento gatillado al cambiar el sub-atributo de ordenamiento en el dropdown de la cabecera
window.cambiarOrdenPropiedades = function(prop) {
    window.aplicarFiltrosYOrdenamiento();
};

// Alterna la dirección del ordenamiento (Ascendente / Descendente)
window.toggleSortDirectionPropiedades = function() {
    const btn = document.getElementById('btn-sort-dir');
    if (!btn) return;

    window.propSortAscending = !window.propSortAscending;
    if (window.propSortAscending) {
        btn.innerText = '🔼';
        btn.title = 'Alternar Dirección (Descendente)';
    } else {
        btn.innerText = '🔽';
        btn.title = 'Alternar Dirección (Ascendente)';
    }

    window.aplicarFiltrosYOrdenamiento();
};

window.esArticuloDisponibleEnListaActual = function(art) {
    if (!art) return false;
    const isBaja = art._estado_delta === 'BAJA' || art.estado === 'BAJA';
    if (isBaja) return false;
    if (art.disponible === false) return false;
    if (art.margenes && Array.isArray(art.margenes) && art.margenes.length > 0) {
        const mFocused = art.margenes.find(m => Number(m.lista_id) === Number(listaSeleccionadaGlobal));
        if (mFocused && mFocused.disponible === false) {
            return false;
        }
    }
    return true;
};

window.toggleOcultarNoAsignados = function() {
    const toggleInactivos = document.getElementById('toggle-filtro-inactivos');
    if (toggleInactivos) {
        localStorage.setItem('bunker_ocultar_inactivos', toggleInactivos.checked ? 'true' : 'false');
    }
    window.aplicarFiltrosYOrdenamiento();
};

window.filtroKilosOperador = 'gte'; // 'gte' (>=) o 'lte' (<=)

/**
 * Calcula determinísticamente los kilos por unidad de presentación comercial (Opción C).
 * Arquitectura 100% Relacional y Física:
 * 1. Relación Padre-Hijo: Si el artículo es un pack con pack_hijo_codigo vinculado, consulta
 *    directamente el campo físico kilos_unidad del artículo hijo en la base de datos Búnker.
 * 2. Pack Físico: Si es un pack con pack_unidades > 1, divide el campo físico kilos_unidad
 *    por el entero físico pack_unidades.
 * 3. Mono-Producto Directo: Retorna directamente el campo físico numérico kilos_unidad.
 * NO depende de nomencladores ni parseo de texto.
 */
window.calcularKilosPresentacionUnitario = function(art) {
    if (!art) return 0;
    const totalKg = parseFloat(art.kilos_unidad || 0);
    if (isNaN(totalKg) || totalKg <= 0) return 0;

    const esPack = art.es_pack === true || art.es_pack === 'true' || art.es_pack === 1 || art.es_pack === 't';
    let packUnits = parseInt(art.pack_unidades || 1, 10);
    if (isNaN(packUnits) || packUnits <= 0) packUnits = 1;

    // 1. Arquitectura Relacional Padre-Hijo: Consultar el campo físico kilos_unidad del registro hijo
    if (esPack && art.pack_hijo_codigo) {
        const dataset = Array.isArray(articulosBunkerGlobal) ? articulosBunkerGlobal : (window.articulosVisiblesActualmente || []);
        const hijo = dataset.find(h => String(h.articulo_id).toLowerCase() === String(art.pack_hijo_codigo).toLowerCase());
        if (hijo && parseFloat(hijo.kilos_unidad) > 0) {
            return parseFloat(hijo.kilos_unidad);
        }
    }

    // 2. Arquitectura de Pack Físico: División entre columnas físicas numéricas (kilos_unidad / pack_unidades)
    if (esPack && packUnits > 1) {
        return totalKg / packUnits;
    }

    // 3. Presentación Mono-Producto Directa: Campo físico numérico kilos_unidad
    return totalKg;
};

window.toggleOperadorFiltroKilos = function() {
    window.filtroKilosOperador = (window.filtroKilosOperador === 'gte') ? 'lte' : 'gte';
    const btn = document.getElementById('btn-filtro-kilos-operador');
    if (btn) {
        btn.innerText = (window.filtroKilosOperador === 'gte') ? '≥' : '≤';
        btn.title = (window.filtroKilosOperador === 'gte') 
            ? 'Filtrando: Mayor o igual (≥). Clic para cambiar a Menor o igual (≤)'
            : 'Filtrando: Menor o igual (≤). Clic para cambiar a Mayor o igual (≥)';
    }
    window.aplicarFiltrosYOrdenamiento();
};

window.limpiarFiltroKilos = function() {
    const input = document.getElementById('input-filtro-kilos-valor');
    if (input) {
        input.value = '';
    }
    window.aplicarFiltrosYOrdenamiento();
};

// =========================================================================
// RADAR AUDITORÍA LÍNEA DE NEGOCIO 1 (BULTO CERRADO DIRECTO: STOCK VS OFERTA)
// =========================================================================
window.filtroRadarLdn1 = window.filtroRadarLdn1 || null; // null | 'TODOS' | 'SIN_STOCK_ACTIVOS' | 'CON_STOCK_INACTIVOS'

window.evaluarEstadoRadarLdn1Articulo = function(art) {
    if (!art) {
        return { esLdn1Comercial: false, dispVal: 0, tuvoLotes: false, disponibleActiva: false, activasCount: 0, totalListas: 0, esSinStockConOferta: false, esConStockSinOferta: false };
    }
    const ldn = window.determinarLineaDeNegocio(art);
    const esLdn1Comercial = ldn && ldn.id === 1 && ldn.esComercial !== false;
    const dispVal = parseFloat(art.stock_disponible !== undefined ? art.stock_disponible : (art.stock_legacy || 0)) || 0;
    const tuvoLotes = (parseFloat(art.total_entrante_unidades || art.stock_unidades || 0) > 0) || (parseInt(art.cantidad_lotes_activos || 0) > 0);
    const { disponibleActiva, activasCount, totalListas } = window.calcularResumenDisponibilidadArticulo(art);

    // 1. Sin Stock pero con Oferta Activa en CUALQUIERA de las listas (incluso si está oculto en la lista en vista actual)
    const esSinStockConOferta = esLdn1Comercial && dispVal <= 0 && activasCount > 0;

    // 2. Con Stock disponible (> 0) pero sin ofertas activas (0/N), excluido de la lista actual, o activo en a lo sumo 1 lista
    const esConStockSinOferta = esLdn1Comercial && dispVal > 0 && (activasCount === 0 || !disponibleActiva || (totalListas > 1 && activasCount <= 1));

    return {
        esLdn1Comercial,
        dispVal,
        tuvoLotes,
        disponibleActiva,
        activasCount,
        totalListas,
        esSinStockConOferta,
        esConStockSinOferta
    };
};

window.subfiltroLegacyStock = window.subfiltroLegacyStock || 'TODOS';

window.setSubfiltroLegacyStock = function(submodo) {
    window.subfiltroLegacyStock = submodo || 'TODOS';
    window.aplicarFiltrosYOrdenamiento();
};

window.actualizarContadoresRadarLdn1 = function() {
    const dataset = Array.isArray(articulosBunkerGlobal) ? articulosBunkerGlobal : [];
    let todosCount = 0;
    let sinStockCount = 0;
    let agotadosConLoteCount = 0;
    let conStockInactivosCount = 0;

    dataset.forEach(art => {
        const st = window.evaluarEstadoRadarLdn1Articulo(art);
        if (!st.esLdn1Comercial) return;
        todosCount++;
        if (st.esSinStockConOferta) {
            sinStockCount++;
            if (st.tuvoLotes) agotadosConLoteCount++;
        }
        if (st.esConStockSinOferta) {
            conStockInactivosCount++;
        }
    });

    const legacyDataset = Array.isArray(window.articulosLegacyConStockGlobal) ? window.articulosLegacyConStockGlobal : [];
    const legacyTotalCount = legacyDataset.length;
    const legacyBultosCount = legacyDataset.filter(i => parseFloat(i.kilos_unidad || 0) >= 4).length;
    const legacyMenoresCount = legacyDataset.filter(i => parseFloat(i.kilos_unidad || 0) < 4).length;

    const elTodos = document.getElementById('badge-radar-ldn1-todos');
    const elSinStock = document.getElementById('badge-radar-ldn1-sin-stock');
    const elConStock = document.getElementById('badge-radar-ldn1-con-stock');
    const elLegacyStock = document.getElementById('badge-radar-legacy-stock');
    if (elTodos) elTodos.textContent = String(todosCount);
    if (elSinStock) {
        elSinStock.textContent = String(sinStockCount);
        elSinStock.title = agotadosConLoteCount > 0
            ? `${agotadosConLoteCount} agotado(s) con lotes previos + ${sinStockCount - agotadosConLoteCount} sin stock inicial`
            : `${sinStockCount} artículo(s) sin stock con oferta activa`;
    }
    if (elConStock) elConStock.textContent = String(conStockInactivosCount);
    if (elLegacyStock) {
        elLegacyStock.textContent = String(legacyTotalCount);
        elLegacyStock.title = `${legacyBultosCount} bulto(s) ≥ 4 kg + ${legacyMenoresCount} fraccionado(s)/menores con stock en Legacy sin alta en Búnker`;
    }

    const elSubTodos = document.getElementById('count-legacy-sub-todos');
    const elSubBultos = document.getElementById('count-legacy-sub-bultos');
    const elSubMenores = document.getElementById('count-legacy-sub-menores');
    if (elSubTodos) elSubTodos.textContent = String(legacyTotalCount);
    if (elSubBultos) elSubBultos.textContent = String(legacyBultosCount);
    if (elSubMenores) elSubMenores.textContent = String(legacyMenoresCount);

    const btnTodos = document.getElementById('btn-radar-ldn1-todos');
    const btnSinStock = document.getElementById('btn-radar-ldn1-sin-stock');
    const btnConStock = document.getElementById('btn-radar-ldn1-con-stock');
    const btnLegacyStock = document.getElementById('btn-radar-legacy-stock');
    const btnClear = document.getElementById('btn-radar-ldn1-clear');
    const panelSubfiltrosLegacy = document.getElementById('radar-legacy-subfiltros');
    const panelAcciones = document.getElementById('radar-ldn1-acciones-contextuales');
    const statusLabel = document.getElementById('radar-ldn1-status-label');
    const btnApagarRapido = document.getElementById('btn-radar-ldn1-apagar-rapido');
    const btnPrenderRapido = document.getElementById('btn-radar-ldn1-prender-rapido');

    const esModoLegacy = window.filtroRadarLdn1 === 'LEGACY_CON_STOCK';
    if (btnTodos) btnTodos.classList.toggle('active', window.filtroRadarLdn1 === 'TODOS');
    if (btnSinStock) btnSinStock.classList.toggle('active', window.filtroRadarLdn1 === 'SIN_STOCK_ACTIVOS');
    if (btnConStock) btnConStock.classList.toggle('active', window.filtroRadarLdn1 === 'CON_STOCK_INACTIVOS');
    if (btnLegacyStock) btnLegacyStock.classList.toggle('active', esModoLegacy);
    if (btnClear) btnClear.style.display = window.filtroRadarLdn1 ? 'inline-flex' : 'none';

    if (panelSubfiltrosLegacy) {
        panelSubfiltrosLegacy.style.display = esModoLegacy ? 'inline-flex' : 'none';
        const btnSubT = document.getElementById('btn-subfiltro-legacy-todos');
        const btnSubB = document.getElementById('btn-subfiltro-legacy-bultos');
        const btnSubM = document.getElementById('btn-subfiltro-legacy-menores');
        const subActual = window.subfiltroLegacyStock || 'TODOS';
        if (btnSubT) btnSubT.classList.toggle('active', subActual === 'TODOS');
        if (btnSubB) btnSubB.classList.toggle('active', subActual === 'BULTOS_5KG');
        if (btnSubM) btnSubM.classList.toggle('active', subActual === 'MENORES_5KG');
    }

    if (panelAcciones) {
        if (window.filtroRadarLdn1) {
            panelAcciones.style.display = 'inline-flex';
            const visiblesCount = Array.isArray(window.articulosVisiblesActualmente) ? window.articulosVisiblesActualmente.length : 0;
            const selVisiblesCount = !esModoLegacy && Array.isArray(window.articulosVisiblesActualmente) && window.articulosSeleccionadosMasa
                ? window.articulosVisiblesActualmente.filter(a => window.articulosSeleccionadosMasa.has(a.articulo_id)).length
                : 0;
            const objetivoCount = selVisiblesCount > 0 ? selVisiblesCount : visiblesCount;
            const sufijoAlcance = selVisiblesCount > 0 ? `seleccionados (${selVisiblesCount})` : `visibles (${visiblesCount})`;

            if (statusLabel) {
                if (esModoLegacy) {
                    statusLabel.textContent = `🏛️ Mostrando ${visiblesCount} de ${legacyTotalCount} artículos Legacy con Stock > 0 pendientes de alta en Búnker`;
                    statusLabel.style.background = '#ede9fe';
                    statusLabel.style.color = '#5b21b6';
                } else if (window.filtroRadarLdn1 === 'SIN_STOCK_ACTIVOS') {
                    statusLabel.textContent = `🔍 Mostrando ${visiblesCount} LDN 1 sin stock con oferta activa (${agotadosConLoteCount} agotados c/lote previo)`;
                    statusLabel.style.background = '#ffe4e6';
                    statusLabel.style.color = '#9f1239';
                } else if (window.filtroRadarLdn1 === 'CON_STOCK_INACTIVOS') {
                    statusLabel.textContent = `🔍 Mostrando ${visiblesCount} LDN 1 con stock disponible y oferta apagada/parcial`;
                    statusLabel.style.background = '#fef3c7';
                    statusLabel.style.color = '#92400e';
                } else {
                    statusLabel.textContent = `🔍 Mostrando ${visiblesCount} artículos comerciales de LDN 1 (Bulto Cerrado)`;
                    statusLabel.style.background = '#e2e8f0';
                    statusLabel.style.color = '#1e293b';
                }
            }

            if (btnApagarRapido) {
                btnApagarRapido.style.display = esModoLegacy ? 'none' : 'inline-flex';
                btnApagarRapido.innerHTML = `🔕 Apagar ${sufijoAlcance} en TODAS las listas`;
                btnApagarRapido.disabled = objetivoCount === 0;
                btnApagarRapido.style.opacity = objetivoCount === 0 ? '0.5' : '1';
            }
            if (btnPrenderRapido) {
                btnPrenderRapido.style.display = esModoLegacy ? 'none' : 'inline-flex';
                btnPrenderRapido.innerHTML = `🟢 Activar ${sufijoAlcance} en TODAS las listas`;
                btnPrenderRapido.disabled = objetivoCount === 0;
                btnPrenderRapido.style.opacity = objetivoCount === 0 ? '0.5' : '1';
            }
        } else {
            panelAcciones.style.display = 'none';
        }
    }
};

window.renderizarGridLegacyPendientes = function(items) {
    const tbody = document.getElementById('tbody-bunker');
    if (!tbody) return;

    if (!Array.isArray(items) || items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="17" style="text-align: center; padding: 36px 20px; color: #64748b; background: #faf5ff;">
                    <div style="font-size: 1.5em; margin-bottom: 6px;">🎉</div>
                    <strong style="color: #4c1d95;">No hay artículos Legacy pendientes con este filtro</strong>
                    <div style="font-size: 0.85em; margin-top: 4px;">Todos los artículos con stock para este criterio ya se encuentran dados de alta en el Búnker.</div>
                </td>
            </tr>
        `;
        return;
    }

    const bannerRowHtml = `
        <tr style="background: linear-gradient(90deg, #f5f3ff 0%, #ede9fe 100%); border-bottom: 2px solid #c4b5fd;">
            <td colspan="17" style="padding: 10px 16px; color: #4c1d95; font-size: 0.86em;">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                    <div>
                        <strong>🏛️ Bandeja de Transición Legacy → Búnker:</strong> Estos artículos tienen <strong>Stock Físico Consolidado &gt; 0</strong> en el sistema anterior pero aún no tienen ficha en el Búnker (por lo que el motor de compras y costos no los ve).
                    </div>
                    <div style="font-size: 0.92em; color: #5b21b6; font-weight: 700;">
                        💡 Al pulsar <em>"🛡️ Dar de Alta en Búnker"</em> se abrirá el Alta con el código Legacy ya seleccionado.
                    </div>
                </div>
            </td>
        </tr>
    `;

    const rowsHtml = items.map(item => {
        const codigo = String(item.id || '');
        const codigoEsc = codigo.replace(/'/g, "\\'");
        const ean = item.codigo_barras && item.codigo_barras !== codigo ? item.codigo_barras : 'S/EAN';
        const desc = item.descripcion || 'Sin descripción';
        const rubro = item.rubro || 'SIN RUBRO';
        const subRubro = item.sub_rubro || '';
        const kilosUn = parseFloat(item.kilos_unidad || 0);
        const costoBase = parseFloat(item.costo_base || 0);
        const ivaPct = parseFloat(item.porcentaje_iva || 21);
        const stockUn = parseFloat(item.stock_consolidado || 0);
        const kilosTotales = kilosUn > 0 ? stockUn * kilosUn : 0;
        const costoPorKg = (kilosUn > 0 && costoBase > 0) ? (costoBase / kilosUn) : 0;
        const esBultoGrande = kilosUn >= 4;

        const badgeTipo = esBultoGrande
            ? `<span style="background:#dbeafe; color:#1e40af; border:1px solid #93c5fd; padding:2px 8px; border-radius:10px; font-size:0.78em; font-weight:800;">🚛 Bulto / Insumo (${kilosUn} kg)</span>`
            : `<span style="background:#fef3c7; color:#92400e; border:1px solid #fcd34d; padding:2px 8px; border-radius:10px; font-size:0.78em; font-weight:700;">🛍️ Presentación ${kilosUn > 0 ? kilosUn + ' kg' : 'S/Peso'}</span>`;

        return `
            <tr style="background-color: #ffffff; border-bottom: 1px solid #e2e8f0; transition: background 0.15s;" onmouseover="this.style.backgroundColor='#faf5ff'" onmouseout="this.style.backgroundColor='#ffffff'">
                <td style="text-align: center; vertical-align: middle;">
                    <span title="Artículo en Stock Legacy pendiente de alta en Búnker" style="font-size: 1.15em;">🏛️</span>
                </td>
                <td style="vertical-align: middle;">
                    <div style="font-weight: 800; color: #1e293b; font-family: monospace; font-size: 0.98em;">${codigo}</div>
                    <div style="font-size: 0.75em; color: #64748b;">EAN: ${ean}</div>
                </td>
                <td style="vertical-align: middle;">
                    <div style="font-weight: 700; color: #475569; font-size: 0.85em;">${rubro}</div>
                    ${subRubro ? `<div style="font-size: 0.75em; color: #94a3b8;">${subRubro}</div>` : ''}
                </td>
                <td style="vertical-align: middle;">
                    <div style="font-weight: 800; color: #0f172a; font-size: 0.95em;">${desc}</div>
                    <div style="font-size: 0.76em; color: #7c3aed; font-weight: 600; margin-top: 2px;">✨ Listo para vincular y nomenclar en Búnker</div>
                </td>
                <td style="vertical-align: middle;">
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        ${badgeTipo}
                    </div>
                </td>
                <td style="text-align: center; vertical-align: middle; color: #475569; font-weight: 600;">
                    ${ivaPct.toFixed(1)}%
                </td>
                <td style="text-align: right; vertical-align: middle; font-weight: 700; color: ${costoBase > 0 ? '#0f172a' : '#94a3b8'};">
                    $ ${costoBase.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    <div style="font-size: 0.72em; color: #64748b; font-weight: normal;">Costo Legacy</div>
                </td>
                <td style="text-align: right; vertical-align: middle; color: #cbd5e1;">—</td>
                <td style="text-align: right; vertical-align: middle; color: #cbd5e1;">—</td>
                <td style="text-align: right; vertical-align: middle; color: #cbd5e1;">—</td>
                <td style="text-align: right; vertical-align: middle; color: #475569; font-size: 0.85em;">
                    ${costoPorKg > 0 ? `$ ${costoPorKg.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} /kg` : '—'}
                </td>
                <td style="text-align: right; vertical-align: middle; color: #cbd5e1;">—</td>
                <td style="text-align: center; vertical-align: middle; color: #cbd5e1;">—</td>
                <td style="text-align: center; vertical-align: middle; color: #cbd5e1;">—</td>
                <td style="text-align: center; vertical-align: middle;">
                    <span style="background: #dcfce7; color: #166534; border: 1px solid #86efac; padding: 3px 9px; border-radius: 12px; font-weight: 800; font-size: 0.9em; display: inline-block;">
                        ${stockUn.toLocaleString('es-AR', { maximumFractionDigits: 2 })} un
                    </span>
                    ${kilosTotales > 0 ? `<div style="font-size: 0.78em; color: #334155; margin-top: 3px; font-weight: 700;">${kilosTotales.toLocaleString('es-AR', { maximumFractionDigits: 1 })} kg</div>` : ''}
                </td>
                <td style="text-align: center; vertical-align: middle;">
                    <span style="background: #f5f3ff; color: #6d28d9; border: 1px dashed #c4b5fd; padding: 3px 8px; border-radius: 12px; font-size: 0.75em; font-weight: 700; white-space: nowrap;">
                        Sin Búnker
                    </span>
                </td>
                <td style="text-align: center; vertical-align: middle;">
                    <button type="button" onclick="window.location.href='bunker.html?enrich=' + encodeURIComponent('${codigoEsc}')" style="background: linear-gradient(135deg, #7c3aed, #6d28d9); color: white; border: none; padding: 6px 11px; border-radius: 7px; font-size: 0.78em; font-weight: 800; cursor: pointer; white-space: nowrap; box-shadow: 0 2px 5px rgba(124, 58, 237, 0.25); display: inline-flex; align-items: center; gap: 5px;" title="Abrir Alta de Artículo con este SKU Legacy ya seleccionado para enriquecer">
                        🛡️ Dar de Alta
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = bannerRowHtml + rowsHtml;
};

window.toggleFiltroRadarLdn1 = function(modo) {
    window.cerrarPopoverListas();
    if (!modo || window.filtroRadarLdn1 === modo) {
        window.filtroRadarLdn1 = null;
    } else {
        window.filtroRadarLdn1 = modo;
    }
    // Al cambiar de modo de auditoría, limpiar selección previa para evitar arrastrar IDs ocultos
    if (window.articulosSeleccionadosMasa) {
        window.articulosSeleccionadosMasa.clear();
    }
    window.aplicarFiltrosYOrdenamiento();
};

window.ejecutarAccionRapidaRadarLdn1 = async function(disponible) {
    const visibles = Array.isArray(window.articulosVisiblesActualmente) ? window.articulosVisiblesActualmente : [];
    const seleccionadosVisibles = visibles.filter(a => window.articulosSeleccionadosMasa && window.articulosSeleccionadosMasa.has(a.articulo_id));
    const articulosObjetivo = seleccionadosVisibles.length > 0 ? seleccionadosVisibles : visibles;

    if (articulosObjetivo.length === 0) {
        Swal.fire('Sin artículos', 'No hay artículos en la vista actual para procesar.', 'info');
        return;
    }

    const listas = window.obtenerListasCatalogoMaestras();
    const accionVerbo = disponible ? 'ACTIVAR' : 'APAGAR (Ocultar)';
    const colorAccion = disponible ? '#16a34a' : '#e11d48';

    const previewItemsHtml = articulosObjetivo.slice(0, 12).map(a => {
        const st = window.evaluarEstadoRadarLdn1Articulo(a);
        const nombre = a.descripcion_generada || a.descripcion || a.articulo_id;
        return `<li style="padding: 3px 0; border-bottom: 1px dashed #e2e8f0; display: flex; justify-content: space-between; gap: 8px; font-size: 0.84em;">
            <span><strong>${a.articulo_id}</strong> — ${nombre}</span>
            <span style="white-space: nowrap; font-weight: 700; color: #64748b;">Stock: ${st.dispVal} | Listas: ${st.activasCount}/${st.totalListas}</span>
        </li>`;
    }).join('');
    const extraCount = articulosObjetivo.length > 12 ? `<div style="font-size: 0.8em; color: #64748b; margin-top: 4px; font-style: italic;">... y ${articulosObjetivo.length - 12} artículo(s) más.</div>` : '';

    const confirmRes = await Swal.fire({
        title: `${disponible ? '🟢 Activar' : '🔕 Apagar'} ${articulosObjetivo.length} artículo(s) LDN 1`,
        html: `
            <p style="font-size: 0.9em; color: #334155; text-align: left; margin-bottom: 10px; line-height: 1.4;">
                Se procederá a <strong style="color: ${colorAccion};">${accionVerbo}</strong> los siguientes <strong>${articulosObjetivo.length}</strong> artículos en <strong>TODAS las listas comerciales (${listas.length} listas)</strong>:
            </p>
            <ul style="list-style: none; padding: 8px 12px; margin: 0; max-height: 220px; overflow-y: auto; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; text-align: left;">
                ${previewItemsHtml}
            </ul>
            ${extraCount}
        `,
        showCancelButton: true,
        confirmButtonColor: colorAccion,
        cancelButtonColor: '#64748b',
        confirmButtonText: `Sí, ${disponible ? 'Activar en todas' : 'Apagar en todas'}`,
        cancelButtonText: 'Cancelar'
    });

    if (!confirmRes.isConfirmed) return;

    const targetIds = articulosObjetivo.map(a => a.articulo_id);
    Swal.fire({
        title: 'Sincronizando Catálogos...',
        text: `Actualizando ${targetIds.length} artículo(s) en las ${listas.length} listas...`,
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        for (const l of listas) {
            const res = await fetch('/api/logistica/bunker/articulos/actualizar-habilitacion-masa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lista_id: Number(l.lista_id),
                    articulo_ids: targetIds,
                    disponible
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Error actualizando disponibilidad en lote.');
            }
        }

        Swal.fire({
            title: disponible ? 'Ofertas Activadas' : 'Ofertas Apagadas',
            text: `Se ${disponible ? 'activaron' : 'ocultaron'} ${targetIds.length} artículo(s) en todas las listas comerciales.`,
            icon: 'success',
            timer: 1800,
            showConfirmButton: false
        });

        window.articulosSeleccionadosMasa.clear();
        const masterCheckbox = document.getElementById('chk-seleccionar-todo-visible');
        if (masterCheckbox) masterCheckbox.checked = false;
        await cargarDataGrid();
    } catch (err) {
        console.error(err);
        Swal.fire('Error', err.message || 'No se pudo completar la operación en masa.', 'error');
    }
};

// Aplica el filtrado de exclusiones y el ordenamiento secuencial por sub-atributos en el cliente,
// y procede a repintar la tabla del grid invocando renderizarGrid
window.aplicarFiltrosYOrdenamiento = function() {
    try {
        // Modo Especial: Bandeja de Transición Legacy c/Stock sin Búnker
        if (window.filtroRadarLdn1 === 'LEGACY_CON_STOCK') {
            let legacyFiltrados = Array.isArray(window.articulosLegacyConStockGlobal)
                ? [...window.articulosLegacyConStockGlobal]
                : [];

            const subActual = window.subfiltroLegacyStock || 'TODOS';
            if (subActual === 'BULTOS_5KG') {
                legacyFiltrados = legacyFiltrados.filter(i => parseFloat(i.kilos_unidad || 0) >= 4);
            } else if (subActual === 'MENORES_5KG') {
                legacyFiltrados = legacyFiltrados.filter(i => parseFloat(i.kilos_unidad || 0) < 4);
            }

            const inputBusqueda = document.getElementById('filtro-busqueda');
            const queryRaw = inputBusqueda ? inputBusqueda.value : '';
            const searchTerms = window.parsearTerminosBusquedaBunker(queryRaw);
            if (searchTerms.length > 0) {
                legacyFiltrados = legacyFiltrados.filter(item => {
                    const bag = [
                        item.id,
                        item.codigo_barras,
                        item.descripcion,
                        item.rubro,
                        item.sub_rubro,
                        item.kilos_unidad ? `${item.kilos_unidad}kg` : ''
                    ].filter(Boolean).join(' ').toLowerCase();
                    const tokens = bag.split(/[\s.,;/\-_()[\]]+/).filter(Boolean);
                    return searchTerms.every(t => {
                        if (t.exact) return tokens.includes(t.value);
                        return bag.includes(t.value);
                    });
                });
            }

            const inputKilos = document.getElementById('input-filtro-kilos-valor');
            const valorKilosRaw = inputKilos ? inputKilos.value.trim() : '';
            if (valorKilosRaw !== '' && !isNaN(parseFloat(valorKilosRaw))) {
                const thresholdKg = parseFloat(valorKilosRaw);
                const op = window.filtroKilosOperador || 'gte';
                legacyFiltrados = legacyFiltrados.filter(item => {
                    const unitKg = parseFloat(item.kilos_unidad || 0);
                    if (unitKg <= 0) return false;
                    return op === 'gte' ? unitKg >= thresholdKg : unitKg <= thresholdKg;
                });
            }

            window.articulosVisiblesActualmente = legacyFiltrados;
            window.actualizarContadoresRadarLdn1();
            window.renderizarGridLegacyPendientes(legacyFiltrados);
            return;
        }

        // 1. Recalcular y renderizar los checkboxes de cada capa reactivamente en cascada descendente
        if (typeof window.actualizarCheckboxesTodasLasCapas === 'function') {
            window.actualizarCheckboxesTodasLasCapas();
        }

        let articulosFiltrados = Array.isArray(articulosBunkerGlobal) ? [...articulosBunkerGlobal] : [];

        // 1.2. Filtrado del Radar LDN 1 (Bulto Cerrado Directo: Stock vs Oferta Activa)
        if (window.filtroRadarLdn1) {
            articulosFiltrados = articulosFiltrados.filter(art => {
                const st = window.evaluarEstadoRadarLdn1Articulo(art);
                if (window.filtroRadarLdn1 === 'TODOS') return st.esLdn1Comercial;
                if (window.filtroRadarLdn1 === 'SIN_STOCK_ACTIVOS') return st.esSinStockConOferta;
                if (window.filtroRadarLdn1 === 'CON_STOCK_INACTIVOS') return st.esConStockSinOferta;
                return true;
            });
        }

        // 1.5. Filtrado por Texto del Buscador Principal (#filtro-busqueda) - Lógica AND Aditiva Estricta y almohadilla #
        const inputBusqueda = document.getElementById('filtro-busqueda');
        const queryRaw = inputBusqueda ? inputBusqueda.value : '';
        const searchTerms = window.parsearTerminosBusquedaBunker(queryRaw);

        if (searchTerms.length > 0) {
            articulosFiltrados = articulosFiltrados.filter(art => window.articuloCumpleTerminosBunker(art, searchTerms));
        }

        // 1.8. Filtrado de Artículos Inactivos/No Disponibles (#toggle-filtro-inactivos)
        // Nota: Si el Radar LDN 1 está activo, omitimos el ocultamiento por lista individual para poder auditar todas las listas
        const toggleInactivos = document.getElementById('toggle-filtro-inactivos');
        if (toggleInactivos && toggleInactivos.checked && !window.filtroRadarLdn1) {
            articulosFiltrados = articulosFiltrados.filter(art => window.esArticuloDisponibleEnListaActual(art));
        }

        // 1.9. Filtrado Rápido de Presentación por Kilos (Opción C: Peso Unitario)
        const inputKilos = document.getElementById('input-filtro-kilos-valor');
        const valorKilosRaw = inputKilos ? inputKilos.value.trim() : '';
        if (valorKilosRaw !== '' && !isNaN(parseFloat(valorKilosRaw))) {
            const thresholdKg = parseFloat(valorKilosRaw);
            const op = window.filtroKilosOperador || 'gte';

            articulosFiltrados = articulosFiltrados.filter(art => {
                const unitKg = window.calcularKilosPresentacionUnitario(art);
                // Insumos u objetos con 0 kg quedan excluidos de la búsqueda de presentaciones alimenticias
                if (unitKg <= 0) return false;

                if (op === 'gte') {
                    return unitKg >= thresholdKg;
                } else {
                    return unitKg <= thresholdKg;
                }
            });
        }

        // 2. Filtrado por Exclusión en Cascada Cumulativa (AND entre capas)
        if (Array.isArray(window.filtroCapas)) {
            window.filtroCapas.forEach(capa => {
                const prop = capa.propiedad;
                if (!prop || !Array.isArray(capa.exclusions) || capa.exclusions.length === 0) return;

                articulosFiltrados = articulosFiltrados.filter(art => {
                    if (!art.propiedades_dinamicas) return true;

                    const rawVal = art.propiedades_dinamicas[prop];
                    const valStr = (rawVal && typeof rawVal === 'object') ? rawVal.valor : (rawVal || '');
                    if (valStr !== undefined && valStr !== null) {
                        const valTrimmed = String(valStr).trim();
                        if (capa.exclusions.includes(valTrimmed)) {
                            return false;
                        }
                    }
                    return true;
                });
            });
        }

        // 3. Ordenamiento Secuencial por Sub-Atributo (o priorización inteligente del Radar LDN 1)
        const sortPropSelect = document.getElementById('sort-propiedad');
        const sortProp = sortPropSelect ? sortPropSelect.value : '';

        if (sortProp) {
            const sortAsc = window.propSortAscending;
            articulosFiltrados.sort((a, b) => {
                let valA = obtenerValorOrdenamientoCapaD(a, sortProp);
                let valB = obtenerValorOrdenamientoCapaD(b, sortProp);

                if (valA === 0 && valB !== 0) return 1;
                if (valB === 0 && valA !== 0) return -1;
                if (valA === 0 && valB === 0) return 0;

                if (typeof valA === 'number' && typeof valB === 'number') {
                    return sortAsc ? valA - valB : valB - valA;
                }

                let strA = String(valA).toLowerCase();
                let strB = String(valB).toLowerCase();

                return sortAsc ? strA.localeCompare(strB) : strB.localeCompare(strA);
            });
        } else if (window.filtroRadarLdn1 === 'SIN_STOCK_ACTIVOS') {
            // Priorizar primero los artículos que tuvieron lotes entrantes y se quedaron sin stock
            articulosFiltrados.sort((a, b) => {
                const stA = window.evaluarEstadoRadarLdn1Articulo(a);
                const stB = window.evaluarEstadoRadarLdn1Articulo(b);
                if (stA.tuvoLotes !== stB.tuvoLotes) return stA.tuvoLotes ? -1 : 1;
                if (stB.activasCount !== stA.activasCount) return stB.activasCount - stA.activasCount;
                return String(a.descripcion_generada || a.descripcion || '').localeCompare(String(b.descripcion_generada || b.descripcion || ''));
            });
        } else if (window.filtroRadarLdn1 === 'CON_STOCK_INACTIVOS') {
            // Priorizar primero los que están apagados en absolutamente todas las listas (0/N) y con mayor stock
            articulosFiltrados.sort((a, b) => {
                const stA = window.evaluarEstadoRadarLdn1Articulo(a);
                const stB = window.evaluarEstadoRadarLdn1Articulo(b);
                if (stA.activasCount !== stB.activasCount) return stA.activasCount - stB.activasCount;
                return stB.dispVal - stA.dispVal;
            });
        }

        // 4. Pintar en la tabla principal y refrescar contadores del Radar LDN 1
        window.articulosVisiblesActualmente = articulosFiltrados;
        window.actualizarContadoresRadarLdn1();
        renderizarGrid(articulosFiltrados);
    } catch (err) {
        console.error("⚠️ [BUSCADOR] Error defensivo en aplicarFiltrosYOrdenamiento:", err);
    }
};

window.actualizarDisponibilidadListaModal = function(checked) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (list) {
        list.disponible = checked;
    }
};

window.actualizarExencionOperativaModal = function(checked) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    list.exencion_operativa = checked;
    
    // Si desmarca la exención, sincronizar en caliente copiando los costos de otra lista no exenta
    if (!checked) {
        const otherNoExempt = gp_listasFinancieras.find((l, idx) => idx !== gp_activeTabIdx && !l.exencion_operativa);
        if (otherNoExempt) {
            list.costo_tiempo = otherNoExempt.costo_tiempo;
            list.insumos = JSON.parse(JSON.stringify(otherNoExempt.insumos || []));
            // Actualizar campos
            document.getElementById('gp-costo-tiempo').value = parseFloat(list.costo_tiempo || 0).toFixed(2);
            renderInsumosGrid();
        }
    }
    recalcularPreciosGestor();
};

function recalcularValoresDeListaEnMemoria(l) {
    const cBase = l.costo_base_sobrescrito !== null ? parseFloat(l.costo_base_sobrescrito) : gp_liveIngredienteCost;
    
    let cInsumos = 0;
    if (l.insumos && l.insumos.length > 0) {
        l.insumos.forEach(ins => {
            if (ins.incluido === true || ins.incluido === 'true') {
                cInsumos += parseFloat(ins.cantidad || 1) * parseFloat(ins.costo_unitario_capturado || 0);
            }
        });
    }
    
    const cTiempo = parseFloat(l.costo_tiempo || 0);
    const cTotalPresentacion = cBase * gp_factorPresentacion;
    const cBulto = cTotalPresentacion + cInsumos;
    
    const modoIva = l.modo_iva || 'COMPLETO';
    let ivaVal = gp_ivaGlobal;
    if (modoIva === 'MEDIO') {
        ivaVal = gp_ivaGlobal / 2;
    } else if (modoIva === 'SIN') {
        ivaVal = 0.00;
    }
    l.iva = ivaVal;
    const ivaCoeff = 1 + (ivaVal / 100);
    
    let margen = parseFloat(l.margen_ganancia) || parseFloat(l.margen_porcentaje) || 0;
    if (l.modo_calculo === 'AUTOMATIC' && !l.has_manual_override && margen === 0 && l.margen_patron_heredado !== null && l.margen_patron_heredado !== undefined) {
        margen = parseFloat(l.margen_patron_heredado);
    }
    
    if (l.modo_calculo === 'AUTOMATIC') {
        const precioS_ivaBase = cBulto * (1 + (margen / 100)) + cTiempo;
        const precioFinalBase = precioS_ivaBase * ivaCoeff;
        l.precio_final = precioFinalBase;
    } else {
        // Modo MANUAL
        const precioFinalBase = parseFloat(l.precio_final) || 0;
        let margenImplicito = 0;
        if (cBulto > 0) {
            margenImplicito = (((precioFinalBase / ivaCoeff) - cTiempo) / cBulto - 1) * 100;
        }
        l.margen_porcentaje = margenImplicito;
        l.margen_ganancia = margenImplicito;
    }
}

function propagarCostosOperativos() {
    const activeList = gp_listasFinancieras[gp_activeTabIdx];
    if (!activeList || activeList.exencion_operativa) return;

    gp_listasFinancieras.forEach((l, idx) => {
        if (idx !== gp_activeTabIdx && !l.exencion_operativa) {
            if (!l.asistente_override) {
                l.costo_tiempo = activeList.costo_tiempo;
            }
            // Clonar profundamente insumos para evitar referencias compartidas
            l.insumos = JSON.parse(JSON.stringify(activeList.insumos || []));
            recalcularValoresDeListaEnMemoria(l);
        }
    });
}

// =========================================================================
// GESTOR MODERNO DE DISPONIBILIDAD EN CATÁLOGOS COMERCIALES (POPOVER V2)
// =========================================================================
window._popoverListasArticuloId = null;
window._popoverCleanupListeners = null;
window._popoverRequiereRefiltroAlCerrar = false;

window.obtenerListasCatalogoMaestras = function() {
    if (Array.isArray(window.listasCatalogoMaestras) && window.listasCatalogoMaestras.length > 0) {
        return window.listasCatalogoMaestras;
    }
    if (typeof gp_listasFinancieras !== 'undefined' && Array.isArray(gp_listasFinancieras) && gp_listasFinancieras.length > 0) {
        return gp_listasFinancieras.map(l => ({
            lista_id: Number(l.lista_id),
            nombre_lista: l.nombre_lista || `Lista ${l.lista_id}`
        }));
    }
    const select = document.getElementById('filtro-lista-precios');
    if (select && select.options && select.options.length > 0) {
        return Array.from(select.options).map(opt => ({
            lista_id: Number(opt.value),
            nombre_lista: opt.textContent.trim()
        }));
    }
    return [{ lista_id: 1, nombre_lista: 'Lista Base' }];
};

window.calcularResumenDisponibilidadArticulo = function(art) {
    const listas = window.obtenerListasCatalogoMaestras();
    const totalListas = listas.length;
    let activasCount = 0;
    let disponibleActiva = true;

    listas.forEach(l => {
        const m = (art && Array.isArray(art.margenes))
            ? art.margenes.find(x => Number(x.lista_id) === Number(l.lista_id))
            : null;
        const disp = m ? (m.disponible !== false) : true;
        if (disp) activasCount++;
        if (Number(l.lista_id) === Number(listaSeleccionadaGlobal)) {
            disponibleActiva = disp;
        }
    });

    return { disponibleActiva, activasCount, totalListas, listas };
};

window.generarHtmlBotonCatalogo = function(art) {
    if (!art) return '';
    const { disponibleActiva, activasCount, totalListas } = window.calcularResumenDisponibilidadArticulo(art);
    const isOpen = window._popoverListasArticuloId === art.articulo_id && !!document.getElementById('bunker-listas-popover');
    const openClase = isOpen ? 'popover-abierto' : '';

    // 3 estados visuales claros:
    // 1) estado-activo (Verde): Activo en la lista actual
    // 2) estado-parcial (Ámbar): Oculto en la lista actual, pero SIGUE ACTIVO en otras listas (activasCount > 0)
    // 3) estado-inactivo (Gris): Apagado en absolutamente todas las listas (0/totalListas)
    let estadoClase = 'estado-inactivo';
    let labelTexto = 'Apagado';
    let tooltipTexto = `Apagado en todas las listas (0 de ${totalListas}) — Click para gestionar catálogos`;

    if (disponibleActiva) {
        estadoClase = 'estado-activo';
        labelTexto = 'Activo';
        tooltipTexto = `Habilitado en la lista actual (${activasCount} de ${totalListas} listas activas) — Click para gestionar catálogos`;
    } else if (activasCount > 0) {
        estadoClase = 'estado-parcial';
        labelTexto = 'En otras';
        tooltipTexto = `Excluido de la lista actual, pero SIGUE ACTIVO en ${activasCount} de ${totalListas} listas — Click para ver o apagar`;
    }

    return `
        <button type="button"
            class="btn-catalogo-listas ${estadoClase} ${openClase}"
            data-articulo-id="${art.articulo_id}"
            onclick="window.mostrarPopoverListas(event, '${art.articulo_id}')"
            title="${tooltipTexto}">
            <span class="btn-catalogo-dot"></span>
            <span class="btn-catalogo-label">${labelTexto}</span>
            <span class="btn-catalogo-count">${activasCount}/${totalListas}</span>
        </button>
    `;
};

window.cerrarPopoverListas = function() {
    const existing = document.getElementById('bunker-listas-popover');
    if (existing) {
        existing.remove();
    }
    if (typeof window._popoverCleanupListeners === 'function') {
        window._popoverCleanupListeners();
        window._popoverCleanupListeners = null;
    }
    document.querySelectorAll('.btn-catalogo-listas.popover-abierto').forEach(btn => {
        btn.classList.remove('popover-abierto');
    });
    window._popoverListasArticuloId = null;

    if (window._popoverRequiereRefiltroAlCerrar) {
        window._popoverRequiereRefiltroAlCerrar = false;
        const toggleInactivos = document.getElementById('toggle-filtro-inactivos');
        if (((toggleInactivos && toggleInactivos.checked) || window.filtroRadarLdn1) && typeof window.aplicarFiltrosYOrdenamiento === 'function') {
            window.aplicarFiltrosYOrdenamiento();
        }
    }
};

window.posicionarPopoverListas = function(popover, triggerBtn) {
    if (!popover || !triggerBtn || !document.body.contains(triggerBtn)) {
        window.cerrarPopoverListas();
        return;
    }
    const rect = triggerBtn.getBoundingClientRect();
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        const mainRect = mainContent.getBoundingClientRect();
        // Si el botón salió del área visible de la tabla al hacer scroll, cerrar limpiamente
        if (rect.bottom < mainRect.top + 36 || rect.top > mainRect.bottom - 12) {
            window.cerrarPopoverListas();
            return;
        }
    }

    const popWidth = popover.offsetWidth || 315;
    const popHeight = popover.offsetHeight || 310;
    const margin = 8;

    // Posición vertical: preferir debajo, pero voltear arriba si no entra en el viewport
    let top = rect.bottom + 6;
    if (top + popHeight > window.innerHeight - margin && rect.top - popHeight - 6 > margin) {
        top = rect.top - popHeight - 6;
    } else if (top + popHeight > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - popHeight - margin);
    }

    // Posición horizontal: alinear con el borde derecho o izquierdo sin desbordar pantalla
    let left = rect.right - popWidth;
    if (left < margin) {
        left = rect.left;
    }
    if (left + popWidth > window.innerWidth - margin) {
        left = window.innerWidth - popWidth - margin;
    }

    popover.style.top = `${Math.round(top)}px`;
    popover.style.left = `${Math.round(left)}px`;
};

window.sincronizarFilaArticuloDisponibilidadDOM = function(articuloId) {
    const art = (articulosBunkerGlobal || []).find(a => a.articulo_id === articuloId);
    if (!art) return;

    const { disponibleActiva, activasCount, totalListas } = window.calcularResumenDisponibilidadArticulo(art);

    // 1. Actualizar contador en el header del popover si sigue abierto para este artículo
    const badgePopover = document.getElementById('bunker-popover-count-badge');
    if (badgePopover && window._popoverListasArticuloId === articuloId) {
        badgePopover.textContent = `${activasCount}/${totalListas} activas`;
        badgePopover.style.background = activasCount > 0 ? '#16a34a' : '#475569';
    }

    // 2. Localizar la fila exacta del artículo en la grilla
    let row = null;
    try {
        row = document.querySelector(`tr.tr-articulo-row[data-articulo-id="${CSS.escape(articuloId)}"]`);
    } catch (_) {
        const rows = document.querySelectorAll('tr.tr-articulo-row');
        for (const r of rows) {
            if (r.dataset.articuloId === articuloId) {
                row = r;
                break;
            }
        }
    }
    if (!row) return;

    // 3. Actualizar el botón en la columna Catálogo
    const tdCatalogo = row.querySelector('.td-art-catalogo') || row.cells[15];
    if (tdCatalogo) {
        tdCatalogo.innerHTML = window.generarHtmlBotonCatalogo(art);
    }

    // 4. Actualizar estado visual de la fila (opacidad y badges "🚫 Excluido")
    row.classList.toggle('articulo-excluido', !disponibleActiva);
    row.querySelectorAll('.badge-excluido-row').forEach(b => b.remove());

    if (!disponibleActiva) {
        const createBadge = () => {
            const span = document.createElement('span');
            span.className = 'badge badge-excluido-row';
            span.style.cssText = 'background-color: #64748b; color: white; padding: 2px 6px; font-size: 0.75em; border-radius: 4px; vertical-align: middle; margin-left: 5px;';
            span.textContent = '🚫 Excluido';
            return span;
        };

        const tdPrincipal = row.querySelector('.td-art-principal') || row.cells[2];
        if (tdPrincipal) {
            const anchor = tdPrincipal.querySelector('.badge-ldn') || tdPrincipal.querySelector('strong');
            if (anchor) anchor.after(createBadge());
        }

        const tdNom = row.querySelector('.td-art-nomenclatura') || row.cells[3];
        if (tdNom) {
            const nomText = tdNom.querySelector('.nom-text');
            if (nomText) nomText.after(createBadge());
            else tdNom.appendChild(createBadge());
        }
    }

    if (typeof window.sincronizarEstadosCheckboxesEncabezado === 'function') {
        window.sincronizarEstadosCheckboxesEncabezado();
    }
    if (typeof window.actualizarContadoresRadarLdn1 === 'function') {
        window.actualizarContadoresRadarLdn1();
    }
};

window.mostrarPopoverListas = function(event, articuloId) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    const triggerBtn = (event && event.currentTarget)
        ? event.currentTarget
        : (event && event.target ? event.target.closest('.btn-catalogo-listas') || event.target : null);

    // Si ya está abierto para este mismo artículo, un segundo clic lo cierra (toggle real)
    if (window._popoverListasArticuloId === articuloId && document.getElementById('bunker-listas-popover')) {
        window.cerrarPopoverListas();
        return;
    }

    // Cerrar cualquier popover previo
    window.cerrarPopoverListas();

    // Buscar artículo en lista global
    const art = (articulosBunkerGlobal || []).find(a => a.articulo_id === articuloId);
    if (!art) return;

    window._popoverListasArticuloId = articuloId;
    if (triggerBtn && triggerBtn.classList) {
        triggerBtn.classList.add('popover-abierto');
    }

    const { activasCount, totalListas, listas } = window.calcularResumenDisponibilidadArticulo(art);
    const nombreArticulo = art.descripcion_generada || art.descripcion || articuloId;

    // Ordenar de forma que listaSeleccionadaGlobal sea siempre la primera
    const reorderedListas = [...listas].sort((a, b) => {
        if (Number(a.lista_id) === Number(listaSeleccionadaGlobal)) return -1;
        if (Number(b.lista_id) === Number(listaSeleccionadaGlobal)) return 1;
        return Number(a.lista_id) - Number(b.lista_id);
    });

    const fmtPrecio = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });

    const popover = document.createElement('div');
    popover.id = 'bunker-listas-popover';
    popover.onclick = (e) => e.stopPropagation();

    let rowsHtml = '';
    reorderedListas.forEach(lista => {
        const m = Array.isArray(art.margenes)
            ? art.margenes.find(x => Number(x.lista_id) === Number(lista.lista_id))
            : null;
        const disponible = m ? (m.disponible !== false) : true;
        const isFocused = Number(lista.lista_id) === Number(listaSeleccionadaGlobal);
        const precioNum = m && parseFloat(m.precio_final) > 0 ? parseFloat(m.precio_final) : 0;
        const precioStr = precioNum > 0 ? fmtPrecio.format(precioNum) : '';

        const badgeVista = isFocused
            ? `<span style="background: #0284c7; color: #ffffff; font-size: 0.68em; font-weight: 800; padding: 1px 6px; border-radius: 8px; margin-left: 6px; text-transform: uppercase; letter-spacing: 0.3px;">★ En vista</span>`
            : '';

        rowsHtml += `
            <label class="bunker-popover-row ${isFocused ? 'is-focused-list' : ''} ${disponible ? '' : 'is-off'}" data-row-lista-id="${lista.lista_id}">
                <div style="display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1;">
                    <div style="display: flex; align-items: center; flex-wrap: wrap;">
                        <span class="bunker-popover-lista-nombre" style="font-size: 0.85em; font-weight: ${isFocused ? '800' : '600'}; color: ${isFocused ? '#0369a1' : '#1e293b'};">${lista.nombre_lista}</span>
                        ${badgeVista}
                    </div>
                    ${precioStr ? `<span style="font-size: 0.75em; color: #64748b; font-family: monospace; font-weight: 600;">${precioStr}</span>` : ''}
                </div>
                <div class="bunker-switch">
                    <input type="checkbox" data-lista-id="${lista.lista_id}" ${disponible ? 'checked' : ''} onchange="window.toggleDisponibilidadArticulo('${articuloId}', ${lista.lista_id}, this.checked)">
                    <span class="bunker-switch-slider"></span>
                </div>
            </label>
        `;
    });

    popover.innerHTML = `
        <div class="bunker-popover-header">
            <div style="min-width: 0; flex: 1;">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="font-weight: 800; font-size: 0.86em; letter-spacing: 0.2px;">📋 Catálogos Comerciales</span>
                    <span id="bunker-popover-count-badge" style="background: ${activasCount > 0 ? '#16a34a' : '#475569'}; color: #ffffff; font-size: 0.72em; font-weight: 800; padding: 1px 7px; border-radius: 10px;">${activasCount}/${totalListas} activas</span>
                </div>
                <div style="font-size: 0.75em; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 3px;" title="${nombreArticulo}">
                    ${nombreArticulo}
                </div>
            </div>
            <button type="button" onclick="window.cerrarPopoverListas()" title="Cerrar (Esc)" style="background: rgba(255,255,255,0.12); border: none; color: #f8fafc; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; font-size: 0.9em; font-weight: bold; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.12)'">✕</button>
        </div>
        <div class="bunker-popover-actions">
            <button type="button" class="bunker-popover-quick-btn activar" onclick="window.toggleTodasLasListasArticulo('${articuloId}', true)">
                ✓ Activar todas
            </button>
            <button type="button" class="bunker-popover-quick-btn desactivar" onclick="window.toggleTodasLasListasArticulo('${articuloId}', false)">
                ✕ Ocultar todas
            </button>
        </div>
        <div class="bunker-popover-list">
            ${rowsHtml}
        </div>
    `;

    document.body.appendChild(popover);
    window.posicionarPopoverListas(popover, triggerBtn);

    // Listeners para clic externo, scroll del contenedor y tecla Escape
    const outsideClickListener = (e) => {
        const popEl = document.getElementById('bunker-listas-popover');
        if (!popEl) return;
        if (popEl.contains(e.target)) return;
        const clickedTrigger = e.target.closest ? e.target.closest('.btn-catalogo-listas') : null;
        if (clickedTrigger && clickedTrigger.getAttribute('data-articulo-id') === articuloId) return;
        window.cerrarPopoverListas();
    };

    let rafId = null;
    const scrollOrResizeListener = (e) => {
        const popEl = document.getElementById('bunker-listas-popover');
        if (!popEl) return;
        // Ignorar scroll interno dentro de la lista del propio popover
        if (e && e.target && popEl.contains(e.target)) return;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            let currentBtn = triggerBtn;
            if (!currentBtn || !document.body.contains(currentBtn)) {
                try {
                    currentBtn = document.querySelector(`.btn-catalogo-listas[data-articulo-id="${CSS.escape(articuloId)}"]`);
                } catch (_) {}
            }
            window.posicionarPopoverListas(popEl, currentBtn);
        });
    };

    const keydownListener = (e) => {
        if (e.key === 'Escape') {
            window.cerrarPopoverListas();
        }
    };

    window._popoverCleanupListeners = () => {
        document.removeEventListener('mousedown', outsideClickListener);
        window.removeEventListener('scroll', scrollOrResizeListener, true);
        window.removeEventListener('resize', scrollOrResizeListener);
        document.removeEventListener('keydown', keydownListener);
        if (rafId) cancelAnimationFrame(rafId);
    };

    setTimeout(() => {
        document.addEventListener('mousedown', outsideClickListener);
        window.addEventListener('scroll', scrollOrResizeListener, true);
        window.addEventListener('resize', scrollOrResizeListener);
        document.addEventListener('keydown', keydownListener);
    }, 0);
};

window.aplicarDisponibilidadEnMemoria = function(art, listaId, disponible) {
    if (!art) return;
    if (!Array.isArray(art.margenes)) art.margenes = [];
    let m = art.margenes.find(x => Number(x.lista_id) === Number(listaId));
    if (m) {
        m.disponible = disponible;
    } else {
        art.margenes.push({
            lista_id: Number(listaId),
            margen_porcentaje: 0,
            costo_base_sobrescrito: null,
            costo_tiempo: 0,
            iva: art.porcentaje_iva || 21,
            precio_final: 0,
            modo_calculo: 'AUTOMATIC',
            costo_desactualizado: false,
            disponible: disponible
        });
    }
};

window.toggleDisponibilidadArticulo = async function(articuloId, listaId, disponible) {
    const art = (articulosBunkerGlobal || []).find(a => a.articulo_id === articuloId);
    let prevDisponible = true;
    if (art && Array.isArray(art.margenes)) {
        const existingM = art.margenes.find(x => Number(x.lista_id) === Number(listaId));
        if (existingM) prevDisponible = existingM.disponible !== false;
    }

    // 1. Actualización optimista inmediata en memoria y DOM
    window.aplicarDisponibilidadEnMemoria(art, listaId, disponible);
    const popRow = document.querySelector(`#bunker-listas-popover .bunker-popover-row[data-row-lista-id="${listaId}"]`);
    if (popRow) {
        popRow.classList.toggle('is-off', !disponible);
    }
    if (Number(listaId) === Number(listaSeleccionadaGlobal) || window.filtroRadarLdn1) {
        window._popoverRequiereRefiltroAlCerrar = true;
    }
    window.sincronizarFilaArticuloDisponibilidadDOM(articuloId);

    // 2. Persistir en backend
    try {
        const res = await fetch('/api/logistica/bunker/articulo/lista-disponibilidad', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articuloId, listaId, disponible })
        });
        const result = await res.json();

        if (!res.ok || !result.success) {
            throw new Error(result.error || 'No se pudo actualizar la disponibilidad.');
        }
    } catch (e) {
        console.error('Error actualizando disponibilidad:', e);
        // Revertir cambio optimista en caso de error
        window.aplicarDisponibilidadEnMemoria(art, listaId, prevDisponible);
        if (popRow) {
            popRow.classList.toggle('is-off', !prevDisponible);
            const chk = popRow.querySelector('input[type="checkbox"]');
            if (chk) chk.checked = prevDisponible;
        }
        window.sincronizarFilaArticuloDisponibilidadDOM(articuloId);
        Swal.fire('Error', e.message || 'Fallo de red al intentar actualizar la disponibilidad.', 'error');
    }
};

window.toggleTodasLasListasArticulo = async function(articuloId, disponible) {
    const art = (articulosBunkerGlobal || []).find(a => a.articulo_id === articuloId);
    if (!art) return;

    const listas = window.obtenerListasCatalogoMaestras();
    if (!listas || listas.length === 0) return;

    // Actualizar switches en el popover abierto y estado en memoria de inmediato
    listas.forEach(l => {
        window.aplicarDisponibilidadEnMemoria(art, l.lista_id, disponible);
        const popRow = document.querySelector(`#bunker-listas-popover .bunker-popover-row[data-row-lista-id="${l.lista_id}"]`);
        if (popRow) {
            popRow.classList.toggle('is-off', !disponible);
            const chk = popRow.querySelector('input[type="checkbox"]');
            if (chk) chk.checked = disponible;
        }
    });

    window._popoverRequiereRefiltroAlCerrar = true;
    window.sincronizarFilaArticuloDisponibilidadDOM(articuloId);

    try {
        await Promise.all(listas.map(l =>
            fetch('/api/logistica/bunker/articulo/lista-disponibilidad', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ articuloId, listaId: l.lista_id, disponible })
            }).then(r => r.json())
        ));
    } catch (e) {
        console.error('Error en actualización múltiple de listas del artículo:', e);
        Swal.fire('Error', 'No se pudieron sincronizar todas las listas.', 'error');
    }
};

// ==========================================
// SELECCIÓN Y ACTUALIZACIÓN EN LOTE (HITL)
// ==========================================
function obtenerIdsElegiblesVisibles() {
    return (window.articulosVisiblesActualmente || []).filter(a => {
        const isBaja = a._estado_delta === 'BAJA' || a.estado === 'BAJA';
        if (isBaja) return false;
        // Cuando el Radar de Auditoría LDN 1 está activo, permitimos seleccionar todos los artículos visibles (incluso ocultos en la lista actual)
        if (window.filtroRadarLdn1) return true;
        const mFocused = a.margenes ? a.margenes.find(m => m.lista_id === listaSeleccionadaGlobal) : null;
        const disponibleActiva = mFocused ? (mFocused.disponible !== false) : true;
        return disponibleActiva;
    }).map(a => a.articulo_id);
}

window.toggleSeleccionArticuloMasa = function(articuloId, checked) {
    if (checked) {
        window.articulosSeleccionadosMasa.add(articuloId);
    } else {
        window.articulosSeleccionadosMasa.delete(articuloId);
    }

    if (typeof window.sincronizarEstadosCheckboxesEncabezado === 'function') {
        window.sincronizarEstadosCheckboxesEncabezado();
    } else {
        const masterCheckbox = document.getElementById('chk-seleccionar-todo-visible');
        if (masterCheckbox) {
            const eligibleIds = obtenerIdsElegiblesVisibles();
            const allChecked = eligibleIds.length > 0 && eligibleIds.every(id => window.articulosSeleccionadosMasa.has(id));
            masterCheckbox.checked = allChecked;
        }
    }
    
    window.actualizarEstadoBotonMasivo();
};

window.toggleSeleccionFamiliaGrupo = function(famKey, checked) {
    console.log(`🚨 [VIGÍA SELECCIÓN MASA F12] Toggling Familia: ${famKey} -> ${checked}`);
    const eligibleIds = obtenerIdsElegiblesVisibles();

    const articulosFam = (window.articulosVisiblesActualmente || []).filter(a => obtenerFamiliaKey(a) === famKey);

    articulosFam.forEach(art => {
        if (checked) {
            if (eligibleIds.includes(art.articulo_id)) {
                window.articulosSeleccionadosMasa.add(art.articulo_id);
            }
        } else {
            window.articulosSeleccionadosMasa.delete(art.articulo_id);
        }
    });

    document.querySelectorAll(`tr.tr-articulo-row[data-fam-key="${famKey}"] .chk-articulo-masa`).forEach(chk => {
        const id = chk.getAttribute('data-articulo-id');
        chk.checked = window.articulosSeleccionadosMasa.has(id);
    });

    document.querySelectorAll(`.chk-subfamilia-grupo[data-fam-key="${famKey}"]`).forEach(chk => {
        chk.checked = checked;
    });

    window.sincronizarEstadosCheckboxesEncabezado();
    window.actualizarEstadoBotonMasivo();
};

window.toggleSeleccionSubfamiliaGrupo = function(subfamKey, checked) {
    console.log(`🚨 [VIGÍA SELECCIÓN MASA F12] Toggling Atributo Principal: ${subfamKey} -> ${checked}`);
    const eligibleIds = obtenerIdsElegiblesVisibles();

    const articulosSub = (window.articulosVisiblesActualmente || []).filter(a => obtenerSubfamiliaKey(a) === subfamKey);

    articulosSub.forEach(art => {
        if (checked) {
            if (eligibleIds.includes(art.articulo_id)) {
                window.articulosSeleccionadosMasa.add(art.articulo_id);
            }
        } else {
            window.articulosSeleccionadosMasa.delete(art.articulo_id);
        }
    });

    document.querySelectorAll(`tr.tr-articulo-row[data-subfam-key="${subfamKey}"] .chk-articulo-masa`).forEach(chk => {
        const id = chk.getAttribute('data-articulo-id');
        chk.checked = window.articulosSeleccionadosMasa.has(id);
    });

    window.sincronizarEstadosCheckboxesEncabezado();
    window.actualizarEstadoBotonMasivo();
};

window.sincronizarEstadosCheckboxesEncabezado = function() {
    const eligibleIds = obtenerIdsElegiblesVisibles();

    // 1. Sincronizar Subfamilias (Atributos Principales)
    document.querySelectorAll('.chk-subfamilia-grupo').forEach(chk => {
        const subfamKey = chk.getAttribute('data-subfam-key');
        const artsSub = (window.articulosVisiblesActualmente || []).filter(a => obtenerSubfamiliaKey(a) === subfamKey && eligibleIds.includes(a.articulo_id));
        if (artsSub.length > 0) {
            chk.checked = artsSub.every(a => window.articulosSeleccionadosMasa.has(a.articulo_id));
        } else {
            chk.checked = false;
        }
    });

    // 2. Sincronizar Familias
    document.querySelectorAll('.chk-familia-grupo').forEach(chk => {
        const famKey = chk.getAttribute('data-fam-key');
        const artsFam = (window.articulosVisiblesActualmente || []).filter(a => obtenerFamiliaKey(a) === famKey && eligibleIds.includes(a.articulo_id));
        if (artsFam.length > 0) {
            chk.checked = artsFam.every(a => window.articulosSeleccionadosMasa.has(a.articulo_id));
        } else {
            chk.checked = false;
        }
    });

    // 3. Sincronizar Maestro Superior
    const masterCheckbox = document.getElementById('chk-seleccionar-todo-visible');
    if (masterCheckbox) {
        const allChecked = eligibleIds.length > 0 && eligibleIds.every(id => window.articulosSeleccionadosMasa.has(id));
        masterCheckbox.checked = allChecked;
    }

    const masterAllCheckbox = document.getElementById('chk-seleccionar-absolutamente-todo');
    if (masterAllCheckbox) {
        const allVisibleNonBaja = (window.articulosVisiblesActualmente || []).filter(a => a._estado_delta !== 'BAJA' && a.estado !== 'BAJA').map(a => a.articulo_id);
        masterAllCheckbox.checked = allVisibleNonBaja.length > 0 && allVisibleNonBaja.every(id => window.articulosSeleccionadosMasa.has(id));
    }
};

window.toggleSeleccionarTodoVisible = function(checked) {
    const eligibleIds = obtenerIdsElegiblesVisibles();
    const visibleIds = (window.articulosVisiblesActualmente || []).map(a => a.articulo_id);
    
    visibleIds.forEach(id => {
        if (checked) {
            // Solo agregar si es elegible
            if (eligibleIds.includes(id)) {
                window.articulosSeleccionadosMasa.add(id);
            }
        } else {
            // Si desmarcamos, removemos todos los visibles seleccionados
            window.articulosSeleccionadosMasa.delete(id);
        }
    });
    
    // Actualizar checkboxes del DOM a su estado correspondiente
    const inputs = document.querySelectorAll('.chk-articulo-masa');
    inputs.forEach(input => {
        const id = input.getAttribute('data-articulo-id');
        input.checked = window.articulosSeleccionadosMasa.has(id);
    });
    
    window.sincronizarEstadosCheckboxesEncabezado();
    window.actualizarEstadoBotonMasivo();
};

window.toggleSeleccionarAbsolutamenteTodo = function(checked) {
    const visibleNonBajaIds = (window.articulosVisiblesActualmente || [])
        .filter(a => a._estado_delta !== 'BAJA' && a.estado !== 'BAJA')
        .map(a => a.articulo_id);

    visibleNonBajaIds.forEach(id => {
        if (checked) {
            window.articulosSeleccionadosMasa.add(id);
        } else {
            window.articulosSeleccionadosMasa.delete(id);
        }
    });

    document.querySelectorAll('.chk-articulo-masa').forEach(input => {
        const id = input.getAttribute('data-articulo-id');
        input.checked = window.articulosSeleccionadosMasa.has(id);
    });

    window.sincronizarEstadosCheckboxesEncabezado();
    window.actualizarEstadoBotonMasivo();
};

window.actualizarEstadoBotonMasivo = function() {
    const btnMargenes = document.getElementById('btn-actualizar-margenes-masa');
    const btnCatalogo = document.getElementById('btn-gestionar-catalogo-masa');
    const btnCotizar = document.getElementById('btn-enviar-precios-cotizacion');
    const totalSeleccionados = window.articulosSeleccionadosMasa ? window.articulosSeleccionadosMasa.size : 0;
    const tieneSeleccionados = totalSeleccionados > 0;
    
    [btnMargenes, btnCatalogo, btnCotizar].forEach(btn => {
        if (!btn) return;
        if (tieneSeleccionados) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        } else {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        }
    });

    if (btnCatalogo) {
        btnCatalogo.innerHTML = tieneSeleccionados ? `🌐 Catálogo en masa (${totalSeleccionados})` : '🌐 Catálogo en masa';
    }
    if (btnCotizar) {
        btnCotizar.innerHTML = tieneSeleccionados ? `✉️ Enviar Seleccionados (${totalSeleccionados})` : '✉️ Enviar Seleccionados';
    }
    if (typeof window.actualizarContadoresRadarLdn1 === 'function') {
        window.actualizarContadoresRadarLdn1();
    }
};

window.abrirMinimodalMargenesMasa = function() {
    // Obtener artículos a actualizar
    const seleccionadosVisibles = Array.from(window.articulosSeleccionadosMasa).filter(id => 
        (window.articulosVisiblesActualmente || []).some(a => a.articulo_id === id)
    );
    
    if (seleccionadosVisibles.length === 0) {
        Swal.fire({
            title: 'Sin Selección',
            text: 'Debe seleccionar al menos un artículo visible en la grilla.',
            icon: 'warning'
        });
        return;
    }
    
    Swal.fire({
        title: 'Actualizar en Masa (Búnker)',
        html: `
            <p style="font-size: 0.92em; color: #475569; margin-bottom: 15px; text-align: left; line-height: 1.4;">
                Se actualizarán los <strong>${seleccionadosVisibles.length}</strong> artículos seleccionados. Los precios finales se recalcularán automáticamente en la base de datos.
            </p>
            <div style="display: flex; flex-direction: column; align-items: stretch; gap: 12px; text-align: left;">
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label for="swal-margen-masa" style="font-weight: bold; font-size: 0.9em; color: #1e293b;">
                        Nuevo Margen de Ganancia General (%):
                    </label>
                    <input type="number" id="swal-margen-masa" class="swal2-input" placeholder="Ej: 35.00" step="0.01" style="margin: 0; width: 100%; box-sizing: border-box;">
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label for="swal-iva-masa" style="font-weight: bold; font-size: 0.9em; color: #1e293b;">
                        Tratamiento de IVA a Aplicar:
                    </label>
                    <select id="swal-iva-masa" class="swal2-select" style="margin: 0; width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid #d1d5db; font-size: 1em; color: #1e293b; background: white; font-weight: 500;">
                        <option value="MANTENER" selected>Mantener actual de cada artículo</option>
                        <option value="COMPLETO">Completo (100% del IVA original)</option>
                        <option value="MEDIO">Medio IVA (50% del IVA original)</option>
                        <option value="SIN">Sin IVA / Exento (0%)</option>
                    </select>
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Confirmar Actualización',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const val = document.getElementById('swal-margen-masa').value;
            const floatVal = parseFloat(val);
            const ivaVal = document.getElementById('swal-iva-masa').value;
            
            // Sanitización y blindaje de la entrada numérica (SweetAlert2)
            // Debe ser un número válido estrictamente mayor o igual a 0 (ej. permitir margen 0% para venta al costo)
            if (isNaN(floatVal)) {
                Swal.showValidationMessage('Debe ingresar un porcentaje numérico válido.');
                return false;
            }
            if (floatVal < 0) {
                Swal.showValidationMessage('El margen de ganancia no puede ser menor a 0%.');
                return false;
            }
            return { margen: floatVal, modoIva: ivaVal };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const { margen, modoIva } = result.value;
            
            Swal.fire({
                title: 'Actualizando artículos...',
                text: 'Procesando recálculo en lote y persistiendo en base de datos.',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });
            
            try {
                const response = await fetch('/api/logistica/bunker/articulos/actualizar-margenes-masa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        lista_id: listaSeleccionadaGlobal,
                        articulo_ids: seleccionadosVisibles,
                        margen_ganancia: margen,
                        modo_iva: modoIva
                    })
                });
                
                const resData = await response.json();
                
                if (response.ok && resData.success) {
                    Swal.fire({
                        title: 'Actualización Exitosa',
                        text: `Se actualizaron los márgenes y alícuotas para los ${seleccionadosVisibles.length} artículos.`,
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    
                    // Limpiar selección tras la actualización exitosa (Pizarra Limpia)
                    window.articulosSeleccionadosMasa.clear();
                    
                    // Sincronizar/desmarcar checkbox maestro visualmente
                    const masterCheckbox = document.getElementById('chk-seleccionar-todo-visible');
                    if (masterCheckbox) {
                        masterCheckbox.checked = false;
                    }
                    
                    // Refrescar en caliente
                    await cargarDataGrid();
                } else {
                    Swal.fire('Error', resData.error || 'No se pudo realizar la actualización masiva.', 'error');
                }
            } catch (err) {
                console.error(err);
                Swal.fire('Error de Conexión', 'Fallo de red al intentar comunicarse con el servidor.', 'error');
            }
        }
    });
};

window.abrirMinimodalCatalogoMasa = function() {
    const seleccionadosVisibles = Array.from(window.articulosSeleccionadosMasa).filter(id =>
        (window.articulosVisiblesActualmente || []).some(a => a.articulo_id === id)
    );

    if (seleccionadosVisibles.length === 0) {
        Swal.fire({
            title: 'Sin Selección',
            text: 'Debe seleccionar al menos un artículo visible en la grilla.',
            icon: 'warning'
        });
        return;
    }

    const listas = window.obtenerListasCatalogoMaestras();
    const preselectTodas = window.filtroRadarLdn1 === 'SIN_STOCK_ACTIVOS' || window.filtroRadarLdn1 === 'CON_STOCK_INACTIVOS';
    const preselectOcultar = window.filtroRadarLdn1 === 'SIN_STOCK_ACTIVOS';

    let opcionesListasHtml = `<option value="ACTIVA" ${!preselectTodas ? 'selected' : ''}>★ Lista actual en vista (${(listas.find(l => Number(l.lista_id) === Number(listaSeleccionadaGlobal)) || {}).nombre_lista || 'Lista ' + listaSeleccionadaGlobal})</option>`;
    opcionesListasHtml += `<option value="TODAS" ${preselectTodas ? 'selected' : ''}>🌐 TODAS las listas comerciales (${listas.length} listas)</option>`;
    listas.forEach(l => {
        if (Number(l.lista_id) !== Number(listaSeleccionadaGlobal)) {
            opcionesListasHtml += `<option value="${l.lista_id}">${l.nombre_lista}</option>`;
        }
    });

    Swal.fire({
        title: '🌐 Catálogo en Masa',
        html: `
            <p style="font-size: 0.92em; color: #475569; margin-bottom: 15px; text-align: left; line-height: 1.4;">
                Gestione la visibilidad en catálogo para los <strong>${seleccionadosVisibles.length}</strong> artículos seleccionados:
            </p>
            <div style="display: flex; flex-direction: column; gap: 14px; text-align: left;">
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label for="swal-catalogo-masa-alcance" style="font-weight: 700; font-size: 0.88em; color: #1e293b;">
                        Lista(s) de destino:
                    </label>
                    <select id="swal-catalogo-masa-alcance" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 0.95em; color: #0f172a; background: #f8fafc; font-weight: 600;">
                        ${opcionesListasHtml}
                    </select>
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label for="swal-catalogo-masa-estado" style="font-weight: 700; font-size: 0.88em; color: #1e293b;">
                        Acción a aplicar:
                    </label>
                    <select id="swal-catalogo-masa-estado" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 0.95em; color: #0f172a; background: #ffffff; font-weight: 600;">
                        <option value="true" ${!preselectOcultar ? 'selected' : ''}>🟢 Habilitar / Activar en Catálogo</option>
                        <option value="false" ${preselectOcultar ? 'selected' : ''}>🚫 Excluir / Ocultar del Catálogo</option>
                    </select>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonColor: '#2563eb',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Aplicar Cambios',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const alcance = document.getElementById('swal-catalogo-masa-alcance').value;
            const disponible = document.getElementById('swal-catalogo-masa-estado').value === 'true';
            return { alcance, disponible };
        }
    }).then(async (result) => {
        if (!result.isConfirmed) return;
        const { alcance, disponible } = result.value;
        const targetListaIds = alcance === 'TODAS'
            ? listas.map(l => Number(l.lista_id))
            : [alcance === 'ACTIVA' ? Number(listaSeleccionadaGlobal) : Number(alcance)];

        Swal.fire({
            title: 'Actualizando Catálogo...',
            text: 'Sincronizando disponibilidad de artículos...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            for (const lid of targetListaIds) {
                const res = await fetch('/api/logistica/bunker/articulos/actualizar-habilitacion-masa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        lista_id: lid,
                        articulo_ids: seleccionadosVisibles,
                        disponible
                    })
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'Error actualizando catálogo en masa.');
                }
            }

            Swal.fire({
                title: 'Catálogo Actualizado',
                text: `Se ${disponible ? 'habilitaron' : 'ocultaron'} ${seleccionadosVisibles.length} artículo(s) correctamente.`,
                icon: 'success',
                timer: 1800,
                showConfirmButton: false
            });

            window.articulosSeleccionadosMasa.clear();
            const masterCheckbox = document.getElementById('chk-seleccionar-todo-visible');
            if (masterCheckbox) masterCheckbox.checked = false;
            await cargarDataGrid();
        } catch (err) {
            console.error(err);
            Swal.fire('Error', err.message || 'No se pudo actualizar el catálogo en masa.', 'error');
        }
    });
};

/**
 * ✉️ Modal Interactivo: Cotización y Envío Dinámico de Precios a Clientes
 */
window.cotizadorState = null;

/**
 * Alternar maximizado de pantalla completa del modal de cotización
 */
window.toggleMaximizarCotizadorModal = function() {
    const popup = Swal.getPopup();
    if (!popup) return;
    const btn = document.getElementById('cotiz-btn-maximize');

    if (popup.classList.contains('cotiz-maximized')) {
        popup.classList.remove('cotiz-maximized');
        popup.style.width = '1150px';
        popup.style.height = 'auto';
        popup.style.maxHeight = '90vh';
        if (btn) btn.innerHTML = '🗖 Maximizar';
    } else {
        popup.classList.add('cotiz-maximized');
        popup.style.width = '98vw';
        popup.style.height = '95vh';
        popup.style.maxHeight = '95vh';
        if (btn) btn.innerHTML = '🗗 Restaurar';
    }
};

/**
 * Escanea dinámicamente las CATEGORÍAS TAXONÓMICAS REALES participantes en un grupo de artículos.
 * Lee exclusivamente posObj.eje y posObj.valor de pd.posiciones, ignorando metadatos raíz del sistema.
 */
window.obtenerCategoriasAtributosParticipantes = function(artList) {
    console.log(`🚨 [VIGÍA COTIZADOR F12] Escaneando categorías taxonómicas intervinientes en ${artList.length} artículo(s)...`);
    if (!Array.isArray(artList) || artList.length === 0) return [];

    const categoriasFound = new Map();

    artList.forEach((item, artIdx) => {
        const art = item.art_original || item;
        const pd = art.propiedades_dinamicas || {};

        console.log(`🔍 [VIGÍA COTIZADOR F12] Artículo [${artIdx + 1}/${artList.length}] ID=${art.articulo_id} "${art.descripcion || art.nomenclatura}":`, {
            familia: art.familia_nombre || art.familia || pd.familia_nombre,
            articulo_principal: art.articulo_principal || pd.articulo_principal,
            posiciones: pd.posiciones
        });

        // Escanear exclusivamente pd.posiciones (donde se configuran los ejes taxonómicos Nivel 2)
        if (pd.posiciones && typeof pd.posiciones === 'object') {
            Object.keys(pd.posiciones).forEach(posKey => {
                const posObj = pd.posiciones[posKey];
                if (!posObj || typeof posObj !== 'object') return;

                // En el Búnker el nombre de la categoría secundaria se guarda en posObj.eje, posObj.categoria o posObj.nombre_categoria
                const catNombre = posObj.eje || posObj.categoria || posObj.nombre_categoria || posObj.nombre;
                const rawVal = posObj.valor || posObj.termino || posObj.texto;

                if (catNombre && rawVal && String(rawVal).trim() !== '') {
                    const catCleanKey = String(catNombre).toLowerCase().trim();
                    const valClean = String(rawVal).trim();

                    // Filtrado defensivo de claves metadata
                    if (['articulo_principal', 'familia', 'familia_id', 'incluir_familia', 'posicion_familia', 'silencioso_principal', 'modo_display_principal', 'presentacion_varios_ui'].includes(catCleanKey)) return;

                    if (!categoriasFound.has(catCleanKey)) {
                        categoriasFound.set(catCleanKey, { label: String(catNombre).trim(), values: new Set() });
                    }
                    categoriasFound.get(catCleanKey).values.add(valClean);
                }
            });
        }
    });

    const result = [];
    categoriasFound.forEach((dataObj, catKey) => {
        if (dataObj.values.size > 0) {
            const formattedLabel = dataObj.label.charAt(0).toUpperCase() + dataObj.label.slice(1);
            result.push({
                key: catKey,
                label: formattedLabel,
                values: Array.from(dataObj.values)
            });
        }
    });

    console.log(`✅ [VIGÍA COTIZADOR F12] Categorías secundarias intervinientes encontradas (${result.length}):`, result);
    return result;
};

/**
 * Evaluador determinista de estado activo de un artículo para una lista de precios dada.
 * Retorna true ÚNICA Y EXCLUSIVAMENTE si:
 * 1) No está deshabilitado en el sistema (!art.deshabilitado)
 * 2) Posee un margen configurado para esa lista
 * 3) La oferta no está desactivada en catálogo (mFocused.disponible !== false)
 * 4) El precio final calculado es estrictamente mayor a $0
 */
window.esArticuloActivoParaLista = function(art, targetListaId) {
    if (!art) return false;
    if (art.deshabilitado === true || art.deshabilitado === 'true' || art.deshabilitado === 1) return false;
    const margenes = art.margenes || [];
    const mFocused = margenes.find(m => Number(m.lista_id) === Number(targetListaId));
    if (!mFocused) return false;
    if (mFocused.disponible === false || mFocused.disponible === 'false' || mFocused.disponible === 0) return false;
    const pFinal = parseFloat(mFocused.precio_final || 0);
    if (isNaN(pFinal) || pFinal <= 0) return false;
    return true;
};

    window.MIXES_COMPOSICION_DEFAULT = {
        'MFSPX1': 'Nuez Mariposa Extra Light, Castaña de Caju Entera, Nuez Pecan Pelada, Avellana Pelada Grande, Almendra Nonparei',
        'MFSPX2': 'Nuez Mariposa Extra Light, Castaña de Caju Entera, Nuez Pecan Pelada, Avellana Pelada Grande, Almendra Nonparei',
        'MFSPx300': 'Nuez Mariposa Extra Light, Castaña de Caju Entera, Nuez Pecan Pelada, Avellana Pelada Grande, Almendra Nonparei',
        'MFSPx5': 'Nuez Mariposa Extra Light, Castaña de Caju Entera, Nuez Pecan Pelada, Avellana Pelada Grande, Almendra Nonparei',
        'MFSPXK': 'Nuez Mariposa Extra Light, Castaña de Caju Entera, Nuez Pecan Pelada, Avellana Pelada Grande, Almendra Nonparei',
        'MFSSOXK': 'Avellana Pelada Chica, Almendra Guara, Mani Repelado Sin Sal, Castaña de Caju Partida, Nuez Mariposa Light para Mix, Nuez Cuarto Ligth',
        'MFSSPx1': 'Avellana Pelada Chica, Almendra Guara, Mani Repelado Sin Sal, Castaña de Caju Partida, Nuez Mariposa Light para Mix, Nuez Cuarto Ligth',
        'MFSSPx2': 'Avellana Pelada Chica, Almendra Guara, Mani Repelado Sin Sal, Castaña de Caju Partida, Nuez Mariposa Light para Mix, Nuez Cuarto Ligth',
        'MFSSPx5': 'Avellana Pelada Chica, Almendra Guara, Mani Repelado Sin Sal, Castaña de Caju Partida, Nuez Mariposa Light para Mix, Nuez Cuarto Ligth',
        'MFSTx1': 'Naranja (Para mix), Pasa de Uva Negra, Chip Banana, Kiwi (Para mix), Pasa Rubia, Almendra Guara Ramillada, Castaña de Caju Partida, Nuez Mariposa Light para Mix, Anana en Rodajas, Mani Repelado Sin Sal 2',
        'MFSTx2': 'Naranja (Para mix), Pasa de Uva Negra, Chip Banana, Kiwi (Para mix), Pasa Rubia, Almendra Guara Ramillada, Castaña de Caju Partida, Nuez Mariposa Light para Mix, Anana en Rodajas, Mani Repelado Sin Sal 2',
        'MFSTx300': 'Naranja (Para mix), Pasa de Uva Negra, Chip Banana, Kiwi (Para mix), Pasa Rubia, Almendra Guara Ramillada, Castaña de Caju Partida, Nuez Mariposa Light para Mix, Anana en Rodajas, Mani Repelado Sin Sal 2',
        'MFSTx5': 'Naranja (Para mix), Pasa de Uva Negra, Chip Banana, Kiwi (Para mix), Pasa Rubia, Almendra Guara Ramillada, Castaña de Caju Partida, Nuez Mariposa Light para Mix, Anana en Rodajas, Mani Repelado Sin Sal 2',
        'MFSTXK': 'Naranja (Para mix), Pasa de Uva Negra, Chip Banana, Kiwi (Para mix), Pasa Rubia, Almendra Guara Ramillada, Castaña de Caju Partida, Nuez Mariposa Light para Mix, Anana en Rodajas, Mani Repelado Sin Sal 2',
        'MFSx1': 'Pasa de Uva Negra, Almendra Guara Partida, Almendra Guara, Pasa Rubia 2, Castaña de Caju Entera, Castaña de Caju Partida, Mani Repelado Sin Sal 2, Nuez Mariposa Light para Mix',
        'MFSx2': 'Pasa de Uva Negra, Almendra Guara Partida, Almendra Guara, Pasa Rubia 2, Castaña de Caju Entera, Castaña de Caju Partida, Mani Repelado Sin Sal 2, Nuez Mariposa Light para Mix',
        'MFSX300G': 'Pasa de Uva Negra, Almendra Guara Partida, Almendra Guara, Pasa Rubia 2, Castaña de Caju Entera, Castaña de Caju Partida, Mani Repelado Sin Sal 2, Nuez Mariposa Light para Mix',
        'MFSx5': 'Pasa de Uva Negra, Almendra Guara Partida, Almendra Guara, Pasa Rubia 2, Castaña de Caju Entera, Castaña de Caju Partida, Mani Repelado Sin Sal 2, Nuez Mariposa Light para Mix',
        'MFSXK': 'Pasa de Uva Negra, Almendra Guara Partida, Almendra Guara, Pasa Rubia 2, Castaña de Caju Entera, Castaña de Caju Partida, Mani Repelado Sin Sal 2, Nuez Mariposa Light para Mix',
        'MSx2': 'Semilla de Girasol, Mani Repelado Salado, Almendra Tostada y Salada (Para Mix), Maiz Frito (Para Mix), Semilla de Zapallo A, Castaña de Caju Tostada y Salada Partida',
        'MSX300G': 'Semilla de Girasol, Mani Repelado Salado, Almendra Tostada y Salada (Para Mix), Maiz Frito (Para Mix), Semilla de Zapallo A, Castaña de Caju Tostada y Salada Partida',
        'MSx5': 'Semilla de Girasol, Mani Repelado Salado, Almendra Tostada y Salada (Para Mix), Maiz Frito (Para Mix), Semilla de Zapallo A, Castaña de Caju Tostada y Salada Partida',
        'MSXK': 'Semilla de Girasol, Mani Repelado Salado, Almendra Tostada y Salada (Para Mix), Maiz Frito (Para Mix), Semilla de Zapallo A, Castaña de Caju Tostada y Salada Partida'
    };

    window.buscarOfertaActivaArticulo = function(artId, listaId, clienteId, ofertasList) {
        if (!ofertasList || ofertasList.length === 0) return null;
        for (const ofr of ofertasList) {
            const aplicaLista = !ofr.listas || ofr.listas.length === 0 || ofr.listas.some(l => Number(l.bunker_lista_precio_id) === Number(listaId));
            if (!aplicaLista) continue;

            if (clienteId && ofr.excepciones && ofr.excepciones.length > 0) {
                const excluido = ofr.excepciones.some(e => Number(e.cliente_id) === Number(clienteId) && e.tipo_excepcion === 'EXCLUIR');
                if (excluido) continue;
            }

            const artMatch = (ofr.articulos || []).find(a => String(a.articulo_numero).trim().toLowerCase() === String(artId).trim().toLowerCase());
            if (artMatch) {
                return {
                    oferta_id: ofr.id,
                    titulo: ofr.titulo,
                    descuento_porcentaje: parseFloat(ofr.descuento_porcentaje || 5),
                    precio_fijo_oferta: artMatch.precio_fijo_oferta ? parseFloat(artMatch.precio_fijo_oferta) : null,
                    condicion_cierre: ofr.condicion_cierre,
                    fecha_fin: ofr.fecha_fin
                };
            }
        }
        return null;
    };

    window.abrirModalEnviarListaCompleta = function() {
        return window.abrirModalEnviarPrecios({ esListaCompleta: true });
    };

    window.abrirModalEnviarPrecios = async function(options = {}) {
        const isFullCatalog = Boolean(options && options.esListaCompleta === true);

        const datasetGlobal = (Array.isArray(articulosBunkerGlobal) && articulosBunkerGlobal.length > 0)
            ? articulosBunkerGlobal
            : (window.articulosVisiblesActualmente || []);

        let seleccionadosVisibles = [];
        if (isFullCatalog) {
            seleccionadosVisibles = datasetGlobal;
        } else {
            // Resolver contra datasetGlobal para NUNCA perder artículos seleccionados al filtrar en el buscador
            seleccionadosVisibles = Array.from(window.articulosSeleccionadosMasa || []).map(id => 
                datasetGlobal.find(a => a.articulo_id === id)
            ).filter(Boolean);
        }

        if (seleccionadosVisibles.length === 0) {
            Swal.fire({
                title: isFullCatalog ? 'Catálogo Sin Artículos' : 'Sin Selección',
                text: isFullCatalog ? 'No se encontraron artículos activos en el catálogo para cotizar.' : 'Debe seleccionar al menos un artículo visible en la grilla para enviar precios.',
                icon: 'warning'
            });
            return;
        }

        Swal.fire({
            title: isFullCatalog ? 'Cargando Lista Completa...' : 'Cargando Cotizador...',
            text: 'Obteniendo clientes, ofertas vigentes y composiciones de recetas...',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        let clientesList = [];
        try {
            const res = await fetch('/api/logistica/bunker/clientes');
            if (res.ok) {
                const resData = await res.json();
                clientesList = (resData && Array.isArray(resData.data)) ? resData.data : (Array.isArray(resData) ? resData : []);
            }
        } catch (e) {
            console.error('Error al obtener clientes para cotizador:', e);
        }

        if (clientesList.length === 0 && window.bunkerClientesAutoseleccionCache && window.bunkerClientesAutoseleccionCache.length > 0) {
            clientesList = window.bunkerClientesAutoseleccionCache;
        }

        // Cargar ofertas dinámicas activas (Single Source of Truth)
        let ofertasActivas = [];
        try {
            const resOf = await fetch('/api/logistica/bunker/ofertas-activas').catch(() => null);
            if (resOf && resOf.ok) {
                const d = await resOf.json();
                ofertasActivas = d.data || [];
            } else {
                const resFallback = await fetch('http://localhost:3000/api/ofertas-dinamicas?solo_activas=true').catch(() => null);
                if (resFallback && resFallback.ok) {
                    const d = await resFallback.json();
                    ofertasActivas = d.data || [];
                }
            }
        } catch (eOf) {
            console.warn('Advertencia cargando ofertas activas:', eOf);
        }

        // Cargar matriz de Configurar Jerarquía B2B (/api/logistica/b2b-jerarquia)
        let jerarquiaB2BFamiliasMap = new Map();
        try {
            const resJer = await fetch('/api/logistica/b2b-jerarquia').catch(() => null);
            if (resJer && resJer.ok) {
                const dJer = await resJer.json();
                if (dJer && dJer.success && Array.isArray(dJer.familias)) {
                    const normK = (txt) => String(txt || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                    dJer.familias.forEach(fam => {
                        const ejesPorPrincipal = {};
                        let defaultEjes = ['tipo_producto', 'variedad', 'marca'];
                        if (Array.isArray(fam.articulos_principales)) {
                            fam.articulos_principales.forEach((ap, idx) => {
                                const ejes = [ap.eje_1, ap.eje_2, ap.eje_3].filter(e => e && e !== 'ninguno');
                                const k = normK(ap.articulo_principal);
                                if (k) ejesPorPrincipal[k] = ejes;
                                if (idx === 0 && ejes.length > 0) defaultEjes = ejes;
                            });
                        }
                        if (fam.familia_id) {
                            jerarquiaB2BFamiliasMap.set(Number(fam.familia_id), {
                                familia_nombre: String(fam.familia_nombre || '').trim(),
                                ejesPorPrincipal,
                                defaultEjes
                            });
                        }
                    });
                }
            }
        } catch (eJer) {
            console.warn('Advertencia cargando Jerarquía B2B:', eJer);
        }

        // Cargar composiciones de mixes desde la BD
        let mixesComposicionMap = { ...window.MIXES_COMPOSICION_DEFAULT };
        try {
            const resMix = await fetch('/api/logistica/bunker/mixes-composicion').catch(() => null);
            if (resMix && resMix.ok) {
                const d = await resMix.json();
                if (d.data && typeof d.data === 'object') {
                    mixesComposicionMap = { ...mixesComposicionMap, ...d.data };
                }
            }
        } catch (eMix) {
            console.warn('Advertencia cargando composición de mixes:', eMix);
        }

        let clientePreseleccionado = null;
        let targetClienteId = window.clienteAutoseleccionadoActual ? window.clienteAutoseleccionadoActual.id : null;
        if (!targetClienteId) {
            const hiddenVal = document.getElementById('select-cliente-autoseleccion')?.value;
            if (hiddenVal) targetClienteId = hiddenVal;
        }
        if (!targetClienteId) {
            const inputVal = (document.getElementById('input-buscar-cliente-autoseleccion')?.value || '').trim();
            if (inputVal) {
                const match = (clientesList || []).find(c => 
                    c.lomas_soft_id === inputVal || 
                    c.lomas_soft_id === inputVal.padStart(4, '0') ||
                    (c.codigo_bunker_cliente && c.codigo_bunker_cliente.toLowerCase() === inputVal.toLowerCase())
                );
                if (match) targetClienteId = match.id;
            }
        }
        if (targetClienteId && clientesList.length > 0) {
            clientePreseleccionado = clientesList.find(c => Number(c.id) === Number(targetClienteId)) || null;
        }
        if (!clientePreseleccionado && window.clienteAutoseleccionadoActual) {
            clientePreseleccionado = window.clienteAutoseleccionadoActual;
        }

        // Si el cliente preseleccionado no tiene contactos pero la caché sí, fusionar
        if (clientePreseleccionado && (!clientePreseleccionado.whatsapp_facturas || clientePreseleccionado.whatsapp_facturas === '[]')) {
            const cached = (window.bunkerClientesAutoseleccionCache || []).find(c => Number(c.id) === Number(clientePreseleccionado.id));
            if (cached && cached.whatsapp_facturas && cached.whatsapp_facturas !== '[]') {
                clientePreseleccionado.whatsapp_facturas = cached.whatsapp_facturas;
            }
            if (cached && cached.email_facturas && cached.email_facturas !== '[]') {
                clientePreseleccionado.email_facturas = cached.email_facturas;
            }
        }

        let defListaId = listaSeleccionadaGlobal || (gp_listasFinancieras && gp_listasFinancieras[0] ? gp_listasFinancieras[0].lista_id : 1);
        if (clientePreseleccionado && clientePreseleccionado.listas_precios && clientePreseleccionado.listas_precios.length > 0) {
            defListaId = Number(clientePreseleccionado.listas_precios[0].id);
            console.log(`🏷️ [VIGÍA COTIZADOR F12] Auto-adjudicando lista asignada del cliente "${clientePreseleccionado.razon_social}": Lista ID=${defListaId} (${clientePreseleccionado.listas_precios[0].nombre})`);
        }

        // Mapear artículos preservando relaciones estructurales Padre/Hijo (pack_hijo_codigo / articulo_id)
        const mapArticulos = (targetListaId) => {
            const resultList = [];
            let itemsToMap = [];

            if (isFullCatalog) {
                itemsToMap = datasetGlobal.filter(art => window.esArticuloActivoParaLista(art, targetListaId));
            } else {
                itemsToMap = seleccionadosVisibles.filter(art => window.esArticuloActivoParaLista(art, targetListaId));
            }

            const clienteIdForOffer = clientePreseleccionado ? clientePreseleccionado.id : null;

            const normKJer = (txt) => String(txt || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            itemsToMap.forEach(art => {
                if (art && jerarquiaB2BFamiliasMap.size > 0) {
                    const famCfg = jerarquiaB2BFamiliasMap.get(Number(art.familia_id || 0)) || null;
                    const pdObj = (art.propiedades_dinamicas && typeof art.propiedades_dinamicas === 'object') ? art.propiedades_dinamicas : {};
                    const rawPrinc = String(art.articulo_principal || pdObj.articulo_principal || '').trim();
                    let princDisplay = rawPrinc;
                    let ejeConsumido = null;
                    if (/\bde$/i.test(rawPrinc) || /\bdel$/i.test(rawPrinc)) {
                        const comp = String(pdObj.tipo_producto || pdObj.ingrediente || '').trim();
                        if (comp && !normKJer(rawPrinc).includes(normKJer(comp))) {
                            princDisplay = rawPrinc + ' ' + comp;
                            ejeConsumido = pdObj.tipo_producto ? 'tipo_producto' : 'ingrediente';
                        }
                    }
                    const ejesAct = (famCfg && famCfg.ejesPorPrincipal && famCfg.ejesPorPrincipal[normKJer(rawPrinc)])
                        ? famCfg.ejesPorPrincipal[normKJer(rawPrinc)]
                        : (famCfg ? famCfg.defaultEjes : ['tipo_producto', 'variedad', 'marca']);
                    const subParts = [];
                    ejesAct.forEach(ej => {
                        if (!ej || ej === 'ninguno' || ej === ejeConsumido) return;
                        const val = pdObj[ej];
                        if (val !== undefined && val !== null && String(val).trim() !== '') {
                            const vt = String(val).trim();
                            if (normKJer(vt) !== normKJer(princDisplay) && !subParts.some(p => normKJer(p) === normKJer(vt))) {
                                subParts.push(vt);
                            }
                        }
                    });
                    if (famCfg && famCfg.familia_nombre) art.familia_nombre = famCfg.familia_nombre;
                    if (princDisplay) art.articulo_principal = princDisplay;
                    pdObj.ruta_subcategoria_b2b = subParts.join(' › ');
                    art.propiedades_dinamicas = pdObj;
                }
                const mFocused = art.margenes ? art.margenes.find(m => Number(m.lista_id) === Number(targetListaId)) : null;
                const pFinal = mFocused ? parseFloat(mFocused.precio_final || 0) : 0;
                const ivaVal = mFocused ? parseFloat(mFocused.iva || 21.00) : 21.00;
                const factorKg = parseFloat(art.kilos_unidad || 1.0);
                const pKiloFinal = factorKg > 0 ? (pFinal / factorKg) : pFinal;

                let presStr = factorKg >= 1.0 ? `${factorKg.toFixed(2)} kg` : `${Math.round(factorKg * 1000)} g`;
                if (factorKg <= 0) presStr = 'Unidad';

                const composicionVal = mixesComposicionMap[art.articulo_id] || null;
                const ofertaActivaVal = window.buscarOfertaActivaArticulo(art.articulo_id, targetListaId, clienteIdForOffer, ofertasActivas);

                // Artículo Padre
                const padreItem = {
                    articulo_id: art.articulo_id,
                    nomenclatura: art.nomenclatura || art.descripcion_generada || art.descripcion || `Art #${art.articulo_id}`,
                    kilos_unidad: factorKg,
                    presentacion_str: presStr,
                    iva: ivaVal,
                    precio_bulto_final: pFinal,
                    precio_kilo_final: pKiloFinal,
                    es_hijo: false,
                    padre_id: null,
                    art_original: art,
                    composicion: composicionVal,
                    oferta_activa: ofertaActivaVal
                };
                resultList.push(padreItem);

                // Derivar unidad fraccionada hija ÚNICAMENTE si es Pack Padre Comercial Real en Búnker
                const packUnits = parseInt(art.pack_unidades || 1, 10);
                const esPackFlag = art.es_pack === true || art.es_pack === 'true' || art.es_pack === 1 || art.es_pack === 't';
                const esPackReal = esPackFlag && (packUnits > 1 || !!art.pack_hijo_codigo);

                if (esPackReal) {
                    const hijoObjReal = art.pack_hijo_codigo ? datasetGlobal.find(a => String(a.articulo_id).toLowerCase() === String(art.pack_hijo_codigo).toLowerCase()) : null;

                    const factorKgHijo = hijoObjReal ? parseFloat(hijoObjReal.kilos_unidad || (factorKg / packUnits)) : (factorKg / packUnits);
                    const pFinalHijo = factorKgHijo * pKiloFinal;
                    const presStrHijo = factorKgHijo < 1.0 ? `${Math.round(factorKgHijo * 1000)} g` : `${factorKgHijo.toFixed(2)} kg`;

                    let nomHijo = (hijoObjReal && hijoObjReal.nomenclatura) ? hijoObjReal.nomenclatura : padreItem.nomenclatura;
                    nomHijo = nomHijo.replace(/\b\d+\s*x\s*\d*\s*[a-zA-Z]*\b/gi, '').trim();
                    if (!nomHijo || nomHijo.length < 3) nomHijo = padreItem.nomenclatura;

                    resultList.push({
                        articulo_id: hijoObjReal ? hijoObjReal.articulo_id : `${art.articulo_id}_HIJO`,
                        nomenclatura: nomHijo,
                        kilos_unidad: factorKgHijo,
                        presentacion_str: presStrHijo,
                        iva: ivaVal,
                        precio_bulto_final: pFinalHijo,
                        precio_kilo_final: pKiloFinal,
                        es_hijo: true,
                        padre_id: art.articulo_id,
                        padre_nombre: padreItem.nomenclatura,
                        art_original: art,
                        composicion: null,
                        oferta_activa: null
                    });
                }
            });

            return resultList;
        };

    /**
     * Ordenar artículos padres por presentación de mayor a menor (kilos_unidad DESC)
     * e inyectar ESTRUCTURALMENTE e INDIVISIBLEMENTE su artículo hijo inmediatamente debajo.
     */
    window.ordenarArticulosCotizador = function(artList) {
        if (!Array.isArray(artList)) return [];

        const padres = artList.filter(a => !a.es_hijo);
        const hijos = artList.filter(a => a.es_hijo);

        padres.sort((a, b) => parseFloat(b.kilos_unidad || 0) - parseFloat(a.kilos_unidad || 0));

        const resultado = [];

        padres.forEach(padre => {
            resultado.push(padre);
            const hijasPadre = hijos.filter(h => String(h.padre_id) === String(padre.articulo_id));
            hijasPadre.forEach(hijo => resultado.push(hijo));
        });

        const procesadosIds = new Set(resultado.map(r => String(r.articulo_id)));
        artList.forEach(item => {
            if (!procesadosIds.has(String(item.articulo_id))) {
                resultado.push(item);
            }
        });

        return resultado;
    };

    const articulosCotizadorBase = window.ordenarArticulosCotizador(mapArticulos(defListaId));
    const categoriasParticipantes = window.obtenerCategoriasAtributosParticipantes(articulosCotizadorBase);

    const familiasSet = new Set();
    const principalesSet = new Set();

    articulosCotizadorBase.forEach(item => {
        const art = item.art_original || item;
        const pd = art.propiedades_dinamicas || {};

        const famVal = art.familia_nombre || art.familia || pd.familia_nombre;
        if (famVal && String(famVal).trim() !== '') {
            familiasSet.add(String(famVal).trim());
        }

        let princVal = art.articulo_principal || pd.articulo_principal;
        if (typeof princVal === 'object' && princVal !== null) {
            princVal = princVal.valor || princVal.termino;
        }
        if (!princVal && art.descripcion_generada) {
            princVal = art.descripcion_generada.split(' ')[0];
        } else if (!princVal && art.descripcion) {
            princVal = art.descripcion.split(' ')[0];
        }

        if (princVal && String(princVal).trim() !== '') {
            principalesSet.add(String(princVal).trim());
        }
    });

    const familiasStr = Array.from(familiasSet).join(', ') || 'General';
    const principalesStr = Array.from(principalesSet).join(', ') || '';

    let savedCotizPrefs = {};
    try {
        const rawCotiz = localStorage.getItem('bunker_cotizador_prefs');
        if (rawCotiz) savedCotizPrefs = JSON.parse(rawCotiz) || {};
    } catch (_) {}

    window.cotizadorState = {
        clientes: clientesList,
        clienteSeleccionado: clientePreseleccionado,
        listaId: defListaId,
        modoIVA: savedCotizPrefs.modoIVA || 'con_iva',
        ocultarColumnaIVA: savedCotizPrefs.ocultarColumnaIVA === true,
        modoPrecio: savedCotizPrefs.modoPrecio || 'ambos',
        mostrarHijos: savedCotizPrefs.mostrarHijos !== undefined ? Boolean(savedCotizPrefs.mostrarHijos) : true,
        destacarOfertas: savedCotizPrefs.destacarOfertas !== undefined ? Boolean(savedCotizPrefs.destacarOfertas) : true,
        bonificacionVolumen: savedCotizPrefs.bonificacionVolumen !== undefined ? Boolean(savedCotizPrefs.bonificacionVolumen) : true,
        mostrarComposicionMixes: savedCotizPrefs.mostrarComposicionMixes === true,
        ofertasActivas: ofertasActivas,
        mixesComposicion: mixesComposicionMap,
        agruparPorAtributo: null,
        nivelesAgrupar: new Set(['familia', 'principal', 'ruta_subcategoria_b2b']),
        categoriasParticipantes: categoriasParticipantes,
        tituloInforme: clientePreseleccionado ? 'Precios Históricos' : 'Consulta de Precios',
        articulos: articulosCotizadorBase
    };

    const clientesOptionsHtml = `
        <option value="">-- Consumidor Final / Sin Registro --</option>
        ${clientesList.map(c => {
            const refParts = [c.codigo_bunker_cliente, c.lomas_soft_id ? `ID: ${c.lomas_soft_id}` : null].filter(Boolean);
            const refStr = refParts.length > 0 ? ` [${refParts.join(' | ')}]` : '';
            return `
                <option value="${c.id}" ${clientePreseleccionado && Number(c.id) === Number(clientePreseleccionado.id) ? 'selected' : ''}>
                    ${c.razon_social || c.cliente_nombre}${refStr}
                </option>
            `;
        }).join('')}
    `;

    const listasOptionsHtml = (gp_listasFinancieras || []).map(l => `
        <option value="${l.lista_id}" ${Number(l.lista_id) === Number(defListaId) ? 'selected' : ''}>
            ${l.nombre_lista || l.nombre || 'Lista #' + l.lista_id} (Lista #${l.lista_id})
        </option>
    `).join('');

    const modalHtml = `
        <div style="font-family: system-ui, -apple-system, sans-serif; text-align: left; max-width: 100%;">
            <!-- Encabezado Institucional -->
            <div style="background: linear-gradient(135deg, #6b21a8 0%, #8e4785 100%); padding: 12px 18px; border-radius: 8px 8px 0 0; margin: -1.25em -1.25em 12px -1.25em; color: white; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0; font-size: 1.2em; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                        ✉️ Diseñador & Previsualizador de Cotización
                    </h3>
                    <p style="margin: 3px 0 0 0; font-size: 0.83em; opacity: 0.9;">
                        Configuración dinámica y previsualización en vivo para ${seleccionadosVisibles.length} artículo(s).
                    </p>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button type="button" class="btn-edit" style="background: #ffffff; color: #6b21a8; border: none; font-weight: 700; font-size: 0.85em; padding: 7px 14px; border-radius: 6px; cursor: pointer;" onclick="window.generarPDFCotizacionAction()">
                        📄 Descargar PDF
                    </button>
                    <button type="button" class="btn-edit" style="background: #10b981; color: white; border: none; font-weight: 700; font-size: 0.85em; padding: 7px 14px; border-radius: 6px; cursor: pointer;" onclick="window.abrirModalDespachoEnviar()">
                        🚀 Enviar / Compartir
                    </button>
                </div>
            </div>

            <!-- Interfaz Dividida 2 Columnas -->
            <div style="display: grid; grid-template-columns: 360px 1fr; gap: 14px; min-height: 520px; max-height: 75vh;">
                
                <!-- PANEL IZQUIERDO: CONFIGURACIÓN DINÁMICA DE DOCUMENTO -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto;">
                    <h4 style="margin: 0; font-size: 0.92em; font-weight: 700; color: #475569; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px;">
                        ⚙️ Parámetros del Informe
                    </h4>

                    <!-- Buscador Unificado de Cliente -->
                    <div>
                        <label style="font-weight: 700; font-size: 0.82em; color: #334155; display: block; margin-bottom: 4px;">
                            🔍 Buscar Cliente:
                        </label>
                        <input type="text" id="cotiz-input-search-cliente" placeholder="Filtrar por nombre, razón social..." style="width: 100%; padding: 6px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.83em; box-sizing: border-box; margin-bottom: 4px;" oninput="window.filtrarClientesCotizador(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();const s=document.getElementById('cotiz-select-cliente');if(s&&s.options.length>1&&s.value===''){s.selectedIndex=1;window.onCotizClienteChanged(s.value);}}">
                        <select id="cotiz-select-cliente" style="width: 100%; padding: 7px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.85em; background: white; font-weight: 600; color: #1e293b;" onchange="window.onCotizClienteChanged(this.value)">
                            ${clientesOptionsHtml}
                        </select>
                    </div>

                    <div id="cotiz-alerta-sin-lista" style="display: none; background: #fffbebf8; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; padding: 8px; border-radius: 6px; font-size: 0.8em; color: #92400e;">
                        ⚠️ <strong>Cliente sin lista asignada:</strong> Seleccione de qué lista de precios desea cotizar.
                    </div>

                    <!-- Selector de Lista de Precios -->
                    <div>
                        <label style="font-weight: 700; font-size: 0.82em; color: #334155; display: block; margin-bottom: 4px;">
                            📋 Lista de Precios a Aplicar:
                        </label>
                        <select id="cotiz-select-lista" style="width: 100%; padding: 7px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.85em; background: white; font-weight: 700; color: #7e22ce;" onchange="window.onCotizListaChanged(this.value)">
                            ${listasOptionsHtml}
                        </select>
                    </div>

                    <!-- Estructura Taxonómica Interviniente (Multi-Selección de Niveles de Agrupamiento) -->
                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
                        <div style="font-weight: 700; font-size: 0.82em; color: #334155; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                            <span>📦 Niveles de Agrupamiento (Multi-Selección):</span>
                            <span style="font-size: 0.73em; font-weight: 600; color: #64748b;">Combiná niveles a tu gusto</span>
                        </div>

                        <div style="display: flex; flex-wrap: wrap; gap: 5px; align-items: center;">
                            <button type="button" class="btn-edit btn-chip-categoria" data-cat=""
                                style="font-size: 0.76em; padding: 5px 10px; border-radius: 6px; font-weight: 700; cursor: pointer; border: 1px solid #475569; background: #64748b; color: white; transition: all 0.15s ease;"
                                onclick="window.onCotizLimpiarNivelesAgrupamiento()"
                                title="Restablecer a lista plana sin agrupamiento">
                                📋 Restablecer
                            </button>

                            <!-- Nivel 0: Familia -->
                            <button type="button" class="btn-edit btn-chip-categoria" data-cat="familia"
                                style="font-size: 0.76em; padding: 5px 10px; border-radius: 6px; font-weight: 700; cursor: pointer; border: 1px solid #7e22ce; background: #f3e8ff; color: #6b21a8; transition: all 0.15s ease;"
                                onclick="window.onCotizToggleNivelAgrupamiento('familia')"
                                title="Mostrar / Ocultar banner de Familia (${familiasStr})">
                                🌾 Familia
                            </button>

                            <!-- Nivel 1: Atributo Principal -->
                            ${principalesStr ? `
                                <button type="button" class="btn-edit btn-chip-categoria" data-cat="principal"
                                    style="font-size: 0.76em; padding: 5px 10px; border-radius: 6px; font-weight: 700; cursor: pointer; border: 1px solid #0284c7; background: #e0f2fe; color: #0369a1; transition: all 0.15s ease;"
                                    onclick="window.onCotizToggleNivelAgrupamiento('principal')"
                                    title="Mostrar / Ocultar banner de Atributo Principal (${principalesStr})">
                                    🌽 Atributo Principal
                                </button>
                            ` : ''}

                            <!-- Niveles 2: Categorías Secundarias -->
                            ${categoriasParticipantes.map(c => `
                                <button type="button" class="btn-edit btn-chip-categoria" data-cat="${c.key}"
                                    style="font-size: 0.76em; padding: 5px 10px; border-radius: 6px; font-weight: 700; cursor: pointer; border: 1px solid #7e22ce; background: #f3e8ff; color: #6b21a8; transition: all 0.15s ease;"
                                    onclick="window.onCotizToggleNivelAgrupamiento('${c.key}')"
                                    title="Separar por los atributos de ${c.label}: ${c.values.join(', ')}">
                                    🏷️ ${c.label}
                                </button>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Título del Informe -->
                    <div>
                        <label style="font-weight: 700; font-size: 0.82em; color: #334155; display: block; margin-bottom: 4px;">
                            🏷️ Título Encabezado del PDF:
                        </label>
                        <input type="text" id="cotiz-input-titulo" value="${window.cotizadorState.tituloInforme}" style="width: 100%; padding: 6px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.85em; box-sizing: border-box; font-weight: 600;" oninput="window.onCotizTituloChanged(this.value)">
                    </div>

                    <!-- Tratamiento de IVA -->
                    <div>
                        <label style="font-weight: 700; font-size: 0.82em; color: #334155; display: block; margin-bottom: 4px;">
                            💰 Tratamiento de IVA:
                        </label>
                        <select id="cotiz-select-iva" style="width: 100%; padding: 7px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.85em; background: white;" onchange="window.onCotizModoIVAChanged(this.value)">
                            <option value="con_iva" ${window.cotizadorState.modoIVA === 'con_iva' ? 'selected' : ''}>Con IVA (Precios Finales)</option>
                            <option value="sin_iva" ${window.cotizadorState.modoIVA === 'sin_iva' ? 'selected' : ''}>Sin IVA (Precios Netos)</option>
                        </select>
                    </div>

                    <!-- Exposición de Precios -->
                    <div>
                        <label style="font-weight: 700; font-size: 0.82em; color: #334155; display: block; margin-bottom: 4px;">
                            📊 Precios a Mostrar:
                        </label>
                        <select id="cotiz-select-modo-precio" style="width: 100%; padding: 7px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.85em; background: white;" onchange="window.onCotizModoPrecioChanged(this.value)">
                            <option value="ambos" ${window.cotizadorState.modoPrecio === 'ambos' ? 'selected' : ''}>Ambos (Precio Kilo + Precio Bulto / Unidad)</option>
                            <option value="kilo" ${window.cotizadorState.modoPrecio === 'kilo' ? 'selected' : ''}>Solo Precio Kilo</option>
                            <option value="bulto" ${window.cotizadorState.modoPrecio === 'bulto' ? 'selected' : ''}>Solo Precio Bulto / Unidad</option>
                        </select>
                    </div>

                    <!-- Toggle Mostrar Fraccionados Hijos -->
                    <div style="display: flex; align-items: center; gap: 8px; background: white; padding: 8px; border-radius: 6px; border: 1px solid #e2e8f0;">
                        <input type="checkbox" id="cotiz-chk-mostrar-hijos" ${window.cotizadorState.mostrarHijos ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer; accent-color: #7e22ce;" onchange="window.onCotizToggleHijosChanged(this.checked)">
                        <label for="cotiz-chk-mostrar-hijos" style="font-size: 0.82em; font-weight: 600; color: #334155; cursor: pointer;">
                            Incluir Presentaciones Fraccionadas (Hijas ↳)
                        </label>
                    </div>

                    <!-- Toggle Omitir Columna % IVA en el Informe -->
                    <div style="display: flex; align-items: center; gap: 8px; background: white; padding: 8px; border-radius: 6px; border: 1px solid #e2e8f0; margin-top: 2px;">
                        <input type="checkbox" id="cotiz-chk-ocultar-iva" ${window.cotizadorState.ocultarColumnaIVA ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer; accent-color: #7e22ce;" onchange="window.onCotizToggleOcultarIVAChanged(this.checked)">
                        <label for="cotiz-chk-ocultar-iva" style="font-size: 0.82em; font-weight: 600; color: #334155; cursor: pointer;">
                            🚫 Omitir Columna de % IVA en el Informe
                        </label>
                    </div>

                    <!-- Parámetros Comerciales del Informe -->
                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px; margin-top: 2px;">
                        <span style="font-size: 0.78em; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">🌟 Opciones Comerciales:</span>

                        <!-- Toggle Destacar Ofertas Activas -->
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;">
                            <input type="checkbox" id="cotiz-chk-destacar-ofertas" ${window.cotizadorState.destacarOfertas ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer; accent-color: #ef4444;" onchange="window.onCotizToggleDestacarOfertasChanged(this.checked)">
                            <span style="font-size: 0.82em; font-weight: 600; color: #1e293b;">🔥 Destacar Ofertas / Promociones Activas</span>
                        </label>

                        <!-- Toggle Bonificación por Volumen -->
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;">
                            <input type="checkbox" id="cotiz-chk-bonificacion-volumen" ${window.cotizadorState.bonificacionVolumen ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer; accent-color: #2563eb;" onchange="window.onCotizToggleBonificacionVolumenChanged(this.checked)">
                            <span style="font-size: 0.82em; font-weight: 600; color: #1e293b;">🛡️ Bonificación Comercial (> $300.000: 5% OFF)</span>
                        </label>

                        <!-- Toggle Mostrar Composición de Mixes -->
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;">
                            <input type="checkbox" id="cotiz-chk-composicion-mixes" ${window.cotizadorState.mostrarComposicionMixes ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer; accent-color: #10b981;" onchange="window.onCotizToggleComposicionMixesChanged(this.checked)">
                            <span style="font-size: 0.82em; font-weight: 600; color: #1e293b;">🥣 Mostrar Composición de Mixes (Ingredientes)</span>
                        </label>
                    </div>

                    <!-- Pestaña de Ítems / Edición Individual -->
                    <div style="border-top: 1px solid #cbd5e1; padding-top: 8px; margin-top: 4px;">
                        <div style="font-weight: 700; font-size: 0.83em; color: #475569; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                            <span>📝 Ítems en Cotización (${seleccionadosVisibles.length})</span>
                            <span style="font-size: 0.75em; color: #64748b;">Edición de Nomenclatura y Precios</span>
                        </div>
                        <div id="cotiz-panel-items-edit" style="display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; padding-right: 4px;">
                            <!-- Ítems dinámicos generados por renderPanelItemsEdit() -->
                        </div>
                    </div>

                </div>

                <!-- PANEL DERECHO: HOJA CANVA PREVISUALIZACIÓN VIVA DEL PDF -->
                <div style="background: #64748b; padding: 16px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; overflow-y: auto;">
                    <div id="cotiz-live-document-canvas" style="background: white; width: 100%; max-width: 720px; min-height: 840px; padding: 30px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border-radius: 4px; box-sizing: border-box; transition: all 0.2s ease;">
                        <!-- Se llena dinámicamente con renderCotizadorLivePreview() -->
                    </div>
                </div>

            </div>
        </div>
    `;

    Swal.fire({
        html: modalHtml,
        width: '1250px',
        showConfirmButton: false,
        showCancelButton: false,
        allowOutsideClick: true,
        didOpen: () => {
            window.renderCotizadorLivePreview();
            window.renderPanelItemsEdit();
        }
    });
};

window.onCotizToggleNivelAgrupamiento = function(catKey) {
    if (!window.cotizadorState) return;
    if (!window.cotizadorState.nivelesAgrupar) {
        window.cotizadorState.nivelesAgrupar = new Set();
    }

    const set = window.cotizadorState.nivelesAgrupar;
    if (set.has(catKey)) {
        set.delete(catKey);
    } else {
        set.add(catKey);
    }

    document.querySelectorAll('.btn-chip-categoria').forEach(btn => {
        const cat = btn.getAttribute('data-cat');
        if (!cat) {
            if (set.size === 0) {
                btn.style.background = '#64748b';
                btn.style.color = '#ffffff';
                btn.style.border = '1px solid #475569';
            } else {
                btn.style.background = '#f1f5f9';
                btn.style.color = '#64748b';
                btn.style.border = '1px solid #cbd5e1';
            }
        } else {
            const isActive = set.has(cat);
            if (isActive) {
                if (cat === 'familia') {
                    btn.style.background = 'linear-gradient(135deg, #7e22ce 0%, #d97706 100%)';
                    btn.style.color = '#ffffff';
                    btn.style.border = '2px solid #f59e0b';
                    btn.style.boxShadow = '0 2px 8px rgba(217, 119, 6, 0.4)';
                    btn.style.transform = 'scale(1.04)';
                } else {
                    btn.style.background = '#7e22ce';
                    btn.style.color = '#ffffff';
                    btn.style.border = '1px solid #6b21a8';
                    btn.style.boxShadow = 'none';
                    btn.style.transform = 'none';
                }
            } else {
                btn.style.background = '#f3e8ff';
                btn.style.color = '#6b21a8';
                btn.style.border = '1px solid #7e22ce';
                btn.style.boxShadow = 'none';
                btn.style.transform = 'none';
            }
        }
    });

    window.renderCotizadorLivePreview();
};

window.onCotizLimpiarNivelesAgrupamiento = function() {
    if (!window.cotizadorState) return;
    window.cotizadorState.nivelesAgrupar = new Set();

    document.querySelectorAll('.btn-chip-categoria').forEach(btn => {
        const cat = btn.getAttribute('data-cat');
        if (!cat) {
            btn.style.background = '#64748b';
            btn.style.color = '#ffffff';
            btn.style.border = '1px solid #475569';
        } else {
            btn.style.background = '#f3e8ff';
            btn.style.color = '#6b21a8';
            btn.style.border = '1px solid #7e22ce';
        }
    });

    window.renderCotizadorLivePreview();
};

/**
 * Buscador Unificado de Clientes (Fase 49 - Filtrado por Tokens y Espacios)
 */
window.filtrarClientesCotizador = function(query) {
    if (!window.cotizadorState) return;
    const rawQuery = (query || '').trim();
    const queryLower = rawQuery.toLowerCase();
    const qNum = rawQuery.replace(/\D/g, '');
    const qNumInt = qNum ? parseInt(qNum, 10) : null;
    const terminos = queryLower.split(/\s+/).filter(Boolean);
    const select = document.getElementById('cotiz-select-cliente');
    if (!select) return;

    const clientes = window.cotizadorState.clientes || [];
    const filtradosConScore = [];

    clientes.forEach(c => {
        if (terminos.length === 0) {
            filtradosConScore.push({ cliente: c, score: 0 });
            return;
        }

        let score = 0;
        const lomasId = String(c.lomas_soft_id || '').trim();
        const lomasNum = lomasId.replace(/\D/g, '');
        const lomasInt = lomasNum ? parseInt(lomasNum, 10) : null;
        const codBunker = String(c.codigo_bunker_cliente || '').toLowerCase().trim();
        const codBunkerNum = codBunker.replace(/\D/g, '');
        const codBunkerNumInt = codBunkerNum ? parseInt(codBunkerNum, 10) : null;
        const razon = String(c.razon_social || '').toLowerCase();
        const fantasia = String(c.cliente_nombre || '').toLowerCase();
        const contacto = String(c.email_portal_nombre || '').toLowerCase();
        const cuit = String(c.cuit_cuil || '').replace(/\D/g, '');

        if (qNum) {
            if (lomasId === rawQuery || lomasId === rawQuery.padStart(4, '0') || (lomasInt !== null && qNumInt !== null && lomasInt === qNumInt)) {
                score += 10000;
            } else if (lomasId.startsWith(rawQuery) || (lomasNum && lomasNum.startsWith(qNum))) {
                score += 4500;
            } else if (lomasId.includes(rawQuery)) {
                score += 2000;
            }

            if (codBunker === queryLower || codBunker === `cb-${queryLower}` || codBunker === `cb-${qNum.padStart(4, '0')}` || (codBunkerNumInt !== null && qNumInt !== null && codBunkerNumInt === qNumInt)) {
                score += 8000;
            } else if (codBunker.startsWith(queryLower) || codBunker.includes(queryLower)) {
                score += 3000;
            }

            if (cuit === qNum) {
                score += 5000;
            } else if (cuit.startsWith(qNum)) {
                score += 1500;
            }
        }

        if (razon === queryLower || fantasia === queryLower) {
            score += 6000;
        } else if (razon.startsWith(queryLower) || fantasia.startsWith(queryLower)) {
            score += 3500;
        } else if (razon.includes(queryLower) || fantasia.includes(queryLower)) {
            score += 1500;
        } else if (terminos.every(t => `${razon} ${fantasia} ${contacto}`.includes(t))) {
            score += 800;
        }

        if (score > 0) {
            filtradosConScore.push({ cliente: c, score });
        }
    });

    if (terminos.length > 0) {
        filtradosConScore.sort((a, b) => b.score - a.score);
    }

    const filtrados = filtradosConScore.map(item => item.cliente);
    const currentVal = select.value;
    let autoSelectId = currentVal;

    // Si la búsqueda arroja coincidencia exacta por ID/código o 1 única coincidencia y el usuario escribió >= 2 caracteres, auto-adjudicarlo de inmediato
    if (rawQuery.length >= 2 && filtradosConScore.length > 0) {
        if (filtradosConScore[0].score >= 8000) {
            autoSelectId = String(filtradosConScore[0].cliente.id);
        } else if (filtrados.length === 1 && (!currentVal || !filtrados.some(c => String(c.id) === String(currentVal)))) {
            autoSelectId = String(filtrados[0].id);
        }
    }

    select.innerHTML = `
        <option value="">-- Consumidor Final / Sin Registro --</option>
        ${filtrados.map(c => {
            const refParts = [c.codigo_bunker_cliente, c.lomas_soft_id ? `ID: ${c.lomas_soft_id}` : null].filter(Boolean);
            const refStr = refParts.length > 0 ? ` [${refParts.join(' | ')}]` : '';
            return `
                <option value="${c.id}" ${String(c.id) === String(autoSelectId) ? 'selected' : ''}>
                    ${c.razon_social || c.cliente_nombre}${refStr}
                </option>
            `;
        }).join('')}
    `;

    if (autoSelectId && String(autoSelectId) !== String(currentVal)) {
        select.value = autoSelectId;
        window.onCotizClienteChanged(autoSelectId);
    }
};

window.onCotizClienteChanged = function(clienteId) {
    if (!window.cotizadorState) return;
    const c = window.cotizadorState.clientes.find(x => Number(x.id) === Number(clienteId));
    window.cotizadorState.clienteSeleccionado = c || null;

    const bannerAlerta = document.getElementById('cotiz-alerta-sin-lista');
    const listaSelect = document.getElementById('cotiz-select-lista');

    if (c) {
        const tieneListaAsignada = c.listas_precios && c.listas_precios.length > 0;
        if (tieneListaAsignada) {
            const primaryListaId = c.listas_precios[0].id;
            if (bannerAlerta) bannerAlerta.style.display = 'none';
            if (listaSelect) {
                listaSelect.value = primaryListaId;
                window.onCotizListaChanged(primaryListaId);
                return;
            }
        } else {
            // Cliente sin lista asignada: Alerta explícita para que el operador seleccione
            if (bannerAlerta) {
                bannerAlerta.style.display = 'block';
                bannerAlerta.innerHTML = `⚠️ <strong>Cliente sin lista asignada:</strong> Seleccione de qué lista de precios desea cotizar.`;
            }
        }
    } else {
        if (bannerAlerta) bannerAlerta.style.display = 'none';
    }

    // Actualizar ofertas activas para el nuevo cliente
    const targetLista = window.cotizadorState.listaId;
    window.cotizadorState.articulos.forEach(item => {
        if (!item.es_hijo && item.art_original) {
            item.oferta_activa = window.buscarOfertaActivaArticulo ? window.buscarOfertaActivaArticulo(item.art_original.articulo_id, targetLista, c ? c.id : null, window.cotizadorState.ofertasActivas) : null;
        }
    });

    window.renderCotizadorLivePreview();
};

window.onCotizListaChanged = function(listaId) {
    if (!window.cotizadorState) return;
    window.cotizadorState.listaId = listaId;

    if (window.cotizadorState.esListaCompleta && typeof window.cotizadorState.mapArticulosFn === 'function') {
        const remapped = window.cotizadorState.mapArticulosFn(listaId);
        window.cotizadorState.articulos = window.ordenarArticulosCotizador(remapped);
        window.cotizadorState.categoriasParticipantes = window.obtenerCategoriasAtributosParticipantes(window.cotizadorState.articulos);
    } else {
        window.cotizadorState.articulos.forEach(item => {
            if (!item.es_hijo) {
                const art = item.art_original;
                if (!art) return;
                const mFocused = art.margenes ? art.margenes.find(m => Number(m.lista_id) === Number(listaId)) : null;
                const pFinal = mFocused ? parseFloat(mFocused.precio_final || 0) : 0;
                const ivaVal = mFocused ? parseFloat(mFocused.iva || 21.00) : 21.00;
                const factorKg = parseFloat(art.kilos_unidad || 1.0);

                item.iva = ivaVal;
                item.precio_bulto_final = pFinal;
                item.precio_kilo_final = factorKg > 0 ? (pFinal / factorKg) : pFinal;

                const clienteIdForOffer = window.cotizadorState.clienteSeleccionado ? window.cotizadorState.clienteSeleccionado.id : null;
                item.oferta_activa = window.buscarOfertaActivaArticulo ? window.buscarOfertaActivaArticulo(art.articulo_id, listaId, clienteIdForOffer, window.cotizadorState.ofertasActivas) : null;
            }
        });

        // Recalcular precios unitarios de los hijos basados en su padre
        window.cotizadorState.articulos.forEach(item => {
            if (item.es_hijo) {
                const padreObj = window.cotizadorState.articulos.find(p => !p.es_hijo && String(p.articulo_id) === String(item.padre_id));
                const pKiloRef = padreObj ? padreObj.precio_kilo_final : item.precio_kilo_final;
                item.precio_kilo_final = pKiloRef;
                item.precio_bulto_final = parseFloat(item.kilos_unidad || 0.15) * pKiloRef;
            }
        });
    }

    window.renderCotizadorLivePreview();
    window.renderPanelItemsEdit();
};

window.onCotizTituloChanged = function(val) {
    if (!window.cotizadorState) return;
    window.cotizadorState.tituloInforme = val || 'Consulta de Precios';
    window.renderCotizadorLivePreview();
};

function guardarPreferenciasCotizador() {
    if (!window.cotizadorState) return;
    const prefs = {
        modoIVA: window.cotizadorState.modoIVA,
        ocultarColumnaIVA: Boolean(window.cotizadorState.ocultarColumnaIVA),
        modoPrecio: window.cotizadorState.modoPrecio,
        mostrarHijos: Boolean(window.cotizadorState.mostrarHijos),
        destacarOfertas: Boolean(window.cotizadorState.destacarOfertas),
        bonificacionVolumen: Boolean(window.cotizadorState.bonificacionVolumen),
        mostrarComposicionMixes: Boolean(window.cotizadorState.mostrarComposicionMixes)
    };
    localStorage.setItem('bunker_cotizador_prefs', JSON.stringify(prefs));
    if (typeof window.guardarPreferenciaBunkerRemota === 'function') {
        window.guardarPreferenciaBunkerRemota('bunker_cotizador_prefs', prefs);
    }
}

window.onCotizModoIVAChanged = function(val) {
    if (!window.cotizadorState) return;
    window.cotizadorState.modoIVA = val;
    guardarPreferenciasCotizador();
    window.renderCotizadorLivePreview();
};

window.onCotizModoPrecioChanged = function(val) {
    if (!window.cotizadorState) return;
    window.cotizadorState.modoPrecio = val;
    guardarPreferenciasCotizador();
    window.renderCotizadorLivePreview();
};

window.onCotizToggleHijosChanged = function(checked) {
    if (!window.cotizadorState) return;
    window.cotizadorState.mostrarHijos = checked;
    guardarPreferenciasCotizador();
    window.renderCotizadorLivePreview();
};

window.onCotizToggleSepararPacksChanged = function(checked) {
    if (!window.cotizadorState) return;
    window.cotizadorState.separarPacks = checked === true;
    window.renderCotizadorLivePreview();
};

window.onCotizToggleOcultarIVAChanged = function(checked) {
    if (!window.cotizadorState) return;
    window.cotizadorState.ocultarColumnaIVA = checked === true;
    guardarPreferenciasCotizador();
    window.renderCotizadorLivePreview();
};

window.onCotizToggleDestacarOfertasChanged = function(checked) {
    if (!window.cotizadorState) return;
    window.cotizadorState.destacarOfertas = checked === true;
    guardarPreferenciasCotizador();
    window.renderCotizadorLivePreview();
};

window.onCotizToggleBonificacionVolumenChanged = function(checked) {
    if (!window.cotizadorState) return;
    window.cotizadorState.bonificacionVolumen = checked === true;
    guardarPreferenciasCotizador();
    window.renderCotizadorLivePreview();
};

window.onCotizToggleComposicionMixesChanged = function(checked) {
    if (!window.cotizadorState) return;
    window.cotizadorState.mostrarComposicionMixes = checked === true;
    guardarPreferenciasCotizador();
    window.renderCotizadorLivePreview();
};


window.updateCotizArticuloRow = function(index, field, value) {
    if (!window.cotizadorState || !window.cotizadorState.articulos[index]) return;
    const item = window.cotizadorState.articulos[index];
    const valNum = parseFloat(value) || 0;
    const factorKg = parseFloat(item.kilos_unidad) || 1.0;

    if (field === 'nomenclatura') {
        item.nomenclatura = value;
    } else if (field === 'iva') {
        item.iva = valNum;
    } else if (field === 'precio_kilo_final') {
        item.precio_kilo_final = valNum;
        item.precio_bulto_final = valNum * factorKg;
    } else if (field === 'precio_bulto_final') {
        item.precio_bulto_final = valNum;
        item.precio_kilo_final = factorKg > 0 ? (valNum / factorKg) : valNum;
    }

    if (item.es_hijo) {
        const padreObj = window.cotizadorState.articulos.find(p => !p.es_hijo && String(p.articulo_id) === String(item.padre_id));
        const pKiloRef = padreObj ? padreObj.precio_kilo_final : item.precio_kilo_final;
        item.precio_kilo_final = pKiloRef;
        item.precio_bulto_final = parseFloat(item.kilos_unidad || 0.15) * pKiloRef;
    }

    window.renderCotizadorLivePreview();
    window.renderPanelItemsEdit();
};

window.eliminarArticuloCotizador = function(index) {
    if (!window.cotizadorState) return;
    window.cotizadorState.articulos.splice(index, 1);
    window.renderCotizadorLivePreview();
    window.renderPanelItemsEdit();
};

/**
 * Renderiza los controles de edición individual de ítems en el panel izquierdo
 */
window.renderPanelItemsEdit = function() {
    if (!window.cotizadorState) return;
    const container = document.getElementById('cotiz-panel-items-edit');
    if (!container) return;

    const modoIva = window.cotizadorState.modoIVA;
    const articulos = window.cotizadorState.articulos;

    if (articulos.length === 0) {
        container.innerHTML = `<div style="font-size: 0.8em; color: #94a3b8; text-align: center; padding: 10px;">Sin artículos.</div>`;
        return;
    }

    container.innerHTML = articulos.map((item, idx) => {
        const factorKg = parseFloat(item.kilos_unidad || 1.0);
        const ivaPct = parseFloat(item.iva || 21);
        const ivaCoeff = 1 + (ivaPct / 100);

        let pKilo = item.precio_kilo_final;
        let pBulto = item.precio_bulto_final;
        if (modoIva === 'sin_iva') {
            pKilo = pKilo / ivaCoeff;
            pBulto = pBulto / ivaCoeff;
        }

        return `
            <div style="background: white; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 4px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 700; font-size: 0.8em; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px;" title="${item.nomenclatura}">
                        ${item.es_hijo ? '↳ ' : ''}${item.nomenclatura}
                    </span>
                    <button type="button" style="background: none; border: none; cursor: pointer; font-size: 0.9em;" onclick="window.eliminarArticuloCotizador(${idx})">❌</button>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                    <div>
                        <label style="font-size: 0.73em; color: #64748b; font-weight: 600;">P. Kilo ($):</label>
                        <input type="number" value="${pKilo.toFixed(2)}" step="0.01" style="width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; padding: 3px; font-size: 0.8em; font-weight: bold; box-sizing: border-box;" onchange="window.updateCotizArticuloRow(${idx}, 'precio_kilo_final', this.value)">
                    </div>
                    <div>
                        <label style="font-size: 0.73em; color: #64748b; font-weight: 600;">P. Bulto ($):</label>
                        <input type="number" value="${pBulto.toFixed(2)}" step="0.01" style="width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; padding: 3px; font-size: 0.8em; font-weight: bold; color: #15803d; box-sizing: border-box;" onchange="window.updateCotizArticuloRow(${idx}, 'precio_bulto_final', this.value)">
                    </div>
                </div>
            </div>
        `;
    }).join('');
};

/**
 * Helper para renderizar la fila HTML de un artículo individual en la cotización
 */
window.renderCotizadorArticuloRowHtml = function(item, idx, modoIva, modoPrecio) {
    const factorKg = parseFloat(item.kilos_unidad || 1.0);
    const ivaPct = parseFloat(item.iva || 21);
    const ivaCoeff = 1 + (ivaPct / 100);
    const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

    let pKiloVal = item.precio_kilo_final;
    let pBultoVal = item.precio_bulto_final;

    if (modoIva === 'sin_iva') {
        pKiloVal = pKiloVal / ivaCoeff;
        pBultoVal = pBultoVal / ivaCoeff;
    }

    const destacarOfertas = window.cotizadorState && window.cotizadorState.destacarOfertas !== false;
    const tieneOferta = destacarOfertas && item.oferta_activa && !item.es_hijo;
    const mostrarComposicion = window.cotizadorState && window.cotizadorState.mostrarComposicionMixes === true;
    const tieneComposicion = mostrarComposicion && item.composicion && !item.es_hijo;

    let promoBadgeHtml = '';
    let pKiloHtml = formatter.format(pKiloVal);
    let pBultoHtml = formatter.format(pBultoVal);

    if (tieneOferta) {
        const descPct = parseFloat(item.oferta_activa.descuento_porcentaje || 5);
        const coeff = 1 - (descPct / 100);
        const pKiloPromo = pKiloVal * coeff;
        const pBultoPromo = pBultoVal * coeff;

        promoBadgeHtml = `<span style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; font-size: 0.72em; font-weight: 800; padding: 1px 6px; border-radius: 4px; margin-left: 6px; white-space: nowrap;">🔥 ${descPct}% OFF</span>`;
        pKiloHtml = `<span style="font-size: 0.82em; text-decoration: line-through; color: #94a3b8; font-weight: normal; margin-right: 4px;">${formatter.format(pKiloVal)}</span><strong style="color: #dc2626;">${formatter.format(pKiloPromo)}</strong>`;
        pBultoHtml = `<span style="font-size: 0.82em; text-decoration: line-through; color: #94a3b8; font-weight: normal; margin-right: 4px;">${formatter.format(pBultoVal)}</span><strong style="color: #dc2626;">${formatter.format(pBultoPromo)}</strong>`;
    }

    const composicionHtml = tieneComposicion 
        ? `<div style="font-size: 0.76em; color: #64748b; font-style: italic; margin-top: 3px; line-height: 1.25;">🥣 <strong style="color: #475569;">Composición:</strong> ${item.composicion}</div>`
        : '';

    const showKilo = modoPrecio === 'kilo' || modoPrecio === 'ambos' || modoPrecio === 'kilo_y_bulto' || modoPrecio === 'solo_kilo';
    const showBulto = modoPrecio === 'bulto' || modoPrecio === 'ambos' || modoPrecio === 'kilo_y_bulto' || modoPrecio === 'solo_bulto';
    const hideIva = window.cotizadorState && window.cotizadorState.ocultarColumnaIVA === true;
    const isChildRow = item.es_hijo;
    const presText = item.presentacion_str || (factorKg > 0 ? (factorKg < 1.0 ? `${Math.round(factorKg * 1000)} g` : `${factorKg.toFixed(2)} kg`) : 'Unidad');
    const ivaStr = (ivaPct % 1 === 0 ? ivaPct.toFixed(0) : String(ivaPct).replace('.', ',')) + '%';

    return `
        <tr style="border-bottom: 1px solid #e2e8f0; background-color: ${isChildRow ? '#faf5ff' : (tieneOferta ? '#fffaf8' : (idx % 2 === 1 ? '#f8fafc' : 'white'))};">
            <td style="padding: 6px 10px; text-align: left;">
                <div style="${isChildRow ? 'padding-left: 14px;' : ''}">
                    ${isChildRow ? `<span style="font-size: 0.84em; color: #7e22ce; font-weight: 600;">↳ Unidad fraccionada por ${presText}</span>` : `<strong style="color: #1e293b;">${item.nomenclatura}</strong>${promoBadgeHtml}`}
                    ${composicionHtml}
                </div>
            </td>
            <td style="padding: 8px 10px; text-align: center; color: ${isChildRow ? '#7e22ce' : '#64748b'}; font-weight: 600;">
                ${presText}
            </td>
            ${!hideIva ? `
                <td style="padding: 8px 10px; text-align: center; color: #64748b;">
                    ${ivaStr}
                </td>
            ` : ''}
            ${showKilo ? `
                <td style="padding: 8px 10px; text-align: ${isChildRow ? 'center' : 'right'}; font-weight: 700; color: ${isChildRow ? '#94a3b8' : '#1e293b'};">
                    ${isChildRow ? '—' : pKiloHtml}
                </td>
            ` : ''}
            ${showBulto ? `
                <td style="padding: 8px 10px; text-align: right; font-weight: 700; color: ${isChildRow ? '#7e22ce' : (tieneOferta ? '#dc2626' : '#15803d')};">
                    ${isChildRow ? `<span style="font-size:0.8em; font-weight:600; opacity:0.95; margin-right:2px;">(P. Ud.)</span>` : ''} ${pBultoHtml}
                </td>
            ` : ''}
        </tr>
    `;
};

function obtenerValorAtributoCliente(item, catKey) {
    if (!item || !catKey) return null;
    const art = item.art_original || item;
    const pd = art.propiedades_dinamicas || {};
    const targetKey = String(catKey).toLowerCase().trim();

    if (pd.posiciones && typeof pd.posiciones === 'object') {
        for (const posKey of Object.keys(pd.posiciones)) {
            const posObj = pd.posiciones[posKey];
            if (posObj && typeof posObj === 'object') {
                const catName = String(posObj.eje || posObj.categoria || posObj.nombre_categoria || '').toLowerCase().trim();
                if (catName === targetKey || posKey.toLowerCase().trim() === targetKey) {
                    const val = posObj.valor || posObj.termino || posObj.texto;
                    if (val !== undefined && val !== null && String(val).trim() !== '') return String(val).trim();
                }
            }
        }
    }

    if (pd[targetKey] !== undefined && pd[targetKey] !== null) {
        const valObj = pd[targetKey];
        const val = (typeof valObj === 'object' && valObj !== null) ? (valObj.valor || valObj.termino) : valObj;
        if (val !== undefined && val !== null && String(val).trim() !== '') return String(val).trim();
    }

    const directMatchKey = Object.keys(pd).find(k => k.toLowerCase().trim() === targetKey);
    if (directMatchKey) {
        const valObj = pd[directMatchKey];
        const val = (typeof valObj === 'object' && valObj !== null) ? (valObj.valor || valObj.termino) : valObj;
        if (val !== undefined && val !== null && String(val).trim() !== '') return String(val).trim();
    }

    return null;
}

window.renderCotizadorLivePreview = function() {
    const canvas = document.getElementById('cotiz-live-document-canvas') || document.getElementById('cotiz-live-canvas');
    if (!canvas || !window.cotizadorState) return;

    const cliente = window.cotizadorState.clienteSeleccionado;
    const clienteNombre = cliente ? (cliente.cliente_nombre || cliente.razon_social) : 'Estimado Cliente';
    
    const listaSelect = document.getElementById('cotiz-select-lista');
    const listaNombre = listaSelect && listaSelect.selectedIndex >= 0 ? listaSelect.options[listaSelect.selectedIndex].text.split('(')[0].trim() : '';

    const titulo = window.cotizadorState.tituloInforme || 'Consulta de Precios';
    const modoIva = window.cotizadorState.modoIVA || 'con_iva';
    const modoPrecio = window.cotizadorState.modoPrecio || 'kilo_y_bulto';
    const mostrarHijos = window.cotizadorState.mostrarHijos === true;

    const showKilo = modoPrecio === 'kilo_y_bulto' || modoPrecio === 'solo_kilo' || modoPrecio === 'kilo' || modoPrecio === 'ambos';
    const showBulto = modoPrecio === 'kilo_y_bulto' || modoPrecio === 'solo_bulto' || modoPrecio === 'bulto' || modoPrecio === 'ambos';
    const hideIva = window.cotizadorState && window.cotizadorState.ocultarColumnaIVA === true;

    let totalCols = hideIva ? 2 : 3;
    if (showKilo) totalCols++;
    if (showBulto) totalCols++;

    const articulosFiltrados = window.cotizadorState.articulos.filter(a => mostrarHijos || !a.es_hijo);

    const hoy = new Date();
    const hoyFmtStr = `${String(hoy.getDate()).padStart(2,'0')}/${String(hoy.getMonth()+1).padStart(2,'0')}/${hoy.getFullYear()}`;

    let rowsHtml = '';
    const nivelesSet = window.cotizadorState.nivelesAgrupar || new Set();

    if (nivelesSet.size > 0) {
        const gruposMap = new Map();
        const nivelesList = Array.from(nivelesSet);

        articulosFiltrados.forEach(item => {
            const art = item.art_original || item;
            const pd = art.propiedades_dinamicas || {};

            const famVal = nivelesSet.has('familia') ? (art.familia_nombre || art.familia || pd.familia_nombre || 'General') : null;

            let princVal = null;
            if (nivelesSet.has('principal')) {
                princVal = art.articulo_principal || pd.articulo_principal;
                if (typeof princVal === 'object' && princVal !== null) princVal = princVal.valor || princVal.termino;
                if (!princVal && art.descripcion_generada) princVal = art.descripcion_generada.split(' ')[0];
                if (!princVal && art.descripcion) princVal = art.descripcion.split(' ')[0];
                if (!princVal) princVal = 'General';
            }

            const secKeys = nivelesList.filter(k => k !== 'familia' && k !== 'principal');
            const secVals = [];
            secKeys.forEach(secK => {
                const v = obtenerValorAtributoCliente(item, secK);
                if (v) secVals.push(v);
            });

            const groupKeyParts = [];
            if (famVal) groupKeyParts.push(famVal);
            if (princVal) groupKeyParts.push(princVal);
            if (secVals.length > 0) groupKeyParts.push(secVals.join(' — '));

            const groupKey = groupKeyParts.join(' | ') || 'GENERAL';

            if (!gruposMap.has(groupKey)) {
                gruposMap.set(groupKey, {
                    famVal,
                    princVal,
                    secValsStr: secVals.join(' — '),
                    items: []
                });
            }
            gruposMap.get(groupKey).items.push(item);
        });

        // Ordenar grupos determinísticamente por Jerarquía Taxonómica: Familia -> Principal -> Categorías Secundarias
        const gruposArray = Array.from(gruposMap.values());
        gruposArray.sort((a, b) => {
            if (a.famVal && b.famVal) {
                const cmpFam = a.famVal.localeCompare(b.famVal, 'es', { sensitivity: 'base' });
                if (cmpFam !== 0) return cmpFam;
            } else if (a.famVal && !b.famVal) return -1;
            else if (!a.famVal && b.famVal) return 1;

            if (a.princVal && b.princVal) {
                const cmpPrinc = a.princVal.localeCompare(b.princVal, 'es', { sensitivity: 'base' });
                if (cmpPrinc !== 0) return cmpPrinc;
            } else if (a.princVal && !b.princVal) return -1;
            else if (!a.princVal && b.princVal) return 1;

            if (a.secValsStr && b.secValsStr) {
                return a.secValsStr.localeCompare(b.secValsStr, 'es', { sensitivity: 'base' });
            } else if (a.secValsStr && !b.secValsStr) return -1;
            else if (!a.secValsStr && b.secValsStr) return 1;

            return 0;
        });

        let globalIdx = 0;
        const htmlParts = [];
        let currentFamShown = null;
        let currentPrincShown = null;

        gruposArray.forEach((dataGrupo) => {
            // Header Nivel 0: Familia
            if (dataGrupo.famVal && dataGrupo.famVal !== currentFamShown) {
                currentFamShown = dataGrupo.famVal;
                currentPrincShown = null;
                htmlParts.push(`
                    <tr style="background: #f8fafc;">
                        <td colspan="${totalCols}" style="padding: 7px 12px; font-weight: 900; color: #0f172a; font-size: 0.9em; text-transform: uppercase; background: #f8fafc; border: 1.5px solid #94a3b8; border-radius: 4px;">
                            <div style="display: inline-flex; align-items: center; gap: 8px;">
                                <img src="/img/isotipo_L_LAMDA.png" style="height: 18px; width: auto; vertical-align: middle;" alt="L" onerror="this.style.display='none'">
                                <span style="color: #0f172a; letter-spacing: 0.5px;">${dataGrupo.famVal.toUpperCase()}</span>
                            </div>
                        </td>
                    </tr>
                `);
            }

            // Header Nivel 1: Atributo Principal
            if (dataGrupo.princVal && dataGrupo.princVal !== currentPrincShown) {
                currentPrincShown = dataGrupo.princVal;
                htmlParts.push(`
                    <tr style="background: #f0f9ff; border-top: 1.5px solid #bae6fd; border-bottom: 1.5px solid #bae6fd;">
                        <td colspan="${totalCols}" style="padding: 7px 12px 7px 20px; font-weight: 900; color: #0369a1; font-size: 0.87em; text-transform: uppercase; background: #e0f2fe;">
                            🌽 <span style="color: #0284c7;">${dataGrupo.princVal.toUpperCase()}</span>
                        </td>
                    </tr>
                `);
            }

            // Header Nivel 2: Categorías Secundarias
            if (dataGrupo.secValsStr) {
                htmlParts.push(`
                    <tr style="background: #f8fafc; border-top: 1.5px solid #cbd5e1; border-bottom: 1.5px solid #cbd5e1;">
                        <td colspan="${totalCols}" style="padding: 6px 10px 6px 28px; font-weight: 800; color: #334155; font-size: 0.86em; text-transform: uppercase; background: #f1f5f9;">
                            📌 <span style="color: #6b21a8; font-weight: 900; margin-left: 4px;">${dataGrupo.secValsStr.toUpperCase()}</span>
                            <span style="font-weight: 600; font-size: 0.82em; color: #64748b; margin-left: 8px;">(${dataGrupo.items.length} artículo${dataGrupo.items.length > 1 ? 's' : ''})</span>
                        </td>
                    </tr>
                `);
            }

            // Filas de artículos del grupo (pareja indivisible Padre + Hijo pegado)
            const itemsGrupoOrdenados = window.ordenarArticulosCotizador(dataGrupo.items);
            itemsGrupoOrdenados.forEach(item => {
                htmlParts.push(window.renderCotizadorArticuloRowHtml(item, globalIdx++, modoIva, modoPrecio));
            });
        });

        rowsHtml = htmlParts.join('');
    } else {
        const articulosPlanosOrdenados = window.ordenarArticulosCotizador(articulosFiltrados);
        rowsHtml = articulosPlanosOrdenados.map((item, idx) => window.renderCotizadorArticuloRowHtml(item, idx, modoIva, modoPrecio)).join('');
    }

    canvas.innerHTML = `
        <!-- Encabezado Membretado Oficial -->
        <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; border-bottom: 2px solid #8e4785; padding-bottom: 12px;">
                <div>
                    <img src="../img/logo_LAMDA_grande.png" alt="LAMDA" style="height: 44px; max-width: 140px; object-fit: contain;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
                    <div style="display: none; font-size: 1.8em; font-weight: 900; color: #8e4785;">LAMDA</div>
                    <div style="font-size: 0.73em; color: #64748b; font-weight: 600; margin-top: 4px;">📱 WhatsApp: +54 9 221 661-5746</div>
                </div>
                <div style="text-align: right;">
                    <h2 style="margin: 0; font-size: 1.35em; font-weight: 800; color: #1e293b;">${titulo}</h2>
                    <div style="font-size: 0.88em; color: #334155; font-weight: 700; margin-top: 6px;">Cliente: ${clienteNombre}</div>
                    ${listaNombre ? `<div style="font-size: 0.8em; color: #7e22ce; font-weight: 600; margin-top: 3px;">Lista: ${listaNombre}</div>` : ''}
                    <div style="font-size: 0.75em; color: #64748b; margin-top: 3px;">Emisión: ${hoyFmtStr}</div>
                </div>
            </div>

            <!-- Tabla de Precios Previsualizada -->
            <table style="width: 100%; border-collapse: collapse; font-size: 0.84em; margin-bottom: 20px;">
                <thead style="background-color: #8e4785; color: white; font-weight: 700;">
                    <tr>
                        <th style="padding: 8px 10px; text-align: left;">Artículo / Nomenclatura</th>
                        <th style="padding: 8px 10px; text-align: center; width: 85px;">Presentación</th>
                        ${!hideIva ? `<th style="padding: 8px 10px; text-align: center; width: 50px;">% IVA</th>` : ''}
                        ${showKilo ? `<th style="padding: 8px 10px; text-align: right; width: 105px;">P. Kilo ${modoIva === 'sin_iva' ? '(Neto)' : (hideIva ? '' : '(c/IVA)')}</th>` : ''}
                        ${showBulto ? `<th style="padding: 8px 10px; text-align: right; width: 110px;">P. Bulto / Ud. ${modoIva === 'sin_iva' ? '(Neto)' : (hideIva ? '' : '(c/IVA)')}</th>` : ''}
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml.length > 0 ? rowsHtml : `<tr><td colspan="${totalCols}" style="padding: 20px; text-align: center; color: #94a3b8;">Sin artículos seleccionados</td></tr>`}
                </tbody>
            </table>
        </div>

        <!-- Pie de Página Institucional -->
        <div style="background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 6px; padding: 10px; font-size: 0.76em; color: #475569;">
            <strong style="color: #7e22ce;">INFORMACIÓN DE COTIZACIÓN Y CONDICIONES COMERCIALES:</strong>
            <ul style="margin: 4px 0 0 0; padding-left: 16px; line-height: 1.4;">
                <li>Los precios expuestos son <strong>${hideIva ? (modoIva === 'sin_iva' ? 'NETOS' : 'FINALES') : (modoIva === 'sin_iva' ? 'NETOS (sin IVA)' : 'FINALES (con IVA)')}</strong>.</li>
                <li>Cotización válida por 48 horas sujetas a disponibilidad de stock y variaciones de mercado.</li>
                ${window.cotizadorState && window.cotizadorState.bonificacionVolumen !== false ? `
                    <li style="color: #2563eb; font-weight: 700;">🛡️ Bonificación Comercial: 5% de descuento adicional en compras superiores a $300.000.</li>
                ` : ''}
                ${window.cotizadorState && window.cotizadorState.destacarOfertas !== false && window.cotizadorState.articulos && window.cotizadorState.articulos.some(a => a.oferta_activa) ? `
                    <li style="color: #dc2626; font-weight: 700;">🔥 Ofertas y Promociones: Artículos señalados con descuento promocional aplican hasta agotar stock asignado a la cuota o fin de vigencia.</li>
                ` : ''}
            </ul>
        </div>
    `;
};
function extraerContactosClienteCotiz(cliente) {
    let phoneContacts = [];
    let emailContacts = [];

    if (cliente) {
        // Parsear WhatsApp contacts (Array, JSON string o string simple)
        if (Array.isArray(cliente.whatsapp_facturas)) {
            phoneContacts = cliente.whatsapp_facturas;
        } else if (typeof cliente.whatsapp_facturas === 'string' && cliente.whatsapp_facturas.trim().startsWith('[')) {
            try {
                phoneContacts = JSON.parse(cliente.whatsapp_facturas.trim());
            } catch(e) {}
        }
        if (!Array.isArray(phoneContacts) || phoneContacts.length === 0) {
            const rawPhone = (typeof cliente.whatsapp_facturas === 'string' ? cliente.whatsapp_facturas : '') 
                || cliente.celular || cliente.telefono || '';
            phoneContacts = String(rawPhone).split(/[,;\s]+/).map(num => ({
                numero: num.trim(),
                nombre: cliente.cliente_nombre || 'Contacto Principal',
                default: true
            })).filter(c => c.numero && c.numero.length >= 6);
        }

        // Parsear Email contacts
        // 1. Verificar si hay JSON array en email_facturas o email_portal
        if (Array.isArray(cliente.email_facturas)) {
            emailContacts = cliente.email_facturas;
        } else {
            const rawEmailVal = cliente.email_facturas || cliente.email_portal || '';
            if (typeof rawEmailVal === 'string' && rawEmailVal.trim().startsWith('[')) {
                try {
                    const parsed = JSON.parse(rawEmailVal.trim());
                    if (Array.isArray(parsed)) {
                        emailContacts = parsed;
                    }
                } catch(e) {
                    console.warn('Error parseando JSON email_facturas:', e);
                }
            }
        }

        if (Array.isArray(emailContacts) && emailContacts.length > 0) {
            emailContacts = emailContacts.map(item => {
                if (typeof item === 'object' && item !== null) {
                    return {
                        email: (item.email || item.mail || '').trim(),
                        nombre: item.nombre || item.contacto || cliente.cliente_nombre || 'Contacto Principal',
                        cargo: item.cargo || '',
                        default: item.default_factura !== false && item.default !== false
                    };
                } else if (typeof item === 'string') {
                    return {
                        email: item.trim(),
                        nombre: cliente.cliente_nombre || 'Contacto Principal',
                        default: true
                    };
                }
                return null;
            }).filter(c => c && c.email && c.email.includes('@'));
        }

        // 2. Si no se obtuvieron emails del JSON array, escanear todos los campos de texto del cliente con regex
        if (!Array.isArray(emailContacts) || emailContacts.length === 0) {
            const combinedText = [
                typeof cliente.email_facturas === 'string' ? cliente.email_facturas : '',
                typeof cliente.email_portal === 'string' ? cliente.email_portal : '',
                typeof cliente.email === 'string' ? cliente.email : '',
                typeof cliente.mail === 'string' ? cliente.mail : '',
                typeof cliente.contacto_email === 'string' ? cliente.contacto_email : ''
            ].filter(Boolean).join(' ');

            const matches = combinedText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
            const uniqueEmails = Array.from(new Set(matches.map(m => m.trim().toLowerCase())));

            emailContacts = uniqueEmails.map((em, idx) => ({
                email: em,
                nombre: cliente.cliente_nombre || 'Contacto Principal',
                default: idx === 0
            }));
        }
    }

    return { phoneContacts, emailContacts };
}

/**
 * 🚀 Modal de Envío y Despacho Multiservicio (Estilo Cuenta Corriente LAMDA)
 */
window.abrirModalDespachoEnviar = async function() {
    if (!window.cotizadorState || window.cotizadorState.articulos.length === 0) {
        Swal.fire('Atención', 'No hay artículos en la cotización.', 'warning');
        return;
    }

    let cliente = window.cotizadorState.clienteSeleccionado || window.clienteAutoseleccionadoActual;
    
    // Si aún no está definido pero tenemos un ID en el combobox o en caché, resolverlo
    if (!cliente && window.bunkerClientesAutoseleccionCache) {
        const idHidden = document.getElementById('select-cliente-autoseleccion')?.value;
        if (idHidden) {
            cliente = window.bunkerClientesAutoseleccionCache.find(c => Number(c.id) === Number(idHidden)) || null;
            if (cliente) window.cotizadorState.clienteSeleccionado = cliente;
        }
    }

    // Reconciliar datos de contacto desde la caché si el objeto cliente vino con arrays vacíos o recortados
    if (cliente && (!cliente.whatsapp_facturas || cliente.whatsapp_facturas === '[]')) {
        const cached = (window.bunkerClientesAutoseleccionCache || []).find(c => Number(c.id) === Number(cliente.id));
        if (cached && cached.whatsapp_facturas && cached.whatsapp_facturas !== '[]') {
            cliente.whatsapp_facturas = cached.whatsapp_facturas;
        }
        if (cached && cached.email_facturas && cached.email_facturas !== '[]') {
            cliente.email_facturas = cached.email_facturas;
        }
        if (cached && cached.celular && !cliente.celular) {
            cliente.celular = cached.celular;
        }
    }

    const clienteNombre = cliente ? (cliente.cliente_nombre || cliente.razon_social) : 'Estimado Cliente';
    const { phoneContacts: contacts, emailContacts: emails } = extraerContactosClienteCotiz(cliente);

    let savedMsgBody = localStorage.getItem('LAMDA_COTIZADOR_MSG_BODY');
    if (savedMsgBody) {
        // Reemplazar dinámicamente cualquier saludo anterior "Hola ...," por el cliente actual
        savedMsgBody = savedMsgBody.replace(/^Hola\s+[^,]+,/i, `Hola ${clienteNombre},`);
        savedMsgBody = savedMsgBody.replace(/solicitada/gi, 'actualizada');
    } else {
        savedMsgBody = `Hola ${clienteNombre}, te enviamos la consulta de precios actualizada.\nQuedamos atentos a cualquier consulta. ¡Muchas gracias!`;
    }

    let htmlContent = `
        <div style="text-align: left; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;">
            <!-- Destinatario Identificado -->
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <span style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Destinatario Cotización:</span>
                    <div style="font-size: 13px; font-weight: 800; color: #0f172a;">${clienteNombre} ${cliente && (cliente.codigo_bunker_cliente || cliente.lomas_soft_id) ? `<span style="font-size: 11px; color: #6366f1; font-weight: 700;">(${cliente.codigo_bunker_cliente || 'ID: ' + cliente.lomas_soft_id})</span>` : ''}</div>
                </div>
                ${!cliente || !cliente.id 
                    ? `<span style="font-size: 11px; background: #fef3c7; color: #92400e; font-weight: 700; padding: 3px 8px; border-radius: 4px;">Consumidor Final</span>` 
                    : `<span style="font-size: 11px; background: #dcfce7; color: #166534; font-weight: 700; padding: 3px 8px; border-radius: 4px;">Cliente Registrado</span>`}
            </div>

            <p style="margin-bottom: 12px; font-size: 12px; color: #4b5563; font-weight: 500;">
                Seleccione los canales y destinatarios a los que desea despachar la cotización:
            </p>
    `;

    // Sección WhatsApp
    htmlContent += `
        <div style="margin-bottom: 14px;">
            <div style="font-size: 12px; font-weight: 700; color: #10b981; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px; display: flex; align-items: center; gap: 4px;">
                <span>📱 Contactos de WhatsApp</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px; max-height: 140px; overflow-y: auto; padding: 4px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fafafa;">
    `;

    if (contacts.length === 0) {
        htmlContent += `
            <div style="padding: 10px; font-size: 11px; color: #94a3b8; text-align: center;">
                ${cliente && cliente.id 
                    ? `No hay contactos de WhatsApp cargados para ${clienteNombre}. Puede ingresar uno manualmente abajo.` 
                    : `Modo Consumidor Final (sin cliente registrado). Ingrese un número de WhatsApp abajo.`}
            </div>
        `;
    } else {
        contacts.forEach((c, index) => {
            const isChecked = (typeof c.default === 'boolean') ? c.default : ((typeof c.default_resumen === 'boolean') ? c.default_resumen : (index === 0));
            const rawNum = String(c.numero || c).trim();
            const formattedNum = rawNum.replace(/\D/g, '');
            
            let displayNum = rawNum;
            if (formattedNum.length === 10) {
                displayNum = `(${formattedNum.substring(0,3)}) ${formattedNum.substring(3,6)}-${formattedNum.substring(6,10)}`;
            } else if (formattedNum.length === 13 && formattedNum.startsWith('549')) {
                displayNum = `+54 9 (${formattedNum.substring(3,6)}) ${formattedNum.substring(6,9)}-${formattedNum.substring(9,13)}`;
            } else if (formattedNum.length === 11 && formattedNum.startsWith('54')) {
                displayNum = `+54 (${formattedNum.substring(2,5)}) ${formattedNum.substring(5,8)}-${formattedNum.substring(8,11)}`;
            }

            const labelText = c.nombre 
                ? `<strong>${c.nombre}</strong>${c.cargo ? ` <span style="font-size: 9px; background: #e0f2fe; color: #0369a1; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${c.cargo}</span>` : ''}`
                : `Contacto #${index + 1}`;

            htmlContent += `
                <label style="display: flex; align-items: flex-start; gap: 10px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: white; cursor: pointer; transition: background 0.2s; margin-bottom: 0;">
                    <input type="checkbox" class="swal-cotiz-contacto-wp-chk" value="${formattedNum || rawNum}" ${isChecked ? 'checked' : ''} style="margin-top: 2px; cursor: pointer; width: 16px; height: 16px; accent-color: #10b981;">
                    <div style="flex: 1;">
                        <div style="font-size: 12px; color: #1f2937;">${labelText}</div>
                        <div style="font-size: 11px; color: #6b7280; font-weight: 600;">📱 ${displayNum}</div>
                    </div>
                </label>
            `;
        });
    }

    htmlContent += `
            </div>
        </div>
    `;

    // Sección Email
    htmlContent += `
        <div style="margin-bottom: 14px;">
            <div style="font-size: 12px; font-weight: 700; color: #8b5cf6; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">
                <span>📧 Correo Electrónico</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px; max-height: 140px; overflow-y: auto; padding: 4px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fafafa;">
    `;

    if (emails.length === 0) {
        htmlContent += `
            <div style="padding: 10px; font-size: 11px; color: #94a3b8; text-align: center;">
                ${cliente && cliente.id 
                    ? `No hay direcciones de correo cargadas para ${clienteNombre}. Puede ingresar una manualmente abajo.` 
                    : `Modo Consumidor Final (sin cliente registrado). Ingrese una dirección de correo abajo.`}
            </div>
        `;
    } else {
        emails.forEach((e, index) => {
            const isChecked = (typeof e.default === 'boolean') ? e.default : ((typeof e.default_factura === 'boolean') ? e.default_factura : (index === 0));
            const emailAddr = String(e.email || e).trim();
            const labelText = e.nombre 
                ? `<strong>${e.nombre}</strong>${e.cargo ? ` <span style="font-size: 9px; background: #f3e8ff; color: #6b21a8; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${e.cargo}</span>` : ''}`
                : `Contacto #${index + 1}`;

            htmlContent += `
                <label style="display: flex; align-items: flex-start; gap: 10px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: white; cursor: pointer; transition: background 0.2s; margin-bottom: 0;">
                    <input type="checkbox" class="swal-cotiz-contacto-email-chk" value="${emailAddr}" ${isChecked ? 'checked' : ''} style="margin-top: 2px; cursor: pointer; width: 16px; height: 16px; accent-color: #8b5cf6;">
                    <div style="flex: 1;">
                        <div style="font-size: 12px; color: #1f2937;">${labelText}</div>
                        <div style="font-size: 11px; color: #6b7280; word-break: break-all;">📧 ${emailAddr}</div>
                    </div>
                </label>
            `;
        });
    }

    htmlContent += `
            </div>
        </div>
    `;

    // Campos manuales opcionales
    htmlContent += `
        <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #cbd5e1; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
                <label style="display: block; font-size: 11px; font-weight: 600; color: #4b5563; margin-bottom: 4px;">
                    Otro WhatsApp (opcional):
                </label>
                <input type="text" id="swal-cotiz-custom-phone" placeholder="Ej: 2216615746" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
            </div>
            <div>
                <label style="display: block; font-size: 11px; font-weight: 600; color: #4b5563; margin-bottom: 4px;">
                    Otro correo (opcional):
                </label>
                <input type="email" id="swal-cotiz-custom-email" placeholder="Ej: admin@cliente.com" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
            </div>
        </div>
    `;

    if (cliente && cliente.id) {
        htmlContent += `
            <div style="margin-top: 12px; padding-top: 8px; border-top: 1px dashed #cbd5e1; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; color: #475569;">
                    <input type="checkbox" id="swal-cotiz-save-default" style="width: 16px; height: 16px; cursor: pointer; accent-color: #6b21a8;">
                    <span>Guardar selección como contactos predeterminados al enviar</span>
                </label>
                <button type="button" class="btn-edit" style="background: #6b21a8; color: white; border: none; padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px; box-shadow: 0 1px 3px rgba(107,33,168,0.2);" onclick="window.guardarPreferenciasContactosCotizManual()">
                    💾 Guardar Preferencias
                </button>
            </div>
            <div id="swal-cotiz-status-save-contacts" style="display: none; font-size: 11px; color: #16a34a; font-weight: 700; margin-top: 4px;"></div>
        `;
    }

    // Cuadro de texto para mensaje
    htmlContent += `
        <div style="margin-top: 14px; padding-top: 10px; border-top: 1px dashed #cbd5e1;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <label style="font-size: 11px; font-weight: 700; color: #10b981; text-transform: uppercase; letter-spacing: 0.5px;">
                    📝 Mensaje de Acompañamiento (Editable)
                </label>
                <button type="button" style="background: none; border: none; color: #7e22ce; font-size: 0.78em; font-weight: 700; cursor: pointer;" onclick="window.guardarPreferenciaMensajeCotiz()">
                    💾 Guardar Plantilla
                </button>
            </div>
            <textarea id="swal-cotiz-mensaje-body" rows="4" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; font-family: inherit; box-sizing: border-box; resize: vertical; outline: none; background-color: #fcfcfc;">${savedMsgBody}</textarea>
        </div>
    `;

    htmlContent += `</div>`;

    const { value: modalResult } = await Swal.fire({
        title: 'Despacho de Cotización',
        html: htmlContent,
        icon: 'question',
        width: '650px',
        showCancelButton: true,
        confirmButtonText: '📤 Enviar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#7c3aed',
        cancelButtonColor: '#6b7280',
        preConfirm: async () => {
            const selectedWps = Array.from(document.querySelectorAll('.swal-cotiz-contacto-wp-chk:checked')).map(el => el.value);
            const selectedEmails = Array.from(document.querySelectorAll('.swal-cotiz-contacto-email-chk:checked')).map(el => el.value);
            const customPhone = document.getElementById('swal-cotiz-custom-phone').value.trim();
            const customEmail = document.getElementById('swal-cotiz-custom-email').value.trim();
            const saveDefaultCheckbox = document.getElementById('swal-cotiz-save-default');
            const saveDefault = saveDefaultCheckbox ? saveDefaultCheckbox.checked : false;
            const mensajeTexto = document.getElementById('swal-cotiz-mensaje-body') ? document.getElementById('swal-cotiz-mensaje-body').value : '';

            if (customPhone) {
                const cleaned = customPhone.replace(/[^\d,]/g, '');
                if (cleaned) {
                    cleaned.split(',').forEach(num => {
                        if (num.trim()) selectedWps.push(num.trim().replace(/\D/g, ''));
                    });
                }
            }
            if (customEmail) {
                customEmail.split(',').forEach(em => {
                    if (em.trim() && em.includes('@')) selectedEmails.push(em.trim());
                });
            }

            if (saveDefault && cliente && cliente.id) {
                await window.guardarPreferenciasContactosCotizManual();
            }

            return {
                whatsapp: selectedWps,
                email: selectedEmails,
                mensajeTexto: mensajeTexto
            };
        }
    });

    if (modalResult) {
        window.ejecutarDespachoCotizacionAction(modalResult);
    }
};

window.guardarPreferenciasContactosCotizManual = async function() {
    if (!window.cotizadorState || !window.cotizadorState.clienteSeleccionado) return;

    const cliente = window.cotizadorState.clienteSeleccionado;
    if (!cliente || !cliente.id) return;

    const selectedWps = Array.from(document.querySelectorAll('.swal-cotiz-contacto-wp-chk:checked')).map(el => el.value);
    const selectedEmails = Array.from(document.querySelectorAll('.swal-cotiz-contacto-email-chk:checked')).map(el => el.value);
    const customPhone = (document.getElementById('swal-cotiz-custom-phone') ? document.getElementById('swal-cotiz-custom-phone').value : '').trim();
    const customEmail = (document.getElementById('swal-cotiz-custom-email') ? document.getElementById('swal-cotiz-custom-email').value : '').trim();

    if (customPhone) {
        const cleaned = customPhone.replace(/[^\d,]/g, '');
        if (cleaned) {
            cleaned.split(',').forEach(num => {
                if (num.trim()) selectedWps.push(num.trim().replace(/\D/g, ''));
            });
        }
    }
    if (customEmail) {
        customEmail.split(',').forEach(em => {
            if (em.trim() && em.includes('@')) selectedEmails.push(em.trim());
        });
    }

    const { phoneContacts: contacts, emailContacts: emails } = extraerContactosClienteCotiz(cliente);

    const updatedWps = (contacts || []).map((c, idx) => {
        const numClean = String(c.numero || c).replace(/\D/g, '');
        const isSel = selectedWps.some(w => String(w).replace(/\D/g, '') === numClean);
        return {
            ...c,
            id: c.id || `cont_${Date.now().toString(36)}_${idx}`,
            enviar_alerta: c.enviar_alerta !== false,
            default: isSel,
            default_resumen: isSel,
            default_factura: isSel
        };
    });
    selectedWps.forEach((w, idx) => {
        const numClean = String(w).replace(/\D/g, '');
        if (numClean && !updatedWps.some(c => String(c.numero || c).replace(/\D/g, '') === numClean)) {
            updatedWps.push({
                id: `cont_${Date.now().toString(36)}_${idx}_new`,
                numero: numClean,
                nombre: cliente.cliente_nombre || 'Contacto Directo',
                enviar_alerta: true,
                default: true,
                default_resumen: true,
                default_factura: true
            });
        }
    });

    const updatedEmails = (emails || []).map(e => {
        const emClean = String(e.email || e).trim().toLowerCase();
        const isSel = selectedEmails.some(m => String(m).trim().toLowerCase() === emClean);
        return {
            ...e,
            default: isSel,
            default_factura: isSel
        };
    });
    selectedEmails.forEach(em => {
        const emClean = String(em).trim().toLowerCase();
        if (emClean && !updatedEmails.some(e => String(e.email || e).trim().toLowerCase() === emClean)) {
            updatedEmails.push({
                email: emClean,
                nombre: cliente.cliente_nombre || 'Contacto Directo',
                default: true,
                default_factura: true
            });
        }
    });

    const wpsJson = JSON.stringify(updatedWps);
    const emailsJson = JSON.stringify(updatedEmails);

    try {
        const resSave = await fetch(`/api/logistica/bunker/clientes/${cliente.id}/whatsapp-contacts`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                whatsapp_facturas: wpsJson,
                email_facturas: emailsJson
            })
        });

        if (resSave.ok) {
            cliente.whatsapp_facturas = wpsJson;
            cliente.email_facturas = emailsJson;

            if (window.clientesBunkerGlobal) {
                const cGlob = window.clientesBunkerGlobal.find(c => Number(c.id) === Number(cliente.id));
                if (cGlob) {
                    cGlob.whatsapp_facturas = wpsJson;
                    cGlob.email_facturas = emailsJson;
                }
            }

            console.log('✅ [VIGÍA COTIZADOR F12] Contactos predeterminados persistidos exitosamente en BD y RAM para cliente ID:', cliente.id);
            const statusEl = document.getElementById('swal-cotiz-status-save-contacts');
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.innerHTML = '✅ Preferencias de contacto guardadas exitosamente.';
                setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 3500);
            }
        }
    } catch(e) {
        console.warn('Error al guardar preferencias de contacto:', e);
    }
};

window.guardarPreferenciaMensajeCotiz = function() {
    const textarea = document.getElementById('swal-cotiz-mensaje-body');
    if (!textarea) return;
    localStorage.setItem('LAMDA_COTIZADOR_MSG_BODY', textarea.value);
    Swal.fire({
        title: 'Preferencia Guardada',
        text: 'El texto del mensaje ha sido guardado como plantilla predeterminada.',
        icon: 'success',
        timer: 1800,
        showConfirmButton: false
    });
};

window.ejecutarDespachoCotizacionAction = async function(modalResult) {
    if (!window.cotizadorState || !modalResult) return;

    const { whatsapp: selectedWps, email: selectedEmails, mensajeTexto } = modalResult;

    if (selectedWps.length === 0 && selectedEmails.length === 0) {
        Swal.fire('Atención', 'Debe seleccionar al menos un destinatario (WhatsApp o Email).', 'warning');
        return;
    }

    Swal.fire({
        title: 'Despachando Cotización...',
        text: 'Procesando envíos...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    // Generar PDF en Base64 para adjuntos
    let pdfBase64Data = null;
    let enviadoAuto = false;
    const clienteObj = window.cotizadorState.clienteSeleccionado;
    const clienteNombreStr = clienteObj ? (clienteObj.cliente_nombre || clienteObj.razon_social) : 'Consumidor Final';
    const listaSelect = document.getElementById('cotiz-select-lista');
    const listaNombreStr = listaSelect && listaSelect.selectedIndex >= 0 ? listaSelect.options[listaSelect.selectedIndex].text.split('(')[0].trim() : '';
    const articulosFiltrados = window.cotizadorState.articulos.filter(a => window.cotizadorState.mostrarHijos || !a.es_hijo);
    const cleanArticulosForPdf = articulosFiltrados.map(a => {
        const artOrig = a.art_original || {};
        const nomComercial = a.nomenclatura || artOrig.nomenclatura || artOrig.descripcion_generada || artOrig.descripcion || `Art #${a.articulo_id}`;
        return {
            articulo_id: a.articulo_id,
            nomenclatura: nomComercial,
            descripcion: nomComercial,
            descripcion_generada: a.descripcion_generada || artOrig.descripcion_generada || nomComercial,
            kilos_unidad: a.kilos_unidad,
            presentacion_str: a.presentacion_str,
            iva: a.iva,
            precio_bulto_final: a.precio_bulto_final,
            precio_kilo_final: a.precio_kilo_final,
            es_hijo: a.es_hijo,
            padre_id: a.padre_id,
            es_pack: artOrig.es_pack !== undefined ? artOrig.es_pack : a.es_pack,
            pack_unidades: artOrig.pack_unidades !== undefined ? artOrig.pack_unidades : a.pack_unidades,
            familia_nombre: artOrig.familia_nombre || artOrig.familia || a.familia_nombre,
            articulo_principal: artOrig.articulo_principal || a.articulo_principal,
            propiedades_dinamicas: artOrig.propiedades_dinamicas || a.propiedades_dinamicas,
            composicion: a.composicion || artOrig.composicion || null,
            oferta_activa: a.oferta_activa || null
        };
    });

    const nivelesArr = Array.from(window.cotizadorState.nivelesAgrupar || []);
    console.log('🚨 [VIGÍA COTIZADOR F12 - DESPACHO] Generando PDF base64 para envío con agrupar_por_atributo:', nivelesArr);
    try {
        const pdfRes = await fetch('/api/logistica/bunker/cotizaciones/exportar-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cliente_nombre: clienteNombreStr,
                whatsapp: selectedWps.join(', '),
                lista_nombre: listaNombreStr,
                titulo_informe: window.cotizadorState.tituloInforme,
                modo_iva: window.cotizadorState.modoIVA,
                ocultar_columna_iva: window.cotizadorState.ocultarColumnaIVA === true,
                modo_precio: window.cotizadorState.modoPrecio,
                mostrar_hijos: window.cotizadorState.mostrarHijos,
                separar_packs: window.cotizadorState.separarPacks === true,
                agrupar_por_atributo: nivelesArr,
                destacar_ofertas: window.cotizadorState.destacarOfertas !== false,
                bonificacion_volumen: window.cotizadorState.bonificacionVolumen !== false,
                mostrar_composicion_mixes: window.cotizadorState.mostrarComposicionMixes === true,
                articulos: cleanArticulosForPdf
            })
        });

        if (pdfRes.ok) {
            const pdfBlob = await pdfRes.blob();
            const arrayBuffer = await pdfBlob.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            pdfBase64Data = btoa(binary);
            console.log('✅ [VIGÍA COTIZADOR F12 - DESPACHO] PDF base64 generado exitosamente.');
        } else {
            console.warn('⚠️ Error al generar PDF para despacho HTTP:', pdfRes.status, pdfRes.statusText);
        }
    } catch (errPdf) {
        console.warn('Error generando PDF en base64 para cotización:', errPdf);
    }

    if (selectedWps.length > 0) {
        let msg = (mensajeTexto && mensajeTexto.trim()) ? mensajeTexto.trim() : `Hola ${clienteNombreStr}, te enviamos la consulta de precios actualizada.\nQuedamos atentos a cualquier consulta. ¡Muchas gracias!`;
        msg = msg.replace(/^Hola\s+[^,]+,/i, `Hola ${clienteNombreStr},`);
        msg = msg.replace(/solicitada/gi, 'actualizada');

        // Intentar envío del documento PDF adjunto por microservicio interno de WhatsApp
        enviadoAuto = false;
        if (pdfBase64Data) {
            try {
                const cleanCliente = clienteNombreStr.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');
                const filename = `Cotizacion_${cleanCliente}.pdf`;

                const resWp = await fetch('/api/facturacion/whatsapp/enviar-documento', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        destinatarios: selectedWps.join(', '),
                        pdfBase64: pdfBase64Data,
                        filename: filename,
                        mensajeTexto: msg
                    })
                });

                if (resWp.ok) {
                    const dataWp = await resWp.json();
                    if (dataWp.success) {
                        enviadoAuto = true;
                    }
                }
            } catch (errWp) {
                console.warn('Error enviando PDF adjunto por microservicio interno de WhatsApp:', errWp);
            }
        }

        if (!enviadoAuto) {
            console.warn('⚠️ No se pudo enviar por el Bot de WhatsApp (Bot desconectado o fuera de línea).');
        }
    }

    let emailSuccess = false;
    if (selectedEmails.length > 0) {
        try {
            const resEmail = await fetch('/api/facturacion/email/cotizaciones/enviar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clienteNombre: clienteNombreStr,
                    destinatarios: selectedEmails.join(', '),
                    pdfBase64: pdfBase64Data,
                    tituloInforme: window.cotizadorState.tituloInforme,
                    mensajeTexto: mensajeTexto
                })
            });

            if (resEmail.ok) {
                const dataEmail = await resEmail.json();
                if (dataEmail.success) {
                    emailSuccess = true;
                } else {
                    console.warn('Advertencia en envío de correo interno:', dataEmail.message);
                }
            } else {
                console.warn('Error al conectar con servicio interno de correo:', resEmail.statusText);
            }
        } catch (errEmail) {
            console.error('Error al despachar cotización por correo electrónico:', errEmail);
        }
    }

    // Alerta transparente sobre el resultado real del despacho
    const wpsRequested = selectedWps.length > 0;
    const emailRequested = selectedEmails.length > 0;

    if (wpsRequested && !enviadoAuto) {
        Swal.fire({
            title: 'Despacho Parcial con Advertencia',
            html: `
                <div style="text-align: left; line-height: 1.5; color: #334155; font-size: 0.92em;">
                    ${emailRequested ? `<p style="margin-bottom: 8px; color: #16a34a; font-weight: bold;">📧 Correo Electrónico: Despachado exitosamente.</p>` : ''}
                    <p style="color: #dc2626; font-weight: bold; margin-bottom: 6px;">
                        ⚠️ WhatsApp Desconectado / Fuera de Línea:
                    </p>
                    <p style="font-size: 0.88em; color: #475569; margin: 0;">
                        El mensaje de WhatsApp <strong>no se pudo entregar automáticamente</strong> porque el servicio de WhatsApp Web está desconectado. Por favor, conecte o vincule el Bot WhatsApp en el menú principal.
                    </p>
                </div>
            `,
            icon: 'warning',
            confirmButtonText: 'Entendido'
        });
    } else {
        Swal.fire({
            title: 'Despacho Exitoso',
            text: 'La consulta de precios ha sido enviada exitosamente.',
            icon: 'success',
            timer: 2200,
            showConfirmButton: false
        });
    }
};

window.generarPDFCotizacionAction = async function() {
    if (!window.cotizadorState || window.cotizadorState.articulos.length === 0) {
        Swal.fire('Atención', 'No hay artículos en la cotización.', 'warning');
        return;
    }

    const clienteSelect = document.getElementById('cotiz-select-cliente');
    const listaSelect = document.getElementById('cotiz-select-lista');

    const clienteNombre = clienteSelect && clienteSelect.selectedIndex > 0 ? clienteSelect.options[clienteSelect.selectedIndex].text.split('(')[0].trim() : 'Consumidor Final';
    const listaNombre = listaSelect && listaSelect.selectedIndex >= 0 ? listaSelect.options[listaSelect.selectedIndex].text.split('(')[0].trim() : '';

    const nivelesArr = Array.from(window.cotizadorState.nivelesAgrupar || []);

    const payload = {
        cliente_nombre: clienteNombre,
        whatsapp: window.cotizadorState.clienteSeleccionado ? (window.cotizadorState.clienteSeleccionado.whatsapp_facturas || window.cotizadorState.clienteSeleccionado.telefono || '') : '',
        lista_nombre: listaNombre,
        titulo_informe: window.cotizadorState.tituloInforme || 'Consulta de Precios',
        modo_iva: window.cotizadorState.modoIVA,
        ocultar_columna_iva: window.cotizadorState.ocultarColumnaIVA === true,
        modo_precio: window.cotizadorState.modoPrecio,
        mostrar_hijos: window.cotizadorState.mostrarHijos,
        separar_packs: window.cotizadorState.separarPacks === true,
        agrupar_por_atributo: nivelesArr,
        destacar_ofertas: window.cotizadorState.destacarOfertas !== false,
        bonificacion_volumen: window.cotizadorState.bonificacionVolumen !== false,
        mostrar_composicion_mixes: window.cotizadorState.mostrarComposicionMixes === true,
        articulos: window.cotizadorState.articulos.filter(a => window.cotizadorState.mostrarHijos || !a.es_hijo).map(a => {
            const artOrig = a.art_original || {};
            const nomComercial = a.nomenclatura || artOrig.nomenclatura || artOrig.descripcion_generada || artOrig.descripcion || `Art #${a.articulo_id}`;
            return {
                ...a,
                nomenclatura: nomComercial,
                descripcion: nomComercial,
                descripcion_generada: a.descripcion_generada || artOrig.descripcion_generada || nomComercial,
                composicion: a.composicion || artOrig.composicion || null,
                oferta_activa: a.oferta_activa || null
            };
        })
    };

    console.log('🚨 [VIGÍA COTIZADOR F12 - EXPORTAR PDF] Enviando payload a /exportar-pdf:', payload);

    Swal.fire({
        title: 'Generando PDF...',
        text: 'Construyendo el documento oficial de precios...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    try {
        const response = await fetch('/api/logistica/bunker/cotizaciones/exportar-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Error al generar el PDF.');

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');

        // Notificación Toast para mantener el modal del cotizador 100% abierto y conectado
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: '📄 PDF Generado Exitosamente',
            text: 'Se abrió el documento en una nueva pestaña.',
            showConfirmButton: false,
            timer: 3500
        });
    } catch (err) {
        console.error('Error generando PDF cotización:', err);
        Swal.fire('Error', 'No se pudo generar el PDF de cotización.', 'error');
    }
};

/**
 * Carga la lista de colaboradores y sus tarifas horarias para el asistente
 */
window.gp_colaboradores_tarifas_map = {};
window.gp_colaboradores_list_data = [];

window.cargarColaboradoresAsistente = async function() {
    try {
        const res = await fetch('/api/logistica/usuarios/tarifas');
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const result = await res.json();
        
        const selectAsistente = document.getElementById('gp-asistente-colaborador');
        const selectRendimiento = document.getElementById('gp-rendimiento-colaborador');
        
        if (result.success && result.data && result.data.length > 0) {
            window.gp_colaboradores_list_data = result.data;
            
            // 1. Poblar Asistente de Mano de Obra (Punto 3)
            if (selectAsistente) {
                const valActual = selectAsistente.value;
                selectAsistente.innerHTML = '<option value="">-- Seleccionar --</option>';
                result.data.forEach(c => {
                    window.gp_colaboradores_tarifas_map[c.usuario_id] = parseFloat(c.valor_hora) || 0;
                    const opt = document.createElement('option');
                    opt.value = c.usuario_id;
                    const tarifa = parseFloat(c.valor_hora) || 0;
                    opt.dataset.tarifa = tarifa;
                    opt.textContent = `${c.nombre_completo || c.usuario} ($${tarifa.toLocaleString('es-AR')}/h)`;
                    selectAsistente.appendChild(opt);
                });
                if (valActual) selectAsistente.value = valActual;
            }
            
            // 2. Poblar Rendimiento de Servicios (Punto 2)
            if (selectRendimiento) {
                const valActualRend = selectRendimiento.value;
                selectRendimiento.innerHTML = '<option value="">-- Seleccionar --</option>';
                result.data.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.usuario_id;
                    opt.textContent = c.nombre_completo || c.usuario;
                    selectRendimiento.appendChild(opt);
                });
                if (valActualRend) selectRendimiento.value = valActualRend;
            }
        }
    } catch(e) {
        console.error('Error al cargar colaboradores para asistente y rendimiento:', e);
    }
};

/* ==========================================================================
   HANDLERS PUNTO 2: SERVICIOS DEL COLABORADOR / TARIFA POR RENDIMIENTO
   ========================================================================== */

window.cambiarColaboradorRendimiento = function(colabId) {
    const selectServicio = document.getElementById('gp-select-servicio');
    if (!selectServicio) return;
    
    selectServicio.innerHTML = '<option value="">-- Seleccionar Servicio --</option>';
    
    if (!colabId || !Array.isArray(window.gp_colaboradores_list_data)) {
        selectServicio.innerHTML = '<option value="">-- Seleccionar Colaborador primero --</option>';
        window.actualizarCostoRendimiento(0, 'N/A', 0);
        return;
    }
    
    const colab = window.gp_colaboradores_list_data.find(c => String(c.usuario_id) === String(colabId));
    if (colab && Array.isArray(colab.tarifas) && colab.tarifas.length > 0) {
        colab.tarifas.forEach((t, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.dataset.valor = parseFloat(t.valor_servicio || t.valor_hora || t.monto) || 0;
            opt.dataset.unidad = t.unidad_medida || t.unidad || 'SERVICIO';
            opt.textContent = `${t.nombre_servicio || t.servicio || 'Servicio'} ($${(parseFloat(t.valor_servicio || t.valor_hora || t.monto) || 0).toLocaleString('es-AR')}/${t.unidad_medida || 'u'})`;
            selectServicio.appendChild(opt);
        });
    } else {
        // Fallback: Si el colaborador posee tarifa horaria por defecto
        const tarifaHora = colab ? (parseFloat(colab.valor_hora) || 0) : 0;
        const opt = document.createElement('option');
        opt.value = 'default_hora';
        opt.dataset.valor = tarifaHora;
        opt.dataset.unidad = 'HORA';
        opt.textContent = `Tarifa General ($${tarifaHora.toLocaleString('es-AR')}/h)`;
        selectServicio.appendChild(opt);
    }
    
    if (selectServicio.options.length > 1) {
        selectServicio.selectedIndex = 1;
        window.cambiarServicioRendimiento(selectServicio.value);
    }
};

window.cambiarServicioRendimiento = function(val) {
    const selectServicio = document.getElementById('gp-select-servicio');
    if (!selectServicio) return;
    
    const selectedOpt = selectServicio.options[selectServicio.selectedIndex];
    if (!selectedOpt || !selectedOpt.dataset || !selectedOpt.dataset.valor) {
        window.actualizarCostoRendimiento(0, 'N/A', 0);
        return;
    }
    
    const tarifa = parseFloat(selectedOpt.dataset.valor) || 0;
    const unidad = selectedOpt.dataset.unidad || 'SERVICIO';
    const cantInput = document.getElementById('gp-rendimiento-cantidad');
    const cantidad = cantInput ? (parseFloat(cantInput.value) || 1) : 1;
    
    window.actualizarCostoRendimiento(tarifa, unidad, cantidad);
};

window.cambiarCantidadRendimiento = function(cant) {
    window.cambiarServicioRendimiento(document.getElementById('gp-select-servicio') ? document.getElementById('gp-select-servicio').value : '');
};

window.actualizarCostoRendimiento = function(tarifa, unidad, cantidad) {
    const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    
    let totalCosto = 0;
    const unidadUpper = String(unidad || '').toUpperCase();

    if (unidadUpper === 'HORA' || unidadUpper === 'HS' || unidadUpper === 'H') {
        // Si la tarifa es por HORA, la cantidad ingresada representa MINUTOS: Formula = (Tarifa * Minutos) / 60
        totalCosto = (tarifa * cantidad) / 60;
    } else if (unidadUpper === 'MINUTO' || unidadUpper === 'MINUTOS' || unidadUpper === 'MIN') {
        // Si la tarifa es por MINUTO: Formula = Tarifa * Minutos
        totalCosto = tarifa * cantidad;
    } else {
        // Para tarifa general u hourly fallback donde la tarifa es horaria (>= $1.000): Formula = (Tarifa * Minutos) / 60
        if (tarifa >= 1000 || unidadUpper === 'SERVICIO') {
            totalCosto = (tarifa * cantidad) / 60;
        } else {
            totalCosto = tarifa * cantidad;
        }
    }
    
    const tarifaValEl = document.getElementById('gp-rendimiento-tarifa-val');
    const unidadValEl = document.getElementById('gp-rendimiento-unidad-val');
    const costoCalcEl = document.getElementById('gp-rendimiento-costo-calc');
    const badgeEl = document.getElementById('gp-rendimiento-total-badge');
    
    window.gp_last_rendimiento_calculated_cost = totalCosto;
    
    if (tarifaValEl) tarifaValEl.innerText = currencyFormatter.format(tarifa);
    if (unidadValEl) unidadValEl.innerText = unidad;
    if (costoCalcEl) costoCalcEl.innerText = currencyFormatter.format(totalCosto);
    if (badgeEl) badgeEl.innerText = currencyFormatter.format(totalCosto);
    
    // Inyectar el costo en la lista de precios activa si rendimiento_activo está tildado
    const rendActivoCheck = document.getElementById('gp-rendimiento-activo');
    if (rendActivoCheck && rendActivoCheck.checked && typeof gp_listasFinancieras !== 'undefined') {
        const list = gp_listasFinancieras[gp_activeTabIdx];
        if (list) {
            list.costo_tiempo = totalCosto;
            list.rendimiento_activo = true;
        }
        if (typeof window.recalcularPreciosGestor === 'function') {
            window.recalcularPreciosGestor();
        }
    }
};

window.toggleRendimientoActivo = async function(checked) {
    const valorNumerico = window.gp_last_rendimiento_calculated_cost || 0;
    const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    const totalTexto = currencyFormatter.format(valorNumerico);

    if (checked) {
        if (!valorNumerico || valorNumerico <= 0) {
            // Si aún no se calculó tarifa, activar únicamente en lista actual de forma pasiva
            const list = typeof gp_listasFinancieras !== 'undefined' ? gp_listasFinancieras[gp_activeTabIdx] : null;
            if (list) list.rendimiento_activo = true;
            if (typeof window.recalcularPreciosGestor === 'function') window.recalcularPreciosGestor();
            return;
        }

        const result = await Swal.fire({
            title: '¿Dónde desea activar este costo de servicio?',
            html: `Está activando el costo de servicio de <b style="color: #2563eb; font-size: 1.1em;">${totalTexto}</b>.<br><br>¿Desea aplicarlo a todas las listas de precios o solo a la lista actual?`,
            icon: 'question',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: '🌐 Aplicar a TODAS las listas',
            denyButtonText: '🎯 Solamente a ESTA lista',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#2563eb',
            denyButtonColor: '#059669',
            cancelButtonColor: '#64748b'
        });

        if (result.isConfirmed) {
            if (typeof gp_listasFinancieras !== 'undefined') {
                gp_listasFinancieras.forEach(list => {
                    list.costo_tiempo = valorNumerico;
                    list.rendimiento_activo = true;
                });
            }
        } else if (result.isDenied) {
            if (typeof gp_listasFinancieras !== 'undefined' && gp_listasFinancieras[gp_activeTabIdx]) {
                const list = gp_listasFinancieras[gp_activeTabIdx];
                list.costo_tiempo = valorNumerico;
                list.rendimiento_activo = true;
            }
        } else {
            // Cancelado: revertir checkbox
            const check = document.getElementById('gp-rendimiento-activo');
            if (check) check.checked = false;
            return;
        }
    } else {
        // Desactivando (OFF)
        const result = await Swal.fire({
            title: '¿Dónde desea desactivar este costo de servicio?',
            html: `¿Desea quitar el costo de servicio de mano de obra en todas las listas de precios o únicamente en la lista actual?`,
            icon: 'warning',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: '🌐 Desactivar en TODAS las listas',
            denyButtonText: '🎯 Desactivar solo en ESTA lista',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#dc2626',
            denyButtonColor: '#64748b',
            cancelButtonColor: '#94a3b8'
        });

        if (result.isConfirmed) {
            if (typeof gp_listasFinancieras !== 'undefined') {
                gp_listasFinancieras.forEach(list => {
                    list.costo_tiempo = 0;
                    list.rendimiento_activo = false;
                });
            }
        } else if (result.isDenied) {
            if (typeof gp_listasFinancieras !== 'undefined' && gp_listasFinancieras[gp_activeTabIdx]) {
                const list = gp_listasFinancieras[gp_activeTabIdx];
                list.costo_tiempo = 0;
                list.rendimiento_activo = false;
            }
        } else {
            // Cancelado: revertir checkbox
            const check = document.getElementById('gp-rendimiento-activo');
            if (check) check.checked = true;
            return;
        }
    }

    if (typeof window.recalcularPreciosGestor === 'function') {
        window.recalcularPreciosGestor();
    }
};

/**
 * Modal interactivo para inyectar el costo de servicio de Punto 2 a la lista activa o a todas las listas
 */
window.confirmarServicioRendimiento = async function() {
    const costoEl = document.getElementById('gp-rendimiento-costo-calc');
    const totalTexto = costoEl ? costoEl.innerText.trim() : '$ 0,00';
    const valorNumerico = window.gp_last_rendimiento_calculated_cost || 0;

    if (!valorNumerico || valorNumerico <= 0) {
        Swal.fire('Atención', 'Primero debe seleccionar un colaborador y servicio con tarifa mayor a $ 0,00.', 'warning');
        return;
    }

    const result = await Swal.fire({
        title: '¿Dónde desea aplicar este costo de servicio?',
        html: `Ha calculado un valor de tarifa por rendimiento de <b style="color: #2563eb; font-size: 1.1em;">${totalTexto}</b>.<br><br>¿Desea sumar este costo a la lista activa o a todas las listas de precios?`,
        icon: 'question',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '🌐 Aplicar a TODAS las listas',
        denyButtonText: '🎯 Solamente a ESTA lista',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#2563eb',
        denyButtonColor: '#059669',
        cancelButtonColor: '#64748b'
    });

    if (result.isConfirmed) {
        // Opción A: Aplicar a TODAS las listas de precios
        if (typeof gp_listasFinancieras !== 'undefined' && Array.isArray(gp_listasFinancieras)) {
            gp_listasFinancieras.forEach(list => {
                list.costo_tiempo = valorNumerico;
                list.rendimiento_activo = true;
            });
            // Tildar checkbox de rendimiento activo
            const rendActivoCheck = document.getElementById('gp-rendimiento-activo');
            if (rendActivoCheck) rendActivoCheck.checked = true;
            
            if (typeof window.recalcularPreciosGestor === 'function') {
                window.recalcularPreciosGestor();
            }
            Swal.fire('¡Aplicado!', `Se inyectó el costo de servicio de ${totalTexto} a TODAS las listas de precios.`, 'success');
        }
    } else if (result.isDenied) {
        // Opción B: Aplicar únicamente a la lista activa (solapa actual)
        if (typeof gp_listasFinancieras !== 'undefined' && gp_listasFinancieras[gp_activeTabIdx]) {
            const list = gp_listasFinancieras[gp_activeTabIdx];
            list.costo_tiempo = valorNumerico;
            list.rendimiento_activo = true;
            
            // Tildar checkbox de rendimiento activo
            const rendActivoCheck = document.getElementById('gp-rendimiento-activo');
            if (rendActivoCheck) rendActivoCheck.checked = true;

            if (typeof window.recalcularPreciosGestor === 'function') {
                window.recalcularPreciosGestor();
            }
            Swal.fire('¡Aplicado!', `Se inyectó el costo de servicio de ${totalTexto} únicamente a la lista actual.`, 'success');
        }
    }
};

/**
 * Realiza el cálculo del asistente e inyecta el valor en el input de costo tiempo
 */
window.calcularCostoAsistente = function() {
    const select = document.getElementById('gp-asistente-colaborador');
    const inputMinutos = document.getElementById('gp-asistente-minutos');
    const inputCostoTiempo = document.getElementById('gp-costo-tiempo');
    
    if (!select || !inputMinutos || !inputCostoTiempo) return;
    
    const selectedOpt = select.options[select.selectedIndex];
    if (!selectedOpt || !selectedOpt.value) {
        return; // No hay colaborador seleccionado
    }
    
    const tarifaHoraria = parseFloat(selectedOpt.dataset.tarifa) || 0;
    const minutos = parseFloat(inputMinutos.value) || 0;
    
    // Formula: (Tarifa Horaria * Minutos) / 60
    const costoCalculado = (tarifaHoraria * minutos) / 60;
    
    // Asignar el costo calculado al input principal redondeado a 2 decimales
    inputCostoTiempo.value = costoCalculado.toFixed(2);
    
    // Actualizar todas las listas en memoria que no tengan override manual
    gp_listasFinancieras.forEach((l, idx) => {
        if (idx === gp_activeTabIdx) {
            l.costo_tiempo = costoCalculado;
            l.asistente_override = false;
        } else if (!l.exencion_operativa && !l.asistente_override) {
            l.costo_tiempo = costoCalculado;
            recalcularValoresDeListaEnMemoria(l);
        }
    });
    
    propagarCostosOperativos();
    debouncedRecalcular();
};

window.sincronizarManoObraUI = function() {
    const list = (typeof gp_listasFinancieras !== 'undefined' && Array.isArray(gp_listasFinancieras)) ? gp_listasFinancieras[gp_activeTabIdx] : null;
    if (!list) return;

    const check = document.getElementById('gp-mano-obra-activa');
    if (check) {
        check.checked = (list.mano_obra_activa === true);
    }
};

/**
 * Modal interactivo para confirmar y propagar la mano de obra del asistente a la lista actual o a todas
 */
window.confirmarManoObraAsistente = function() {
    const colabSelect = document.getElementById('gp-asistente-colaborador');
    const minutosInput = document.getElementById('gp-asistente-minutos');
    const costoInput = document.getElementById('gp-costo-tiempo');
    
    if (!colabSelect || !minutosInput || !costoInput) return;
    
    const colabId = colabSelect.value;
    const minutos = parseFloat(minutosInput.value) || 0;
    const costoCalculado = parseFloat(costoInput.value) || 0;
    
    if (!colabId) {
        Swal.fire({
            icon: 'warning',
            title: 'Seleccione un colaborador',
            text: 'Debe seleccionar un colaborador para calcular la tarifa de mano de obra.'
        });
        return;
    }
    
    if (minutos <= 0) {
        Swal.fire({
            icon: 'warning',
            title: 'Ingrese los minutos',
            text: 'Debe ingresar un valor de minutos mayor a cero.'
        });
        return;
    }

    if (costoCalculado <= 0) {
        Swal.fire({
            icon: 'warning',
            title: 'Costo de Mano de Obra Nulo',
            text: 'El colaborador seleccionado no posee tarifa o el costo calculado es cero. Ingrese un colaborador y minutos válidos.'
        });
        return;
    }
    
    const colabNombre = colabSelect.options[colabSelect.selectedIndex] ? colabSelect.options[colabSelect.selectedIndex].text : 'Colaborador';

    Swal.fire({
        title: 'Aplicar Costo de Mano de Obra / Servicios',
        html: `
            <div style="font-size: 0.95em; color: #334155; text-align: left; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
                <div><strong>👷 Colaborador:</strong> ${colabNombre}</div>
                <div><strong>⏱️ Tiempo Asignado:</strong> ${minutos} minutos</div>
                <div><strong>💰 Costo Calculado:</strong> <strong style="color: #0284c7; font-size: 1.1em;">$ ${costoCalculado.toFixed(2)}</strong></div>
            </div>
            <p style="margin-top: 15px; font-weight: bold; color: #475569; font-size: 0.9em;">
                ¿Dónde desea aplicar este costo de servicio?
            </p>
        `,
        icon: 'question',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '🌐 Aplicar a TODAS las listas',
        denyButtonText: '🎯 Solamente a ESTA lista',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#0284c7',
        denyButtonColor: '#3b82f6'
    }).then((result) => {
        if (result.isConfirmed) {
            // Aplicar a TODAS las listas activas
            if (Array.isArray(gp_listasFinancieras)) {
                gp_listasFinancieras.forEach(l => {
                    l.costo_tiempo = costoCalculado;
                    l.mano_obra_activa = true;
                });
            }
            if (typeof window.sincronizarManoObraUI === 'function') window.sincronizarManoObraUI();
            if (typeof window.recalcularPreciosGestor === 'function') {
                window.recalcularPreciosGestor();
            }
            Swal.fire({
                icon: 'success',
                title: 'Mano de obra aplicada',
                text: `Se aplicó el costo de $ ${costoCalculado.toFixed(2)} a TODAS las listas activas.`
            });
        } else if (result.isDenied) {
            // Aplicar SOLAMENTE a la lista actual
            const list = typeof gp_listasFinancieras !== 'undefined' ? gp_listasFinancieras[gp_activeTabIdx] : null;
            if (list) {
                list.costo_tiempo = costoCalculado;
                list.mano_obra_activa = true;
            }
            if (typeof window.sincronizarManoObraUI === 'function') window.sincronizarManoObraUI();
            if (typeof window.recalcularPreciosGestor === 'function') {
                window.recalcularPreciosGestor();
            }
            Swal.fire({
                icon: 'success',
                title: 'Mano de obra aplicada',
                text: `Se aplicó el costo de $ ${costoCalculado.toFixed(2)} a la lista actual.`
            });
        }
    });
};

/**
 * Consulta métricas empíricas de planta para el artículo activo
 */
window.consultarMetricasCampoArticulo = async function(articulo_id) {
    const banner = document.getElementById('gp-banner-metricas-campo');
    const linkCampo = document.getElementById('gp-link-metricas-campo');
    const tituloEl = document.getElementById('gp-metricas-titulo-resumen');
    const badgeCantEl = document.getElementById('gp-metricas-badge-cant');
    const detalleEl = document.getElementById('gp-metricas-detalle-resumen');
    const extraEl = document.getElementById('gp-metricas-extra-resumen');

    if (banner) banner.style.display = 'none';
    if (linkCampo) linkCampo.style.display = 'none';
    window.gp_metricas_campo_activas = null;

    if (!articulo_id) return;

    try {
        const res = await fetch(`/api/tiempos/articulo/${encodeURIComponent(articulo_id)}/metricas-campo`);
        if (!res.ok) return;
        const data = await res.json();

        if (data && data.tiene_metricas && data.promedio_minutos_unitario > 0) {
            window.gp_metricas_campo_activas = data;

            if (banner) {
                if (tituloEl) {
                    tituloEl.innerText = `Evidencia Real de Planta: ${data.promedio_minutos_unitario.toFixed(2)} min/u`;
                }
                if (badgeCantEl) {
                    badgeCantEl.innerText = `${data.cantidad_mediciones} medición${data.cantidad_mediciones > 1 ? 'es' : ''} (${data.total_unidades_medidas} u. totales)`;
                }
                if (detalleEl) {
                    detalleEl.innerHTML = `🟡 Prep: <b>${data.promedio_etapa1.toFixed(2)}m</b> | 🔵 Prod: <b>${data.promedio_etapa2.toFixed(2)}m</b> | 🟣 Etq: <b>${data.promedio_etapa3.toFixed(2)}m</b>`;
                }
                if (extraEl && data.ultima_medicion) {
                    const ult = data.ultima_medicion;
                    let fechaStr = '';
                    if (ult.fecha) {
                        const d = new Date(ult.fecha);
                        fechaStr = d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
                    }
                    extraEl.innerText = `Última toma: ${ult.usuario_nombre || 'Operario'} — Carro #${ult.carro_id || '-'} (${fechaStr})`;
                }
                banner.style.display = 'block';
            }

            if (linkCampo) {
                linkCampo.innerHTML = `⏱️ ${data.promedio_minutos_unitario.toFixed(2)}m campo`;
                linkCampo.style.display = 'inline-block';
            }
        }
    } catch (err) {
        console.error('Error al consultar métricas de campo de artículo:', err);
    }
};

/**
 * Inyecta el tiempo promedio empírico de planta en el input del asistente de mano de obra
 */
window.aplicarMetricaCampoAsistente = function() {
    if (!window.gp_metricas_campo_activas || !window.gp_metricas_campo_activas.promedio_minutos_unitario) {
        Swal.fire({
            icon: 'info',
            title: 'Sin métricas',
            text: 'No hay mediciones registradas para este artículo.'
        });
        return;
    }

    const data = window.gp_metricas_campo_activas;
    const minUnit = parseFloat(data.promedio_minutos_unitario) || 0;
    const inputMinutos = document.getElementById('gp-asistente-minutos');
    const selectColab = document.getElementById('gp-asistente-colaborador');

    if (inputMinutos) {
        inputMinutos.value = minUnit.toFixed(2);
        inputMinutos.style.transition = 'all 0.3s ease';
        inputMinutos.style.backgroundColor = '#dcfce7';
        inputMinutos.style.borderColor = '#10b981';
        setTimeout(() => {
            inputMinutos.style.backgroundColor = '';
            inputMinutos.style.borderColor = '';
        }, 1500);
    }

    // Si ya hay un colaborador seleccionado, calculamos el costo
    if (selectColab && selectColab.value) {
        if (typeof window.calcularCostoAsistente === 'function') {
            window.calcularCostoAsistente();
        }
        Swal.fire({
            icon: 'success',
            title: 'Minutos de Planta Aplicados',
            html: `Se inyectaron <b>${minUnit.toFixed(2)} minutos/u</b> al Asistente y se calculó el costo con el colaborador seleccionado.<br><br><small style="color: #64748b;">Haga clic en <b>"✅ Aplicar Mano de Obra"</b> para propagarlo a las listas de precios deseadas.</small>`,
            timer: 3500,
            showConfirmButton: true,
            confirmButtonText: 'Entendido'
        });
    } else {
        if (selectColab) {
            selectColab.focus();
            selectColab.style.borderColor = '#f59e0b';
            setTimeout(() => {
                selectColab.style.borderColor = '';
            }, 2000);
        }
        Swal.fire({
            icon: 'info',
            title: 'Minutos de Planta Aplicados',
            html: `Se cargaron <b>${minUnit.toFixed(2)} minutos/u</b> en el campo de tiempo.<br><br>👉 <b>Seleccione ahora un Colaborador</b> en el asistente para calcular el costo monetario.`,
            timer: 4000,
            showConfirmButton: true
        });
    }
};

/**
 * Despliega modal con desglose e historial completo de mediciones empíricas de planta
 */
window.abrirModalMetricasCampo = function() {
    if (!window.gp_metricas_campo_activas || !window.gp_metricas_campo_activas.tiene_metricas) {
        Swal.fire('Sin registros', 'Este artículo aún no cuenta con mediciones empíricas de planta registradas.', 'info');
        return;
    }

    const data = window.gp_metricas_campo_activas;
    const hist = data.historial || [];

    let rowsHtml = '';
    if (hist.length > 0) {
        rowsHtml = hist.map(h => {
            let fStr = '-';
            if (h.fecha) {
                const d = new Date(h.fecha);
                fStr = d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
            }
            return `
                <tr style="border-bottom: 1px solid #e2e8f0; font-size: 0.85em;">
                    <td style="padding: 6px 8px; text-align: left;">${fStr}</td>
                    <td style="padding: 6px 8px; font-weight: bold; text-align: center; color: #1e40af;">#${h.carro_id || '-'}</td>
                    <td style="padding: 6px 8px; text-align: left;">${h.usuario_nombre || 'Operario'}</td>
                    <td style="padding: 6px 8px; text-align: center; font-weight: bold;">${h.unidades || 1} u.</td>
                    <td style="padding: 6px 8px; text-align: right; color: #d97706;">${(parseFloat(h.etapa1) || 0).toFixed(2)}m</td>
                    <td style="padding: 6px 8px; text-align: right; color: #2563eb;">${(parseFloat(h.etapa2) || 0).toFixed(2)}m</td>
                    <td style="padding: 6px 8px; text-align: right; color: #7c3aed;">${(parseFloat(h.etapa3) || 0).toFixed(2)}m</td>
                    <td style="padding: 6px 8px; text-align: right; font-weight: bold; color: #047857; background: #ecfdf5;">${(parseFloat(h.minutos_unitarios) || 0).toFixed(2)}m</td>
                </tr>
            `;
        }).join('');
    } else {
        rowsHtml = `<tr><td colspan="8" style="text-align: center; padding: 12px; color: #94a3b8;">No hay registros detallados.</td></tr>`;
    }

    Swal.fire({
        title: '📊 Evidencia de Tiempos de Producción',
        html: `
            <div style="text-align: left; font-size: 0.9em; display: flex; flex-direction: column; gap: 10px;">
                <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-size: 0.82em; color: #166534; font-weight: bold; text-transform: uppercase;">Promedio General Ponderado</div>
                        <div style="font-size: 1.4em; font-weight: 800; color: #15803d;">${data.promedio_minutos_unitario.toFixed(2)} <span style="font-size: 0.65em; font-weight: normal;">minutos/unidad</span></div>
                    </div>
                    <div style="text-align: right; font-size: 0.82em; color: #166534;">
                        <div>🟡 Prep: <b>${data.promedio_etapa1.toFixed(2)}m</b></div>
                        <div>🔵 Prod: <b>${data.promedio_etapa2.toFixed(2)}m</b></div>
                        <div>🟣 Etq: <b>${data.promedio_etapa3.toFixed(2)}m</b></div>
                    </div>
                </div>

                <div style="max-height: 260px; overflow-y: auto; border: 1px solid #cbd5e1; border-radius: 6px;">
                    <table style="width: 100%; border-collapse: collapse; font-family: sans-serif;">
                        <thead style="background: #f8fafc; position: sticky; top: 0; border-bottom: 2px solid #cbd5e1; font-size: 0.78em; color: #475569;">
                            <tr>
                                <th style="padding: 6px 8px; text-align: left;">Fecha</th>
                                <th style="padding: 6px 8px; text-align: center;">Carro</th>
                                <th style="padding: 6px 8px; text-align: left;">Operario</th>
                                <th style="padding: 6px 8px; text-align: center;">Unid.</th>
                                <th style="padding: 6px 8px; text-align: right; color: #d97706;">E1 Prep</th>
                                <th style="padding: 6px 8px; text-align: right; color: #2563eb;">E2 Prod</th>
                                <th style="padding: 6px 8px; text-align: right; color: #7c3aed;">E3 Etq</th>
                                <th style="padding: 6px 8px; text-align: right; color: #047857;">Total/u</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `,
        width: 700,
        showCancelButton: true,
        confirmButtonText: `📥 Cargar Promedio (${data.promedio_minutos_unitario.toFixed(2)}m) al Asistente`,
        confirmButtonColor: '#10b981',
        cancelButtonText: 'Cerrar'
    }).then((res) => {
        if (res.isConfirmed) {
            window.aplicarMetricaCampoAsistente();
        }
    });
};

window.toggleManoObraActiva = async function(checked) {
    const costoInput = document.getElementById('gp-costo-tiempo');
    const valorNumerico = costoInput ? (parseFloat(costoInput.value) || 0) : 0;
    const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    const totalTexto = currencyFormatter.format(valorNumerico);

    if (checked) {
        if (!valorNumerico || valorNumerico <= 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Debe ingresar Mano de Obra primero',
                text: 'Seleccione un colaborador y tiempo asignado antes de activar la casilla de mano de obra.'
            });
            const check = document.getElementById('gp-mano-obra-activa');
            if (check) check.checked = false;
            return;
        }

        const result = await Swal.fire({
            title: '¿Dónde desea activar la mano de obra?',
            html: `Está activando el costo de mano de obra de <b style="color: #2563eb; font-size: 1.1em;">${totalTexto}</b>.<br><br>¿Desea aplicarlo a todas las listas de precios o solo a la lista actual?`,
            icon: 'question',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: '🌐 Aplicar a TODAS las listas',
            denyButtonText: '🎯 Solamente a ESTA lista',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#2563eb',
            denyButtonColor: '#059669',
            cancelButtonColor: '#64748b'
        });

        if (result.isConfirmed) {
            if (typeof gp_listasFinancieras !== 'undefined') {
                gp_listasFinancieras.forEach(list => {
                    list.costo_tiempo = valorNumerico;
                    list.mano_obra_activa = true;
                });
            }
        } else if (result.isDenied) {
            if (typeof gp_listasFinancieras !== 'undefined' && gp_listasFinancieras[gp_activeTabIdx]) {
                const list = gp_listasFinancieras[gp_activeTabIdx];
                list.costo_tiempo = valorNumerico;
                list.mano_obra_activa = true;
            }
        } else {
            const check = document.getElementById('gp-mano-obra-activa');
            if (check) check.checked = false;
            return;
        }
    } else {
        const result = await Swal.fire({
            title: '¿Dónde desea desactivar la mano de obra?',
            html: `¿Desea quitar el costo de mano de obra en todas las listas de precios o únicamente en la lista actual?`,
            icon: 'warning',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: '🌐 Desactivar en TODAS las listas',
            denyButtonText: '🎯 Desactivar solo en ESTA lista',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#dc2626',
            denyButtonColor: '#64748b',
            cancelButtonColor: '#94a3b8'
        });

        if (result.isConfirmed) {
            if (typeof gp_listasFinancieras !== 'undefined') {
                gp_listasFinancieras.forEach(list => {
                    list.costo_tiempo = 0;
                    list.mano_obra_activa = false;
                });
            }
        } else if (result.isDenied) {
            if (typeof gp_listasFinancieras !== 'undefined' && gp_listasFinancieras[gp_activeTabIdx]) {
                const list = gp_listasFinancieras[gp_activeTabIdx];
                list.costo_tiempo = 0;
                list.mano_obra_activa = false;
            }
        } else {
            const check = document.getElementById('gp-mano-obra-activa');
            if (check) check.checked = true;
            return;
        }
    }

    if (typeof window.sincronizarManoObraUI === 'function') window.sincronizarManoObraUI();
    if (typeof window.recalcularPreciosGestor === 'function') {
        window.recalcularPreciosGestor();
    }
};

/* ==========================================================================
   MÓDULO INTEGRADO: EDITOR DE RECETAS EN EL BÚNKER (PUERTO 3005)
   ========================================================================== */

window.gp_receta_id_existente = null;
window.gp_receta_modal_state = [];
window.gp_ingredientes_disponibles = [];

window.abrirModalRecetaBunker = async function() {
    const artId = document.getElementById('gp-articulo-id').value;
    const artNombre = document.getElementById('gp-producto').innerText;
    
    document.getElementById('gp-receta-modal-articulo-nombre').innerText = artNombre;
    window.gp_receta_modal_state = [];
    window.gp_ingredientes_disponibles = [];
    
    // Configurar visibilidad del botón de eliminar en el footer del modal
    const btnModalDel = document.getElementById('gp-receta-modal-btn-eliminar');
    if (btnModalDel) {
        btnModalDel.style.display = window.gp_receta_id_existente ? 'inline-flex' : 'none';
    }

    // Resetear inputs de carga
    document.getElementById('gp-receta-modal-selected-id').value = '';
    document.getElementById('gp-receta-modal-selected-nombre').value = '';
    document.getElementById('gp-receta-modal-selected-unidad').value = '';
    document.getElementById('gp-receta-modal-buscar-input').value = '';
    document.getElementById('gp-receta-modal-cantidad-input').value = '';
    
    const tbody = document.getElementById('gp-receta-modal-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 15px; color: #64748b; font-style: italic;">Cargando ingredientes...</td></tr>';
    }
    
    document.getElementById('gp-modal-receta').style.display = 'flex';
    
    try {
        // 1. Cargar ingredientes y packaging disponibles
        const resIng = await fetch('/api/produccion/ingredientes');
        if (!resIng.ok) throw new Error('No se pudieron cargar los ingredientes disponibles');
        window.gp_ingredientes_disponibles = await resIng.json();
        
        // 2. Cargar receta si existe
        if (window.gp_receta_id_existente) {
            const resReceta = await fetch(`/api/produccion/recetas/${encodeURIComponent(artId)}`);
            if (resReceta.ok) {
                const receta = await resReceta.json();
                window.gp_receta_modal_state = receta.ingredientes || [];
            }
        }
        
        window.renderRecetaModalTable();
    } catch (err) {
        console.error('[RECETA-MODAL] Error al abrir modal:', err);
        Swal.fire('Error', err.message || 'Error al preparar modal de recetas', 'error');
        window.cerrarModalRecetaBunker();
    }
};

window.eliminarRecetaBunkerDirecta = async function() {
    const artId = document.getElementById('gp-articulo-id').value;
    const artNombre = document.getElementById('gp-producto').innerText;

    if (!artId) {
        Swal.fire('Error', 'ID de artículo no encontrado para eliminar la receta', 'error');
        return;
    }

    const confirmRes = await Swal.fire({
        title: '¿Eliminar y Desvincular Receta?',
        html: `<p style="color: #475569;">¿Está seguro de eliminar y desvincular definitivamente la receta del artículo <strong>${artNombre}</strong> (${artId})?</p><p style="color: #ef4444; font-size: 0.88em; margin-top: 6px;">Esta acción eliminará todos los componentes asignados y restablecerá la tarjeta a <strong>Sin Receta</strong>.</p>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: '🗑️ Sí, Eliminar Receta',
        cancelButtonText: 'Cancelar'
    });

    if (!confirmRes.isConfirmed) return;

    Swal.fire({ title: 'Eliminando y desvinculando receta...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        let res = await fetch(`/api/logistica/bunker/recetas/${encodeURIComponent(artId)}`, {
            method: 'DELETE'
        });

        // Fallback a ruta de producción si el endpoint de logística retornara 404
        if (res.status === 404) {
            res = await fetch(`/api/produccion/recetas/${encodeURIComponent(artId)}`, {
                method: 'DELETE'
            });
        }

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || 'Error al eliminar la receta del servidor');
        }

        console.log(`🚨 [VIGÍA DEPURADOR - AUDITORÍA F12] Receta eliminada y desvinculada exitosamente del artículo SKU=${artId} ("${artNombre}")`);
        
        Swal.fire({
            icon: 'success',
            title: 'Receta Desvinculada',
            text: `La receta del artículo ${artNombre} ha sido eliminada y desvinculada exitosamente.`,
            timer: 2000,
            showConfirmButton: false
        });

        // Si el modal de edición de receta estaba abierto, cerrarlo
        if (typeof window.cerrarModalRecetaBunker === 'function') {
            window.cerrarModalRecetaBunker();
        }

        // Recalibrar y actualizar en caliente el Gestor de Precios
        window.gp_receta_id_existente = null;
        await window.abrirGestorPrecios(artId, artNombre, gp_ivaGlobal);

    } catch (e) {
        console.error('❌ [BUNKER-RECETAS - ERROR ELIMINANDO RECETA]:', e);
        Swal.fire('Error', e.message || 'Fallo de conexión al eliminar la receta', 'error');
    }
};

window.cerrarModalRecetaBunker = function() {
    document.getElementById('gp-modal-receta').style.display = 'none';
};

window.buscarIngredienteModalInput = function(val) {
    const listEl = document.getElementById('gp-receta-modal-resultados');
    if (!listEl) return;
    if (!val || !val.trim()) {
        listEl.style.display = 'none';
        listEl.innerHTML = '';
        return;
    }
    const cleanVal = val.toLowerCase().trim();
    const matches = (window.gp_ingredientes_disponibles || []).filter(i => 
        i.nombre.toLowerCase().includes(cleanVal) || 
        String(i.id).includes(cleanVal)
    ).slice(0, 15); // Límite de 15 coincidencias para optimizar UI

    if (matches.length === 0) {
        listEl.innerHTML = '<li style="padding: 8px; color: #94a3b8; font-style: italic; font-size: 0.9em;">Sin resultados</li>';
        listEl.style.display = 'block';
        return;
    }

    listEl.innerHTML = matches.map(c => `
        <li style="padding: 8px 10px; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 0.9em; transition: background 0.2s;" 
            onmouseover="this.style.background='#f1f5f9'" 
            onmouseout="this.style.background='white'"
            onclick="window.seleccionarIngredienteModal(${c.id}, '${c.nombre.replace(/'/g, "\\'")}', '${c.unidad_medida}')">
            ${c.nombre} <span style="font-size: 0.8em; color: #94a3b8; font-family: monospace;">(${c.unidad_medida})</span>
        </li>
    `).join('');
    listEl.style.display = 'block';
};

window.seleccionarIngredienteModal = function(id, nombre, unidad) {
    document.getElementById('gp-receta-modal-selected-id').value = id;
    document.getElementById('gp-receta-modal-selected-nombre').value = nombre;
    document.getElementById('gp-receta-modal-selected-unidad').value = unidad;
    
    document.getElementById('gp-receta-modal-buscar-input').value = nombre;
    
    const listEl = document.getElementById('gp-receta-modal-resultados');
    if (listEl) {
        listEl.style.display = 'none';
        listEl.innerHTML = '';
    }
    
    const cantInput = document.getElementById('gp-receta-modal-cantidad-input');
    if (cantInput) {
        cantInput.focus();
    }
};

window.agregarIngredienteAlLocalState = function() {
    const id = document.getElementById('gp-receta-modal-selected-id').value;
    const nombre = document.getElementById('gp-receta-modal-selected-nombre').value;
    const unidad = document.getElementById('gp-receta-modal-selected-unidad').value;
    const inputCant = document.getElementById('gp-receta-modal-cantidad-input');
    
    if (!id || !nombre) {
        Swal.fire('Error', 'Debe seleccionar un ingrediente válido del buscador', 'error');
        return;
    }
    
    const cantidad = parseFloat(inputCant.value) || 0;
    if (cantidad <= 0) {
        Swal.fire('Error', 'La cantidad debe ser mayor a cero', 'error');
        return;
    }
    
    const exists = window.gp_receta_modal_state.some(ing => Number(ing.ingrediente_id) === Number(id));
    if (exists) {
        Swal.fire('Error', 'El ingrediente ya se encuentra en la receta', 'error');
        return;
    }
    
    window.gp_receta_modal_state.push({
        ingrediente_id: parseInt(id),
        nombre_ingrediente: nombre,
        unidad_medida: unidad,
        cantidad: cantidad
    });
    
    // Limpiar inputs
    document.getElementById('gp-receta-modal-selected-id').value = '';
    document.getElementById('gp-receta-modal-selected-nombre').value = '';
    document.getElementById('gp-receta-modal-selected-unidad').value = '';
    document.getElementById('gp-receta-modal-buscar-input').value = '';
    inputCant.value = '';
    
    window.renderRecetaModalTable();
};

window.actualizarCantidadIngrediente = function(index, val) {
    const qty = parseFloat(val) || 0;
    if (qty > 0 && window.gp_receta_modal_state[index]) {
        window.gp_receta_modal_state[index].cantidad = qty;
    }
};

window.eliminarIngredienteModal = function(index) {
    if (window.gp_receta_modal_state[index]) {
        window.gp_receta_modal_state.splice(index, 1);
        window.renderRecetaModalTable();
    }
};

window.renderRecetaModalTable = function() {
    const tbody = document.getElementById('gp-receta-modal-tbody');
    if (!tbody) return;
    
    if (!window.gp_receta_modal_state || window.gp_receta_modal_state.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 15px; color: #94a3b8; font-style: italic;">Sin ingredientes en la receta</td></tr>';
        return;
    }
    
    tbody.innerHTML = window.gp_receta_modal_state.map((ing, index) => `
        <tr style="border-bottom: 1px solid #cbd5e1;">
            <td style="padding: 8px 10px; color: #1e293b; font-weight: 500;">${ing.nombre_ingrediente}</td>
            <td style="padding: 8px 10px; text-align: center;">
                <input type="number" step="0.0001" min="0.0001" value="${ing.cantidad}" oninput="window.actualizarCantidadIngrediente(${index}, this.value)" style="width: 90px; text-align: center; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; font-family: monospace;">
            </td>
            <td style="padding: 8px 10px; text-align: center; color: #64748b; font-size: 0.9em; font-weight: bold;">${ing.unidad_medida}</td>
            <td style="padding: 8px 10px; text-align: center;">
                <button type="button" onclick="window.eliminarIngredienteModal(${index})" style="background: transparent; border: none; color: #ef4444; font-size: 1.1em; cursor: pointer; padding: 4px 8px; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='transparent'">🗑️</button>
            </td>
        </tr>
    `).join('');
};

window.guardarRecetaBunker = async function() {
    const artId = document.getElementById('gp-articulo-id').value;
    const artNombre = document.getElementById('gp-producto').innerText;
    
    if (!artId) {
        Swal.fire('Error', 'ID de artículo no encontrado', 'error');
        return;
    }
    
    if (!window.gp_receta_modal_state || window.gp_receta_modal_state.length === 0) {
        Swal.fire('Error', 'Debe agregar al menos un ingrediente o packaging a la receta', 'error');
        return;
    }
    
    Swal.fire({ title: 'Guardando Receta...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    try {
        const datos = {
            articulo_numero: artId,
            descripcion: 'Receta de Búnker para ' + artNombre,
            ingredientes: window.gp_receta_modal_state.map(ing => ({
                ingrediente_id: ing.ingrediente_id,
                nombre_ingrediente: ing.nombre_ingrediente,
                unidad_medida: ing.unidad_medida,
                cantidad: Number(ing.cantidad)
            })),
            articulos: [],
            esProduccionExternaConArticuloPrincipal: false
        };
        
        const url = window.gp_receta_id_existente
            ? `/api/produccion/recetas/${encodeURIComponent(artId)}`
            : '/api/produccion/recetas';
        const method = window.gp_receta_id_existente ? 'PUT' : 'POST';
        
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos)
        });
        
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'Error al guardar la receta');
        }
        
        Swal.fire('Guardado Exitoso', 'La receta se ha guardado correctamente.', 'success');
        window.cerrarModalRecetaBunker();
        
        // Sincroniza y recarga el Gestor de Precios actual en caliente
        const ivaVal = window.gp_ivaGlobal || 21;
        await window.abrirGestorPrecios(artId, artNombre, ivaVal);
        
    } catch (err) {
        console.error('[RECETA-MODAL] Error al guardar receta:', err);
        Swal.fire('Error', err.message || 'Error al guardar la receta', 'error');
    }
};





/**
 * MODAL INTERACTIVO DE DECISIÓN DE COSTO DE RECETA (REEMPLAZAR VS SUMAR)
 */
window.inyectarCostoRecetaModal = function(costoKiloReceta) {
    if (!costoKiloReceta || isNaN(costoKiloReceta) || costoKiloReceta <= 0) {
        Swal.fire('Advertencia', 'El costo derivado de la receta de producción no es válido.', 'warning');
        return;
    }

    const fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    const costoFormateado = fmt.format(costoKiloReceta);

    const list = typeof gp_listasFinancieras !== 'undefined' ? gp_listasFinancieras[gp_activeTabIdx] : null;
    let costoActualBase = 0;
    if (list) {
        costoActualBase = list.costo_base_sobrescrito !== null 
            ? parseFloat(list.costo_base_sobrescrito) 
            : parseFloat(typeof gp_liveIngredienteCost !== 'undefined' ? gp_liveIngredienteCost : 0);
    }

    Swal.fire({
        title: 'Estructura de Receta de Producción',
        html: `
            <div style="text-align: left; font-size: 0.95em; color: #334155; line-height: 1.5;">
                <p>Costo equivalente de la receta: <strong style="color: #0284c7; font-size: 1.1em;">${costoFormateado} / kg</strong></p>
                <p style="margin-top: 8px;">¿Cómo desea aplicar este costo al Gestor de Precios?</p>
            </div>
        `,
        icon: 'question',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '🔄 Reemplazar Costo Base',
        denyButtonText: '➕ Sumar al Costo Base',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#0284c7',
        denyButtonColor: '#16a34a'
    }).then((result) => {
        if (result.isConfirmed) {
            if (typeof window.aplicarCostoBaseManual === 'function') {
                window.aplicarCostoBaseManual(costoKiloReceta);
            }
        } else if (result.isDenied) {
            const nuevoCostoTotal = (costoActualBase || 0) + costoKiloReceta;
            if (typeof window.aplicarCostoBaseManual === 'function') {
                window.aplicarCostoBaseManual(nuevoCostoTotal);
            }
        }
    });
};

/**
 * MÓDULO INTERACTIVO DE ANCLAJE Y CANDADOS DE CÁLCULO (MARGEN VS PRECIO FINAL)
 */
window.actualizarIconosCandados = function() {
    const list = typeof gp_listasFinancieras !== 'undefined' ? gp_listasFinancieras[gp_activeTabIdx] : null;
    if (!list) return;

    const btnLockMargen = document.getElementById('btn-lock-margen');
    const btnLockPrecio = document.getElementById('btn-lock-precio');

    if (list.modo_calculo === 'MANUAL') {
        // Fijar Precio Final (Opción B)
        if (btnLockMargen) {
            btnLockMargen.innerText = '🔓';
            btnLockMargen.style.opacity = '0.4';
            btnLockMargen.title = 'Margen Flotante (Haz clic para fijar Margen)';
        }
        if (btnLockPrecio) {
            btnLockPrecio.innerText = '🔒';
            btnLockPrecio.style.opacity = '1';
            btnLockPrecio.title = 'Precio Final Fijado (Haz clic para liberar Precio)';
        }
    } else {
        // Fijar Margen (Opción A - AUTOMATIC default)
        if (btnLockMargen) {
            btnLockMargen.innerText = '🔒';
            btnLockMargen.style.opacity = '1';
            btnLockMargen.title = 'Margen Fijado (Haz clic para liberar Margen)';
        }
        if (btnLockPrecio) {
            btnLockPrecio.innerText = '🔓';
            btnLockPrecio.style.opacity = '0.4';
            btnLockPrecio.title = 'Precio Final Flotante (Haz clic para fijar Precio)';
        }
    }
};

window.toggleAnclajeCalculo = async function(modoDeseado) {
    const list = typeof gp_listasFinancieras !== 'undefined' ? gp_listasFinancieras[gp_activeTabIdx] : null;
    if (!list) return;

    const lockTitle = modoDeseado === 'MARGEN' ? '🔒 Fijar Margen (Precio Flotante)' : '🔒 Fijar Precio Final (Margen Flotante)';
    const lockDesc = modoDeseado === 'MARGEN' 
        ? 'El <b>Margen de Ganancia (%)</b> quedará congelado y el Precio Final variará automáticamente ante cambios de costos.' 
        : 'El <b>Precio Final c/IVA ($)</b> quedará congelado y el Margen variará automáticamente ante cambios de costos.';

    const result = await Swal.fire({
        title: lockTitle,
        html: `<p style="font-size: 0.95em; color: #475569; margin-bottom: 12px;">${lockDesc}</p><p style="font-size: 0.9em; font-weight: bold; color: #1e293b;">¿Dónde desea aplicar esta regla de anclaje?</p>`,
        icon: 'question',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '🎯 Solo esta lista',
        denyButtonText: '🌐 Aplicar a TODAS las listas',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#2563eb',
        denyButtonColor: '#7c3aed',
        cancelButtonColor: '#64748b'
    });

    if (result.isDismissed) return;

    const applyAll = result.isDenied; // Deny button = TODAS las listas
    const targetMode = modoDeseado === 'MARGEN' ? 'AUTOMATIC' : 'MANUAL';

    if (modoDeseado === 'MARGEN') {
        const margenInput = document.getElementById('gp-margen');
        const val = margenInput ? parseFloat(margenInput.value) : NaN;
        if (applyAll) {
            (gp_listasFinancieras || []).forEach(l => {
                l.modo_calculo = 'AUTOMATIC';
            });
        } else {
            list.modo_calculo = 'AUTOMATIC';
            if (!isNaN(val)) {
                list.margen_ganancia = val;
                list.margen_porcentaje = val;
            }
        }
    } else if (modoDeseado === 'PRECIO') {
        const precioInput = document.getElementById('gp-precio-final');
        const val = precioInput ? parseFloat(precioInput.value) : NaN;
        if (applyAll) {
            (gp_listasFinancieras || []).forEach(l => {
                l.modo_calculo = 'MANUAL';
            });
        } else {
            list.modo_calculo = 'MANUAL';
            if (!isNaN(val) && val > 0) {
                list.precio_final = val;
            }
        }
    }

    if (typeof window.actualizarIconosCandados === 'function') {
        window.actualizarIconosCandados();
    }
    if (typeof window.recalcularPreciosGestor === 'function') {
        window.recalcularPreciosGestor();
    }

    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2200,
        timerProgressBar: true
    });
    Toast.fire({
        icon: 'success',
        title: applyAll 
            ? `🌐 Anclaje ${modoDeseado === 'MARGEN' ? 'Margen' : 'Precio'} fijado en TODAS las listas` 
            : `🎯 Anclaje ${modoDeseado === 'MARGEN' ? 'Margen' : 'Precio'} fijado en esta lista`
    });
};

window.abrirCalculadoraTostadero = async function(artIdCustom = null) {
    let currentData = window.gp_current_articulo_data;

    const domArtId = document.getElementById('gp-articulo-id') ? document.getElementById('gp-articulo-id').value : null;
    const domNombre = document.getElementById('gp-producto') ? document.getElementById('gp-producto').innerText : null;

    const activeArtId = artIdCustom || (currentData ? currentData.articulo_id : null) || domArtId;

    if (!activeArtId) {
        Swal.fire({
            icon: 'warning',
            title: 'No hay artículo cargado',
            text: 'Primero debe seleccionar un artículo consolidado válido antes de simular el tostadero.'
        });
        return;
    }

    if (!currentData || currentData.articulo_id !== activeArtId) {
        currentData = {
            articulo_id: activeArtId,
            nombre: domNombre || activeArtId,
            descripcion: domNombre || activeArtId,
            costo_base: window.gp_liveIngredienteCost || 0,
            costo_integrado: window.gp_liveIngredienteCost || 0
        };
        window.gp_current_articulo_data = currentData;
    }

    const skuSalida = currentData.articulo_id || currentData.articulo_numero || activeArtId || currentData.nombre || currentData.descripcion;
    console.log(`🔍 [HARD-DEBUG SIMULADOR TOSTADERO] skuSalida: "${skuSalida}" (activeArtId: "${activeArtId}")`);

    Swal.fire({
        title: 'Cargando datos de simulación...',
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    try {
        // 1. Obtener mermas e historial inicial del backend
        const resMermas = await fetch(`/api/logistica/bunker/mermas-historicas?sku_salida=${encodeURIComponent(skuSalida)}`);
        const mermasData = await resMermas.json();
        console.log("🔍 [HARD-DEBUG SIMULADOR TOSTADERO] mermasData response:", mermasData);

        // 2. Obtener colaboradores activos
        const resColab = await fetch('/api/logistica/usuarios/tarifas');
        const colaboradoresRes = await resColab.json();
        const colaboradores = colaboradoresRes.data || [];

        // 2.5 Obtener ingredientes locales para la Tabla Maestra de autocompletado
        let ingredientesListaMaestra = [];
        try {
            const resIngs = await fetch('/api/produccion/ingredientes');
            if (resIngs.ok) {
                ingredientesListaMaestra = await resIngs.json();
            }
        } catch (errIngs) {
            console.error("Error al cargar ingredientes locales:", errIngs);
        }
        
        const simSaved = (currentData.propiedades_dinamicas && currentData.propiedades_dinamicas.tostadero_simulacion) 
            ? currentData.propiedades_dinamicas.tostadero_simulacion 
            : null;

        // 2.7 Obtener ingredientes de la Unidad Productiva vinculada al artículo simulado
        const skuParaReceta = mermasData.sku_entrada || skuSalida;
        let ingredientesUp = [];
        try {
            const resUp = await fetch(`/api/produccion/recetas/hibridas/nativa/${encodeURIComponent(skuParaReceta)}`);
            if (resUp.ok) {
                const dataUp = await resUp.json();
                if (dataUp.enlazado && dataUp.ingredientes && dataUp.ingredientes.length > 0) {
                    ingredientesUp = dataUp.ingredientes.map(ing => ({
                        ingrediente_id: ing.articulo_id,
                        nombre_ingrediente: ing.descripcion,
                        cantidad: parseFloat(ing.cantidad_por_kilo_base),
                        costo_patron: parseFloat(ing.costo_base) || 0,
                        es_ratio_api: true
                    }));
                }
            }
        } catch (errUp) {
            console.error("Error al cargar ingredientes de la Unidad Productiva:", errUp);
        }
        
        const defaultColabId = simSaved ? simSaved.colaborador_id : (window.gp_current_articulo_data ? window.gp_current_articulo_data.asistente_colaborador_id : '');

        Swal.close();

        // Formateador de moneda local
        const currencyFormatterLocal = new Intl.NumberFormat('es-AR', {
            style: 'currency',
            currency: 'ARS',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        // Estructura de variables en caliente (Dominios Desacoplados v5.43c)
        let currentSkuEntrada = mermasData.sku_nexo_ingrediente || mermasData.sku_entrada || '';
        let currentDescripcionCrudo = mermasData.descripcion_nexo_generada || mermasData.descripcion_entrada || mermasData.sku_entrada || 'Sin vincular';
        let currentCostoCrudo = simSaved ? parseFloat(simSaved.costo_crudo) : 0; // Por Kilo
        let currentTarifa = simSaved ? parseFloat(simSaved.tarifa) : 0;
        let currentMerma = simSaved ? parseFloat(simSaved.merma) : (mermasData.merma_promedio || 0.00);
        let currentKilosUnidad = 1.00;
        let cotizacionMaestraSeleccionada = null;
        
        // 🔑 HITO A (Fase 3 - v5.44): INGESTA DINÁMICA DE COSTO BASE DE MATERIA PRIMA (Caja 2)
        if (mermasData && mermasData.ingesta_financiera_caja_2 && parseFloat(mermasData.ingesta_financiera_caja_2.costo_kilo_sugerido) > 0) {
            currentCostoCrudo = parseFloat(mermasData.ingesta_financiera_caja_2.costo_kilo_sugerido);
        } else {
            const skuOrigenFinanzas = currentSkuEntrada || mermasData.sku_entrada || 'MPB';
            try {
                const resFinCrudo = await fetch(`/api/logistica/bunker/finanzas/${encodeURIComponent(skuOrigenFinanzas)}`);
                if (resFinCrudo.ok) {
                    const jsonFin = await resFinCrudo.json();
                    const finData = jsonFin.data || jsonFin;
                    if (finData && Array.isArray(finData.listas_margenes) && finData.listas_margenes.length > 0) {
                        const listaValida = finData.listas_margenes.find(l => l.disponible === true || l.es_patron === true) || finData.listas_margenes[0];
                        currentCostoCrudo = parseFloat(listaValida.costo_base_sobrescrito) || 0;
                    }
                }
            } catch (errFin) {
                console.error("⚠️ Error al sincronizar costo origen desde Finanzas:", errFin);
            }
        }
        
        // Etapa 1 (Insumos Húmedos pre-horno de UP)
        let currentIngredientesExtra = (ingredientesUp && ingredientesUp.length > 0) 
            ? [...ingredientesUp] 
            : (simSaved && simSaved.ingredientes_extra ? simSaved.ingredientes_extra : []);

        // Etapa 2 (Insumos Secos post-horno de Fraccionado)
        let currentAgregadosPostHorno = [];
        if (mermasData.ingredientes_extra && mermasData.ingredientes_extra.length > 0) {
            currentAgregadosPostHorno = mermasData.ingredientes_extra.map(ing => ({
                ingrediente_id: ing.ingrediente_id,
                nombre_ingrediente: ing.nombre_ingrediente,
                cantidad: parseFloat(ing.cantidad),
                costo_patron: parseFloat(ing.costo_patron) || 0,
                es_ratio_api: true
            }));
        }

        let isFirstLoad = true;

        // Construir HTML del modal expandido interactivo de dos columnas
        const formHtml = `
            <div style="display: flex; gap: 20px; text-align: left; font-family: sans-serif; color: #1e293b;">
                <!-- COLUMNA IZQUIERDA: Materia Prima y Selección de Costo -->
                <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 15px;">
                    <!-- Paso 1: Materia Prima -->
                    <div>
                        <label style="font-weight: bold; display: block; margin-bottom: 5px; color: #334155; font-size: 0.95em;">1. Materia Prima Entrada</label>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; font-size: 0.88em; color: #475569;">
                            <div style="font-weight: 600; color: #0f172a;">${currentDescripcionCrudo}</div>
                            <div style="font-size: 0.85em; color: #64748b;" id="sim_lbl_kilos_unidad">Cargando kilos por bulto...</div>
                        </div>
                    </div>

                    <!-- Paso 1.5: Insumos Secundarios / Adicionales de Entrada (Pre-Horno) -->
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <label style="font-weight: bold; color: #334155; font-size: 0.95em; margin: 0;">1.5 Insumos Secundarios (Pre-Horno)</label>
                            <button type="button" id="sim_btn_agregar_insumo" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; border-radius: 4px; padding: 2px 8px; font-size: 0.8em; font-weight: 600; cursor: pointer;">+ Agregar Insumo</button>
                        </div>
                        <div id="sim_insumos_adicionales_container" style="display: flex; flex-direction: column; gap: 8px;"></div>
                    </div>

                    <!-- Paso 2: Fuente de Costo Reposición -->
                    <div>
                        <label style="font-weight: bold; display: block; margin-bottom: 6px; color: #334155; font-size: 0.95em;">2. Costo Base de Materia Prima Cruda ($/kg)</label>
                        <input type="number" id="sim_costo_manual_input" step="0.01" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.9em; font-weight: bold;" placeholder="0.00" value="${currentCostoCrudo > 0 ? currentCostoCrudo.toFixed(2) : ''}">
                        
                        <!-- 🔑 DESGLOSE DE FUNDAMENTALS DE CAJA 2 (v5.46) -->
                        <div id="sim_desglose_fundamentals_caja2" style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 6px 10px; margin-top: 6px; font-size: 0.81em; color: #166534; display: flex; flex-direction: column; gap: 3px;">
                            <div style="font-weight: 700; display: flex; justify-content: space-between; border-bottom: 1px solid #bbf7d0; padding-bottom: 3px; margin-bottom: 2px;">
                                <span>💡 Desglose de Costo Base Operativo:</span>
                                <span id="sim_lbl_fund_total">$ 0,00 / kg</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; color: #15803d;">
                                <span>• Formulación Insumos Crudos:</span>
                                <span id="sim_lbl_fund_insumos">$ 0,00 / kg</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; color: #15803d;">
                                <span>• MO Intrínseca (Amasado/Envasado):</span>
                                <span id="sim_lbl_fund_mo_int">$ 0,00 / kg</span>
                            </div>
                            <div id="sim_lbl_fund_bulto_detalle" style="font-size: 0.78em; color: #166534; font-style: italic; margin-top: 2px;">
                                📦 Equivalente a <strong>$ 0,00</strong> por bulto de 1,00 kg.
                            </div>
                        </div>

                        <div style="margin-top: 8px; border-top: 1px dashed #cbd5e1; padding-top: 8px; display: flex; flex-direction: column; gap: 6px;">
                            <span style="font-size: 0.85em; font-weight: bold; color: #475569;">📡 Catálogo de Cotizaciones (Supabase):</span>
                            <div id="sim_contenedor_fuentes_costo" style="margin-top: 4px; display: flex; flex-direction: column; gap: 4px;"></div>
                            <button type="button" id="sim_btn_buscar_tabla_maestra" class="swal2-confirm swal2-styled" style="background-color: #0284c7; margin: 0; padding: 8px 12px; font-size: 0.88em; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: bold;">
                                <span>🔍 Buscar en Tabla Maestra</span>
                            </button>
                        </div>
                    </div>

                    <!-- Paso 3: Colaborador y Liquidación de Servicio -->
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <label style="font-weight: bold; color: #334155; font-size: 0.95em; margin: 0;">3. Colaborador y Liquidación de Servicio</label>
                        </div>
                        
                        <!-- Nivel 1: Selector de Colaborador -->
                        <div style="margin-bottom: 8px;">
                            <span style="font-size: 0.82em; color: #64748b; display: block; margin-bottom: 3px;">Nivel 1: Operario / Colaborador</span>
                            <select id="sim_colaborador" style="width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; background: white; font-size: 0.9em;">
                                <option value="" selected disabled>Seleccione Colaborador...</option>
                                ${colaboradores.map(c => `<option value="${c.usuario_id}">${c.nombre_completo || c.usuario} (Base: $ ${c.valor_hora || '0,00'})\x3C/option>`).join('')}
                            </select>
                        </div>

                        <!-- Nivel 2: Selector de Servicio (Tarifario en Cascada) -->
                        <div style="margin-bottom: 8px;">
                            <span style="font-size: 0.82em; color: #64748b; display: block; margin-bottom: 3px;">Nivel 2: Servicio / Tarifario Parametrizado</span>
                            <select id="sim_servicio_select" disabled style="width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; background: #f1f5f9; font-size: 0.9em;">
                                <option value="">Seleccione primero un colaborador...</option>
                            </select>
                        </div>

                        <!-- Nivel 3: Inyección y Visibilidad Transparente de Tarifa -->
                        <div style="display: flex; align-items: center; gap: 10px; margin-top: 6px;">
                            <span id="sim_lbl_tarifa_tipo" style="font-size: 0.85em; color: #475569;">Tarifa Servicio ($/un):</span>
                            <input type="number" id="sim_tarifa_input" step="0.01" style="width: 110px; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.9em; font-weight: bold; color: #1e3a8a;" placeholder="0.00" value="${currentTarifa > 0 ? currentTarifa.toFixed(2) : ''}" oninput="if(typeof window.recalcularSimulacionTostadero === 'function') window.recalcularSimulacionTostadero();">
                            
                            <span style="font-size: 0.85em; color: #475569;">Unidades:</span>
                            <input type="number" id="sim_unidades_producidas" step="1" style="width: 80px; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.9em; font-weight: bold; text-align: center;" value="96" oninput="if(typeof window.recalcularSimulacionTostadero === 'function') window.recalcularSimulacionTostadero();">
                        </div>
                        <div id="sim_lbl_tarifa_detalle" style="background: #e0f2fe; border: 1px solid #bae6fd; border-radius: 6px; padding: 6px 10px; font-size: 0.82em; color: #0369a1; margin-top: 8px; font-weight: bold;">
                            💼 Seleccione un colaborador y servicio para calcular la liquidación.
                        </div>
                    </div>
                </div>

                <!-- COLUMNA DERECHA: Historial de Cocciones y Pizarra Final -->
                <div style="flex: 1.1; min-width: 0; display: flex; flex-direction: column; gap: 15px;">
                    <!-- Paso 4: Historial de Mermas -->
                    <div>
                        <label style="font-weight: bold; display: block; margin-bottom: 6px; color: #334155; font-size: 0.95em;">4. Historial de Cocciones Recientes (Haga clic para seleccionar)</label>
                        <div style="background: white; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; max-height: 150px; overflow-y: auto;">
                            <table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">
                                <thead>
                                    <tr style="background: #f1f5f9; border-bottom: 1px solid #cbd5e1; color: #475569; text-align: left;">
                                        <th style="padding: 6px 8px;">Fecha</th>
                                        <th style="padding: 6px 8px;">Carro</th>
                                        <th style="padding: 6px 8px; text-align: right;">Entrada</th>
                                        <th style="padding: 6px 8px; text-align: right;">Salida</th>
                                        <th style="padding: 6px 8px; text-align: right;">Merma %</th>
                                    </tr>
                                </thead>
                                <tbody id="sim_tabla_mermas_body">
                                    <tr><td colspan="5" style="text-align: center; padding: 10px; color: #64748b;">Cargando historial...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Paso 5: Merma Simulación -->
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <label style="font-weight: bold; color: #334155; font-size: 0.95em; margin: 0;">5. Merma Simulación (%)</label>
                            <div style="display: flex; gap: 6px;">
                                <button type="button" id="sim_btn_merma_promedio" style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 3px 8px; font-size: 0.78em; cursor: pointer;">Promedio</button>
                                <button type="button" id="sim_btn_merma_ultimo" style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 3px 8px; font-size: 0.78em; cursor: pointer;">Último</button>
                                <button type="button" id="sim_btn_anular_merma" style="background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; border-radius: 4px; padding: 3px 8px; font-size: 0.78em; font-weight: bold; cursor: pointer;">⚡ Anular Merma (0%)</button>
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input type="number" id="sim_merma_input" step="0.01" style="width: 100px; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.95em; font-weight: bold;" value="${currentMerma.toFixed(2)}">
                            <span style="font-weight: bold; color: #475569;">%</span>
                            <span id="sim_lbl_historial_res" style="font-size: 0.8em; color: #64748b; margin-left: 8px;"></span>
                        </div>
                    </div>

                    <!-- Paso 6: Agregados Secos Post-Horno (Merma 0%) -->
                    <div style="background: #fdf4ff; border: 1px solid #f5d0fe; border-radius: 8px; padding: 10px;">
                        <label style="font-weight: bold; display: block; margin-bottom: 6px; color: #86198f; font-size: 0.95em;">6. Agregados Secos Post-Horno (Merma 0%)</label>
                        <div id="sim_insumos_posthorno_container" style="display: flex; flex-direction: column; gap: 8px;"></div>
                    </div>

                    <!-- Paso 7: Pizarra de Resultados (Modelo Operaciones Dinámico) -->
                    <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px; margin-top: auto;">
                        <h4 style="margin: 0 0 8px 0; color: #1e3a8a; font-size: 1.02em; display: flex; align-items: center; gap: 4px; border-bottom: 1px solid #bfdbfe; padding-bottom: 4px;">📊 Pizarra de Liquidación Final</h4>
                        <div style="display: flex; flex-direction: column; gap: 5px; font-size: 0.88em; color: #1e40af;">
                            <div style="display: flex; justify-content: space-between;">
                                <span>Costo Materia Prima Cruda:</span>
                                <span id="sim_lbl_desglose_crudo">$ 0,00 / kg</span>
                            </div>
                            <div id="sim_contenedor_desglose_extras" style="display: none; flex-direction: column; gap: 3px; font-size: 0.82em; color: #475569; padding-left: 10px; border-left: 2px solid #bfdbfe; margin: 4px 0;">
                            </div>
                            <div style="display: flex; justify-content: space-between; padding-top: 4px; border-top: 1px dashed #bfdbfe;">
                                <span>💵 Inversión Total Tanda (MP + MO):</span>
                                <span id="sim_lbl_inversion_total" style="font-weight: bold; color: #0f172a;">$ 0,00</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>⚖️ Costo Crudo por Kilo Total:</span>
                                <span id="sim_lbl_costo_crudo_kg" style="font-weight: bold; color: #1e40af;">$ 0,00 / kg</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #bfdbfe; padding-bottom: 4px;">
                                <span>🔥 Divisor Factor Rendimiento (<span id="sim_lbl_rendimiento_pct">100</span>% Rend.):</span>
                                <span id="sim_lbl_factor_rendimiento" style="font-weight: bold; color: #2563eb;">0,0000</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 1.2em; font-weight: bold; color: #1e3a8a; margin-top: 5px; border-top: 2px solid #bfdbfe; padding-top: 5px;">
                                <span id="sim_lbl_costo_final_titulo">Costo Base Simulado:</span>
                                <span id="sim_lbl_costo_final">$ 0,00 / kg</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const isUP = !!(mermasData && mermasData.is_unidad_productiva && mermasData.sku_up);
        const skuUP = isUP ? mermasData.sku_up : skuSalida;
        const nombreOficialUP = isUP 
            ? (mermasData.descripcion_up_generada || mermasData.descripcion_salida) 
            : (currentData.descripcion_generada || currentData.descripcion || currentDescripcionCrudo || skuSalida);

        const tituloModalDinamico = isUP 
            ? `🏭 Unidad Productiva: ${nombreOficialUP}` 
            : `🔥 Calculadora de Tostadero y Cocciones (${nombreOficialUP})`;

        const { value: finalCostoSimulado } = await Swal.fire({
            title: tituloModalDinamico,
            html: formHtml,
            width: '950px',
            showCancelButton: true,
            confirmButtonText: '💾 Inyectar Costo Base',
            cancelButtonText: 'Cerrar',
            focusConfirm: false,
            didOpen: () => {
                // Escalar ratios basado en la masa base unitaria (Etapa 1)
                window.escalarRatiosSecundarios = (masaBaseKg) => {
                    const containerPre = document.getElementById('sim_insumos_adicionales_container');
                    if (containerPre) {
                        containerPre.querySelectorAll('.sim-insumo-row').forEach(row => {
                            const qtyInput = row.querySelector('.sim-insumo-qty-input');
                            const searchInput = row.querySelector('.sim-insumo-search-input');
                            const subtotalLbl = row.querySelector('.sim-insumo-subtotal-lbl');
                            
                            if (qtyInput && qtyInput.getAttribute('data-is-ratio') === 'true') {
                                const baseRatio = parseFloat(qtyInput.getAttribute('data-base-ratio')) || 0;
                                const newQty = baseRatio * masaBaseKg;
                                qtyInput.value = Number(newQty.toFixed(3));
                                
                                if (searchInput && subtotalLbl) {
                                    const cost = parseFloat(searchInput.getAttribute('data-costo')) || 0;
                                    subtotalLbl.innerText = currencyFormatterLocal.format(newQty * cost);
                                }
                            }
                        });
                    }
                };

                // Agregar fila de insumo secundario
                window.agregarFilaInsumoSecundario = (data = null, skipRecalculate = false) => {
                    const ingName = data ? data.nombre_ingrediente : '';
                    const ingId = data ? (data.ingrediente_id || '') : '';
                    const initialQty = data ? parseFloat(data.cantidad) || 0 : 0;
                    const ingCost = data ? parseFloat(data.costo_patron) || 0 : 0;
                    const initialSubtotal = initialQty * ingCost;
                    const isRatioApi = (data && data.es_ratio_api) ? 'true' : 'false';
                    const baseRatio = data ? (initialQty / (currentKilosUnidad || 1)) : 0;
                    const initialQtyFormatted = data ? Number(initialQty.toFixed(3)) : '';

                    const containerId = (data && data.es_ratio_api && currentAgregadosPostHorno.some(p => String(p.ingrediente_id) === String(ingId)))
                        ? 'sim_insumos_posthorno_container'
                        : 'sim_insumos_adicionales_container';

                    const targetContainer = document.getElementById(containerId);
                    if (!targetContainer) return;

                    const rowDiv = document.createElement('div');
                    rowDiv.className = 'sim-insumo-row';
                    rowDiv.style.cssText = 'display: flex; align-items: center; gap: 8px; background: white; padding: 6px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box;';

                    rowDiv.innerHTML = `
                        <div style="flex: 1.8; position: relative; min-width: 120px;">
                            <input type="text" class="sim-insumo-search-input" placeholder="Buscar ingrediente..." style="width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 8px; box-sizing: border-box; font-size: 0.85em;" value="${ingName}">
                            <input type="hidden" class="sim-insumo-id-val" value="${ingId}">
                            <div class="sim-insumo-search-results" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #cbd5e1; border-radius: 0 0 6px 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10100; max-height: 150px; overflow-y: auto; box-sizing: border-box;"></div>
                        </div>
                        <div style="flex: 1.4; display: flex; align-items: center; gap: 4px; min-width: 105px;">
                            <input type="number" class="sim-insumo-qty-input" step="0.001" placeholder="Cant." style="width: 85px; min-width: 75px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 6px; box-sizing: border-box; font-size: 0.88em; text-align: right; font-weight: 500;" value="${initialQtyFormatted}" data-is-ratio="${isRatioApi}" data-base-ratio="${baseRatio}" oninput="this.setAttribute('data-is-ratio', 'false'); if(typeof window.recalcularSimulacionTostadero === 'function') window.recalcularSimulacionTostadero();">
                            <span style="font-size: 0.85em; color: #475569; font-weight: 500;">kg</span>
                        </div>
                        ${containerId === 'sim_insumos_posthorno_container' ? `
                        <div style="flex: 1.6; font-size: 0.82em; color: #86198f; text-align: right; line-height: 1.2; min-width: 110px;">
                            <div class="sim-insumo-unit-cost-lbl" style="display: none;">$ ${ingCost.toFixed(2)}/kg</div>
                            <div class="sim-insumo-subtotal-lbl" style="color: #86198f; font-size: 0.88em; font-weight: 600;">(Merma 0%)</div>
                        </div>
                        ` : `
                        <div style="flex: 1.6; font-size: 0.82em; color: #334155; text-align: right; line-height: 1.2; min-width: 110px;">
                            <div class="sim-insumo-unit-cost-lbl" style="color: #64748b; font-size: 0.88em;">$ ${ingCost.toFixed(2)}/kg</div>
                            <div class="sim-insumo-subtotal-lbl" style="font-weight: bold; color: #0f172a;">${currencyFormatterLocal.format(initialSubtotal)}</div>
                        </div>
                        `}
                        <button type="button" class="sim-btn-remove-row" style="background: none; border: none; color: #ef4444; font-weight: bold; font-size: 1.1em; cursor: pointer; padding: 0 4px;">✕</button>
                    `;

                    targetContainer.appendChild(rowDiv);

                    // Configurar autocompletado e interacciones
                    const searchInput = rowDiv.querySelector('.sim-insumo-search-input');
                    const resultsDiv = rowDiv.querySelector('.sim-insumo-search-results');
                    const idInput = rowDiv.querySelector('.sim-insumo-id-val');
                    const qtyInput = rowDiv.querySelector('.sim-insumo-qty-input');
                    const unitCostLbl = rowDiv.querySelector('.sim-insumo-unit-cost-lbl');
                    const subtotalLbl = rowDiv.querySelector('.sim-insumo-subtotal-lbl');
                    const btnRemove = rowDiv.querySelector('.sim-btn-remove-row');

                    if (searchInput && resultsDiv) {
                        searchInput.addEventListener('input', () => {
                            const q = searchInput.value.toLowerCase().trim();
                            if (!q) {
                                resultsDiv.style.display = 'none';
                                return;
                            }
                            const matches = (ingredientesListaMaestra || []).filter(i => 
                                (i.nombre && i.nombre.toLowerCase().includes(q)) || 
                                (i.descripcion && i.descripcion.toLowerCase().includes(q))
                            ).slice(0, 10);

                            if (matches.length === 0) {
                                resultsDiv.style.display = 'none';
                                return;
                            }

                            let html = '';
                            matches.forEach(m => {
                                const cVal = parseFloat(m.costo_patron) || parseFloat(m.costo_base) || 0;
                                html += `<div class="sim-search-item" data-id="${m.id || m.articulo_id}" data-nombre="${m.nombre || m.descripcion}" data-costo="${cVal}" style="padding: 6px 8px; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 0.85em;">
                                    <strong style="color: #0f172a;">${m.nombre || m.descripcion}</strong>
                                    <div style="font-size: 0.8em; color: #64748b;">$ ${cVal.toFixed(2)}/kg</div>
                                </div>`;
                            });
                            resultsDiv.innerHTML = html;
                            resultsDiv.style.display = 'block';

                            resultsDiv.querySelectorAll('.sim-search-item').forEach(item => {
                                item.addEventListener('click', () => {
                                    const id = item.getAttribute('data-id');
                                    const nombre = item.getAttribute('data-nombre');
                                    const costo = parseFloat(item.getAttribute('data-costo')) || 0;

                                    searchInput.value = nombre;
                                    searchInput.setAttribute('data-costo', costo);
                                    idInput.value = id;
                                    resultsDiv.style.display = 'none';

                                    if (unitCostLbl) unitCostLbl.innerText = `$ ${costo.toFixed(2)}/kg`;
                                    if (typeof window.recalcularSimulacionTostadero === 'function') {
                                        window.recalcularSimulacionTostadero();
                                    }
                                });
                            });
                        });
                    }

                    if (btnRemove) {
                        btnRemove.addEventListener('click', () => {
                            rowDiv.remove();
                            if (typeof window.recalcularSimulacionTostadero === 'function') {
                                window.recalcularSimulacionTostadero();
                            }
                        });
                    }

                    if (data && data.costo_patron) {
                        searchInput.setAttribute('data-costo', data.costo_patron);
                    }

                    if (!skipRecalculate && typeof window.recalcularSimulacionTostadero === 'function') {
                        window.recalcularSimulacionTostadero();
                    }
                };

                window.recalcularSimulacionTostadero = () => {
                    const mermaVal = parseFloat(document.getElementById('sim_merma_input').value) || 0;
                    const tarifaVal = parseFloat(document.getElementById('sim_tarifa_input').value) || 0;
                    
                    const rend = 1 - (mermaVal / 100);
                    
                    // 1. Recopilar Etapa 1 (Húmedos Pre-Horno)
                    const activeIngredients = [];
                    let sumQtyExtra = 0;
                    let sumCostExtra = 0;

                    const container = document.getElementById('sim_insumos_adicionales_container');
                    const rows = container ? container.querySelectorAll('.sim-insumo-row') : [];
                    rows.forEach(r => {
                        const nameInp = r.querySelector('.sim-insumo-search-input');
                        const idInp = r.querySelector('.sim-insumo-id-val');
                        const qtyInp = r.querySelector('.sim-insumo-qty-input');

                        const name = nameInp ? nameInp.value.trim() : '';
                        const id = idInp ? idInp.value : '';
                        const qty = qtyInp ? parseFloat(String(qtyInp.value).replace(',', '.')) || 0 : 0;
                        const cost = nameInp ? parseFloat(nameInp.getAttribute('data-costo')) || 0 : 0;

                        if (name) {
                            activeIngredients.push({ ingrediente_id: id || null, nombre_ingrediente: name, cantidad: qty, costo_patron: cost });
                            sumQtyExtra += qty;
                            sumCostExtra += qty * cost;
                        }
                    });

                    // A) Horneable & Salida de Horno (Redondeo explícito a 2 decimales)
                    const masaHorneable = currentKilosUnidad + sumQtyExtra;
                    const costoTotalHorneable = (currentKilosUnidad * currentCostoCrudo) + sumCostExtra;
                    const masaSalidaHorno = Number((masaHorneable * rend).toFixed(2));

                    // 2. Recopilar & Escalar Etapa 2 (Secos Post-Horno sobre Masa Salida Horno)
                    const activePostHorno = [];
                    let sumQtyPostHorno = 0;
                    let sumCostPostHorno = 0;

                    const containerPost = document.getElementById('sim_insumos_posthorno_container');
                    const rowsPost = containerPost ? containerPost.querySelectorAll('.sim-insumo-row') : [];
                    
                    // Escalar ratios dinámicamente multiplicando por la Salida de Horno limpia
                    rowsPost.forEach(r => {
                        const qtyInp = r.querySelector('.sim-insumo-qty-input');
                        if (qtyInp && qtyInp.getAttribute('data-is-ratio') === 'true') {
                            const baseRatio = parseFloat(qtyInp.getAttribute('data-base-ratio')) || 0;
                            const newQty = baseRatio * masaSalidaHorno;
                            qtyInp.value = Number(newQty.toFixed(3));
                        }
                    });

                    rowsPost.forEach(r => {
                        const nameInp = r.querySelector('.sim-insumo-search-input');
                        const idInp = r.querySelector('.sim-insumo-id-val');
                        const qtyInp = r.querySelector('.sim-insumo-qty-input');

                        const name = nameInp ? nameInp.value.trim() : '';
                        const id = idInp ? idInp.value : '';
                        const qty = qtyInp ? parseFloat(String(qtyInp.value).replace(',', '.')) || 0 : 0;
                        const cost = nameInp ? parseFloat(nameInp.getAttribute('data-costo')) || 0 : 0;

                        if (name) {
                            activePostHorno.push({ ingrediente_id: id || null, nombre_ingrediente: name, cantidad: qty, costo_patron: cost });
                            sumQtyPostHorno += qty;
                            sumCostPostHorno += qty * cost;
                        }
                    });

                    currentIngredientesExtra = activeIngredients;
                    currentAgregadosPostHorno = activePostHorno;

                    // 🔑 MOTOR DUAL DE MANO DE OBRA (BIFURCACIÓN GRANEL vs UNIDAD) - v5.64
                    const modoUnidadCheck = document.getElementById('gp-tostadero-modo-unidad-check') || document.getElementById('sim_modo_unidad_check');
                    const esModoUnidad = modoUnidadCheck ? modoUnidadCheck.checked : false;
                    const unidadesProdInp = document.getElementById('sim_unidades_producidas');
                    const unidadesProd = unidadesProdInp ? (parseFloat(unidadesProdInp.value) || 1) : 1;
                    
                    // Vector B (v5.64): Bloqueo DOM del Input de Unidades en Modo Granel
                    if (unidadesProdInp) {
                        if (esModoUnidad) {
                            unidadesProdInp.disabled = false;
                            unidadesProdInp.readOnly = false;
                            unidadesProdInp.style.opacity = '1';
                        } else {
                            unidadesProdInp.disabled = true;
                            unidadesProdInp.readOnly = true;
                            unidadesProdInp.style.opacity = '0.5';
                        }
                    }

                    const masaFinalTerminada = masaSalidaHorno + sumQtyPostHorno;
                    let manoObraTotalVal = 0;

                    if (esModoUnidad) {
                        // Modo Unidad Productiva (Maquila): MO = Tarifa_Unidad * Unidades (Multiplicador por kilos desactivado)
                        manoObraTotalVal = tarifaVal * unidadesProd;
                    } else {
                        // Modo Granel: MO = Tarifa_Kilo * Kilos_Salida (Masa Final con agregados)
                        manoObraTotalVal = tarifaVal * masaFinalTerminada;
                    }
                    
                    // D) Cascada Dinámica de Operaciones (Inversion_Total / Kilos_Entrada / Factor_Rendimiento) - Bifurcación v5.64
                    const factorRendimiento = Math.max(0.0001, rend);
                    let inversionTotalTanda = 0;

                    if (esModoUnidad) {
                        // 🔒 FLUJO POR PIEZAS (BARRITAS - FASE 1 INMUTABLE): Incluye costo monetario de agregados post-horno si existiera
                        inversionTotalTanda = costoTotalHorneable + manoObraTotalVal + sumCostPostHorno;
                    } else {
                        // 🥣 FLUJO GRANEL (GRANOLAS - FASE 2 RECTIFICADO): Agregados secos post-horno aportan KILOS (para MO) pero $0.00 PESOS en Inversión Total Tostadero
                        inversionTotalTanda = costoTotalHorneable + manoObraTotalVal;
                    }

                    const costoUnitarioPorPieza = unidadesProd > 0 ? (inversionTotalTanda / unidadesProd) : 0;
                    
                    // 🔑 BIFURCACIÓN DE COSTO POR KILO (UNIDAD vs GRANEL CONCENTRADO) - v5.65
                    let costoFinalPorKilo = 0;
                    if (esModoUnidad) {
                        // 🔒 FLUJO POR PIEZAS (BARRITAS - FASE 1 INMUTABLE):
                        costoFinalPorKilo = masaFinalTerminada > 0 ? (inversionTotalTanda / masaFinalTerminada) : 0;
                    } else {
                        // 🥣 FLUJO GRANEL (GRANOLAS - COSTO BASE CONCENTRADO v5.65):
                        // Se divide por masaSalidaHorno (la masa que sufrió la merma) para evitar la doble dilución en Búnker
                        const masaBaseHorneadaReal = Math.max(0.0001, masaSalidaHorno);
                        costoFinalPorKilo = masaBaseHorneadaReal > 0 ? (inversionTotalTanda / masaBaseHorneadaReal) : 0;
                    }

                    // Actualizar Pizarra UI con Visibilidad Transparente de Tarifa ($175/un)
                    document.getElementById('sim_lbl_desglose_crudo').innerText = currencyFormatterLocal.format(currentCostoCrudo) + ' / kg';

                    // 🔑 FASE 3 ETAPA FINAL (v5.46): Actualizar Desglose de Fundamentals de Caja 2 (es-AR)
                    if (mermasData && mermasData.ingesta_financiera_caja_2) {
                        const ingFin = mermasData.ingesta_financiera_caja_2;
                        const cTotal = parseFloat(ingFin.costo_kilo_sugerido) || currentCostoCrudo;
                        const cPuro = parseFloat(ingFin.costo_kilo_insumos_puro) || cTotal;
                        const cMoInt = parseFloat(ingFin.costo_tiempo_mo_kilo) || 0;
                        const kgBulto = parseFloat(ingFin.kilos_bulto) || 1.00;
                        const cBultoTotal = parseFloat(ingFin.costo_bulto_total) || (cTotal * kgBulto);

                        const elTotal = document.getElementById('sim_lbl_fund_total');
                        const elInsumos = document.getElementById('sim_lbl_fund_insumos');
                        const elMoInt = document.getElementById('sim_lbl_fund_mo_int');
                        const elBultoDet = document.getElementById('sim_lbl_fund_bulto_detalle');

                        if (elTotal) elTotal.innerText = `${currencyFormatterLocal.format(cTotal)} / kg`;
                        if (elInsumos) elInsumos.innerText = `${currencyFormatterLocal.format(cPuro)} / kg`;
                        if (elMoInt) elMoInt.innerText = `${currencyFormatterLocal.format(cMoInt)} / kg`;
                        if (elBultoDet) {
                            elBultoDet.innerHTML = `📦 Equivalente a <strong>${currencyFormatterLocal.format(cBultoTotal)}</strong> por bulto de ${kgBulto.toFixed(2)} kg.`;
                        }
                    }
                    
                    const elDetalleTarifa = document.getElementById('sim_lbl_tarifa_detalle');
                    if (elDetalleTarifa) {
                        if (esModoUnidad) {
                            elDetalleTarifa.innerText = `💼 Tarifa de Maquila Explicita: ${currencyFormatterLocal.format(tarifaVal)} / un (Total MO: ${currencyFormatterLocal.format(manoObraTotalVal)} para ${unidadesProd} un)`;
                        } else {
                            elDetalleTarifa.innerText = `⚖️ Tarifa Granel Explicita: ${currencyFormatterLocal.format(tarifaVal)} / kg (Total MO: ${currencyFormatterLocal.format(manoObraTotalVal)} para ${masaFinalTerminada.toFixed(2)} kg)`;
                        }
                    }

                    const elInversion = document.getElementById('sim_lbl_inversion_total');
                    if (elInversion) elInversion.innerText = currencyFormatterLocal.format(inversionTotalTanda);
                    
                    const elCostoCrudoKg = document.getElementById('sim_lbl_costo_crudo_kg');
                    if (elCostoCrudoKg) {
                        elCostoCrudoKg.innerText = esModoUnidad 
                            ? `${currencyFormatterLocal.format(costoUnitarioPorPieza)} / un` 
                            : `${currencyFormatterLocal.format(costoFinalPorKilo)} / kg`;
                    }
                    
                    const elRendPct = document.getElementById('sim_lbl_rendimiento_pct');
                    if (elRendPct) elRendPct.innerText = (rend * 100).toFixed(2);
                    
                    const elFactorRend = document.getElementById('sim_lbl_factor_rendimiento');
                    if (elFactorRend) elFactorRend.innerText = factorRendimiento.toFixed(4) + ` (${(rend * 100).toFixed(2)}% Rinde)`;
                    
                    const elCostoFinalTitulo = document.getElementById('sim_lbl_costo_final_titulo');
                    if (elCostoFinalTitulo) {
                        elCostoFinalTitulo.innerText = esModoUnidad ? 'Costo Total por Unidad:' : 'Costo Base Simulado:';
                    }

                    const elCostoFinal = document.getElementById('sim_lbl_costo_final');
                    if (elCostoFinal) {
                        elCostoFinal.innerText = esModoUnidad 
                            ? `${currencyFormatterLocal.format(costoUnitarioPorPieza)} / un (${currencyFormatterLocal.format(costoFinalPorKilo)} / kg)`
                            : `${currencyFormatterLocal.format(costoFinalPorKilo)} / kg`;
                    }
                    
                    const extrasContainer = document.getElementById('sim_contenedor_desglose_extras');
                    if (extrasContainer) {
                        extrasContainer.style.display = 'flex';
                        let htmlExtras = '';
                        
                        htmlExtras += `
                            <div style="display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px dashed #cbd5e1; margin-bottom: 4px; padding-bottom: 4px;">
                                <span style="color: #475569; font-weight: 500;">• Mezcla Base (${currentKilosUnidad.toFixed(2)} kg @ ${currencyFormatterLocal.format(currentCostoCrudo)}/kg):</span>
                                <span style="font-weight: 600; color: #1e293b;">${currencyFormatterLocal.format(currentKilosUnidad * currentCostoCrudo)}</span>
                            </div>
                        `;

                        if (currentIngredientesExtra.length > 0) {
                            currentIngredientesExtra.forEach(ing => {
                                const cant = parseFloat(ing.cantidad) || 0;
                                const cost = parseFloat(ing.costo_patron) || 0;
                                htmlExtras += `
                                    <div style="display: flex; justify-content: space-between; padding: 2px 0;">
                                        <span style="color: #475569;">• ${ing.nombre_ingrediente} (${cant.toFixed(2)} kg @ ${currencyFormatterLocal.format(cost)}/kg):</span>
                                        <span style="font-weight: 500; color: #334155;">${currencyFormatterLocal.format(cant * cost)}</span>
                                    </div>
                                `;
                            });
                        }

                        htmlExtras += `
                            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-top: 1.5px solid #bfdbfe; margin-top: 4px; font-weight: bold; color: #1e3a8a;">
                                <span>Masa Horneable (${masaHorneable.toFixed(2)} kg):</span>
                                <span>Total MP: ${currencyFormatterLocal.format(costoTotalHorneable)}</span>
                            </div>
                        `;

                        if (currentAgregadosPostHorno.length > 0) {
                            htmlExtras += `<div style="margin-top: 4px; margin-bottom: 2px; color: #86198f; font-weight: bold; font-size: 0.9em;">Agregados Post-Horno (Merma 0%):</div>`;
                            currentAgregadosPostHorno.forEach(ing => {
                                const cant = parseFloat(ing.cantidad) || 0;
                                const cantFmt = Number(cant.toFixed(3));
                                htmlExtras += `
                                    <div style="display: flex; justify-content: space-between; padding: 2px 0;">
                                        <span style="color: #86198f;">• ${ing.nombre_ingrediente} (${cantFmt} kg):</span>
                                        <span style="font-weight: 500; color: #86198f;">+ ${cantFmt} kg (Agregado Seco)</span>
                                    </div>
                                `;
                            });
                        }

                        const labelMasaFinal = esModoUnidad 
                            ? `Producción Final (${unidadesProd} un):` 
                            : `Masa Final (${masaFinalTerminada.toFixed(2)} kg):`;

                        htmlExtras += `
                            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-top: 1.5px solid #fbcfe8; margin-top: 4px; font-weight: bold; color: #86198f;">
                                <span>${labelMasaFinal}</span>
                                <span>MO Total: ${currencyFormatterLocal.format(manoObraTotalVal)}</span>
                            </div>
                        `;
                        
                        extrasContainer.innerHTML = htmlExtras;
                    }
                };

                window.seleccionarFuenteCosto = function(costoVal) {
                    currentCostoCrudo = parseFloat(costoVal) || 0;
                    const inputManual = document.getElementById('sim_costo_manual_input');
                    if (inputManual && document.activeElement !== inputManual) {
                        inputManual.value = currentCostoCrudo > 0 ? currentCostoCrudo.toFixed(2) : '';
                    }
                    if (typeof window.recalcularSimulacionTostadero === 'function') {
                        window.recalcularSimulacionTostadero();
                    }
                };

                window.actualizarFuentesYHistorial = async (skuEntrada, forzarSeleccionMaestra = false) => {
                    const elFuentes = document.getElementById('sim_contenedor_fuentes_costo');
                    const elTablaBody = document.getElementById('sim_tabla_mermas_body');

                    if (!skuEntrada) {
                        if (elFuentes) elFuentes.innerHTML = '<div style="padding: 10px; color: #64748b;">Materia prima sin vincular.</div>';
                        if (elTablaBody) elTablaBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 10px; color: #64748b;">Sin historial.</td></tr>';
                        return;
                    }

                    if (elFuentes) elFuentes.innerHTML = '<div style="padding: 10px; color: #64748b; text-align: center;">Cargando ofertas de reposición...</div>';
                    if (elTablaBody) elTablaBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 10px; color: #64748b;">Cargando historial...</td></tr>';

                    try {
                        const resFin = await fetch(`/api/logistica/bunker/finanzas/${encodeURIComponent(skuEntrada)}`);
                        const finData = await resFin.json();

                        let cBunker = 0;
                        let kUnidad = 1.00;
                        let cLote = null;
                        let ofertas = [];
                        let recetaKiloCost = 0;
                        let manoObraKiloCost = 0;
                        let costoBunkerKilo = 0;
                        let fuenteCostoAplicada = '';

                        // 🔑 FASE 3 (v5.47): Detectar e Inmunizar Costo Vivo Operativo Inyectado ($ 8.198,94 / kg)
                        const ingestaCaja2Obj = mermasData && mermasData.ingesta_financiera_caja_2;
                        const costoVivoIngresado = (ingestaCaja2Obj && parseFloat(ingestaCaja2Obj.costo_kilo_sugerido) > 0)
                            ? parseFloat(ingestaCaja2Obj.costo_kilo_sugerido)
                            : 0;

                        if (resFin.ok && finData.success && finData.data) {
                            const dataObj = finData.data;
                            kUnidad = parseFloat(dataObj.kilos_unidad) || 1.00;
                            cLote = dataObj.lote ? parseFloat(dataObj.lote.costo_kilo_al_momento) : null;
                            ofertas = dataObj.reposicion_ofertas || [];

                            if (costoVivoIngresado > 0) {
                                costoBunkerKilo = costoVivoIngresado;
                                fuenteCostoAplicada = ingestaCaja2Obj.fuente_aplicada || 'COSTO_BASE_OPERATIVO';
                            } else if (dataObj.costo_por_kilo_normalizado !== undefined && dataObj.costo_por_kilo_normalizado > 0) {
                                costoBunkerKilo = parseFloat(dataObj.costo_por_kilo_normalizado);
                                fuenteCostoAplicada = dataObj.fuente_costo_aplicada || 'COSTO_NORMALIZADO';
                            } else {
                                cBunker = parseFloat(dataObj.costo_reposicion) || parseFloat(dataObj.costo_kilo_ingrediente) || parseFloat(dataObj.costo_base_manual) || (cLote || 0);

                                if (dataObj.receta_id && Array.isArray(dataObj.receta_ingredientes) && dataObj.receta_ingredientes.length > 0) {
                                    let recipeTotalCost = 0;
                                    dataObj.receta_ingredientes.forEach(ing => {
                                        recipeTotalCost += (parseFloat(ing.cantidad) || 0) * (parseFloat(ing.costo_patron || ing.costo_patron_directo || 0) || 0);
                                    });
                                    recetaKiloCost = recipeTotalCost / (kUnidad || 1);
                                }

                                if (dataObj.listas_margenes && Array.isArray(dataObj.listas_margenes) && dataObj.listas_margenes.length > 0) {
                                    const targetList = dataObj.listas_margenes.find(l => l.rendimiento_activo === true || l.mano_obra_activa === true) || dataObj.listas_margenes[0];
                                    if (targetList) {
                                        manoObraKiloCost = parseFloat(targetList.costo_tiempo) || 0;
                                    }
                                }
                                costoBunkerKilo = cBunker > 0 ? (cBunker / kUnidad) : (recetaKiloCost > 0 ? (recetaKiloCost + manoObraKiloCost) : 0);
                                if (costoBunkerKilo === 0 && cLote) costoBunkerKilo = cLote;
                            }
                        }

                        currentKilosUnidad = kUnidad;
                        const elKilosLbl = document.getElementById('sim_lbl_kilos_unidad');
                        if (elKilosLbl) elKilosLbl.innerHTML = `Presentación: <strong>${kUnidad.toFixed(2)} kg</strong> por bulto.`;

                        let htmlFuentes = '';

                        const bunkerChecked = (!forzarSeleccionMaestra || !cotizacionMaestraSeleccionada) ? 'checked' : '';
                        const fuenteEtiqueta = fuenteCostoAplicada ? ` <small style="color: #64748b; font-size: 0.85em;">(${fuenteCostoAplicada})</small>` : '';
                        htmlFuentes += `
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 0; font-size: 0.95em; margin: 0; user-select: none;">
                                <input type="radio" name="sim_fuente_costo" value="${costoBunkerKilo}" ${bunkerChecked} onchange="window.seleccionarFuenteCosto(${costoBunkerKilo})">
                                <span>🎯 Costo Base Actual / Editado: <strong>${currencyFormatterLocal.format(costoBunkerKilo)} / kg</strong>${fuenteEtiqueta}</span>
                            </label>
                        `;

                        if (cLote !== null) {
                            htmlFuentes += `
                                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 0; font-size: 0.95em; margin: 0; user-select: none;">
                                    <input type="radio" name="sim_fuente_costo" value="${cLote}" onchange="window.seleccionarFuenteCosto(${cLote})">
                                    <span>📦 Último Lote de Compra: <strong>${currencyFormatterLocal.format(cLote)} / kg</strong></span>
                                </label>
                            `;
                        }

                        if (ofertas.length > 0) {
                            htmlFuentes += `<div style="font-size: 0.85em; font-weight: bold; color: #475569; margin-top: 6px; margin-bottom: 2px;">Ofertas de Proveedores:</div>`;
                            ofertas.forEach((o, index) => {
                                const cProvKilo = parseFloat(o.costo_reposicion) || 0;
                                const pNombre = o.proveedor_nombre || `Proveedor #${o.proveedor_id}`;
                                htmlFuentes += `
                                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 3px 0; font-size: 0.9em; margin: 0; user-select: none; color: #334155;">
                                        <input type="radio" name="sim_fuente_costo" value="${cProvKilo}" onchange="window.seleccionarFuenteCosto(${cProvKilo})">
                                        <span>🏭 ${pNombre}: <strong>${currencyFormatterLocal.format(cProvKilo)} / kg</strong></span>
                                    </label>
                                `;
                            });
                        }

                        if (cotizacionMaestraSeleccionada) {
                            const cMaestraKilo = parseFloat(cotizacionMaestraSeleccionada.costo_reposicion) || 0;
                            htmlFuentes += `
                                <div style="font-size: 0.85em; font-weight: bold; color: #0284c7; margin-top: 6px; margin-bottom: 2px;">Cotización Seleccionada:</div>
                                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 0; font-size: 0.93em; margin: 0; user-select: none; background: #e0f2fe; border-radius: 4px; padding-left: 6px;">
                                    <input type="radio" name="sim_fuente_costo" value="${cMaestraKilo}" checked onchange="window.seleccionarFuenteCosto(${cMaestraKilo})">
                                    <span>🔍 <strong>${cotizacionMaestraSeleccionada.descripcion}</strong>: <strong>${currencyFormatterLocal.format(cMaestraKilo)} / kg</strong></span>
                                </label>
                            `;
                        }

                        if (elFuentes) elFuentes.innerHTML = htmlFuentes;

                        let savedCost = simSaved ? parseFloat(simSaved.costo_crudo) : 0;
                        if (cotizacionMaestraSeleccionada) {
                            window.seleccionarFuenteCosto(parseFloat(cotizacionMaestraSeleccionada.costo_reposicion) || 0);
                        } else if (savedCost > 0) {
                            window.seleccionarFuenteCosto(savedCost);
                        } else if (costoVivoIngresado > 0) {
                            window.seleccionarFuenteCosto(costoVivoIngresado);
                        } else {
                            window.seleccionarFuenteCosto(costoBunkerKilo);
                        }

                    } catch (err) {
                        console.error("⚠️ [TOSTADERO] Excepción en actualización de cotizaciones:", err);
                        let fallbackCost = currentCostoCrudo > 0 ? currentCostoCrudo : 0;
                        let fallbackHtml = `
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 0; font-size: 0.95em; margin: 0; user-select: none;">
                                <input type="radio" name="sim_fuente_costo" value="${fallbackCost}" checked onchange="window.seleccionarFuenteCosto(${fallbackCost})">
                                <span>🎯 Costo Base Actual / Editado: <strong>${currencyFormatterLocal.format(fallbackCost)} / kg</strong></span>
                            </label>
                        `;
                        const containerEl = document.getElementById('sim_contenedor_fuentes_costo');
                        if (containerEl) {
                            containerEl.innerHTML = fallbackHtml;
                        }
                        if (typeof window.seleccionarFuenteCosto === 'function') {
                            window.seleccionarFuenteCosto(fallbackCost);
                        }
                    }

                    try {
                        const resMer = await fetch(`/api/logistica/bunker/mermas-historicas?sku_salida=${encodeURIComponent(skuSalida)}`);
                        const mData = await resMer.json();
                        
                        if (isFirstLoad) {
                            currentIngredientesExtra = (ingredientesUp && ingredientesUp.length > 0) 
                                ? [...ingredientesUp] 
                                : (simSaved && simSaved.ingredientes_extra ? simSaved.ingredientes_extra : []);
                            
                            if (mData.ingredientes_extra && mData.ingredientes_extra.length > 0 && currentAgregadosPostHorno.length === 0) {
                                currentAgregadosPostHorno = mData.ingredientes_extra.map(ing => ({
                                    ingrediente_id: ing.ingrediente_id,
                                    nombre_ingrediente: ing.nombre_ingrediente,
                                    cantidad: parseFloat(ing.cantidad),
                                    costo_patron: parseFloat(ing.costo_patron) || 0,
                                    es_ratio_api: true
                                }));
                            }

                            const container = document.getElementById('sim_insumos_adicionales_container');
                            if (container) {
                                container.innerHTML = '';
                                currentIngredientesExtra.forEach(ing => {
                                    window.agregarFilaInsumoSecundario(ing, true);
                                });
                            }

                            const containerPost = document.getElementById('sim_insumos_posthorno_container');
                            if (containerPost) {
                                containerPost.innerHTML = '';
                                currentAgregadosPostHorno.forEach(ing => {
                                    window.agregarFilaInsumoSecundario(ing, true);
                                });
                            }

                            isFirstLoad = false;
                        }

                        window.setSimMerma = function(val) {
                            const inputMerma = document.getElementById('sim_merma_input');
                            if (inputMerma) {
                                inputMerma.value = parseFloat(val).toFixed(2);
                                if (typeof window.recalcularSimulacionTostadero === 'function') {
                                    window.recalcularSimulacionTostadero();
                                }
                            }
                        };

                        if (typeof window.escalarRatiosSecundarios === 'function') {
                            window.escalarRatiosSecundarios(currentKilosUnidad);
                        }
                        if (typeof window.recalcularSimulacionTostadero === 'function') {
                            window.recalcularSimulacionTostadero();
                        }

                        const historialValido = mData.historial || [];
                        let htmlMermas = '';
                        let sumaMermas = 0;
                        let countMermas = 0;
                        let ultimaMermaCalculada = 0;

                        if (historialValido.length > 0) {
                            historialValido.forEach((h, index) => {
                                const fechaRaw = h.fecha_registro || h.fecha_creacion || h.fecha;
                                const fechaObj = new Date(fechaRaw);
                                const fechaFmt = (fechaRaw && !isNaN(fechaObj.getTime())) ? fechaObj.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : 'N/A';
                                const entradaVal = parseFloat(h.kilos_entrada) || 0;
                                const salidaVal = parseFloat(h.kilos_salida) || 0;
                                const ingVal = (h.ingredientes_extra_json && Array.isArray(h.ingredientes_extra_json))
                                    ? h.ingredientes_extra_json.reduce((acc, i) => acc + (parseFloat(i.cantidad) || 0), 0)
                                    : (parseFloat(h.ingredientes_sumados) || 0);
                                const entradaTotal = h.kilos_entrada_total !== undefined && h.kilos_entrada_total !== null
                                    ? parseFloat(h.kilos_entrada_total)
                                    : (entradaVal + ingVal);

                                let mPct = h.porcentaje_merma !== null ? parseFloat(h.porcentaje_merma) : null;
                                if (mPct === null && entradaTotal > 0 && salidaVal > 0) {
                                    mPct = ((entradaTotal - salidaVal) / entradaTotal) * 100;
                                }
                                if (mPct !== null && mPct < 0) mPct = 0;
                                
                                if (mPct !== null) {
                                    if (mPct > 0) {
                                        sumaMermas += mPct;
                                        countMermas++;
                                    }
                                    if (index === 0) {
                                        ultimaMermaCalculada = mPct;
                                    }
                                }

                                const mermaTexto = mPct !== null ? `${mPct.toFixed(2)}%` : 'Sin datos';
                                const clickMermaVal = mPct !== null ? mPct : 0;

                                htmlMermas += `
                                    <tr style="border-bottom: 1px solid #f1f5f9; cursor: pointer;" onclick="window.setSimMerma(${clickMermaVal})" class="sim-row-merma">
                                        <td style="padding: 8px; color: #475569;">${fechaFmt}</td>
                                        <td style="padding: 8px; font-weight: 500; color: #1e3a8a;">#${h.carro_id}</td>
                                        <td style="padding: 8px; text-align: right; color: #64748b;" title="Mezcla Base: ${entradaVal.toFixed(2)} kg + Insumos Extra: ${ingVal.toFixed(2)} kg">${entradaTotal.toFixed(2)} kg</td>
                                        <td style="padding: 8px; text-align: right; color: #64748b;">${salidaVal.toFixed(2)} kg</td>
                                        <td style="padding: 8px; text-align: right; font-weight: bold; color: #1e3a8a;">${mermaTexto}</td>
                                    </tr>
                                `;
                            });
                            document.getElementById('sim_tabla_mermas_body').innerHTML = htmlMermas;

                            const promedioFinal = countMermas > 0 ? (sumaMermas / countMermas) : 0;
                            const btnPromedio = document.getElementById('sim_btn_merma_promedio');
                            const btnUltimo = document.getElementById('sim_btn_merma_ultimo');
                            if (btnPromedio) {
                                btnPromedio.textContent = `Promedio (${promedioFinal.toFixed(1)}%)`;
                                btnPromedio.onclick = () => window.setSimMerma(promedioFinal);
                            }
                            if (btnUltimo) {
                                btnUltimo.textContent = `Último (${ultimaMermaCalculada.toFixed(1)}%)`;
                                btnUltimo.onclick = () => window.setSimMerma(ultimaMermaCalculada);
                            }

                            document.getElementById('sim_lbl_historial_res').innerHTML = `Basado en <strong>${countMermas} cocciones válidas</strong> registradas en el historial. Merma promedio: <strong>${promedioFinal.toFixed(2)}%</strong>`;
                        } else {
                            document.getElementById('sim_tabla_mermas_body').innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 10px; color: #64748b;">Sin historial de mermas computadas (> 0%) para esta relación.</td></tr>';
                            document.getElementById('sim_lbl_historial_res').innerText = 'Sin carros con mermas válidas.';
                        }
                    } catch (err) {
                        console.error(err);
                        document.getElementById('sim_tabla_mermas_body').innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 10px; color: red;">Error al consultar historial.</td></tr>';
                    }
                };

                document.getElementById('sim_merma_input').addEventListener('input', window.recalcularSimulacionTostadero);
                document.getElementById('sim_tarifa_input').addEventListener('input', window.recalcularSimulacionTostadero);
                
                // 🔑 FASE 3 ETAPA FINAL (v5.46): Escuchador & Persistencia por Artículo (localStorage)
                const modoUnidadChkEl = document.getElementById('gp-tostadero-modo-unidad-check') || document.getElementById('sim_modo_unidad_check');
                if (modoUnidadChkEl) {
                    modoUnidadChkEl.addEventListener('change', (e) => {
                        const modeVal = e.target.checked ? 'UNIDAD' : 'KILO';
                        if (window.currentArticuloIdGlobal) {
                            localStorage.setItem(`bunker_modo_unidad_${window.currentArticuloIdGlobal}`, modeVal);
                        }
                        if (window.currentSkuGlobal) {
                            localStorage.setItem(`bunker_modo_unidad_${window.currentSkuGlobal}`, modeVal);
                        }
                        if (typeof window.recalcularSimulacionTostadero === 'function') {
                            window.recalcularSimulacionTostadero();
                        }
                    });
                }

                document.getElementById('sim_btn_agregar_insumo').addEventListener('click', () => {
                    window.agregarFilaInsumoSecundario();
                });

                // CASCADA SELECTOR DE SERVICIOS (Nivel 1 -> Nivel 2 -> Nivel 3)
                const selectColab = document.getElementById('sim_colaborador');
                const selectServicio = document.getElementById('sim_servicio_select');

                const cargarServiciosColaborador = async (colaboradorId) => {
                    if (!selectServicio) return;
                    if (!colaboradorId) {
                        selectServicio.innerHTML = '<option value="">Seleccione primero un colaborador...</option>';
                        selectServicio.disabled = true;
                        return;
                    }

                    selectServicio.innerHTML = '<option value="">Cargando servicios del operario...</option>';
                    selectServicio.disabled = true;

                    const colabObj = (colaboradores || []).find(c => String(c.usuario_id) === String(colaboradorId));
                    const colabNombre = colabObj ? (colabObj.nombre_completo || colabObj.usuario) : 'Colaborador';
                    const tarifaBaseHora = colabObj ? (parseFloat(colabObj.valor_hora) || 0) : 0;

                    try {
                        const resServicios = await fetch(`/api/logistica/bunker/colaboradores/tarifas-rendimiento/${colaboradorId}`);
                        let serviciosList = [];
                        if (resServicios.ok) {
                            const dataRes = await resServicios.json();
                            if (dataRes.success && Array.isArray(dataRes.data)) {
                                serviciosList = dataRes.data;
                            }
                        }

                        if (serviciosList.length > 0) {
                            let optionsHtml = '<option value="" data-tarifa="0" selected disabled>-- Seleccione Servicio Parametrizado --</option>';

                            serviciosList.forEach((s) => {
                                const tVal = parseFloat(s.valor_por_unidad) || 0;
                                const descLimpia = s.descripcion || s.articulo_numero || 'Servicio General';
                                optionsHtml += `<option value="${s.id}" data-sku="${s.articulo_numero}" data-tarifa="${tVal}">
                                    ${descLimpia} — ${currencyFormatterLocal.format(tVal)} / ${s.unidad_medida || 'un'}
                                </option>`;
                            });

                            optionsHtml += `<option value="hora" data-tarifa="${tarifaBaseHora}">Tarifa Base por Hora (${colabNombre}) — ${currencyFormatterLocal.format(tarifaBaseHora)} / hr</option>`;

                            selectServicio.innerHTML = optionsHtml;
                            selectServicio.disabled = false;
                            selectServicio.style.background = 'white';
                            selectServicio.selectedIndex = 0;
                        } else {
                            selectServicio.innerHTML = `<option value="base" data-tarifa="${tarifaBaseHora}">Tarifa Base por Hora (${colabNombre}) — ${currencyFormatterLocal.format(tarifaBaseHora)} / hr</option>`;
                            selectServicio.disabled = false;
                            selectServicio.style.background = 'white';
                            selectServicio.selectedIndex = 0;
                        }

                    } catch (errServ) {
                        console.error("Error cargando servicios del colaborador:", errServ);
                        selectServicio.innerHTML = `<option value="error" data-tarifa="0">Error cargando servicios (Carga Manual)</option>`;
                        selectServicio.disabled = false;
                        selectServicio.style.background = 'white';
                    }
                };

                if (selectColab) {
                    selectColab.addEventListener('change', () => {
                        const selectedColabId = selectColab.value;
                        cargarServiciosColaborador(selectedColabId);
                    });
                }

                if (selectServicio) {
                    selectServicio.addEventListener('change', () => {
                        const optSelected = selectServicio.options[selectServicio.selectedIndex];
                        if (optSelected) {
                            const tarifaInyectada = parseFloat(optSelected.getAttribute('data-tarifa')) || 0;
                            const tarifaInp = document.getElementById('sim_tarifa_input');
                            if (tarifaInp) {
                                tarifaInp.value = tarifaInyectada.toFixed(2);
                            }

                            const colabSelectedObj = (colaboradores || []).find(c => String(c.usuario_id) === String(selectColab.value));
                            const colabNombre = colabSelectedObj ? (colabSelectedObj.nombre_completo || colabSelectedObj.usuario) : '';
                            const detalleEl = document.getElementById('sim_lbl_tarifa_detalle');
                            if (detalleEl) {
                                detalleEl.innerText = `Servicio: ${optSelected.text}`;
                            }

                            if (typeof window.recalcularSimulacionTostadero === 'function') {
                                window.recalcularSimulacionTostadero();
                            }
                        }
                    });
                }

                const inputCostManual = document.getElementById('sim_costo_manual_input');
                if (inputCostManual) {
                    inputCostManual.addEventListener('input', (e) => {
                        const val = parseFloat(String(e.target.value).replace(',', '.')) || 0;
                        window.seleccionarFuenteCosto(val);
                    });
                }

                const btnAnularMerma = document.getElementById('sim_btn_anular_merma');
                if (btnAnularMerma) {
                    btnAnularMerma.addEventListener('click', () => {
                        const inputMerma = document.getElementById('sim_merma_input');
                        if (inputMerma) inputMerma.value = '0.00';
                        if (typeof window.recalcularSimulacionTostadero === 'function') {
                            window.recalcularSimulacionTostadero();
                        }
                    });
                }

                window.actualizarFuentesYHistorial(currentSkuEntrada);

                if (defaultColabId && selectColab) {
                    selectColab.value = defaultColabId;
                    cargarServiciosColaborador(defaultColabId);
                }
            },
            preConfirm: () => {
                const textFinal = document.getElementById('sim_lbl_costo_final').innerText;
                let finalKiloVal = 0;
                let finalUnidadVal = 0;

                const matchKilo = textFinal.match(/\$\s*([\d\.\,]+)\s*\/\s*kg/);
                if (matchKilo && matchKilo[1]) {
                    finalKiloVal = parseFloat(matchKilo[1].replace(/\./g, '').replace(',', '.')) || 0;
                }
                const matchUnidad = textFinal.match(/\$\s*([\d\.\,]+)\s*\/\s*un/);
                if (matchUnidad && matchUnidad[1]) {
                    finalUnidadVal = parseFloat(matchUnidad[1].replace(/\./g, '').replace(',', '.')) || 0;
                }

                if (!finalKiloVal) {
                    const cleanText = textFinal.replace(/\$/g, '').replace(/\/ kg/g, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.').trim();
                    finalKiloVal = parseFloat(cleanText) || 0;
                }

                const piezasInp = document.getElementById('gp-tostadero-piezas-input') || document.getElementById('sim_unidades_producidas');
                const piezasQty = piezasInp ? (parseInt(piezasInp.value) || 20) : 20;

                const mermaVal = parseFloat(document.getElementById('sim_merma_input') ? document.getElementById('sim_merma_input').value : currentMerma) || 0;
                const tarifaVal = parseFloat(document.getElementById('sim_tarifa_input') ? document.getElementById('sim_tarifa_input').value : currentTarifa) || 0;
                const colabSelect = document.getElementById('sim_colaborador');
                const colaboradorId = colabSelect && colabSelect.value ? parseInt(colabSelect.value) : null;

                const activeIngredients = [];
                const rows = document.querySelectorAll('#sim_insumos_adicionales_container .sim-insumo-row');
                rows.forEach(r => {
                    const nameInp = r.querySelector('.sim-insumo-search-input');
                    const idInp = r.querySelector('.sim-insumo-id-val');
                    const qtyInp = r.querySelector('.sim-insumo-qty-input');

                    const name = nameInp ? nameInp.value.trim() : '';
                    const id = idInp ? idInp.value : '';
                    const qty = qtyInp ? parseFloat(qtyInp.value) || 0 : 0;
                    const cost = nameInp ? parseFloat(nameInp.getAttribute('data-costo')) || 0 : 0;

                    if (name) {
                        activeIngredients.push({
                            ingrediente_id: id || null,
                            nombre_ingrediente: name,
                            cantidad: qty,
                            costo_patron: cost
                        });
                    }
                });
                
                return {
                    costo_final: finalKiloVal,
                    costo_unidad: finalUnidadVal,
                    cantidad_piezas: piezasQty,
                    costo_crudo: currentCostoCrudo,
                    merma: mermaVal,
                    tarifa: tarifaVal,
                    colaborador_id: colaboradorId,
                    ingredientes_extra: activeIngredients
                };
            }
        });

        // Cleanup global helpers
        delete window.seleccionarFuenteCosto;
        delete window.setSimMerma;
        delete window.recalcularSimulacionTostadero;
        delete window.actualizarFuentesYHistorial;
        delete window.agregarFilaInsumoSecundario;

        if (finalCostoSimulado && finalCostoSimulado.costo_final > 0) {
            const finalObj = finalCostoSimulado;
            const finalVal = parseFloat(finalObj.costo_final) || 0;
            
            if (!window.gp_current_articulo_data) window.gp_current_articulo_data = {};
            if (!window.gp_current_articulo_data.propiedades_dinamicas) {
                window.gp_current_articulo_data.propiedades_dinamicas = {};
            }
            window.gp_current_articulo_data.propiedades_dinamicas.tostadero_simulacion = finalObj;

            // Actualizar variable global de costo tostadero en memoria
            window.gp_costoTostaderoKilo = finalVal;

            // Poblar y resaltar la Tarjeta 4 "🥣 COSTO TOSTADERO (CARRO EXTERNO)" de forma pasiva (estacionado)
            const tostaderoValEl = document.getElementById('gp-costo-tostadero-val');
            if (tostaderoValEl) {
                tostaderoValEl.innerText = currencyFormatterLocal.format(finalVal);
                tostaderoValEl.setAttribute('onclick', `window.confirmarTostaderoTotalCost(${finalVal})`);
                tostaderoValEl.style.boxShadow = '0 0 10px rgba(217, 119, 6, 0.6)';
                tostaderoValEl.style.borderColor = '#d97706';
                setTimeout(() => { tostaderoValEl.style.boxShadow = 'none'; }, 1500);
            }

            const tostaderoBadge = document.getElementById('gp-tostadero-badge');
            if (tostaderoBadge) {
                tostaderoBadge.innerText = '🔥 Estacionado';
                tostaderoBadge.style.background = '#fde68a';
                tostaderoBadge.style.color = '#78350f';
            }

            const calcSimBtn = document.getElementById('btn-simulador-costo');
            if (calcSimBtn) {
                calcSimBtn.innerText = `🔥 Simulado: ${currencyFormatterLocal.format(finalVal)} / kg`;
                calcSimBtn.style.background = '#0284c7';
                calcSimBtn.style.color = 'white';
            }

            // Notificación pasiva Toast (Fase 16: Sin autoejecución del modal prematuro)
            const Toast = Swal.mixin({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2500,
                timerProgressBar: true
            });
            Toast.fire({
                icon: 'success',
                title: `Costo Tostadero estacionado: ${currencyFormatterLocal.format(finalVal)} / kg`
            });
        }
    } catch (err) {
        console.error("Error en la calculadora de tostadero:", err);
        Swal.fire('Error', 'Ocurrió un error al intentar consultar los históricos de mermas y tarifas.', 'error');
    }
};

// Modal global de Telemetría y Salud Cloudflare
window.abrirModalTelemetriaCloudflare = async function() {
    Swal.fire({
        title: '⚡ Telemetría y Rendimiento Cloudflare',
        html: `<div style="text-align:center; padding: 20px;"><p style="margin-top:10px;">Consultando API de Cloudflare y métricas en vivo...</p></div>`,
        showConfirmButton: false,
        width: '650px'
    });

    try {
        const resp = await fetch('/api/logistica/telemetria/cloudflare');
        const res = await resp.json();
        if (!res.success) throw new Error(res.error || 'Error al obtener telemetría');

        const cf = res.resumenCloudflare;
        
        Swal.fire({
            title: '📊 Telemetría y Salud de Red Cloudflare',
            width: '700px',
            html: `
                <div style="text-align: left; font-family: sans-serif; font-size: 0.95em;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
                            <div style="color: #64748b; font-size: 0.85em; font-weight: 600;">ESTADO DE RED</div>
                            <div style="color: #16a34a; font-size: 1.1em; font-weight: 700; margin-top: 4px;">🟢 ${cf.estado}</div>
                        </div>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
                            <div style="color: #64748b; font-size: 0.85em; font-weight: 600;">SUBDOMINIO WORKER</div>
                            <div style="color: #6b21a8; font-size: 0.85em; font-weight: 700; margin-top: 4px; word-break: break-all;">⚡ ${cf.subdominio}</div>
                        </div>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
                            <div style="color: #64748b; font-size: 0.85em; font-weight: 600;">TASA CACHE HITS</div>
                            <div style="color: #2563eb; font-size: 1.2em; font-weight: 700; margin-top: 4px;">🎯 ${cf.tasaCacheHits}</div>
                        </div>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
                            <div style="color: #64748b; font-size: 0.85em; font-weight: 600;">LATENCIA PROMEDIO</div>
                            <div style="color: #059669; font-size: 1.2em; font-weight: 700; margin-top: 4px;">⚡ ${cf.latenciaPromedio}</div>
                        </div>
                    </div>
                    <div style="background: #f3e8ff; border: 1px solid #d8b4fe; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
                        <div style="color: #6b21a8; font-weight: 700; font-size: 0.9em;">
                            📱 PWA Service Worker (Instalación Local en Celulares)
                        </div>
                        <div style="color: #4c1d95; font-size: 0.85em; margin-top: 4px;">
                            Marco visual pre-cacheado en memoria interna de dispositivos. Respuesta en 0.002s por solicitud.
                        </div>
                    </div>
                    <div style="text-align: right; color: #94a3b8; font-size: 0.8em;">
                        Última sincronización API: ${new Date(res.timestamp).toLocaleTimeString()}
                    </div>
                </div>
            `,
            confirmButtonText: '🔄 Actualizar Métricas',
            confirmButtonColor: '#8b5cf6',
            showCancelButton: true,
            cancelButtonText: 'Cerrar'
        }).then((result) => {
            if (result.isConfirmed) {
                window.abrirModalTelemetriaCloudflare();
            }
        });
    } catch(err) {
        Swal.fire('Error', err.message, 'error');
    }
};