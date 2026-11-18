/**
 * Modal "Abrir Caja Cerrada" v5.1
 * - Flujo físico real: 1° Caja Búnker (escaneo o búsqueda) -> 2° Fracción Búnker aprendida -> 3° Operador + Lote heredado + Impresión Zebra
 * - Catálogo exclusivo public.bunker_articulos (cero artículos legacy)
 * - Buscador en vivo (0 ms) sobre palabras completas del Diccionario Búnker (propiedades_dinamicas) + nomenclador
 * - Aprendizaje automático Caja -> Fracción + Unidades por caja + Multiplicador de cajas
 * - Herencia automática del lote de la caja padre e impresión Zebra de pares (Artículo + Lote) al finalizar
 */

const ModalAbrirCaja = (function () {
    'use strict';

    const STORAGE_ULTIMO_USUARIO = 'abrirCajaUltimoUsuarioId';

    let modalElement = null;
    let inicializado = false;

    // Caché en memoria del catálogo Búnker y vínculos aprendidos
    let catalogoBunker = [];
    let mapaPorSku = new Map();
    let aprendizajesLista = [];
    let ultimasCajasConStock = [];
    let usuariosCargados = false;

    // Estado de la operación activa
    let cajaSeleccionada = null;
    let datosArticuloUnidad = null;
    let unidadPreseleccionadaContextual = null; // Cuando se abre desde clic derecho en un faltante
    let fuenteSeleccionUnidad = '';             // 'aprendido' | 'contextual' | 'manual'
    let loteActual = '';
    let loteProveedor = '';
    let origenLote = 'generado';                // 'lote_unico' | 'multi_pendiente' | 'lote_confirmado' | 'generado' | 'manual'
    let lotesPadreActivos = [];                 // Lista de lotes cerrados activos de la caja seleccionada

    // Navegación por teclado en los dos omnibox
    let resultadosCajaVisibles = [];
    let indiceHighlightCaja = -1;
    let resultadosUnidadVisibles = [];
    let indiceHighlightUnidad = -1;
    let timerAutoScanCaja = null;
    let timerAutoScanUnidad = null;
    let huboAperturasEnSesion = false;

    // ==========================================
    // NORMALIZACIÓN Y MOTOR DE BÚSQUEDA BÚNKER
    // ==========================================

    function normalizarTexto(texto) {
        if (!texto) return '';
        return String(texto)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/ñ/g, 'n');
    }

    /**
     * Construye la bolsa de búsqueda de un artículo Búnker indexando:
     * 1. Nomenclador Búnker visible (descripcion_generada)
     * 2. Familia / Rubro
     * 3. Palabras COMPLETAS del Diccionario Búnker (propiedades_dinamicas: articulo_principal y posiciones[].valor,
     *    incluyendo atributos silenciosos y modos abreviados, omitiendo abreviaturas sueltas de diccionario y códigos SKU)
     * 4. Variantes de género (ej: tostado <-> tostada) y presentaciones pegadas (ej: "2 x 5kg" -> "2x5kg 2x5 x5kg x5")
     */
    function construirBolsaBusquedaBunker(art) {
        if (!art) return '';
        const tokens = [];

        const descGen = art.descripcion_generada || art.descripcion || '';
        if (descGen) {
            tokens.push(descGen);
            // Variantes pegadas de presentaciones ("2 x 5kg" -> "2x5kg 2x5 x5kg x5", "x 5kg" -> "x5kg x5")
            const regexPres = /(\b\d+\s*[xX]\s*\d+(?:[.,]\d+)?\s*(?:kg|g|gr|un|u)?|\b[xX]\s*\d+(?:[.,]\d+)?\s*(?:kg|g|gr|un|u)?)/gi;
            let match;
            while ((match = regexPres.exec(descGen)) !== null) {
                const compacto = match[0].replace(/\s+/g, '');
                tokens.push(compacto);
                const sinUnidad = compacto.replace(/(kg|g|gr|un|u)$/i, '');
                if (sinUnidad && sinUnidad !== compacto) tokens.push(sinUnidad);
            }
            const mSub = descGen.match(/\b\d+\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr)?/i);
            if (mSub) {
                tokens.push(`x${mSub[1]}${mSub[2] || ''}`);
                tokens.push(`x${mSub[1]}`);
            }
        }

        if (art.descripcion_corta && art.descripcion_corta !== descGen) {
            tokens.push(art.descripcion_corta);
        }

        const famNombre = art.familia_nombre || art.propiedades_dinamicas?.familia_nombre;
        if (famNombre) tokens.push(famNombre);
        if (art.rubro) tokens.push(art.rubro);
        if (art.sub_rubro) tokens.push(art.sub_rubro);

        let pd = art.propiedades_dinamicas;
        if (typeof pd === 'string') {
            try { pd = JSON.parse(pd); } catch (_) { pd = null; }
        }

        if (pd && typeof pd === 'object') {
            if (pd.articulo_principal) tokens.push(pd.articulo_principal);
            if (pd.familia_nombre) tokens.push(pd.familia_nombre);

            const posObj = pd.posiciones;
            if (posObj && typeof posObj === 'object') {
                Object.keys(posObj).forEach(key => {
                    if (key.startsWith('asistente_') || key.startsWith('rendimiento_') || key.startsWith('tostadero_') || key.startsWith('_meta')) {
                        return;
                    }
                    const item = posObj[key];
                    if (item && typeof item === 'object' && item.valor) {
                        const valorCompleto = String(item.valor).trim();
                        tokens.push(valorCompleto);

                        // Palabras compuestas pegadas (ej: "Extra Light" -> "extralight", "Non Pareil" -> "nonpareil")
                        if (/\s+/.test(valorCompleto)) {
                            tokens.push(valorCompleto.replace(/\s+/g, ''));
                        }

                        // Flexiones de género en palabras descriptivas completas (ej: "Peladas" <-> "pelado", "Tostado" <-> "tostada")
                        valorCompleto.split(/[\s/]+/).forEach(w => {
                            if (w.length > 4) {
                                if (/os$/i.test(w)) {
                                    tokens.push(w.slice(0, -2) + 'o', w.slice(0, -2) + 'a', w.slice(0, -2) + 'as');
                                } else if (/as$/i.test(w)) {
                                    tokens.push(w.slice(0, -2) + 'a', w.slice(0, -2) + 'o', w.slice(0, -2) + 'os');
                                } else if (/o$/i.test(w)) {
                                    tokens.push(w.slice(0, -1) + 'a', w.slice(0, -1) + 'os', w.slice(0, -1) + 'as');
                                } else if (/a$/i.test(w)) {
                                    tokens.push(w.slice(0, -1) + 'o', w.slice(0, -1) + 'as', w.slice(0, -1) + 'os');
                                }
                            }
                        });
                    }
                });
            }
        }

        return normalizarTexto(tokens.filter(Boolean).join(' '));
    }

    // Asegurar Single Source of Truth global si la página aún no lo definió
    if (typeof window.obtenerTextoBusquedaArticulo !== 'function') {
        window.obtenerTextoBusquedaArticulo = construirBolsaBusquedaBunker;
    }

    // ==========================================
    // DEDUCCIÓN DE UNIDADES Y SIMILITUD BÚNKER
    // ==========================================

    function deducirFormatoCaja(caja) {
        if (!caja) return { unidades: null, kilosHijoEsperados: null, etiquetaFuente: '' };

        const packU = parseInt(caja.pack_unidades, 10) || 0;
        const desc = String(caja.descripcion_generada || caja.descripcion || '');
        const m = desc.match(/\b(\d{1,3})\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|k|g|gr|gramos?|un|u)?\b/i);

        if (m) {
            const mult = parseInt(m[1], 10);
            const valorPeso = parseFloat(String(m[2]).replace(',', '.'));
            const unidadRaw = (m[3] || '').toLowerCase();
            let kilosHijo = null;
            if (valorPeso > 0) {
                if (unidadRaw.startsWith('g')) {
                    kilosHijo = valorPeso / 1000;
                } else if (unidadRaw.startsWith('k') || valorPeso <= 25) {
                    kilosHijo = valorPeso;
                } else if (valorPeso >= 50) {
                    kilosHijo = valorPeso / 1000;
                }
            }
            if (mult >= 2 && mult <= 200) {
                return {
                    unidades: packU > 1 ? packU : mult,
                    kilosHijoEsperados: kilosHijo,
                    etiquetaFuente: `✨ Deducido de "${m[0].trim()}"`
                };
            }
        }

        if (packU > 1) {
            const kuCaja = parseFloat(caja.kilos_unidad) || 0;
            return {
                unidades: packU,
                kilosHijoEsperados: kuCaja > 0 ? (kuCaja / packU) : null,
                etiquetaFuente: `✨ Configurado en Búnker (${packU} un.)`
            };
        }

        return { unidades: null, kilosHijoEsperados: null, etiquetaFuente: '' };
    }

    function extraerAtributosCompletosSet(art) {
        const set = new Set();
        let pd = art?.propiedades_dinamicas;
        if (typeof pd === 'string') {
            try { pd = JSON.parse(pd); } catch (_) { pd = null; }
        }
        if (pd?.posiciones && typeof pd.posiciones === 'object') {
            Object.values(pd.posiciones).forEach(p => {
                if (p && p.valor) {
                    set.add(normalizarTexto(p.valor));
                }
            });
        }
        return set;
    }

    function sugerirFraccionesPorSimilitud(caja, formatoCaja) {
        if (!caja || !catalogoBunker.length) return [];

        let pdCaja = caja.propiedades_dinamicas;
        if (typeof pdCaja === 'string') {
            try { pdCaja = JSON.parse(pdCaja); } catch (_) { pdCaja = null; }
        }
        const principalCaja = normalizarTexto(pdCaja?.articulo_principal || '');
        const attrsCaja = extraerAtributosCompletosSet(caja);
        const kuCaja = parseFloat(caja.kilos_unidad) || 0;
        const kilosHijoEsp = formatoCaja?.kilosHijoEsperados || null;

        const candidatos = [];

        for (const cand of catalogoBunker) {
            if (cand.articulo_numero === caja.articulo_numero) continue;

            // Evitar sugerir otra caja padre explícita (ej. "2 x 5kg" o es_pack con pack_unidades > 1)
            const descCand = String(cand.descripcion_generada || cand.descripcion || '');
            if (/\b\d+\s*[xX]\s*\d+/.test(descCand) || (cand.es_pack && (parseInt(cand.pack_unidades, 10) || 0) > 1)) {
                continue;
            }

            let pdCand = cand.propiedades_dinamicas;
            if (typeof pdCand === 'string') {
                try { pdCand = JSON.parse(pdCand); } catch (_) { pdCand = null; }
            }
            const principalCand = normalizarTexto(pdCand?.articulo_principal || '');

            // Si ambos definen artículo principal y no coinciden, descartar (ej: no sugerir Almendra para Nuez)
            if (principalCaja && principalCand && principalCaja !== principalCand) {
                continue;
            }

            let score = 0;
            if (caja.familia_id && cand.familia_id && Number(caja.familia_id) === Number(cand.familia_id)) {
                score += 20;
            }
            if (principalCaja && principalCaja === principalCand) {
                score += 45;
            }

            const attrsCand = extraerAtributosCompletosSet(cand);
            attrsCaja.forEach(val => {
                if (attrsCand.has(val)) score += 18;
            });

            const kuCand = parseFloat(cand.kilos_unidad) || 0;
            if (kilosHijoEsp && kuCand > 0) {
                if (Math.abs(kuCand - kilosHijoEsp) < 0.02) {
                    score += 55;
                } else {
                    score -= 20;
                }
            } else if (kuCaja > 0 && kuCand > 0 && kuCand < kuCaja) {
                const ratio = kuCaja / kuCand;
                if (ratio >= 2 && ratio <= 50 && Math.abs(ratio - Math.round(ratio)) < 0.01) {
                    score += 35;
                }
            }

            if (score >= 55) {
                candidatos.push({ art: cand, score });
            }
        }

        candidatos.sort((a, b) => b.score - a.score);
        return candidatos.slice(0, 4).map(c => c.art);
    }

    // ==========================================
    // FECHAS Y UTILIDADES
    // ==========================================

    function obtenerFechasPorDefecto() {
        const hoy = new Date();
        const elab = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;
        const vencDate = new Date(hoy);
        vencDate.setMonth(vencDate.getMonth() + 8);
        const venc = `${String(vencDate.getDate()).padStart(2, '0')}/${String(vencDate.getMonth() + 1).padStart(2, '0')}/${vencDate.getFullYear()}`;
        return { elaboracion: elab, vencimiento: venc };
    }

    function escaparHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ==========================================
    // INICIALIZACIÓN Y LISTENERS
    // ==========================================

    function inicializarModal() {
        modalElement = document.getElementById('modal-abrir-caja');
        if (!modalElement) return false;

        if (!inicializado) {
            configurarEventListeners();
            hacerDraggable();
            inicializado = true;
        }
        return true;
    }

    function configurarEventListeners() {
        const inputCaja = document.getElementById('ac-input-omnibox-caja');
        const btnLimpiarCaja = document.getElementById('ac-limpiar-omnibox-caja');
        const inputUnidad = document.getElementById('ac-input-omnibox-unidad');
        const btnLimpiarUnidad = document.getElementById('ac-limpiar-omnibox-unidad');

        // Omnibox Paso 1 (Caja)
        if (inputCaja) {
            inputCaja.addEventListener('input', () => {
                const val = inputCaja.value;
                if (btnLimpiarCaja) btnLimpiarCaja.style.display = val ? 'block' : 'none';
                filtrarOmniboxCaja(val);
            });
            inputCaja.addEventListener('keydown', manejarTecladoOmniboxCaja);
            inputCaja.addEventListener('focus', () => {
                if (inputCaja.value.trim()) filtrarOmniboxCaja(inputCaja.value);
            });
        }
        btnLimpiarCaja?.addEventListener('click', () => {
            if (inputCaja) {
                inputCaja.value = '';
                btnLimpiarCaja.style.display = 'none';
                filtrarOmniboxCaja('');
                inputCaja.focus();
            }
        });

        // Omnibox Paso 2 (Unidad/Fracción)
        if (inputUnidad) {
            inputUnidad.addEventListener('input', () => {
                const val = inputUnidad.value;
                if (btnLimpiarUnidad) btnLimpiarUnidad.style.display = val ? 'block' : 'none';
                filtrarOmniboxUnidad(val);
            });
            inputUnidad.addEventListener('keydown', manejarTecladoOmniboxUnidad);
            inputUnidad.addEventListener('focus', () => {
                if (inputUnidad.value.trim()) filtrarOmniboxUnidad(inputUnidad.value);
            });
        }
        btnLimpiarUnidad?.addEventListener('click', () => {
            if (inputUnidad) {
                inputUnidad.value = '';
                btnLimpiarUnidad.style.display = 'none';
                filtrarOmniboxUnidad('');
                inputUnidad.focus();
            }
        });

        // Botones Cambiar (Reinicio en cascada)
        document.getElementById('ac-btn-cambiar-caja')?.addEventListener('click', reiniciarACambioDeCaja);
        document.getElementById('ac-btn-cambiar-unidad')?.addEventListener('click', activarModoCambioUnidad);

        // Stepper de cantidad de cajas a abrir
        document.getElementById('ac-btn-menos-cajas')?.addEventListener('click', () => ajustarCantidadCajas(-1));
        document.getElementById('ac-btn-mas-cajas')?.addEventListener('click', () => ajustarCantidadCajas(1));
        document.getElementById('ac-cantidad-cajas')?.addEventListener('input', () => {
            normalizarCantidadCajasInput();
            actualizarVistaPreviaConversion();
            actualizarEstadoPasosYBotones();
        });

        // Unidades por caja
        document.getElementById('abrir-caja-cantidad')?.addEventListener('input', () => {
            const badgeFuente = document.getElementById('ac-fuente-unidades-badge');
            if (badgeFuente) badgeFuente.textContent = '✏️ Editado manual';
            actualizarVistaPreviaConversion();
            actualizarEstadoPasosYBotones();
        });

        // Operador (recordar en localStorage)
        document.getElementById('abrir-caja-usuario')?.addEventListener('change', (e) => {
            if (e.target.value) {
                try { localStorage.setItem(STORAGE_ULTIMO_USUARIO, String(e.target.value)); } catch (_) {}
            }
            actualizarEstadoPasosYBotones();
        });

        // Lote y fechas opcionales
        document.getElementById('btn-regenerar-lote')?.addEventListener('click', () => {
            solicitarLoteSugerido(cajaSeleccionada?.articulo_numero, true);
        });
        const inputLoteEl = document.getElementById('abrir-caja-lote');
        if (inputLoteEl) {
            inputLoteEl.addEventListener('input', (e) => {
                loteActual = e.target.value.trim().toUpperCase();
                e.target.value = loteActual;
                const matchActivo = lotesPadreActivos.find(l => String(l.lote_codigo_corto).toUpperCase() === loteActual);
                if (matchActivo) {
                    origenLote = lotesPadreActivos.length > 1 ? 'lote_confirmado' : 'lote_unico';
                    loteProveedor = matchActivo.proveedor_nombre || '';
                } else {
                    origenLote = 'manual';
                }
                renderizarAlertaMultiLote();
                actualizarInfoLoteUI();
                actualizarVistaPreviaConversion();
                actualizarEstadoPasosYBotones();
            });
            inputLoteEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    loteActual = inputLoteEl.value.trim().toUpperCase();
                    inputLoteEl.value = loteActual;
                    const matchActivo = lotesPadreActivos.find(l => String(l.lote_codigo_corto).toUpperCase() === loteActual);
                    if (matchActivo) {
                        origenLote = lotesPadreActivos.length > 1 ? 'lote_confirmado' : 'lote_unico';
                        loteProveedor = matchActivo.proveedor_nombre || '';
                    } else if (loteActual) {
                        origenLote = 'manual';
                    }
                    renderizarAlertaMultiLote();
                    actualizarInfoLoteUI();
                    actualizarVistaPreviaConversion();
                    actualizarEstadoPasosYBotones();
                    document.getElementById('btn-confirmar-caja')?.focus();
                }
            });
        }

        // Checkbox opcional para incluir Elaboración y Vencimiento (por defecto apagado)
        document.getElementById('ac-check-incluir-fechas')?.addEventListener('change', (e) => {
            const box = document.getElementById('ac-fechas-collapse');
            const inputElab = document.getElementById('abrir-caja-fecha-elab');
            const inputVenc = document.getElementById('abrir-caja-fecha-venc');
            if (!box) return;

            if (e.target.checked) {
                const fechasDef = obtenerFechasPorDefecto();
                if (inputElab && !inputElab.value.trim()) inputElab.value = fechasDef.elaboracion;
                if (inputVenc && !inputVenc.value.trim()) inputVenc.value = fechasDef.vencimiento;
                box.style.display = 'grid';
                setTimeout(() => inputElab?.focus(), 40);
            } else {
                box.style.display = 'none';
            }
        });

        // Acciones finales
        document.getElementById('btn-confirmar-caja')?.addEventListener('click', () => ejecutarApertura(true));
        document.getElementById('btn-solo-abrir-caja')?.addEventListener('click', () => ejecutarApertura(false));

        // Cerrar con Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modalElement && modalElement.style.display === 'flex') {
                cerrarModal();
            }
        });
    }

    function hacerDraggable() {
        const modal = document.querySelector('#modal-abrir-caja .modal-content');
        const header = document.getElementById('modal-abrir-caja-header');
        if (!modal || !header) return;

        let isDragging = false;
        let initialX = 0;
        let initialY = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('modal-close')) return;
            isDragging = true;
            initialX = e.clientX - (modal.offsetLeft || 0);
            initialY = e.clientY - (modal.offsetTop || 0);
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            modal.style.position = 'fixed';
            modal.style.left = (e.clientX - initialX) + 'px';
            modal.style.top = (e.clientY - initialY) + 'px';
            modal.style.transform = 'none';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    // ==========================================
    // CARGA DE CATÁLOGO BÚNKER Y OPERADORES
    // ==========================================

    async function cargarCatalogoBunker() {
        try {
            const resp = await fetch('/api/produccion/abrir-caja/catalogo');
            if (!resp.ok) throw new Error('Error al obtener catálogo Búnker');
            const data = await resp.json();

            catalogoBunker = (data.articulos || []).map(art => ({
                ...art,
                _bolsaBusqueda: construirBolsaBusquedaBunker(art)
            }));

            mapaPorSku.clear();
            catalogoBunker.forEach(art => {
                mapaPorSku.set(String(art.articulo_numero).trim(), art);
            });

            aprendizajesLista = data.aprendizajes || [];
            ultimasCajasConStock = data.ultimas_cajas_con_stock || [];

            renderizarUltimasCajasConStock();
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error cargando catálogo Búnker:', error);
            mostrarMensaje('Error al cargar catálogo Búnker. Verifique conexión.', 'error');
        }
    }

    async function cargarUsuariosYPreseleccionar() {
        const select = document.getElementById('abrir-caja-usuario');
        if (!select) return;

        try {
            if (!usuariosCargados || select.options.length <= 1) {
                const resp = await fetch('/api/usuarios/con-permiso/Produccion');
                if (resp.ok) {
                    const usuarios = await resp.json();
                    select.innerHTML = '<option value="">-- Seleccionar operador --</option>';
                    usuarios.forEach(u => {
                        const opt = document.createElement('option');
                        opt.value = String(u.id);
                        opt.textContent = u.nombre_completo;
                        select.appendChild(opt);
                    });
                    usuariosCargados = true;
                }
            }

            // Preseleccionar operador activo o último operador usado en esta PC
            if (!select.value) {
                let idPreferido = null;
                try {
                    const colabRaw = localStorage.getItem('colaboradorActivo');
                    if (colabRaw) {
                        const colab = JSON.parse(colabRaw);
                        if (colab && colab.id) idPreferido = String(colab.id);
                    }
                    if (!idPreferido) {
                        idPreferido = localStorage.getItem(STORAGE_ULTIMO_USUARIO);
                    }
                } catch (_) {}

                if (idPreferido && Array.from(select.options).some(o => o.value === String(idPreferido))) {
                    select.value = String(idPreferido);
                }
            }
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error al cargar operadores:', error);
        }
    }

    function renderizarUltimasCajasConStock() {
        const wrap = document.getElementById('ac-ultimas-cajas-wrap');
        const lista = document.getElementById('ac-ultimas-cajas-lista');
        if (!wrap || !lista) return;

        // Si estamos en modo contextual con cajas sugeridas propias, priorizamos esas
        if (unidadPreseleccionadaContextual) {
            wrap.style.display = 'none';
            return;
        }

        lista.innerHTML = '';
        if (!ultimasCajasConStock || ultimasCajasConStock.length === 0) {
            wrap.style.display = 'none';
            return;
        }

        ultimasCajasConStock.forEach(item => {
            const artCaja = mapaPorSku.get(item.codigo_caja);
            if (!artCaja || parseFloat(artCaja.stock_actual || 0) < 1) return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ac-chip';
            btn.innerHTML = `
                <span>📦 <strong>${escaparHtml(artCaja.descripcion)}</strong></span>
                <span style="color:#15803d; font-weight:800;">(${parseFloat(artCaja.stock_actual).toFixed(0)} cj)</span>
                <span style="color:#64748b;">➔ ${item.unidades_por_caja}× ${escaparHtml(item.codigo_unidad)}</span>
            `;
            btn.addEventListener('click', () => seleccionarCaja(artCaja));
            lista.appendChild(btn);
        });

        wrap.style.display = lista.children.length > 0 ? 'block' : 'none';
    }

    // ==========================================
    // OMNIBÚSQUEDA EN VIVO — PASO 1 (CAJA BÚNKER)
    // ==========================================

    function buscarMatchExactoCodigo(queryRaw, excluirSku = null) {
        const limpio = String(queryRaw || '').trim();
        if (!limpio) return null;
        const upper = limpio.toUpperCase();

        // 1° Código de barras oficial o local
        const porBarcode = catalogoBunker.find(a =>
            a.articulo_numero !== excluirSku &&
            ((a.codigo_barras && String(a.codigo_barras).trim() === limpio) ||
             (a.codigo_barras_local && String(a.codigo_barras_local).trim() === limpio))
        );
        if (porBarcode) return porBarcode;

        // 2° SKU exacto (solo si no tiene espacios)
        if (!/\s/.test(limpio)) {
            const porSku = catalogoBunker.find(a =>
                a.articulo_numero !== excluirSku &&
                String(a.articulo_numero).trim().toUpperCase() === upper
            );
            if (porSku) return porSku;
        }

        return null;
    }

    function filtrarOmniboxCaja(textoRaw) {
        clearTimeout(timerAutoScanCaja);
        const dropdown = document.getElementById('ac-resultados-caja');
        const tokensInfo = document.getElementById('ac-tokens-caja');
        if (!dropdown) return;

        const limpio = String(textoRaw || '').trim();
        if (!limpio) {
            dropdown.style.display = 'none';
            resultadosCajaVisibles = [];
            indiceHighlightCaja = -1;
            if (tokensInfo) {
                tokensInfo.innerHTML = '💡 Filtra en vivo sobre el Diccionario Búnker (palabras completas + nomenclador, separadas por espacio).';
            }
            return;
        }

        // Auto-selección rápida si es lectura de pistola numérica pura (>= 6 dígitos) con match exacto y stock >= 1
        if (/^\d{6,}$/.test(limpio)) {
            const exactoScan = buscarMatchExactoCodigo(limpio);
            if (exactoScan && parseFloat(exactoScan.stock_actual || 0) >= 1) {
                timerAutoScanCaja = setTimeout(() => {
                    if (document.getElementById('ac-input-omnibox-caja')?.value.trim() === limpio && !cajaSeleccionada) {
                        seleccionarCaja(exactoScan);
                    }
                }, 130);
            }
        }

        const norm = normalizarTexto(limpio);
        const terminos = norm.split(/\s+/).filter(Boolean);

        // Coincidencia por código de barras O por todos los grupos de caracteres en la bolsa Búnker
        const coincidencias = catalogoBunker.filter(art => {
            if (terminos.length === 1) {
                const unico = limpio.toUpperCase();
                if ((art.codigo_barras && String(art.codigo_barras).includes(limpio)) ||
                    (art.codigo_barras_local && String(art.codigo_barras_local).includes(limpio)) ||
                    String(art.articulo_numero).toUpperCase() === unico) {
                    return true;
                }
            }
            return terminos.every(t => art._bolsaBusqueda.includes(t));
        });

        // Ordenar: 1° con stock >= 1 (priorizando cajas con aprendizaje o formato NxM), 2° sin stock abajo
        const setCajasAprendidas = new Set(aprendizajesLista.map(a => a.codigo_caja));
        coincidencias.sort((a, b) => {
            const stockA = parseFloat(a.stock_actual || 0) >= 1 ? 1 : 0;
            const stockB = parseFloat(b.stock_actual || 0) >= 1 ? 1 : 0;
            if (stockA !== stockB) return stockB - stockA;

            const aprA = setCajasAprendidas.has(a.articulo_numero) ? 1 : 0;
            const aprB = setCajasAprendidas.has(b.articulo_numero) ? 1 : 0;
            if (aprA !== aprB) return aprB - aprA;

            return String(a.descripcion).localeCompare(String(b.descripcion), 'es', { sensitivity: 'base' });
        });

        const conStockCount = coincidencias.filter(c => parseFloat(c.stock_actual || 0) >= 1).length;
        if (tokensInfo) {
            const pills = terminos.map(t => `<span style="background:#e0f2fe; color:#0369a1; padding:1px 6px; border-radius:4px; font-weight:700;">${escaparHtml(t)}</span>`).join(' + ');
            tokensInfo.innerHTML = `🔎 Filtro activo: ${pills} — <strong>${conStockCount}</strong> con stock${coincidencias.length > conStockCount ? ` (${coincidencias.length - conStockCount} en stock 0)` : ''}`;
        }

        resultadosCajaVisibles = coincidencias.slice(0, 35);
        indiceHighlightCaja = resultadosCajaVisibles.findIndex(a => parseFloat(a.stock_actual || 0) >= 1);

        renderizarDropdownArticulos(dropdown, resultadosCajaVisibles, indiceHighlightCaja, true, (artElegido) => {
            if (parseFloat(artElegido.stock_actual || 0) < 1) {
                mostrarMensaje(`⚠️ La caja "${artElegido.descripcion}" figura con stock ${parseFloat(artElegido.stock_actual || 0).toFixed(2)}. Debe tener al menos 1 caja disponible.`, 'warning');
                return;
            }
            seleccionarCaja(artElegido);
        });
    }

    function manejarTecladoOmniboxCaja(e) {
        const input = e.target;
        if (e.key === 'ArrowDown') {
            if (resultadosCajaVisibles.length > 0) {
                e.preventDefault();
                indiceHighlightCaja = Math.min(resultadosCajaVisibles.length - 1, indiceHighlightCaja + 1);
                actualizarHighlightVisual('ac-resultados-caja', indiceHighlightCaja);
            }
        } else if (e.key === 'ArrowUp') {
            if (resultadosCajaVisibles.length > 0) {
                e.preventDefault();
                indiceHighlightCaja = Math.max(0, indiceHighlightCaja - 1);
                actualizarHighlightVisual('ac-resultados-caja', indiceHighlightCaja);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(timerAutoScanCaja);
            const val = input.value.trim();
            if (!val) return;

            // 1° Match exacto por código de barras / SKU (pistola lectora)
            const exacto = buscarMatchExactoCodigo(val);
            if (exacto) {
                if (parseFloat(exacto.stock_actual || 0) < 1) {
                    mostrarMensaje(`⚠️ La caja escaneada "${exacto.descripcion}" figura sin stock disponible (${parseFloat(exacto.stock_actual || 0).toFixed(2)}).`, 'warning');
                    return;
                }
                seleccionarCaja(exacto);
                return;
            }

            // 2° Elemento resaltado en la lista filtrada
            const candidato = resultadosCajaVisibles[indiceHighlightCaja] || resultadosCajaVisibles[0];
            if (candidato) {
                if (parseFloat(candidato.stock_actual || 0) < 1) {
                    mostrarMensaje(`⚠️ "${candidato.descripcion}" no tiene stock de cajas cerradas (${parseFloat(candidato.stock_actual || 0).toFixed(2)}).`, 'warning');
                    return;
                }
                seleccionarCaja(candidato);
            } else {
                mostrarMensaje('No se encontró ninguna caja en Búnker con ese código o descripción.', 'warning');
            }
        }
    }

    // ==========================================
    // OMNIBÚSQUEDA EN VIVO — PASO 2 (FRACCIÓN BÚNKER)
    // ==========================================

    function filtrarOmniboxUnidad(textoRaw) {
        clearTimeout(timerAutoScanUnidad);
        const dropdown = document.getElementById('ac-resultados-unidad');
        const tokensInfo = document.getElementById('ac-tokens-unidad');
        if (!dropdown) return;

        const excluirSku = cajaSeleccionada?.articulo_numero || null;
        const limpio = String(textoRaw || '').trim();
        if (!limpio) {
            dropdown.style.display = 'none';
            resultadosUnidadVisibles = [];
            indiceHighlightUnidad = -1;
            if (tokensInfo) {
                tokensInfo.innerHTML = '💡 La primera vez elegís la fracción y el sistema la aprende automáticamente para las próximas cajas.';
            }
            return;
        }

        if (/^\d{6,}$/.test(limpio)) {
            const exactoScan = buscarMatchExactoCodigo(limpio, excluirSku);
            if (exactoScan) {
                timerAutoScanUnidad = setTimeout(() => {
                    if (document.getElementById('ac-input-omnibox-unidad')?.value.trim() === limpio && !datosArticuloUnidad) {
                        seleccionarUnidad(exactoScan, 'manual');
                    }
                }, 130);
            }
        }

        const norm = normalizarTexto(limpio);
        const terminos = norm.split(/\s+/).filter(Boolean);

        const coincidencias = catalogoBunker.filter(art => {
            if (excluirSku && art.articulo_numero === excluirSku) return false;
            if (terminos.length === 1) {
                const unico = limpio.toUpperCase();
                if ((art.codigo_barras && String(art.codigo_barras).includes(limpio)) ||
                    (art.codigo_barras_local && String(art.codigo_barras_local).includes(limpio)) ||
                    String(art.articulo_numero).toUpperCase() === unico) {
                    return true;
                }
            }
            return terminos.every(t => art._bolsaBusqueda.includes(t));
        });

        if (tokensInfo) {
            const pills = terminos.map(t => `<span style="background:#dbeafe; color:#1d4ed8; padding:1px 6px; border-radius:4px; font-weight:700;">${escaparHtml(t)}</span>`).join(' + ');
            tokensInfo.innerHTML = `🔎 Filtro activo: ${pills} — <strong>${coincidencias.length}</strong> fracciones Búnker`;
        }

        resultadosUnidadVisibles = coincidencias.slice(0, 35);
        indiceHighlightUnidad = resultadosUnidadVisibles.length > 0 ? 0 : -1;

        renderizarDropdownArticulos(dropdown, resultadosUnidadVisibles, indiceHighlightUnidad, false, (artElegido) => {
            seleccionarUnidad(artElegido, 'manual');
        });
    }

    function manejarTecladoOmniboxUnidad(e) {
        const input = e.target;
        if (e.key === 'ArrowDown') {
            if (resultadosUnidadVisibles.length > 0) {
                e.preventDefault();
                indiceHighlightUnidad = Math.min(resultadosUnidadVisibles.length - 1, indiceHighlightUnidad + 1);
                actualizarHighlightVisual('ac-resultados-unidad', indiceHighlightUnidad);
            }
        } else if (e.key === 'ArrowUp') {
            if (resultadosUnidadVisibles.length > 0) {
                e.preventDefault();
                indiceHighlightUnidad = Math.max(0, indiceHighlightUnidad - 1);
                actualizarHighlightVisual('ac-resultados-unidad', indiceHighlightUnidad);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(timerAutoScanUnidad);
            const val = input.value.trim();
            if (!val) return;

            const exacto = buscarMatchExactoCodigo(val, cajaSeleccionada?.articulo_numero);
            if (exacto) {
                seleccionarUnidad(exacto, 'manual');
                return;
            }

            const candidato = resultadosUnidadVisibles[indiceHighlightUnidad] || resultadosUnidadVisibles[0];
            if (candidato) {
                seleccionarUnidad(candidato, 'manual');
            }
        }
    }

    function renderizarDropdownArticulos(dropdown, lista, highlightIdx, exigirStockCaja, onSelect) {
        dropdown.innerHTML = '';

        if (!lista || lista.length === 0) {
            dropdown.innerHTML = '<div style="padding: 12px; color: #64748b; font-size: 13px;">No se encontraron artículos en Búnker con esos términos.</div>';
            dropdown.style.display = 'block';
            return;
        }

        lista.forEach((art, idx) => {
            const stock = parseFloat(art.stock_actual || 0);
            const sinStockCaja = exigirStockCaja && stock < 1;

            const row = document.createElement('div');
            row.className = 'ac-item-row'
                + (idx === highlightIdx ? ' ac-item-highlighted' : '')
                + (sinStockCaja ? ' ac-item-nostock' : '');

            const formato = exigirStockCaja ? deducirFormatoCaja(art) : null;
            const apr = exigirStockCaja ? aprendizajesLista.find(a => a.codigo_caja === art.articulo_numero) : null;
            const unidHint = apr
                ? `<span style="background:#dcfce7; color:#15803d; padding:1px 6px; border-radius:4px; font-weight:700;">⚡ ${apr.unidades_por_caja}× ${escaparHtml(apr.codigo_unidad)}</span>`
                : (formato?.unidades ? `<span style="background:#e0f2fe; color:#0369a1; padding:1px 6px; border-radius:4px; font-weight:700;">${formato.unidades} un/caja</span>` : '');

            row.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <div style="font-weight:700; color:#0f172a; font-size:13.5px;">${escaparHtml(art.descripcion)}</div>
                    ${unidHint}
                </div>
                <div style="font-size:11.5px; color:#475569; margin-top:3px; display:flex; flex-wrap:wrap; gap:12px;">
                    <span>SKU: <strong style="font-family:monospace;">${escaparHtml(art.articulo_numero)}</strong></span>
                    <span>Cód. Barras: <span style="font-family:monospace;">${escaparHtml(art.codigo_barras || '-')}</span></span>
                    <span>Stock: <strong style="color:${stock >= 1 ? '#15803d' : '#dc2626'};">${stock.toFixed(2)} ${exigirStockCaja ? 'cajas' : 'un.'}</strong>${sinStockCaja ? ' ⚠️ Sin stock' : ''}</span>
                    ${art.lote_padre_activo && exigirStockCaja ? `<span>Lote: <strong style="font-family:monospace; color:#0f766e;">${escaparHtml(art.lote_padre_activo)}</strong></span>` : ''}
                </div>
            `;

            row.addEventListener('click', () => onSelect(art));
            dropdown.appendChild(row);
        });

        dropdown.style.display = 'block';
    }

    function actualizarHighlightVisual(dropdownId, nuevoIdx) {
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown) return;
        const filas = dropdown.querySelectorAll('.ac-item-row');
        filas.forEach((f, idx) => {
            if (idx === nuevoIdx) {
                f.classList.add('ac-item-highlighted');
                f.scrollIntoView({ block: 'nearest' });
            } else {
                f.classList.remove('ac-item-highlighted');
            }
        });
    }

    // ==========================================
    // SELECCIÓN Y FLUJO PROGRESIVO DE PASOS
    // ==========================================

    async function seleccionarCaja(caja) {
        cajaSeleccionada = caja;
        ocultarMensaje();

        // Actualizar tarjeta de Paso 1
        document.getElementById('ac-caja-nombre').textContent = caja.descripcion;
        document.getElementById('ac-caja-sku').textContent = caja.articulo_numero;
        document.getElementById('ac-caja-barcode').textContent = caja.codigo_barras || '-';
        document.getElementById('ac-caja-stock').textContent = `${parseFloat(caja.stock_actual || 0).toFixed(2)} cajas`;

        const loteInfoSpan = document.getElementById('ac-caja-lote-info');
        const loteTextoEl = document.getElementById('ac-caja-lote-texto');
        lotesPadreActivos = Array.isArray(caja.lotes_padre_activos) ? caja.lotes_padre_activos : [];

        if (lotesPadreActivos.length > 1) {
            if (loteTextoEl) loteTextoEl.textContent = `${lotesPadreActivos.length} lotes en stock`;
            if (loteInfoSpan) loteInfoSpan.style.display = 'inline';
        } else if (lotesPadreActivos.length === 1 || caja.lote_padre_activo) {
            if (loteTextoEl) loteTextoEl.textContent = lotesPadreActivos[0]?.lote_codigo_corto || caja.lote_padre_activo;
            if (loteInfoSpan) loteInfoSpan.style.display = 'inline';
        } else if (loteInfoSpan) {
            loteInfoSpan.style.display = 'none';
        }

        document.getElementById('ac-caja-buscador-wrap').style.display = 'none';
        document.getElementById('ac-caja-resumen-card').style.display = 'block';
        document.getElementById('ac-resultados-caja').style.display = 'none';

        // Configurar tope de cajas a abrir según stock real entero disponible
        const maxCajas = Math.max(1, Math.floor(parseFloat(caja.stock_actual || 1)));
        const inputCantCajas = document.getElementById('ac-cantidad-cajas');
        if (inputCantCajas) {
            inputCantCajas.max = String(maxCajas);
            inputCantCajas.value = '1';
        }
        const hintMax = document.getElementById('ac-max-cajas-hint');
        if (hintMax) hintMax.textContent = `Disp: ${maxCajas} caja${maxCajas === 1 ? '' : 's'}`;

        // Lógica de lote: 1 lote único -> automático silencioso; >1 lotes -> pide escanear/elegir sin trabar; 0 -> consulta servidor
        if (lotesPadreActivos.length === 1) {
            loteActual = String(lotesPadreActivos[0].lote_codigo_corto).trim();
            loteProveedor = lotesPadreActivos[0].proveedor_nombre || '';
            origenLote = 'lote_unico';
            const inputLote = document.getElementById('abrir-caja-lote');
            if (inputLote) inputLote.value = loteActual;
            renderizarAlertaMultiLote();
            actualizarInfoLoteUI();
        } else if (lotesPadreActivos.length > 1) {
            // Dejamos precargado el primero (FIFO) para no trabar el flujo si decide continuar directo, pero pedimos escanear
            loteActual = String(lotesPadreActivos[0].lote_codigo_corto).trim();
            loteProveedor = lotesPadreActivos[0].proveedor_nombre || '';
            origenLote = 'multi_pendiente';
            const inputLote = document.getElementById('abrir-caja-lote');
            if (inputLote) inputLote.value = loteActual;
            renderizarAlertaMultiLote();
            actualizarInfoLoteUI();
        } else if (caja.lote_padre_activo) {
            loteActual = String(caja.lote_padre_activo).trim();
            loteProveedor = caja.lote_padre_proveedor || '';
            origenLote = 'lote_unico';
            const inputLote = document.getElementById('abrir-caja-lote');
            if (inputLote) inputLote.value = loteActual;
            renderizarAlertaMultiLote();
            actualizarInfoLoteUI();
        } else {
            renderizarAlertaMultiLote();
            solicitarLoteSugerido(caja.articulo_numero, false);
        }

        // Resolver Paso 2: ¿Aprendido, Contextual o Primera Vez?
        const formatoCaja = deducirFormatoCaja(caja);
        const inputUnidPorCaja = document.getElementById('abrir-caja-cantidad');
        const badgeFuenteUnid = document.getElementById('ac-fuente-unidades-badge');

        // Caso A: Ya venía fijada una unidad desde clic derecho en tabla de faltantes
        if (unidadPreseleccionadaContextual && unidadPreseleccionadaContextual.articulo_numero !== caja.articulo_numero) {
            const aprEspecifico = aprendizajesLista.find(a =>
                a.codigo_caja === caja.articulo_numero &&
                a.codigo_unidad === unidadPreseleccionadaContextual.articulo_numero
            );
            if (aprEspecifico && inputUnidPorCaja) {
                inputUnidPorCaja.value = String(aprEspecifico.unidades_por_caja);
                if (badgeFuenteUnid) badgeFuenteUnid.textContent = `⚡ Aprendido (${aprEspecifico.unidades_por_caja} un.)`;
            } else if (formatoCaja.unidades && inputUnidPorCaja) {
                inputUnidPorCaja.value = String(formatoCaja.unidades);
                if (badgeFuenteUnid) badgeFuenteUnid.textContent = formatoCaja.etiquetaFuente;
            }
            seleccionarUnidad(unidadPreseleccionadaContextual, 'contextual');
            return;
        }

        // Caso B: Aprendizaje previo de esta caja en abrir_caja_aprendizaje
        const apr = aprendizajesLista.find(a => a.codigo_caja === caja.articulo_numero);
        if (apr) {
            const unidAprendida = mapaPorSku.get(apr.codigo_unidad);
            if (unidAprendida && unidAprendida.articulo_numero !== caja.articulo_numero) {
                if (inputUnidPorCaja) inputUnidPorCaja.value = String(apr.unidades_por_caja);
                if (badgeFuenteUnid) {
                    badgeFuenteUnid.textContent = `⚡ Aprendido (${apr.veces_usado} ${apr.veces_usado === 1 ? 'vez' : 'veces'})`;
                }
                seleccionarUnidad(unidAprendida, 'aprendido', apr.veces_usado);
                return;
            }
        }

        // Caso C: Vínculo pack_hijo_codigo configurado en Búnker (solo lectura)
        if (caja.pack_hijo_codigo) {
            const hijoBunker = mapaPorSku.get(caja.pack_hijo_codigo)
                || catalogoBunker.find(a => a.codigo_barras === caja.pack_hijo_codigo);
            if (hijoBunker && hijoBunker.articulo_numero !== caja.articulo_numero) {
                const uDef = formatoCaja.unidades || 2;
                if (inputUnidPorCaja) inputUnidPorCaja.value = String(uDef);
                if (badgeFuenteUnid) badgeFuenteUnid.textContent = formatoCaja.etiquetaFuente || '✨ Vínculo Búnker';
                seleccionarUnidad(hijoBunker, 'aprendido', 1);
                return;
            }
        }

        // Caso D: Primera vez que se abre esta caja -> pre-llenar unidades deducidas y ofrecer sugerencias por similitud
        datosArticuloUnidad = null;
        if (formatoCaja.unidades && inputUnidPorCaja) {
            inputUnidPorCaja.value = String(formatoCaja.unidades);
            if (badgeFuenteUnid) badgeFuenteUnid.textContent = formatoCaja.etiquetaFuente;
        } else if (inputUnidPorCaja) {
            inputUnidPorCaja.value = '';
            if (badgeFuenteUnid) badgeFuenteUnid.textContent = '';
        }

        mostrarBuscadorUnidadConSugerencias(caja, formatoCaja);
        actualizarVistaPreviaConversion();
        actualizarEstadoPasosYBotones();

        setTimeout(() => document.getElementById('ac-input-omnibox-unidad')?.focus(), 60);
    }

    function mostrarBuscadorUnidadConSugerencias(caja, formatoCaja) {
        document.getElementById('ac-unidad-resumen-card').style.display = 'none';
        document.getElementById('ac-unidad-buscador-wrap').style.display = 'block';

        const sugWrap = document.getElementById('ac-sugerencias-unidad-similitud');
        const sugLista = document.getElementById('ac-lista-unidad-similitud');
        if (!sugWrap || !sugLista) return;

        sugLista.innerHTML = '';
        const sugeridos = sugerirFraccionesPorSimilitud(caja, formatoCaja || deducirFormatoCaja(caja));

        if (sugeridos.length > 0) {
            sugeridos.forEach(cand => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'ac-chip';
                chip.innerHTML = `
                    <span>🎯 <strong>${escaparHtml(cand.descripcion)}</strong></span>
                    <span style="font-family:monospace; color:#475569;">[${escaparHtml(cand.articulo_numero)}]</span>
                `;
                chip.addEventListener('click', () => seleccionarUnidad(cand, 'manual'));
                sugLista.appendChild(chip);
            });
            sugWrap.style.display = 'block';
        } else {
            sugWrap.style.display = 'none';
        }
    }

    function seleccionarUnidad(unidadArt, fuente = 'manual', vecesUsado = 0) {
        datosArticuloUnidad = unidadArt;
        fuenteSeleccionUnidad = fuente;

        document.getElementById('ac-unidad-nombre').textContent = unidadArt.descripcion;
        document.getElementById('ac-unidad-sku').textContent = unidadArt.articulo_numero;
        document.getElementById('ac-unidad-barcode').textContent = unidadArt.codigo_barras || '-';
        document.getElementById('ac-unidad-stock').textContent = `${parseFloat(unidadArt.stock_actual || 0).toFixed(2)} un.`;

        document.getElementById('ac-unidad-buscador-wrap').style.display = 'none';
        document.getElementById('ac-resultados-unidad').style.display = 'none';
        document.getElementById('ac-unidad-resumen-card').style.display = 'block';

        // Si las unidades por caja aún estaban vacías (ej: caja decía "x 10kg" y fracción "x 5kg"), deducir por cociente exacto de kilos Búnker
        const inputUnidPorCaja = document.getElementById('abrir-caja-cantidad');
        const badgeFuenteUnid = document.getElementById('ac-fuente-unidades-badge');
        if (inputUnidPorCaja && (!inputUnidPorCaja.value || parseInt(inputUnidPorCaja.value, 10) < 1) && cajaSeleccionada) {
            const kuCaja = parseFloat(cajaSeleccionada.kilos_unidad) || 0;
            const kuUnid = parseFloat(unidadArt.kilos_unidad) || 0;
            if (kuCaja > 0 && kuUnid > 0 && kuCaja > kuUnid) {
                const ratio = kuCaja / kuUnid;
                if (ratio >= 2 && ratio <= 200 && Math.abs(ratio - Math.round(ratio)) < 0.02) {
                    inputUnidPorCaja.value = String(Math.round(ratio));
                    if (badgeFuenteUnid) {
                        badgeFuenteUnid.textContent = `✨ Deducido (${kuCaja}kg ÷ ${kuUnid}kg = ${Math.round(ratio)})`;
                    }
                }
            }
        }

        const badgePaso2 = document.getElementById('ac-badge-paso-2');
        if (badgePaso2) {
            if (fuente === 'aprendido') {
                badgePaso2.style.background = '#dcfce7';
                badgePaso2.style.color = '#15803d';
                badgePaso2.textContent = vecesUsado > 1 ? `⚡ Aprendido (${vecesUsado} usos)` : '⚡ Aprendido automáticamente';
            } else if (fuente === 'contextual') {
                badgePaso2.style.background = '#dbeafe';
                badgePaso2.style.color = '#1d4ed8';
                badgePaso2.textContent = '🎯 Producto solicitado';
            } else {
                badgePaso2.style.background = '#e0f2fe';
                badgePaso2.style.color = '#0369a1';
                badgePaso2.textContent = '✔ Se aprenderá al confirmar';
            }
        }

        actualizarVistaPreviaConversion();
        actualizarEstadoPasosYBotones();

        // Foco inteligente: si falta cantidad -> foco en cantidad; si hay múltiples lotes sin escanear -> foco en lote listo para pistola
        if (inputUnidPorCaja && (!inputUnidPorCaja.value || parseInt(inputUnidPorCaja.value, 10) < 1)) {
            setTimeout(() => inputUnidPorCaja.focus(), 50);
        } else if (origenLote === 'multi_pendiente') {
            setTimeout(() => {
                const inputLote = document.getElementById('abrir-caja-lote');
                if (inputLote && !inputLote.disabled) {
                    inputLote.focus();
                    inputLote.select();
                }
            }, 60);
        }
    }

    function reiniciarACambioDeCaja() {
        cajaSeleccionada = null;
        if (!unidadPreseleccionadaContextual) {
            datosArticuloUnidad = null;
        }
        loteActual = '';
        loteProveedor = '';
        origenLote = 'generado';
        lotesPadreActivos = [];
        renderizarAlertaMultiLote();

        document.getElementById('ac-caja-resumen-card').style.display = 'none';
        document.getElementById('ac-caja-buscador-wrap').style.display = 'block';

        const inputCaja = document.getElementById('ac-input-omnibox-caja');
        const btnLimpiarCaja = document.getElementById('ac-limpiar-omnibox-caja');
        if (inputCaja) inputCaja.value = '';
        if (btnLimpiarCaja) btnLimpiarCaja.style.display = 'none';
        filtrarOmniboxCaja('');

        if (!unidadPreseleccionadaContextual) {
            document.getElementById('ac-unidad-resumen-card').style.display = 'none';
            document.getElementById('ac-unidad-buscador-wrap').style.display = 'block';
            document.getElementById('ac-sugerencias-unidad-similitud').style.display = 'none';
            const inputUnidad = document.getElementById('ac-input-omnibox-unidad');
            if (inputUnidad) inputUnidad.value = '';
            const inputCant = document.getElementById('abrir-caja-cantidad');
            if (inputCant) inputCant.value = '';
            const badgeFuente = document.getElementById('ac-fuente-unidades-badge');
            if (badgeFuente) badgeFuente.textContent = '';
        }

        const inputLote = document.getElementById('abrir-caja-lote');
        if (inputLote) inputLote.value = '';

        renderizarUltimasCajasConStock();
        actualizarVistaPreviaConversion();
        actualizarEstadoPasosYBotones();
        ocultarMensaje();

        setTimeout(() => inputCaja?.focus(), 60);
    }

    function activarModoCambioUnidad() {
        unidadPreseleccionadaContextual = null;
        datosArticuloUnidad = null;

        const inputUnidad = document.getElementById('ac-input-omnibox-unidad');
        const btnLimpiarUnidad = document.getElementById('ac-limpiar-omnibox-unidad');
        if (inputUnidad) inputUnidad.value = '';
        if (btnLimpiarUnidad) btnLimpiarUnidad.style.display = 'none';
        filtrarOmniboxUnidad('');

        mostrarBuscadorUnidadConSugerencias(cajaSeleccionada, deducirFormatoCaja(cajaSeleccionada));
        actualizarVistaPreviaConversion();
        actualizarEstadoPasosYBotones();

        setTimeout(() => inputUnidad?.focus(), 60);
    }

    function ajustarCantidadCajas(delta) {
        const input = document.getElementById('ac-cantidad-cajas');
        if (!input || !cajaSeleccionada) return;
        const max = Math.max(1, Math.floor(parseFloat(cajaSeleccionada.stock_actual || 1)));
        const actual = parseInt(input.value, 10) || 1;
        const nuevo = Math.min(max, Math.max(1, actual + delta));
        input.value = String(nuevo);
        actualizarVistaPreviaConversion();
        actualizarEstadoPasosYBotones();
    }

    function normalizarCantidadCajasInput() {
        const input = document.getElementById('ac-cantidad-cajas');
        if (!input || !cajaSeleccionada) return;
        const max = Math.max(1, Math.floor(parseFloat(cajaSeleccionada.stock_actual || 1)));
        let val = parseInt(input.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > max) val = max;
        input.value = String(val);
    }

    function actualizarVistaPreviaConversion() {
        const preview = document.getElementById('ac-conversion-preview');
        const displayEtiquetas = document.getElementById('display-cant-etiquetas');
        const btnConfirmar = document.getElementById('btn-confirmar-caja');

        const cantCajas = Math.max(1, parseInt(document.getElementById('ac-cantidad-cajas')?.value, 10) || 1);
        const unidPorCaja = parseInt(document.getElementById('abrir-caja-cantidad')?.value, 10) || 0;
        const totalUnidades = cantCajas * unidPorCaja;

        if (displayEtiquetas) {
            if (totalUnidades > 0 && datosArticuloUnidad) {
                displayEtiquetas.textContent = `${totalUnidades} ${totalUnidades === 1 ? 'par' : 'pares'} (${totalUnidades}× Artículo "${datosArticuloUnidad.articulo_numero}" + ${totalUnidades}× Lote "${loteActual || '...'}")`;
            } else {
                displayEtiquetas.textContent = '0 pares (Artículo + Lote)';
            }
        }

        if (btnConfirmar) {
            btnConfirmar.textContent = totalUnidades > 0
                ? `🖨️ Confirmar e Imprimir en Zebra (${totalUnidades} ${totalUnidades === 1 ? 'par' : 'pares'})`
                : '🖨️ Confirmar e Imprimir en Zebra';
        }

        if (!preview) return;
        if (!cajaSeleccionada || !datosArticuloUnidad || unidPorCaja < 1) {
            preview.style.display = 'none';
            return;
        }

        const stockCajaRestante = Math.max(0, (parseFloat(cajaSeleccionada.stock_actual || 0) - cantCajas)).toFixed(2);
        const stockUnidNuevo = (parseFloat(datosArticuloUnidad.stock_actual || 0) + totalUnidades).toFixed(2);

        preview.innerHTML = `
            📉 Sale: <strong>−${cantCajas} ${cantCajas === 1 ? 'caja' : 'cajas'}</strong> de <code>${escaparHtml(cajaSeleccionada.articulo_numero)}</code> (quedan ${stockCajaRestante})
            &nbsp;&nbsp;➜&nbsp;&nbsp;
            📈 Entra: <strong>+${totalUnidades} un.</strong> de <code>${escaparHtml(datosArticuloUnidad.articulo_numero)}</code> (pasa a ${stockUnidNuevo})
        `;
        preview.style.display = 'block';
    }

    function actualizarEstadoPasosYBotones() {
        const paso1 = document.getElementById('ac-paso-1');
        const paso2 = document.getElementById('ac-paso-2');
        const paso3 = document.getElementById('ac-paso-3');
        const badge1 = document.getElementById('ac-badge-paso-1');
        const badge2 = document.getElementById('ac-badge-paso-2');
        const badge3 = document.getElementById('ac-badge-paso-3');

        const tieneCaja = Boolean(cajaSeleccionada);
        const unidPorCaja = parseInt(document.getElementById('abrir-caja-cantidad')?.value, 10) || 0;
        const cantCajas = parseInt(document.getElementById('ac-cantidad-cajas')?.value, 10) || 0;
        const tienePaso2 = tieneCaja && Boolean(datosArticuloUnidad) && unidPorCaja >= 1 && cantCajas >= 1;

        // Paso 1 visual
        if (paso1) {
            paso1.className = 'ac-step-card ' + (tieneCaja ? 'ac-step-done' : 'ac-step-active');
        }
        if (badge1) {
            if (tieneCaja) {
                badge1.style.background = '#dcfce7';
                badge1.style.color = '#15803d';
                badge1.textContent = '✔ Caja lista';
            } else {
                badge1.style.background = '#e0f2fe';
                badge1.style.color = '#0369a1';
                badge1.textContent = 'Escaneá o buscá en Búnker';
            }
        }

        // Controles de Paso 2
        const controlesPaso2 = [
            'ac-input-omnibox-unidad',
            'ac-btn-menos-cajas',
            'ac-cantidad-cajas',
            'ac-btn-mas-cajas',
            'abrir-caja-cantidad'
        ];
        controlesPaso2.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = !tieneCaja;
        });

        if (paso2) {
            if (!tieneCaja) {
                paso2.className = 'ac-step-card ac-step-locked';
                if (badge2) {
                    badge2.style.background = '#e2e8f0';
                    badge2.style.color = '#475569';
                    badge2.textContent = 'Completá el paso anterior';
                }
            } else if (tienePaso2) {
                paso2.className = 'ac-step-card ac-step-done';
            } else {
                paso2.className = 'ac-step-card ac-step-active';
                if (badge2 && !datosArticuloUnidad) {
                    badge2.style.background = '#e0f2fe';
                    badge2.style.color = '#0369a1';
                    badge2.textContent = 'Elegí fracción y cantidad';
                }
            }
        }

        // Controles de Paso 3
        const controlesPaso3 = [
            'abrir-caja-usuario',
            'abrir-caja-lote',
            'btn-regenerar-lote',
            'ac-check-incluir-fechas',
            'abrir-caja-fecha-elab',
            'abrir-caja-fecha-venc',
            'ac-check-continuar'
        ];
        controlesPaso3.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = !tienePaso2;
        });

        const usuarioVal = document.getElementById('abrir-caja-usuario')?.value;
        const loteVal = document.getElementById('abrir-caja-lote')?.value.trim();
        const todoListo = tienePaso2 && Boolean(usuarioVal) && Boolean(loteVal);

        if (paso3) {
            if (!tienePaso2) {
                paso3.className = 'ac-step-card ac-step-locked';
                if (badge3) {
                    badge3.style.background = '#e2e8f0';
                    badge3.style.color = '#475569';
                    badge3.textContent = 'Completá el paso anterior';
                }
            } else if (todoListo) {
                paso3.className = 'ac-step-card ac-step-active';
                if (badge3) {
                    if (origenLote === 'multi_pendiente') {
                        badge3.style.background = '#fef3c7';
                        badge3.style.color = '#b45309';
                        badge3.textContent = '⚠️ Varios lotes (podés escanear o seguir)';
                    } else {
                        badge3.style.background = '#dcfce7';
                        badge3.style.color = '#15803d';
                        badge3.textContent = '✔ Listo para confirmar';
                    }
                }
            } else {
                paso3.className = 'ac-step-card ac-step-active';
                if (badge3) {
                    badge3.style.background = '#fef3c7';
                    badge3.style.color = '#b45309';
                    badge3.textContent = 'Seleccioná operador';
                }
            }
        }

        const btnConfirmar = document.getElementById('btn-confirmar-caja');
        const btnSoloAbrir = document.getElementById('btn-solo-abrir-caja');
        if (btnConfirmar) btnConfirmar.disabled = !todoListo;
        if (btnSoloAbrir) btnSoloAbrir.disabled = !todoListo;
    }

    // ==========================================
    // HERENCIA DE LOTE E IMPRESIÓN ZEBRA
    // ==========================================

    function renderizarAlertaMultiLote() {
        const alerta = document.getElementById('ac-alerta-multi-lote');
        const titulo = document.getElementById('ac-alerta-multi-lote-titulo');
        const chipsCont = document.getElementById('ac-chips-multi-lote');
        if (!alerta || !chipsCont) return;

        if (!cajaSeleccionada || !Array.isArray(lotesPadreActivos) || lotesPadreActivos.length <= 1) {
            alerta.style.display = 'none';
            chipsCont.innerHTML = '';
            return;
        }

        const yaConfirmado = origenLote === 'lote_confirmado';
        alerta.style.background = yaConfirmado ? '#f0fdf4' : '#fffbeb';
        alerta.style.borderColor = yaConfirmado ? '#86efac' : '#fcd34d';
        alerta.style.color = yaConfirmado ? '#14532d' : '#92400e';

        if (titulo) {
            titulo.textContent = yaConfirmado
                ? `✔ Lote ${loteActual} seleccionado entre los ${lotesPadreActivos.length} lotes en stock:`
                : `⚠️ Hay ${lotesPadreActivos.length} lotes en stock: escaneá la etiqueta de lote de la caja o elegí uno (si no, usará ${loteActual}):`;
        }

        chipsCont.innerHTML = '';
        lotesPadreActivos.forEach(item => {
            const cod = String(item.lote_codigo_corto).trim();
            const esActivo = cod.toUpperCase() === String(loteActual).toUpperCase();
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.style.cssText = `
                padding: 4px 10px;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 700;
                cursor: pointer;
                border: 1.5px solid ${esActivo ? '#16a34a' : '#cbd5e1'};
                background: ${esActivo ? '#dcfce7' : '#ffffff'};
                color: ${esActivo ? '#14532d' : '#334155'};
            `;
            const cjTxt = parseFloat(item.cajas_cerradas || 0) > 0 ? ` (${parseFloat(item.cajas_cerradas).toFixed(0)} cj)` : '';
            btn.innerHTML = `🏷️ <span style="font-family:monospace;">${escaparHtml(cod)}</span>${escaparHtml(cjTxt)}`;
            btn.addEventListener('click', () => {
                loteActual = cod;
                loteProveedor = item.proveedor_nombre || '';
                origenLote = 'lote_confirmado';
                const inputLote = document.getElementById('abrir-caja-lote');
                if (inputLote) inputLote.value = loteActual;
                renderizarAlertaMultiLote();
                actualizarInfoLoteUI();
                actualizarVistaPreviaConversion();
                actualizarEstadoPasosYBotones();
                document.getElementById('btn-confirmar-caja')?.focus();
            });
            chipsCont.appendChild(btn);
        });

        alerta.style.display = 'block';
    }

    async function solicitarLoteSugerido(codigoCaja, forzarNuevo = false) {
        try {
            let url = `/api/produccion/abrir-caja/lote-sugerido?forzar_nuevo=${forzarNuevo ? '1' : '0'}`;
            if (codigoCaja) url += `&codigo_caja=${encodeURIComponent(codigoCaja)}`;

            const resp = await fetch(url);
            if (!resp.ok) throw new Error('Error consultando lote');
            const data = await resp.json();

            if (data.success && data.lote) {
                loteActual = data.lote;
                loteProveedor = data.proveedor || '';
                if (forzarNuevo) {
                    origenLote = 'generado';
                } else if (Array.isArray(data.lotes_activos) && data.lotes_activos.length > 1) {
                    lotesPadreActivos = data.lotes_activos;
                    origenLote = 'multi_pendiente';
                } else if (data.origen === 'lote_caja') {
                    lotesPadreActivos = Array.isArray(data.lotes_activos) ? data.lotes_activos : [];
                    origenLote = 'lote_unico';
                } else {
                    origenLote = 'generado';
                }

                const inputLote = document.getElementById('abrir-caja-lote');
                if (inputLote) inputLote.value = loteActual;

                renderizarAlertaMultiLote();
                actualizarInfoLoteUI();
                actualizarVistaPreviaConversion();
                actualizarEstadoPasosYBotones();
            }
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error obteniendo lote:', error);
            if (!loteActual) {
                loteActual = 'L' + Math.random().toString(36).substring(2, 9).toUpperCase();
                origenLote = 'generado';
                const inputLote = document.getElementById('abrir-caja-lote');
                if (inputLote) inputLote.value = loteActual;
                actualizarInfoLoteUI();
                actualizarEstadoPasosYBotones();
            }
        }
    }

    function actualizarInfoLoteUI() {
        const badge = document.getElementById('badge-origen-lote');
        const info = document.getElementById('info-lote-origen');

        if (badge) {
            if (origenLote === 'lote_unico') {
                badge.style.background = '#dcfce7';
                badge.style.color = '#15803d';
                badge.textContent = '🟢 Único lote en stock (auto)';
            } else if (origenLote === 'lote_confirmado') {
                badge.style.background = '#dcfce7';
                badge.style.color = '#15803d';
                badge.textContent = '🟢 Lote confirmado';
            } else if (origenLote === 'multi_pendiente') {
                badge.style.background = '#fef3c7';
                badge.style.color = '#b45309';
                badge.textContent = `🟡 Sugerido (hay ${lotesPadreActivos.length} lotes)`;
            } else if (origenLote === 'manual') {
                badge.style.background = '#fef3c7';
                badge.style.color = '#b45309';
                badge.textContent = '✏️ Lote Manual / Escaneado';
            } else {
                badge.style.background = '#e0f2fe';
                badge.style.color = '#0369a1';
                badge.textContent = '✨ Lote Nuevo (Caja sin lote)';
            }
        }

        if (info) {
            if (origenLote === 'lote_unico') {
                info.textContent = `Único lote activo de la caja padre${loteProveedor ? ' (' + loteProveedor + ')' : ''}.`;
            } else if (origenLote === 'lote_confirmado') {
                info.textContent = `Lote verificado de la caja padre${loteProveedor ? ' (' + loteProveedor + ')' : ''}.`;
            } else if (origenLote === 'multi_pendiente') {
                info.textContent = 'Podés escanear el lote de la caja ahora o confirmar directo con el sugerido.';
            } else if (origenLote === 'manual') {
                info.textContent = 'Código de lote ingresado o escaneado manualmente.';
            } else {
                info.textContent = 'La caja padre no tenía lote vinculado; se generó un código nuevo.';
            }
        }
    }

    /**
     * Despacha la impresión en Zebra de N pares (Etiqueta de Artículo + Etiqueta de Lote).
     * Por defecto NO envía fechas de elaboración/vencimiento salvo que el operador marque el check explícito.
     */
    async function enviarImpresionZebra(articuloUnidad, totalUnidades, lote, incluirFechas = false, fechaElab = '', fechaVenc = '') {
        const payload = {
            articulo: {
                numero: articuloUnidad.articulo_numero,
                nombre: articuloUnidad.descripcion_generada || articuloUnidad.descripcion,
                codigo_barras: articuloUnidad.codigo_barras || articuloUnidad.articulo_numero
            },
            cantidad: totalUnidades,
            lote: lote,
            fechas: (incluirFechas && fechaElab && fechaVenc) ? {
                elaboracion: fechaElab,
                vencimiento: fechaVenc
            } : null
        };

        let resPrint = await fetch('/api/produccion/articulos/imprimir-etiqueta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(() => null);

        if (!resPrint || !resPrint.ok) {
            resPrint = await fetch('http://localhost:3000/api/imprimir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (!resPrint || !resPrint.ok) {
            throw new Error('No se pudo conectar con la impresora Zebra');
        }
    }

    // ==========================================
    // EJECUCIÓN ATÓMICA (ABRIR + IMPRIMIR ZEBRA)
    // ==========================================

    async function ejecutarApertura(imprimirEnZebra = true) {
        const usuarioId = parseInt(document.getElementById('abrir-caja-usuario')?.value, 10);
        const cantCajas = Math.max(1, parseInt(document.getElementById('ac-cantidad-cajas')?.value, 10) || 1);
        const unidPorCaja = parseInt(document.getElementById('abrir-caja-cantidad')?.value, 10) || 0;
        const totalUnidades = cantCajas * unidPorCaja;
        const lote = document.getElementById('abrir-caja-lote')?.value.trim() || loteActual;
        const incluirFechas = Boolean(document.getElementById('ac-check-incluir-fechas')?.checked);
        const fechaElab = document.getElementById('abrir-caja-fecha-elab')?.value.trim();
        const fechaVenc = document.getElementById('abrir-caja-fecha-venc')?.value.trim();
        const mantenerAbierto = Boolean(document.getElementById('ac-check-continuar')?.checked);

        if (!cajaSeleccionada || !datosArticuloUnidad || !usuarioId || unidPorCaja < 1 || !lote) {
            mostrarMensaje('Complete todos los campos requeridos antes de confirmar.', 'warning');
            return;
        }

        try {
            localStorage.setItem(STORAGE_ULTIMO_USUARIO, String(usuarioId));
        } catch (_) {}

        const btnConfirmar = document.getElementById('btn-confirmar-caja');
        const btnSoloAbrir = document.getElementById('btn-solo-abrir-caja');
        if (btnConfirmar) btnConfirmar.disabled = true;
        if (btnSoloAbrir) btnSoloAbrir.disabled = true;

        try {
            mostrarMensaje('Registrando apertura de caja y trazabilidad en Búnker...', 'info');

            const resp = await fetch('/api/produccion/abrir-caja', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    codigo_caja: cajaSeleccionada.articulo_numero,
                    codigo_unidad: datosArticuloUnidad.articulo_numero,
                    cantidad_cajas: cantCajas,
                    unidades_por_caja: unidPorCaja,
                    cantidad_unidades: totalUnidades,
                    usuario_id: usuarioId,
                    lote: lote,
                    kilos_caja: cajaSeleccionada.kilos_unidad || 0,
                    kilos_unidad: datosArticuloUnidad.kilos_unidad || 0
                })
            });

            const result = await resp.json();
            if (!resp.ok || !result.success) {
                throw new Error(result.detalle || result.error || 'Error al registrar apertura');
            }

            huboAperturasEnSesion = true;

            // Actualizar caché en memoria (stocks y aprendizaje) sin recargar página
            if (result.stocks_actualizados) {
                Object.entries(result.stocks_actualizados).forEach(([sku, nuevoStock]) => {
                    const item = mapaPorSku.get(sku);
                    if (item) item.stock_actual = nuevoStock;
                });
            }

            const idxApr = aprendizajesLista.findIndex(a =>
                a.codigo_caja === cajaSeleccionada.articulo_numero &&
                a.codigo_unidad === datosArticuloUnidad.articulo_numero
            );
            if (idxApr >= 0) {
                aprendizajesLista[idxApr].unidades_por_caja = unidPorCaja;
                aprendizajesLista[idxApr].veces_usado = (aprendizajesLista[idxApr].veces_usado || 1) + cantCajas;
                const actualizado = aprendizajesLista.splice(idxApr, 1)[0];
                aprendizajesLista.unshift(actualizado);
            } else {
                aprendizajesLista.unshift({
                    codigo_caja: cajaSeleccionada.articulo_numero,
                    codigo_unidad: datosArticuloUnidad.articulo_numero,
                    unidades_por_caja: unidPorCaja,
                    veces_usado: cantCajas
                });
            }

            // Enviar impresión automática a Zebra si corresponde
            let avisoImpresion = '';
            if (imprimirEnZebra) {
                try {
                    mostrarMensaje(`🖨️ Enviando ${totalUnidades} pares (Artículo + Lote ${lote}) a impresora Zebra...`, 'info');
                    await enviarImpresionZebra(datosArticuloUnidad, totalUnidades, lote, incluirFechas, fechaElab, fechaVenc);
                    avisoImpresion = ` | 🖨️ ${totalUnidades} pares impresos en Zebra`;
                } catch (printErr) {
                    console.error('❌ [ABRIR-CAJA] Error en impresión Zebra:', printErr);
                    mostrarMensaje(
                        `✅ Stock actualizado (+${totalUnidades} un. de ${datosArticuloUnidad.articulo_numero}, Lote ${lote}), pero falló la conexión con Zebra: ${printErr.message}`,
                        'warning'
                    );
                    refrescarVistasProduccionEnFondo();
                    if (btnConfirmar) btnConfirmar.disabled = false;
                    if (btnSoloAbrir) btnSoloAbrir.disabled = false;
                    return;
                }
            }

            mostrarMensaje(
                `✅ Apertura exitosa: −${cantCajas} caja(s) ➜ +${totalUnidades} un. de ${datosArticuloUnidad.descripcion} (Lote: ${lote})${avisoImpresion}`,
                'success'
            );

            refrescarVistasProduccionEnFondo();

            if (mantenerAbierto) {
                unidadPreseleccionadaContextual = null;
                await cargarCatalogoBunker();
                setTimeout(() => {
                    reiniciarACambioDeCaja();
                    mostrarMensaje(`✅ Última apertura lista (+${totalUnidades} un. Lote ${lote}). Escaneá la siguiente caja.`, 'success');
                }, 650);
            } else {
                setTimeout(() => {
                    cerrarModal();
                }, 1100);
            }
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error al ejecutar apertura:', error);
            mostrarMensaje(`❌ ${error.message}`, 'error');
            if (btnConfirmar) btnConfirmar.disabled = false;
            if (btnSoloAbrir) btnSoloAbrir.disabled = false;
        }
    }

    function refrescarVistasProduccionEnFondo() {
        try {
            if (typeof window.actualizarResumenFaltantes === 'function') {
                window.actualizarResumenFaltantes();
            }
            if (typeof window.cargarPedidosArticulos === 'function') {
                window.cargarPedidosArticulos();
            }
            if (typeof window.cargarPedidosPorCliente === 'function') {
                window.cargarPedidosPorCliente();
            }
        } catch (e) {
            console.warn('⚠️ [ABRIR-CAJA] Aviso refrescando tablas en segundo plano:', e);
        }
    }

    // ==========================================
    // MODO CONTEXTUAL (CLIC DERECHO EN FALTANTES)
    // ==========================================

    async function prepararModoContextualDesdeFaltante(articuloNumero, datosArticulo) {
        const unidBunker = mapaPorSku.get(String(articuloNumero).trim()) || (datosArticulo ? {
            articulo_numero: datosArticulo.articulo_numero || datosArticulo.codigo || articuloNumero,
            descripcion: datosArticulo.descripcion || datosArticulo.nombre || articuloNumero,
            codigo_barras: datosArticulo.codigo_barras || '',
            stock_actual: datosArticulo.stock_consolidado ?? datosArticulo.stock_disponible ?? 0,
            kilos_unidad: datosArticulo.kilos_unidad || 0
        } : null);

        if (!unidBunker) return;
        unidadPreseleccionadaContextual = unidBunker;
        seleccionarUnidad(unidBunker, 'contextual');

        // Buscar si existen cajas aprendidas con stock >= 1 para esta unidad
        try {
            const resp = await fetch(`/api/produccion/abrir-caja/sugerencias?articulo_unidad=${encodeURIComponent(unidBunker.articulo_numero)}`);
            if (!resp.ok) return;
            const data = await resp.json();
            const sugs = data.sugerencias || [];

            const wrapCtx = document.getElementById('ac-sugerencias-caja-contextual');
            const listaCtx = document.getElementById('ac-lista-caja-contextual');

            if (sugs.length === 1) {
                // Si hay una única caja habitual con stock, preseleccionarla directo
                const unicaCaja = mapaPorSku.get(sugs[0].codigo_caja);
                if (unicaCaja && parseFloat(unicaCaja.stock_actual || 0) >= 1) {
                    await seleccionarCaja(unicaCaja);
                    return;
                }
            }

            if (sugs.length > 0 && wrapCtx && listaCtx) {
                listaCtx.innerHTML = '';
                sugs.forEach((s, i) => {
                    const artCaja = mapaPorSku.get(s.codigo_caja);
                    if (!artCaja) return;
                    const chip = document.createElement('button');
                    chip.type = 'button';
                    chip.className = 'ac-chip';
                    chip.innerHTML = `
                        <span>${i === 0 ? '⭐' : '📦'} <strong>${escaparHtml(artCaja.descripcion)}</strong></span>
                        <span style="color:#15803d; font-weight:800;">(${parseFloat(artCaja.stock_actual).toFixed(0)} cj)</span>
                    `;
                    chip.addEventListener('click', () => seleccionarCaja(artCaja));
                    listaCtx.appendChild(chip);
                });
                wrapCtx.style.display = listaCtx.children.length > 0 ? 'block' : 'none';
            }
        } catch (err) {
            console.error('❌ [ABRIR-CAJA] Error consultando sugerencias contextuales:', err);
        }
    }

    // ==========================================
    // MENSAJES, RESET Y APERTURA / CIERRE
    // ==========================================

    function mostrarMensaje(texto, tipo) {
        const el = document.getElementById('mensaje-abrir-caja');
        if (!el) return;

        el.textContent = texto;
        if (tipo === 'success') {
            el.style.background = '#dcfce7';
            el.style.color = '#14532d';
            el.style.border = '1px solid #86efac';
        } else if (tipo === 'error') {
            el.style.background = '#fee2e2';
            el.style.color = '#991b1b';
            el.style.border = '1px solid #fca5a5';
        } else if (tipo === 'warning') {
            el.style.background = '#fef3c7';
            el.style.color = '#92400e';
            el.style.border = '1px solid #fcd34d';
        } else {
            el.style.background = '#e0f2fe';
            el.style.color = '#075985';
            el.style.border = '1px solid #7dd3fc';
        }
        el.style.display = 'block';
    }

    function ocultarMensaje() {
        const el = document.getElementById('mensaje-abrir-caja');
        if (el) el.style.display = 'none';
    }

    function resetearEstadoVisual() {
        cajaSeleccionada = null;
        datosArticuloUnidad = null;
        unidadPreseleccionadaContextual = null;
        fuenteSeleccionUnidad = '';
        loteActual = '';
        loteProveedor = '';
        origenLote = 'generado';
        lotesPadreActivos = [];
        huboAperturasEnSesion = false;

        // Por defecto NO incluir fechas de elaboración/vencimiento en etiquetas de artículos
        const chkFechas = document.getElementById('ac-check-incluir-fechas');
        const inputElab = document.getElementById('abrir-caja-fecha-elab');
        const inputVenc = document.getElementById('abrir-caja-fecha-venc');
        if (chkFechas) chkFechas.checked = false;
        if (inputElab) inputElab.value = '';
        if (inputVenc) inputVenc.value = '';
        const boxFechas = document.getElementById('ac-fechas-collapse');
        if (boxFechas) boxFechas.style.display = 'none';
        renderizarAlertaMultiLote();

        document.getElementById('ac-caja-resumen-card').style.display = 'none';
        document.getElementById('ac-caja-buscador-wrap').style.display = 'block';
        document.getElementById('ac-sugerencias-caja-contextual').style.display = 'none';

        document.getElementById('ac-unidad-resumen-card').style.display = 'none';
        document.getElementById('ac-unidad-buscador-wrap').style.display = 'block';
        document.getElementById('ac-sugerencias-unidad-similitud').style.display = 'none';

        const inputCaja = document.getElementById('ac-input-omnibox-caja');
        const inputUnidad = document.getElementById('ac-input-omnibox-unidad');
        const inputCant = document.getElementById('abrir-caja-cantidad');
        const inputCantCajas = document.getElementById('ac-cantidad-cajas');
        const inputLote = document.getElementById('abrir-caja-lote');
        const badgeFuente = document.getElementById('ac-fuente-unidades-badge');

        if (inputCaja) inputCaja.value = '';
        if (inputUnidad) inputUnidad.value = '';
        if (inputCant) inputCant.value = '';
        if (inputCantCajas) inputCantCajas.value = '1';
        if (inputLote) inputLote.value = '';
        if (badgeFuente) badgeFuente.textContent = '';

        document.getElementById('ac-limpiar-omnibox-caja').style.display = 'none';
        document.getElementById('ac-limpiar-omnibox-unidad').style.display = 'none';
        document.getElementById('ac-resultados-caja').style.display = 'none';
        document.getElementById('ac-resultados-unidad').style.display = 'none';

        ocultarMensaje();
        actualizarVistaPreviaConversion();
        actualizarEstadoPasosYBotones();
    }

    async function abrir(articuloNumero = null, datosArticulo = null) {
        if (!modalElement && !inicializarModal()) {
            alert('Error: Modal Abrir Caja no encontrado en la página.');
            return;
        }

        resetearEstadoVisual();
        modalElement.style.display = 'flex';

        await Promise.all([
            cargarCatalogoBunker(),
            cargarUsuariosYPreseleccionar()
        ]);

        if (articuloNumero) {
            await prepararModoContextualDesdeFaltante(articuloNumero, datosArticulo);
        }

        actualizarEstadoPasosYBotones();
        if (!cajaSeleccionada) {
            setTimeout(() => document.getElementById('ac-input-omnibox-caja')?.focus(), 80);
        }
    }

    function cerrarModal() {
        if (modalElement) modalElement.style.display = 'none';
        if (huboAperturasEnSesion) {
            refrescarVistasProduccionEnFondo();
        }
    }

    return {
        abrir,
        cerrar: cerrarModal
    };
})();

// Menú contextual en tabla de producción (clic derecho sobre faltante)
window.agregarOpcionAbrirCajaAlMenu = function (menuContextual, articuloNumero, datosArticulo) {
    if (!menuContextual) return;

    const opcion = document.createElement('div');
    opcion.className = 'context-menu-item';
    opcion.innerHTML = '📦 Abrir Caja';
    opcion.style.cssText = `
        padding: 12px 16px;
        cursor: pointer;
        transition: background 0.2s;
        border-bottom: 1px solid #e0e0e0;
        font-size: 14px;
        font-weight: 500;
        color: #212121;
    `;

    opcion.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const menuElement = document.getElementById('context-menu-articulo');
        if (menuElement) menuElement.remove();

        if (window.ModalAbrirCaja && typeof window.ModalAbrirCaja.abrir === 'function') {
            window.ModalAbrirCaja.abrir(articuloNumero, datosArticulo);
        }
        return false;
    }, true);

    opcion.addEventListener('mouseenter', () => opcion.style.background = '#f5f5f5');
    opcion.addEventListener('mouseleave', () => opcion.style.background = 'white');

    menuContextual.insertBefore(opcion, menuContextual.firstChild);
};

window.ModalAbrirCaja = ModalAbrirCaja;

document.addEventListener('DOMContentLoaded', function () {
    const btnGlobal = document.getElementById('btn-abrir-caja-global');
    if (btnGlobal) {
        btnGlobal.addEventListener('click', function (e) {
            e.preventDefault();
            if (window.ModalAbrirCaja && typeof window.ModalAbrirCaja.abrir === 'function') {
                window.ModalAbrirCaja.abrir();
            }
        });
    }
});
