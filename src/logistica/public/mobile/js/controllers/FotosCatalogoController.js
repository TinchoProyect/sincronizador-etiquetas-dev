/**
 * FotosCatalogoController.js
 * Controlador móvil dedicado a Imágenes Base LAMDA / Tiendas de Nodos,
 * Estudio IA Multimodal (0-2 fotos reales de referencia), Prompt Libre,
 * Biblioteca de Prompts Guardados y Biblioteca LAMDA.
 */

(function () {
    'use strict';

    const PRESETS_ESTUDIO = [
        { id: 'libre', label: '✍️ Prompt libre' },
        { id: 'cuenco_neutro', label: '🥣 Cuenco 45°' },
        { id: 'granel_cenital', label: '🪨 Cenital' },
        { id: 'macro_editorial', label: '🔍 Macro' },
        { id: 'mesa_cinematografica', label: '🎬 Mesa editorial' },
        { id: 'producto_elaborado', label: '🍫 Elaborado' },
        { id: 'fondo_blanco', label: '⬜ Fondo blanco' }
    ];

    const DESCRIPCIONES_PRESET = {
        cuenco_neutro: 'Fotografía gastronómica profesional en plano a 45 grados del ingrediente real servido en un cuenco cerámico artesanal minimalista de tono claro sobre superficie neutra cálida mate con luz natural suave de estudio.',
        granel_cenital: 'Fotografía gastronómica profesional en plano cenital (90 grados) del ingrediente real a granel dispuesto de forma orgánica y prolija sobre piedra natural clara o madera clara con luz difusa.',
        macro_editorial: 'Fotografía macro gastronómica de ultra detalle y enfoque selectivo del producto real, resaltando vetas, crocancia, textura natural e iluminación lateral cinematográfica suave.',
        mesa_cinematografica: 'Fotografía editorial gastronómica con el producto real esparcido de forma natural y armónica directamente sobre una mesa de madera cálida o piedra mate (sin cuenco ni recipiente), luz lateral cinematográfica suave.',
        producto_elaborado: 'Fotografía gastronómica comercial de estudio del producto elaborado real (por ejemplo barritas, bocados o granola) presentado entero y con un corte que muestre su interior, ingredientes visibles y textura real sobre superficie limpia (sin cuenco), luz lateral definida.',
        fondo_blanco: 'Fotografía profesional de catálogo e-commerce del ingrediente real agrupado en una pequeña pila limpia sobre fondo blanco puro minimalista con sombra natural muy sutil.'
    };

    function esc(v) {
        return String(v ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function normTxt(v) {
        return String(v ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    function limpiarTextoPrompt(v) {
        return String(v ?? '')
            .replace(/\bRELDO\b/gi, 'Repelado')
            .replace(/\bCHLER\b/gi, 'Chandler')
            .replace(/\bEXLIGHT\b/gi, 'Extra Light')
            .replace(/\bVGNA\b/gi, 'Virginia')
            .replace(/\bMPSA\b/gi, 'Mariposa')
            .replace(/\bS\/PIEL\b/gi, 'Sin piel')
            .replace(/\bC\/CASCARA\b/gi, 'Con cáscara')
            .replace(/\bS\/CASCARA\b/gi, 'Sin cáscara')
            .replace(/\bTOST\/SAL\b/gi, 'Tostado y Salado')
            .replace(/\bF\/SCOS\b/gi, 'Frutos Secos')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function interpolarPlaceholders(texto, { producto = '', rubro = '' } = {}) {
        return String(texto || '')
            .replace(/\{\{\s*PRODUCTO\s*\}\}/gi, String(producto || '').trim() || 'producto natural')
            .replace(/\{\{\s*RUBRO\s*\}\}/gi, String(rubro || '').trim() || 'Almacén')
            .replace(/[ \t]+/g, ' ')
            .trim();
    }

    function obtenerHeadersAuth(extra = {}) {
        const sesion = (typeof obtenerSesion === 'function') ? obtenerSesion() : null;
        const headers = { ...extra };
        if (sesion && sesion.token) {
            headers['Authorization'] = `Bearer ${sesion.token}`;
        }
        return headers;
    }

    async function apiFetch(url, options = {}) {
        const opts = {
            credentials: 'same-origin',
            ...options,
            headers: obtenerHeadersAuth(options.headers || {})
        };
        const resp = await fetch(url, opts);
        const data = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` }));
        if (!resp.ok || data.ok === false) {
            throw new Error(data.error || data.message || `Error HTTP ${resp.status}`);
        }
        return data;
    }

    function comprimirImagenCanvas(file, maxDim = 1280, quality = 0.84) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
            reader.onload = (ev) => {
                const img = new Image();
                img.onerror = () => reject(new Error('El archivo no es una imagen válida.'));
                img.onload = () => {
                    let w = img.naturalWidth || img.width || 1;
                    let h = img.naturalHeight || img.height || 1;
                    if (w > maxDim || h > maxDim) {
                        if (w >= h) {
                            h = Math.round((h * maxDim) / w);
                            w = maxDim;
                        } else {
                            w = Math.round((w * maxDim) / h);
                            h = maxDim;
                        }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    const dataUrl = canvas.toDataURL('image/jpeg', quality);
                    canvas.toBlob((blob) => {
                        canvas.width = 0;
                        canvas.height = 0;
                        if (!blob) return reject(new Error('No se pudo comprimir la fotografía.'));
                        const b64 = dataUrl.split(',')[1] || '';
                        resolve({
                            dataUrl,
                            mimeType: 'image/jpeg',
                            data: b64,
                            blob,
                            name: file.name || 'referencia.jpg'
                        });
                    }, 'image/jpeg', quality);
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    const ctrl = {
        anclas: [],
        familiasAbiertas: new Set(),
        filtro: 'todos', // 'todos' | 'sin_foto' | 'en_nodos'
        busqueda: '',

        // Selección actual de detalle
        rubroFocalKey: null,
        destinoModo: 'rubro', // 'rubro' | 'subrama' | 'variedad'
        destinoSubramaNorm: '',
        destinoVariedadClave: '',
        tabActiva: 'ia', // 'ia' | 'biblioteca' | 'directa'

        // Estudio IA
        preset: 'cuenco_neutro',
        modoPrompt: 'preset', // 'preset' | 'libre' | 'guardado'
        promptTexto: '',
        promptCustom: false,
        incluirReglaSinEnvases: true,
        incluirFidelidadReceta: true,
        calidad: 'estandar',
        referencias: [null, null],
        promptsGuardados: [],
        promptGuardadoId: null,
        generandoIa: false,
        previewIa: null,

        // Biblioteca
        bibScope: 'rubro', // 'rubro' | 'familia' | 'todas'
        bibBusqueda: '',
        bibItems: [],

        // Foto directa
        fotoDirecta: null,
        subiendoDirecta: false,

        async init() {
            await Promise.all([
                this.cargarCatalogo(false),
                this.cargarPromptsGuardados(true)
            ]);
        },

        async cargarCatalogo(silencioso = false) {
            const container = document.getElementById('fc-main-container');
            if (!silencioso && container && !this.rubroFocalKey) {
                container.innerHTML = '<div style="text-align:center; padding:2.5rem 1rem; color:#94a3b8;">Cargando catálogo de Tiendas LAMDA...</div>';
            }
            try {
                const data = await apiFetch('/api/produccion/nodos/admin/imagenes-base?solo_nodos=false&incluir_internas=false');
                this.anclas = data.anclas_principales || [];
                if (this.familiasAbiertas.size === 0 && this.anclas.length > 0) {
                    this.familiasAbiertas.add(this.anclas[0].familia_nombre);
                }
                this.render();
            } catch (err) {
                if (container) {
                    container.innerHTML = `<div class="fc-card" style="border-color:rgba(239,68,68,0.5); color:#fca5a5;">Error cargando catálogo: ${esc(err.message)}</div>`;
                }
            }
        },

        async cargarPromptsGuardados(silencioso = false) {
            try {
                const data = await apiFetch('/api/produccion/nodos/admin/imagenes-base/prompts');
                this.promptsGuardados = data.items || [];
                if (!silencioso) this.render();
            } catch (_) {}
        },

        onBuscar(val) {
            this.busqueda = String(val || '');
            this.render();
        },

        setFiltro(f, btnEl) {
            this.filtro = f;
            document.querySelectorAll('[data-fc-filtro]').forEach(el => el.classList.remove('active'));
            if (btnEl) btnEl.classList.add('active');
            this.render();
        },

        toggleFamilia(famNombre) {
            if (this.familiasAbiertas.has(famNombre)) {
                this.familiasAbiertas.delete(famNombre);
            } else {
                this.familiasAbiertas.add(famNombre);
            }
            this.render();
        },

        getRubroFocal() {
            if (!this.rubroFocalKey) return null;
            return this.anclas.find(a => a.ancla_key === this.rubroFocalKey) || null;
        },

        getDestinoActual() {
            const ancla = this.getRubroFocal();
            if (!ancla) return null;
            if (this.destinoModo === 'variedad' && this.destinoVariedadClave) {
                const v = (ancla.variedades || []).find(x => x.clave_producto_base === this.destinoVariedadClave);
                if (v) {
                    return {
                        modo: 'variedad',
                        ancla,
                        variedad: v,
                        tipo_ancla: v.tipo_ancla_default || (v.ingrediente_id ? 'INGREDIENTE' : 'PRODUCTO_BASE'),
                        familia_id: ancla.familia_id,
                        familia_nombre: ancla.familia_nombre,
                        articulo_principal: ancla.articulo_principal,
                        ruta_subrama: null,
                        ruta_subrama_labels: v.ruta_subrama_labels || [],
                        ingrediente_id: v.ingrediente_id || null,
                        clave_producto_base: v.clave_producto_base || null,
                        claves_secundarias: v.claves_secundarias || [],
                        articulo_sku: v.sku_principal_combo || null,
                        titulo_referencia: v.nombre_base_oficial,
                        producto_prompt: limpiarTextoPrompt(v.nombre_base_oficial),
                        imagen_actual: v.imagen_efectiva,
                        imagen_propia: v.imagen_propia,
                        tiene_propia: Boolean(v.tiene_excepcion_propia && v.imagen_propia),
                        hereda_de: v.hereda_de_label || ancla.articulo_principal,
                        fidelidad_ingredientes: v.fidelidad_ingredientes || null
                    };
                }
            }
            if (this.destinoModo === 'subrama' && this.destinoSubramaNorm) {
                const sr = (ancla.subramas || []).find(s => s.ruta_subrama_norm === this.destinoSubramaNorm);
                if (sr) {
                    const labels = sr.ruta_subrama_labels || [];
                    return {
                        modo: 'subrama',
                        ancla,
                        subrama: sr,
                        tipo_ancla: 'SUBRAMA_JERARQUIA',
                        familia_id: ancla.familia_id,
                        familia_nombre: ancla.familia_nombre,
                        articulo_principal: ancla.articulo_principal,
                        ruta_subrama: labels.join('>'),
                        ruta_subrama_labels: labels,
                        ingrediente_id: null,
                        clave_producto_base: null,
                        claves_secundarias: [],
                        articulo_sku: null,
                        titulo_referencia: `${ancla.articulo_principal} › ${labels.join(' › ')}`,
                        producto_prompt: limpiarTextoPrompt(`${ancla.articulo_principal} ${labels.join(' ')}`),
                        imagen_actual: sr.imagen_efectiva,
                        imagen_propia: sr.imagen_propia,
                        tiene_propia: Boolean(sr.tiene_foto_propia && sr.imagen_propia),
                        hereda_de: sr.hereda_de_label || ancla.articulo_principal,
                        fidelidad_ingredientes: sr.fidelidad_ingredientes || null
                    };
                }
            }
            return {
                modo: 'rubro',
                ancla,
                tipo_ancla: 'ANCLA_PRINCIPAL',
                familia_id: ancla.familia_id,
                familia_nombre: ancla.familia_nombre,
                articulo_principal: ancla.articulo_principal,
                ruta_subrama: null,
                ruta_subrama_labels: [],
                ingrediente_id: null,
                clave_producto_base: null,
                claves_secundarias: [],
                articulo_sku: null,
                titulo_referencia: `${ancla.familia_nombre} › ${ancla.articulo_principal}`,
                producto_prompt: limpiarTextoPrompt(ancla.articulo_principal),
                imagen_actual: ancla.imagen_efectiva,
                imagen_propia: ancla.imagen_ancla,
                tiene_propia: Boolean(ancla.imagen_ancla),
                hereda_de: null,
                fidelidad_ingredientes: ancla.fidelidad_ingredientes || null
            };
        },

        construirPromptPresetActual(dest) {
            if (!dest) return '';
            if (this.preset === 'libre') return '';
            const base = DESCRIPCIONES_PRESET[this.preset] || DESCRIPCIONES_PRESET.cuenco_neutro;
            const ctx = dest.familia_nombre && normTxt(dest.familia_nombre) !== normTxt(dest.producto_prompt)
                ? ` (rubro: ${dest.familia_nombre})`
                : '';
            const regla = this.incluirReglaSinEnvases
                ? ' Sin envases, sin bolsas, sin etiquetas, sin marcas ni texto sobreimpreso.'
                : '';
            return `${base} Producto protagonista único: "${dest.producto_prompt}"${ctx}.${regla}`.trim();
        },

        abrirRubro(anclaKey) {
            this.rubroFocalKey = anclaKey;
            this.destinoModo = 'rubro';
            this.destinoSubramaNorm = '';
            this.destinoVariedadClave = '';
            this.tabActiva = 'ia';
            this.previewIa = null;
            this.fotoDirecta = null;
            const dest = this.getDestinoActual();
            if (this.modoPrompt === 'guardado' && this.promptGuardadoId) {
                const pg = this.promptsGuardados.find(p => Number(p.id) === Number(this.promptGuardadoId));
                if (pg && dest) {
                    this.promptTexto = interpolarPlaceholders(pg.prompt_texto, { producto: dest.producto_prompt, rubro: dest.familia_nombre });
                }
            } else if (this.modoPrompt !== 'libre' && dest) {
                this.promptTexto = this.construirPromptPresetActual(dest);
                this.promptCustom = false;
            }
            this.cargarBiblioteca(true);
            this.render();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        },

        volverAListado() {
            this.rubroFocalKey = null;
            this.previewIa = null;
            this.fotoDirecta = null;
            this.render();
        },

        cambiarDestino(modo, clave = '') {
            this.destinoModo = modo;
            this.destinoSubramaNorm = modo === 'subrama' ? clave : '';
            this.destinoVariedadClave = modo === 'variedad' ? clave : '';
            this.previewIa = null;
            const dest = this.getDestinoActual();
            if (this.modoPrompt === 'guardado' && this.promptGuardadoId && dest) {
                const pg = this.promptsGuardados.find(p => Number(p.id) === Number(this.promptGuardadoId));
                if (pg) {
                    this.promptTexto = interpolarPlaceholders(pg.prompt_texto, { producto: dest.producto_prompt, rubro: dest.familia_nombre });
                }
            } else if (this.modoPrompt === 'preset' && !this.promptCustom && dest) {
                this.promptTexto = this.construirPromptPresetActual(dest);
            }
            this.render();
        },

        setTab(tab) {
            this.tabActiva = tab;
            if (tab === 'biblioteca') {
                this.cargarBiblioteca(false);
            } else {
                this.render();
            }
        },

        seleccionarPreset(presetId) {
            this.preset = presetId;
            this.promptGuardadoId = null;
            const dest = this.getDestinoActual();
            if (presetId === 'libre') {
                this.modoPrompt = 'libre';
                if (!this.promptCustom) {
                    this.promptTexto = '';
                }
            } else {
                this.modoPrompt = 'preset';
                this.promptCustom = false;
                this.promptTexto = this.construirPromptPresetActual(dest);
            }
            this.render();
        },

        onEditarPrompt(val) {
            this.promptTexto = val;
            this.promptCustom = true;
            if (this.modoPrompt === 'preset' && this.preset !== 'libre') {
                // El usuario editó el texto: respetar exactamente lo editado sin pisarlo
                this.modoPrompt = 'libre';
                this.preset = 'libre';
            }
        },

        aplicarPromptGuardado(promptId) {
            const pg = this.promptsGuardados.find(p => Number(p.id) === Number(promptId));
            if (!pg) return;
            const dest = this.getDestinoActual();
            this.promptGuardadoId = Number(pg.id);
            this.modoPrompt = 'guardado';
            this.preset = pg.preset_base && DESCRIPCIONES_PRESET[pg.preset_base] ? pg.preset_base : 'libre';
            this.incluirReglaSinEnvases = pg.regla_sin_envases !== false;
            this.promptTexto = dest
                ? interpolarPlaceholders(pg.prompt_texto, { producto: dest.producto_prompt, rubro: dest.familia_nombre })
                : pg.prompt_texto;
            this.promptCustom = true;
            this.tabActiva = 'ia';
            this.render();
        },

        dispararCapturaReferencia(slotIdx, usarCamara) {
            const inp = document.getElementById(usarCamara ? 'fc-input-ref-cam' : 'fc-input-ref-gal');
            if (!inp) return;
            inp.value = '';
            inp.onchange = async () => {
                const file = inp.files && inp.files[0];
                if (!file) return;
                try {
                    const comp = await comprimirImagenCanvas(file, 1280, 0.84);
                    this.referencias[slotIdx] = comp;
                    this.render();
                } catch (err) {
                    Swal.fire({ icon: 'error', title: 'Error con imagen', text: err.message, background: '#1e293b', color: '#fff' });
                }
            };
            inp.click();
        },

        quitarReferencia(slotIdx) {
            this.referencias[slotIdx] = null;
            this.render();
        },

        dispararFotoDirecta(usarCamara) {
            const inp = document.getElementById(usarCamara ? 'fc-input-direct-cam' : 'fc-input-direct-gal');
            if (!inp) return;
            inp.value = '';
            inp.onchange = async () => {
                const file = inp.files && inp.files[0];
                if (!file) return;
                try {
                    this.fotoDirecta = await comprimirImagenCanvas(file, 1280, 0.86);
                    this.render();
                } catch (err) {
                    Swal.fire({ icon: 'error', title: 'Error con foto', text: err.message, background: '#1e293b', color: '#fff' });
                }
            };
            inp.click();
        },

        async guardarPromptActual() {
            const txt = String(document.getElementById('fc-ia-prompt')?.value ?? this.promptTexto ?? '').trim();
            if (!txt) {
                return Swal.fire({ icon: 'warning', title: 'Prompt vacío', text: 'Escribí primero el prompt que querés guardar.', background: '#1e293b', color: '#fff' });
            }
            const dest = this.getDestinoActual();
            const catSugerida = (dest?.familia_nombre || 'GENERAL').toUpperCase().slice(0, 30);
            const { value: formVals } = await Swal.fire({
                title: '💾 Guardar en Mis Prompts',
                html: `
                    <div style="text-align:left; display:flex; flex-direction:column; gap:10px;">
                        <label style="font-size:12px; font-weight:700; color:#cbd5e1;">Nombre del prompt</label>
                        <input id="sw-prompt-nombre" class="swal2-input" style="margin:0; width:100%; background:#0f172a; color:#fff; border-color:#475569;" placeholder="Ej: Barritas sobre madera sin cuenco" />
                        <label style="font-size:12px; font-weight:700; color:#cbd5e1;">Categoría (opcional)</label>
                        <input id="sw-prompt-cat" class="swal2-input" style="margin:0; width:100%; background:#0f172a; color:#fff; border-color:#475569;" value="${esc(catSugerida)}" />
                        <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#fde68a; margin-top:4px;">
                            <input type="checkbox" id="sw-prompt-fav" checked /> Marcar como favorito ⭐
                        </label>
                    </div>
                `,
                background: '#1e293b',
                color: '#f8fafc',
                showCancelButton: true,
                confirmButtonText: '💾 Guardar',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#7c3aed',
                preConfirm: () => {
                    const nombre = document.getElementById('sw-prompt-nombre')?.value.trim();
                    const categoria = document.getElementById('sw-prompt-cat')?.value.trim() || 'GENERAL';
                    const es_favorito = Boolean(document.getElementById('sw-prompt-fav')?.checked);
                    if (!nombre) {
                        Swal.showValidationMessage('Ingresá un nombre para identificar este prompt.');
                        return false;
                    }
                    return { nombre, categoria, es_favorito };
                }
            });
            if (!formVals) return;

            try {
                const res = await apiFetch('/api/produccion/nodos/admin/imagenes-base/prompts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nombre: formVals.nombre,
                        categoria: formVals.categoria,
                        prompt_texto: txt,
                        preset_base: this.preset || 'libre',
                        regla_sin_envases: this.incluirReglaSinEnvases,
                        es_favorito: formVals.es_favorito
                    })
                });
                this.promptGuardadoId = Number(res.prompt?.id || 0) || null;
                this.modoPrompt = 'guardado';
                await this.cargarPromptsGuardados(false);
                Swal.fire({ toast: true, position: 'top', icon: 'success', title: 'Prompt guardado en Mis Prompts', showConfirmButton: false, timer: 2000, background: '#0f172a', color: '#fff' });
            } catch (err) {
                Swal.fire({ icon: 'error', title: 'Error', text: err.message, background: '#1e293b', color: '#fff' });
            }
        },

        async abrirGestorPrompts() {
            await this.cargarPromptsGuardados(true);
            const renderList = () => {
                if (this.promptsGuardados.length === 0) {
                    return '<div style="padding:18px; text-align:center; color:#94a3b8; font-size:13px;">Todavía no guardaste prompts personalizados. Creá uno desde Estudio IA con el botón 💾 Guardar prompt.</div>';
                }
                return this.promptsGuardados.map(p => `
                    <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:10px; margin-bottom:8px; text-align:left;">
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; margin-bottom:4px;">
                            <strong style="font-size:13px; color:#f8fafc;">${p.es_favorito ? '⭐ ' : ''}${esc(p.nombre)}</strong>
                            <span style="font-size:10px; padding:2px 6px; border-radius:999px; background:rgba(168,85,247,0.2); color:#e9d5ff;">${esc(p.categoria)} · ${p.usos_count || 0} usos</span>
                        </div>
                        <div style="font-size:11.5px; color:#cbd5e1; line-height:1.35; margin-bottom:8px; max-height:66px; overflow:auto;">${esc(p.prompt_texto)}</div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            ${this.rubroFocalKey ? `<button type="button" onclick="Swal.close(); FotosCatalogoController.aplicarPromptGuardado(${p.id})" style="flex:1; padding:6px 10px; border-radius:7px; border:1px solid #c084fc; background:rgba(124,58,237,0.35); color:#fff; font-weight:700; font-size:12px; cursor:pointer;">✓ Usar aquí</button>` : ''}
                            <button type="button" onclick="FotosCatalogoController.editarPromptEnModal(${p.id})" style="padding:6px 10px; border-radius:7px; border:1px solid #475569; background:#1e293b; color:#e2e8f0; font-size:12px; cursor:pointer;">✏️</button>
                            <button type="button" onclick="FotosCatalogoController.toggleFavPrompt(${p.id}, ${!p.es_favorito})" style="padding:6px 10px; border-radius:7px; border:1px solid #475569; background:#1e293b; color:#fde68a; font-size:12px; cursor:pointer;">${p.es_favorito ? '★' : '☆'}</button>
                            <button type="button" onclick="FotosCatalogoController.borrarPrompt(${p.id})" style="padding:6px 10px; border-radius:7px; border:1px solid rgba(239,68,68,0.4); background:rgba(239,68,68,0.15); color:#fca5a5; font-size:12px; cursor:pointer;">🗑️</button>
                        </div>
                    </div>
                `).join('');
            };

            await Swal.fire({
                title: '📌 Biblioteca de Prompts LAMDA',
                html: `<div style="max-height:62vh; overflow-y:auto;">${renderList()}</div>`,
                background: '#1e293b',
                color: '#f8fafc',
                confirmButtonText: 'Cerrar',
                confirmButtonColor: '#475569'
            });
        },

        async toggleFavPrompt(id, fav) {
            try {
                await apiFetch(`/api/produccion/nodos/admin/imagenes-base/prompts/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ es_favorito: fav })
                });
                await this.abrirGestorPrompts();
            } catch (err) {
                Swal.fire({ icon: 'error', title: 'Error', text: err.message, background: '#1e293b', color: '#fff' });
            }
        },

        async editarPromptEnModal(id) {
            const p = this.promptsGuardados.find(x => Number(x.id) === Number(id));
            if (!p) return;
            const { value: vals } = await Swal.fire({
                title: '✏️ Editar Prompt Guardado',
                html: `
                    <div style="text-align:left; display:flex; flex-direction:column; gap:8px;">
                        <label style="font-size:12px; color:#cbd5e1; font-weight:700;">Nombre</label>
                        <input id="sw-ed-nom" class="swal2-input" style="margin:0; width:100%; background:#0f172a; color:#fff;" value="${esc(p.nombre)}" />
                        <label style="font-size:12px; color:#cbd5e1; font-weight:700;">Categoría</label>
                        <input id="sw-ed-cat" class="swal2-input" style="margin:0; width:100%; background:#0f172a; color:#fff;" value="${esc(p.categoria)}" />
                        <label style="font-size:12px; color:#cbd5e1; font-weight:700;">Texto del prompt (podés usar {{PRODUCTO}} y {{RUBRO}})</label>
                        <textarea id="sw-ed-txt" rows="4" style="width:100%; background:#0f172a; color:#fff; border:1px solid #475569; border-radius:8px; padding:8px; font-size:13px;">${esc(p.prompt_texto)}</textarea>
                    </div>
                `,
                background: '#1e293b',
                color: '#f8fafc',
                showCancelButton: true,
                confirmButtonText: 'Guardar cambios',
                cancelButtonText: 'Volver',
                confirmButtonColor: '#7c3aed',
                preConfirm: () => {
                    const nombre = document.getElementById('sw-ed-nom')?.value.trim();
                    const categoria = document.getElementById('sw-ed-cat')?.value.trim() || 'GENERAL';
                    const prompt_texto = document.getElementById('sw-ed-txt')?.value.trim();
                    if (!nombre || !prompt_texto) {
                        Swal.showValidationMessage('Nombre y texto son obligatorios.');
                        return false;
                    }
                    return { nombre, categoria, prompt_texto };
                }
            });
            if (!vals) return this.abrirGestorPrompts();
            await apiFetch(`/api/produccion/nodos/admin/imagenes-base/prompts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(vals)
            });
            await this.abrirGestorPrompts();
        },

        async borrarPrompt(id) {
            try {
                await apiFetch(`/api/produccion/nodos/admin/imagenes-base/prompts/${id}`, { method: 'DELETE' });
                if (Number(this.promptGuardadoId) === Number(id)) this.promptGuardadoId = null;
                await this.abrirGestorPrompts();
            } catch (err) {
                Swal.fire({ icon: 'error', title: 'Error', text: err.message, background: '#1e293b', color: '#fff' });
            }
        },

        async generarIa() {
            if (this.generandoIa) return;
            const dest = this.getDestinoActual();
            if (!dest) return;
            const txtEl = document.getElementById('fc-ia-prompt');
            const promptActual = String(txtEl ? txtEl.value : this.promptTexto || '').trim();
            this.promptTexto = promptActual;

            if (this.modoPrompt === 'libre' && !promptActual) {
                return Swal.fire({ icon: 'warning', title: 'Falta el prompt', text: 'En modo Prompt libre escribí qué escena o toma querés generar.', background: '#1e293b', color: '#fff' });
            }

            this.generandoIa = true;
            this.render();
            try {
                const refsPayload = this.referencias
                    .filter(Boolean)
                    .map(r => ({ mimeType: r.mimeType, data: r.data }));

                const data = await apiFetch('/api/produccion/nodos/admin/imagenes-base/generar-ia', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        familia_id: dest.familia_id,
                        familia_nombre: dest.familia_nombre,
                        articulo_principal: dest.articulo_principal,
                        ruta_subrama_labels: dest.ruta_subrama_labels || [],
                        nombre_variante: dest.modo === 'variedad' ? dest.variedad.nombre_base_oficial : '',
                        ingrediente_id: dest.ingrediente_id || null,
                        articulo_sku: dest.articulo_sku || null,
                        preset_estilo: this.preset,
                        modo_prompt: this.modoPrompt,
                        calidad: this.calidad,
                        prompt_personalizado: promptActual,
                        incluir_regla_sin_envases: this.incluirReglaSinEnvases,
                        incluir_fidelidad_ingredientes: this.incluirFidelidadReceta,
                        prompt_guardado_id: this.promptGuardadoId,
                        imagenes_referencia: refsPayload
                    })
                });
                this.previewIa = data;
            } catch (err) {
                Swal.fire({ icon: 'error', title: 'Error IA', text: err.message, background: '#1e293b', color: '#fff' });
            } finally {
                this.generandoIa = false;
                this.render();
            }
        },

        async confirmarIa(aplicarAlAncla = true) {
            if (!this.previewIa?.preview_token) return;
            const dest = this.getDestinoActual();
            if (!dest) return;
            try {
                await apiFetch('/api/produccion/nodos/admin/imagenes-base/confirmar-ia', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        preview_token: this.previewIa.preview_token,
                        familia_id: dest.familia_id,
                        familia_nombre: dest.familia_nombre,
                        articulo_principal: dest.articulo_principal,
                        ruta_subrama: dest.ruta_subrama,
                        etiqueta: dest.titulo_referencia,
                        tipo_ancla: dest.tipo_ancla,
                        ingrediente_id: dest.ingrediente_id,
                        clave_producto_base: dest.clave_producto_base,
                        claves_secundarias: dest.claves_secundarias,
                        articulo_sku: dest.articulo_sku,
                        titulo_referencia: dest.titulo_referencia,
                        aplicar_al_ancla: Boolean(aplicarAlAncla)
                    })
                });
                this.previewIa = null;
                await Promise.all([this.cargarCatalogo(true), this.cargarBiblioteca(true)]);
                Swal.fire({
                    toast: true,
                    position: 'top',
                    icon: 'success',
                    title: aplicarAlAncla ? 'Foto guardada y aplicada a Tiendas' : 'Foto guardada en Biblioteca LAMDA',
                    showConfirmButton: false,
                    timer: 2400,
                    background: '#0f172a',
                    color: '#fff'
                });
            } catch (err) {
                Swal.fire({ icon: 'error', title: 'Error', text: err.message, background: '#1e293b', color: '#fff' });
            }
        },

        async cargarBiblioteca(silencioso = false) {
            const dest = this.getDestinoActual();
            const qs = new URLSearchParams();
            if (dest && this.bibScope !== 'todas') {
                if (dest.familia_id) qs.set('familia_id', String(dest.familia_id));
                if (this.bibScope === 'rubro' && dest.articulo_principal) {
                    qs.set('articulo_principal', dest.articulo_principal);
                }
            }
            if (this.bibBusqueda.trim()) qs.set('q', this.bibBusqueda.trim());
            try {
                const data = await apiFetch(`/api/produccion/nodos/admin/imagenes-base/biblioteca?${qs.toString()}`);
                this.bibItems = data.items || [];
            } catch (_) {}
            if (!silencioso) this.render();
        },

        async asignarBiblioteca(bibId) {
            const dest = this.getDestinoActual();
            if (!dest) return;
            try {
                await apiFetch('/api/produccion/nodos/admin/imagenes-base/asignar-biblioteca', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        biblioteca_imagen_id: Number(bibId),
                        tipo_ancla: dest.tipo_ancla,
                        familia_id: dest.familia_id,
                        articulo_principal: dest.articulo_principal,
                        ruta_subrama: dest.ruta_subrama,
                        ingrediente_id: dest.ingrediente_id,
                        clave_producto_base: dest.clave_producto_base,
                        claves_secundarias: dest.claves_secundarias,
                        articulo_sku: dest.articulo_sku,
                        titulo_referencia: dest.titulo_referencia
                    })
                });
                await this.cargarCatalogo(true);
                Swal.fire({ toast: true, position: 'top', icon: 'success', title: 'Foto aplicada desde Biblioteca', showConfirmButton: false, timer: 2000, background: '#0f172a', color: '#fff' });
            } catch (err) {
                Swal.fire({ icon: 'error', title: 'Error', text: err.message, background: '#1e293b', color: '#fff' });
            }
        },

        async verReusarPromptBiblioteca(bibId) {
            const item = this.bibItems.find(it => Number(it.id) === Number(bibId));
            if (!item || !item.prompt_usado) return;
            const res = await Swal.fire({
                title: '📋 Prompt de esta Imagen',
                html: `
                    <div style="text-align:left; display:flex; flex-direction:column; gap:10px;">
                        <div style="font-size:12px; color:#94a3b8;">
                            ${esc(item.etiqueta)} · <strong>${esc(item.modelo_ia || 'Gemini')}</strong>${item.preset_estilo ? ` · ${esc(item.preset_estilo)}` : ''}
                        </div>
                        <textarea readonly rows="5" style="width:100%; background:#0f172a; color:#f8fafc; border:1px solid #475569; border-radius:8px; padding:10px; font-size:12.5px;">${esc(item.prompt_usado)}</textarea>
                    </div>
                `,
                background: '#1e293b',
                color: '#f8fafc',
                showCancelButton: true,
                showDenyButton: true,
                confirmButtonText: '✨ Cargar en Estudio IA',
                denyButtonText: '💾 Guardar en Mis Prompts',
                cancelButtonText: 'Cerrar',
                confirmButtonColor: '#7c3aed',
                denyButtonColor: '#0284c7'
            });
            if (res.isConfirmed) {
                this.preset = item.preset_estilo && DESCRIPCIONES_PRESET[item.preset_estilo] ? item.preset_estilo : 'libre';
                this.modoPrompt = 'libre';
                this.promptTexto = item.prompt_usado;
                this.promptCustom = true;
                this.promptGuardadoId = item.prompt_guardado_id || null;
                this.tabActiva = 'ia';
                this.render();
            } else if (res.isDenied) {
                this.promptTexto = item.prompt_usado;
                this.preset = item.preset_estilo || 'libre';
                await this.guardarPromptActual();
            }
        },

        async eliminarBibliotecaItem(bibId) {
            const c = await Swal.fire({
                title: '¿Eliminar de Biblioteca?',
                text: 'Si esta foto estaba asignada a un rubro o producto, también se quitará su asignación.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Sí, eliminar',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#ef4444',
                background: '#1e293b',
                color: '#f8fafc'
            });
            if (!c.isConfirmed) return;
            try {
                await apiFetch(`/api/produccion/nodos/admin/imagenes-base/biblioteca/${Number(bibId)}`, { method: 'DELETE' });
                await Promise.all([this.cargarBiblioteca(true), this.cargarCatalogo(true)]);
                this.render();
            } catch (err) {
                Swal.fire({ icon: 'error', title: 'Error', text: err.message, background: '#1e293b', color: '#fff' });
            }
        },

        async subirFotoDirecta(aplicarAlDestino = true) {
            if (!this.fotoDirecta || this.subiendoDirecta) return;
            const dest = this.getDestinoActual();
            if (!dest) return;
            this.subiendoDirecta = true;
            this.render();
            try {
                const fd = new FormData();
                fd.append('foto', this.fotoDirecta.blob, this.fotoDirecta.name || 'captura_movil.jpg');
                fd.append('origen_tipo', 'UPLOAD_MOVIL');
                if (dest.familia_id) fd.append('familia_id', String(dest.familia_id));
                if (dest.familia_nombre) fd.append('familia_nombre', dest.familia_nombre);
                if (dest.articulo_principal) fd.append('articulo_principal', dest.articulo_principal);

                if (aplicarAlDestino) {
                    fd.append('tipo_ancla', dest.tipo_ancla);
                    if (dest.ruta_subrama) fd.append('ruta_subrama', dest.ruta_subrama);
                    if (dest.ingrediente_id) fd.append('ingrediente_id', String(dest.ingrediente_id));
                    if (dest.clave_producto_base) fd.append('clave_producto_base', dest.clave_producto_base);
                    if (Array.isArray(dest.claves_secundarias) && dest.claves_secundarias.length > 0) {
                        fd.append('claves_secundarias', dest.claves_secundarias.join(','));
                    }
                    if (dest.articulo_sku) fd.append('articulo_sku', dest.articulo_sku);
                    fd.append('titulo_referencia', dest.titulo_referencia);
                    await apiFetch('/api/produccion/nodos/admin/imagenes-base', { method: 'POST', body: fd });
                } else {
                    fd.append('etiqueta', dest.titulo_referencia);
                    await apiFetch('/api/produccion/nodos/admin/imagenes-base/biblioteca', { method: 'POST', body: fd });
                }
                this.fotoDirecta = null;
                await Promise.all([this.cargarCatalogo(true), this.cargarBiblioteca(true)]);
                Swal.fire({
                    toast: true,
                    position: 'top',
                    icon: 'success',
                    title: aplicarAlDestino ? 'Foto subida y aplicada' : 'Foto guardada en Biblioteca',
                    showConfirmButton: false,
                    timer: 2200,
                    background: '#0f172a',
                    color: '#fff'
                });
            } catch (err) {
                Swal.fire({ icon: 'error', title: 'Error subiendo foto', text: err.message, background: '#1e293b', color: '#fff' });
            } finally {
                this.subiendoDirecta = false;
                this.render();
            }
        },

        async quitarAsignacion(imagenId, clavesSec = []) {
            try {
                const qs = clavesSec.length > 0 ? `?claves_secundarias=${encodeURIComponent(clavesSec.join(','))}` : '';
                await apiFetch(`/api/produccion/nodos/admin/imagenes-base/${Number(imagenId)}${qs}`, { method: 'DELETE' });
                await this.cargarCatalogo(true);
                Swal.fire({ toast: true, position: 'top', icon: 'info', title: 'Asignación quitada', showConfirmButton: false, timer: 1800, background: '#0f172a', color: '#fff' });
            } catch (err) {
                Swal.fire({ icon: 'error', title: 'Error', text: err.message, background: '#1e293b', color: '#fff' });
            }
        },

        render() {
            const totalRubros = this.anclas.length;
            const conFoto = this.anclas.filter(a => Boolean(a.imagen_efectiva)).length;
            const elTotal = document.getElementById('fc-stat-total');
            const elCon = document.getElementById('fc-stat-con');
            const elSin = document.getElementById('fc-stat-sin');
            if (elTotal) elTotal.textContent = String(totalRubros);
            if (elCon) elCon.textContent = String(conFoto);
            if (elSin) elSin.textContent = String(Math.max(0, totalRubros - conFoto));

            const searchBox = document.getElementById('fc-search-box');
            const statsBox = document.getElementById('fc-stats-strip');
            const container = document.getElementById('fc-main-container');
            if (!container) return;

            const dest = this.getDestinoActual();
            if (dest) {
                if (searchBox) searchBox.style.display = 'none';
                if (statsBox) statsBox.style.display = 'none';
                container.innerHTML = this.renderVistaDetalle(dest);
                return;
            }

            if (searchBox) searchBox.style.display = 'block';
            if (statsBox) statsBox.style.display = 'grid';

            const terms = normTxt(this.busqueda).split(/\s+/).filter(Boolean);
            const filtradas = this.anclas.filter(a => {
                if (this.filtro === 'sin_foto' && a.imagen_efectiva) return false;
                if (this.filtro === 'en_nodos' && Number(a.en_nodos_count || 0) <= 0) return false;
                if (terms.length === 0) return true;
                const bolsa = normTxt([
                    a.familia_nombre,
                    a.articulo_principal,
                    ...(a.subramas || []).map(s => (s.ruta_subrama_labels || []).join(' ')),
                    ...(a.variedades || []).map(v => `${v.nombre_base_oficial} ${v.ingrediente_codigo || ''} ${v.presentaciones.map(p => p.sku_nodo).join(' ')}`)
                ].filter(Boolean).join(' '));
                return terms.every(t => bolsa.includes(t));
            });

            if (filtradas.length === 0) {
                container.innerHTML = '<div class="fc-card" style="text-align:center; color:#94a3b8; padding:2rem;">No se encontraron rubros con ese filtro.</div>';
                return;
            }

            const famMap = new Map();
            for (const a of filtradas) {
                const fn = a.familia_nombre || 'Almacén';
                if (!famMap.has(fn)) famMap.set(fn, []);
                famMap.get(fn).push(a);
            }

            container.innerHTML = Array.from(famMap.entries()).map(([famNombre, rubros]) => {
                const abierta = terms.length > 0 || this.familiasAbiertas.has(famNombre);
                return `
                    <div class="fc-fam-acc">
                        <button type="button" class="fc-fam-head" onclick="FotosCatalogoController.toggleFamilia(decodeURIComponent('${encodeURIComponent(famNombre)}'))">
                            <span>🌿 ${esc(famNombre)}</span>
                            <span style="font-size:0.78rem; color:#c4b5fd;">${rubros.length} rubro${rubros.length === 1 ? '' : 's'} ${abierta ? '▾' : '▸'}</span>
                        </button>
                        ${abierta ? rubros.map(a => {
                            const img = a.imagen_efectiva;
                            return `
                                <div class="fc-rubro-row" data-fc-rubro="${esc(a.ancla_key)}" onclick="FotosCatalogoController.abrirRubro(decodeURIComponent('${encodeURIComponent(a.ancla_key)}'))">
                                    ${img ? `<img class="fc-thumb" src="${esc(img.url)}" alt="${esc(a.articulo_principal)}" />` : '<div class="fc-thumb-ph">🖼️</div>'}
                                    <div style="flex:1; min-width:0;">
                                        <div style="font-size:0.96rem; font-weight:800; color:#f8fafc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(a.articulo_principal)}</div>
                                        <div style="font-size:0.76rem; color:#94a3b8; margin-top:2px;">
                                            <strong style="color:#34d399;">${a.total_variedades}</strong> var. · ${a.total_presentaciones} pres.
                                            ${a.en_nodos_count > 0 ? ` · <span style="color:#38bdf8;">${a.en_nodos_count} en Nodos</span>` : ''}
                                        </div>
                                    </div>
                                    <span style="font-size:1.35rem; color:#c084fc; font-weight:700;">›</span>
                                </div>
                            `;
                        }).join('') : ''}
                    </div>
                `;
            }).join('');
        },

        renderVistaDetalle(dest) {
            const ancla = dest.ancla;
            const subramas = ancla.subramas || [];
            const variedades = ancla.variedades || [];
            const refsActivas = this.referencias.filter(Boolean).length;

            return `
                <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem;">
                    <button type="button" class="fc-btn-sec" id="fc-btn-volver" onclick="FotosCatalogoController.volverAListado()">← Volver al catálogo</button>
                    <span style="font-size:0.75rem; color:#94a3b8; font-weight:700;">${esc(ancla.familia_nombre)}</span>
                </div>

                <div class="fc-card">
                    <div style="display:flex; gap:0.85rem; align-items:center;">
                        ${dest.imagen_actual
                            ? `<img src="${esc(dest.imagen_actual.url)}" alt="${esc(dest.titulo_referencia)}" style="width:72px; height:72px; border-radius:0.85rem; object-fit:cover; border:1px solid #475569; flex-shrink:0;" />`
                            : '<div class="fc-thumb-ph" style="width:72px; height:72px; font-size:1.7rem;">🖼️</div>'}
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:0.72rem; font-weight:800; color:#c084fc; text-transform:uppercase;">
                                ${dest.modo === 'rubro' ? 'Rubro Completo (Ancla Principal)' : (dest.modo === 'subrama' ? 'Sub-rama Jerárquica' : 'Excepción Puntual')}
                            </div>
                            <div style="font-size:1.05rem; font-weight:900; color:#f8fafc; line-height:1.25; margin-top:2px;">${esc(dest.titulo_referencia)}</div>
                            <div style="font-size:0.75rem; color:${dest.tiene_propia ? '#e9d5ff' : (dest.imagen_actual ? '#6ee7b7' : '#fbbf24')}; margin-top:3px;">
                                ${dest.tiene_propia
                                    ? '🎨 Foto propia activa'
                                    : (dest.imagen_actual ? `✓ Hereda de ${esc(dest.hereda_de)}` : '⚠️ Todavía sin foto asignada')}
                            </div>
                        </div>
                    </div>

                    ${dest.tiene_propia && dest.imagen_propia ? `
                        <button type="button" class="fc-btn-sec" style="color:#fca5a5; border-color:rgba(239,68,68,0.4);"
                            onclick="FotosCatalogoController.quitarAsignacion(${Number(dest.imagen_propia.id)}, ${JSON.stringify(dest.claves_secundarias || []).replace(/"/g, '&quot;')})">
                            🗑️ Quitar foto de este destino
                        </button>
                    ` : ''}

                    <div>
                        <div style="font-size:0.74rem; font-weight:800; color:#94a3b8; margin-bottom:0.35rem; text-transform:uppercase;">Elegir destino (Rubro / Sub-rama / Variedad):</div>
                        <div class="fc-dest-row">
                            <button type="button" class="fc-chip ${this.destinoModo === 'rubro' ? 'active' : ''}"
                                onclick="FotosCatalogoController.cambiarDestino('rubro')">🌿 Todo el rubro</button>
                            ${subramas.map(s => `
                                <button type="button" class="fc-chip ${this.destinoModo === 'subrama' && this.destinoSubramaNorm === s.ruta_subrama_norm ? 'active' : ''}"
                                    onclick="FotosCatalogoController.cambiarDestino('subrama', decodeURIComponent('${encodeURIComponent(s.ruta_subrama_norm)}'))">
                                    N${s.nivel} · ${esc(s.ruta_subrama_labels.join(' › '))}
                                </button>
                            `).join('')}
                        </div>
                        ${variedades.length > 1 ? `
                            <select class="fc-input" style="margin-top:0.5rem; padding:0.55rem 0.75rem; font-size:0.84rem;"
                                onchange="if (this.value) { FotosCatalogoController.cambiarDestino('variedad', this.value); } else { FotosCatalogoController.cambiarDestino('rubro'); }">
                                <option value="">🎯 O elegir una variedad puntual (${variedades.length})...</option>
                                ${variedades.map(v => `
                                    <option value="${esc(v.clave_producto_base)}" ${this.destinoModo === 'variedad' && this.destinoVariedadClave === v.clave_producto_base ? 'selected' : ''}>
                                        ${esc(v.nombre_base_oficial)} ${v.tiene_excepcion_propia ? '🎨' : ''}
                                    </option>
                                `).join('')}
                            </select>
                        ` : ''}
                    </div>
                </div>

                <div class="fc-tabs-3">
                    <button type="button" id="fc-tab-ia" class="fc-tab-btn ${this.tabActiva === 'ia' ? 'active' : ''}" onclick="FotosCatalogoController.setTab('ia')">✨ Estudio IA</button>
                    <button type="button" id="fc-tab-bib" class="fc-tab-btn ${this.tabActiva === 'biblioteca' ? 'active' : ''}" onclick="FotosCatalogoController.setTab('biblioteca')">📚 Biblioteca</button>
                    <button type="button" id="fc-tab-dir" class="fc-tab-btn ${this.tabActiva === 'directa' ? 'active' : ''}" onclick="FotosCatalogoController.setTab('directa')">📷 Foto directa</button>
                </div>

                ${this.tabActiva === 'ia' ? this.renderTabIa(dest, refsActivas) : ''}
                ${this.tabActiva === 'biblioteca' ? this.renderTabBiblioteca() : ''}
                ${this.tabActiva === 'directa' ? this.renderTabDirecta(dest) : ''}
            `;
        },

        renderTabIa(dest, refsActivas) {
            return `
                <div class="fc-card" id="fc-panel-estudio-ia">
                    <div>
                        <div style="font-size:0.86rem; font-weight:800; color:#f5d0fe;">1. Fotos reales de referencia (opcional: ${refsActivas}/2)</div>
                        <div style="font-size:0.74rem; color:#94a3b8; margin-top:2px;">Sacá 1 o 2 fotos caseras del producto (ej. barrita o mix propio). La IA toma la forma, corte e ingredientes reales y limpia el fondo.</div>
                        <div class="fc-refs-grid" style="margin-top:0.55rem;">
                            ${[0, 1].map(idx => {
                                const r = this.referencias[idx];
                                return `
                                    <div class="fc-ref-slot" data-fc-ref-slot="${idx}">
                                        ${r ? `
                                            <img class="fc-ref-img" src="${r.dataUrl}" alt="Referencia ${idx + 1}" />
                                            <button type="button" class="fc-btn-sec" style="width:100%; min-height:36px; font-size:0.75rem; color:#fca5a5; border-color:rgba(239,68,68,0.4);"
                                                onclick="FotosCatalogoController.quitarReferencia(${idx})">✕ Quitar #${idx + 1}</button>
                                        ` : `
                                            <div style="font-size:0.78rem; font-weight:700; color:#cbd5e1;">Referencia #${idx + 1}</div>
                                            <button type="button" class="fc-btn-sec" style="width:100%; min-height:40px; font-size:0.78rem;"
                                                onclick="FotosCatalogoController.dispararCapturaReferencia(${idx}, true)">📷 Cámara</button>
                                            <button type="button" class="fc-btn-sec" style="width:100%; min-height:40px; font-size:0.78rem;"
                                                onclick="FotosCatalogoController.dispararCapturaReferencia(${idx}, false)">🖼️ Galería</button>
                                        `}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>

                    <div>
                        <div style="font-size:0.86rem; font-weight:800; color:#f5d0fe; margin-bottom:0.4rem;">2. Estilo de toma (tocá cualquiera)</div>
                        <div class="fc-preset-grid">
                            ${PRESETS_ESTUDIO.map(p => `
                                <button type="button" class="fc-preset-pill ${this.preset === p.id ? 'active' : ''}" data-fc-preset="${p.id}"
                                    onclick="FotosCatalogoController.seleccionarPreset('${p.id}')">${p.label}</button>
                            `).join('')}
                        </div>
                    </div>

                    <div>
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.35rem;">
                            <span style="font-size:0.82rem; font-weight:800; color:#cbd5e1;">📌 Mis Prompts Guardados</span>
                            <button type="button" class="fc-btn-sec" style="min-height:34px; font-size:0.75rem; padding:0.25rem 0.6rem;"
                                onclick="FotosCatalogoController.abrirGestorPrompts()">⚙️ Gestionar (${this.promptsGuardados.length})</button>
                        </div>
                        <select id="fc-select-prompt-guardado" class="fc-input" style="padding:0.55rem 0.75rem; font-size:0.84rem;"
                            onchange="if (this.value) FotosCatalogoController.aplicarPromptGuardado(this.value);">
                            <option value="">Elegir un prompt guardado...</option>
                            ${this.promptsGuardados.map(p => `
                                <option value="${p.id}" ${Number(this.promptGuardadoId) === Number(p.id) ? 'selected' : ''}>
                                    ${p.es_favorito ? '⭐ ' : ''}${esc(p.nombre)} (${esc(p.categoria)})
                                </option>
                            `).join('')}
                        </select>
                    </div>

                    <div>
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.35rem;">
                            <label for="fc-ia-prompt" style="font-size:0.82rem; font-weight:800; color:#cbd5e1;">
                                3. Prompt ${this.modoPrompt === 'libre' ? '(Modo Libre — se respeta literal)' : '(Editable)'}
                            </label>
                            <button type="button" id="fc-btn-guardar-prompt" class="fc-btn-sec" style="min-height:34px; font-size:0.75rem; padding:0.25rem 0.65rem; border-color:#c084fc; color:#f5d0fe;"
                                onclick="FotosCatalogoController.guardarPromptActual()">💾 Guardar prompt</button>
                        </div>
                        <textarea id="fc-ia-prompt" rows="4" class="fc-input" style="font-size:0.86rem; line-height:1.4; resize:vertical;"
                            placeholder="Describí exactamente la escena que querés (ej: zoom macro sobre barrita de cereales partida al medio sobre piedra oscura, sin cuenco)..."
                            oninput="FotosCatalogoController.onEditarPrompt(this.value)">${esc(this.promptTexto)}</textarea>
                    </div>

                    <label style="display:flex; align-items:center; gap:0.55rem; font-size:0.82rem; color:#e2e8f0; cursor:pointer;">
                        <input type="checkbox" id="fc-chk-sin-envases" ${this.incluirReglaSinEnvases ? 'checked' : ''}
                            onchange="FotosCatalogoController.incluirReglaSinEnvases = this.checked;" style="width:18px; height:18px;" />
                        Agregar regla estricta: sin envases, bolsas ni marcas
                    </label>

                    ${dest.fidelidad_ingredientes && dest.fidelidad_ingredientes.tiene_receta ? `
                        <div data-testid="fc-fidelidad-receta-box" style="background:rgba(16,185,129,0.08); border:1px solid rgba(52,211,153,0.35); border-radius:0.8rem; padding:0.65rem 0.75rem; display:flex; flex-direction:column; gap:0.4rem;">
                            <label style="display:flex; align-items:center; gap:0.55rem; font-size:0.82rem; font-weight:800; color:#a7f3d0; cursor:pointer;">
                                <input type="checkbox" id="fc-chk-fidelidad-receta" ${this.incluirFidelidadReceta ? 'checked' : ''}
                                    onchange="FotosCatalogoController.incluirFidelidadReceta = this.checked;" style="width:18px; height:18px;" />
                                🧪 Fidelidad estricta de receta (BD)
                            </label>
                            <div style="display:flex; flex-wrap:wrap; gap:0.3rem;">
                                ${dest.fidelidad_ingredientes.ingredientes_reales.map(ing => `
                                    <span style="background:rgba(16,185,129,0.18); color:#d1fae5; border:1px solid rgba(52,211,153,0.35); border-radius:999px; padding:0.12rem 0.5rem; font-size:0.72rem; font-weight:700;">✓ ${esc(ing)}</span>
                                `).join('')}
                            </div>
                            ${dest.fidelidad_ingredientes.ingredientes_prohibidos?.length > 0 ? `
                                <div style="font-size:0.72rem; color:#fca5a5; line-height:1.35;">
                                    <strong>Prohibido inventar:</strong> ${esc(dest.fidelidad_ingredientes.ingredientes_prohibidos.join(', '))}
                                </div>
                            ` : ''}
                        </div>
                    ` : ''}

                    <div>
                        <label style="display:block; font-size:0.76rem; font-weight:700; color:#94a3b8; margin-bottom:0.25rem;">Modelo Gemini:</label>
                        <select id="fc-ia-calidad" class="fc-input" style="padding:0.55rem 0.75rem; font-size:0.85rem;"
                            onchange="FotosCatalogoController.calidad = this.value;">
                            <option value="estandar" ${this.calidad === 'estandar' ? 'selected' : ''}>⚡ Estándar — Nano Banana 2 (gemini-3.1-flash-image)</option>
                            <option value="pro" ${this.calidad === 'pro' ? 'selected' : ''}>💎 Pro — gemini-3-pro-image (Alta precisión)</option>
                        </select>
                    </div>

                    <button type="button" id="fc-btn-generar-ia" class="fc-btn-primary" ${this.generandoIa ? 'disabled' : ''}
                        onclick="FotosCatalogoController.generarIa()">
                        ${this.generandoIa ? '⏳ Generando imagen en Gemini...' : '✨ Generar imagen con IA'}
                    </button>

                    ${this.previewIa ? `
                        <div style="background:#0f172a; border:1px solid rgba(52,211,153,0.45); border-radius:0.9rem; padding:0.85rem; display:flex; flex-direction:column; gap:0.7rem;">
                            <div style="font-size:0.84rem; font-weight:800; color:#34d399;">
                                ✓ Previsualización lista · ${esc(this.previewIa.modelo_usado)}
                                ${this.previewIa.uso_referencias_count > 0 ? ` · ${this.previewIa.uso_referencias_count} ref.` : ''}
                            </div>
                            <img src="${this.previewIa.preview_data_url}" alt="Previsualización IA" style="width:100%; max-height:320px; object-fit:contain; border-radius:0.75rem; background:#020617;" />
                            <div style="display:flex; flex-direction:column; gap:0.45rem;">
                                <button type="button" class="fc-btn-success" onclick="FotosCatalogoController.confirmarIa(true)">✅ Guardar en Biblioteca y Aplicar a Tiendas</button>
                                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.45rem;">
                                    <button type="button" class="fc-btn-sec" onclick="FotosCatalogoController.confirmarIa(false)">📥 Solo Biblioteca</button>
                                    <button type="button" class="fc-btn-sec" onclick="FotosCatalogoController.generarIa()">🔄 Regenerar</button>
                                </div>
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        },

        renderTabBiblioteca() {
            return `
                <div class="fc-card" id="fc-panel-biblioteca">
                    <div class="fc-chips-row" style="padding-top:0;">
                        <button type="button" class="fc-chip ${this.bibScope === 'rubro' ? 'active' : ''}" onclick="FotosCatalogoController.bibScope='rubro'; FotosCatalogoController.cargarBiblioteca(false);">Este rubro</button>
                        <button type="button" class="fc-chip ${this.bibScope === 'familia' ? 'active' : ''}" onclick="FotosCatalogoController.bibScope='familia'; FotosCatalogoController.cargarBiblioteca(false);">Esta familia</button>
                        <button type="button" class="fc-chip ${this.bibScope === 'todas' ? 'active' : ''}" onclick="FotosCatalogoController.bibScope='todas'; FotosCatalogoController.cargarBiblioteca(false);">Todas</button>
                    </div>
                    <input type="search" class="fc-input" style="padding:0.55rem 0.85rem; font-size:0.86rem;"
                        value="${esc(this.bibBusqueda)}" placeholder="Filtrar biblioteca..."
                        oninput="FotosCatalogoController.bibBusqueda=this.value; FotosCatalogoController.cargarBiblioteca(false);" />
                    ${this.bibItems.length === 0 ? `
                        <div style="padding:1.5rem; text-align:center; color:#94a3b8; font-size:0.84rem;">No hay imágenes en esta vista de Biblioteca.</div>
                    ` : `
                        <div class="fc-lib-grid">
                            ${this.bibItems.map(it => `
                                <div class="fc-lib-card" data-fc-bib-id="${it.id}">
                                    <img src="${esc(it.url)}" alt="${esc(it.etiqueta)}" />
                                    <div style="font-size:0.78rem; font-weight:800; color:#f8fafc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(it.etiqueta)}</div>
                                    <div style="font-size:0.68rem; color:#94a3b8;">
                                        ${it.origen_tipo === 'IA_GEMINI' ? '✨ IA' : (it.origen_tipo === 'UPLOAD_MOVIL' ? '📷 Móvil' : '📤 PC')}
                                        ${Number(it.uso_referencias_count || 0) > 0 ? ` · 📷${it.uso_referencias_count} ref` : ''}
                                    </div>
                                    <button type="button" class="fc-btn-success" style="min-height:36px; font-size:0.75rem; padding:0.35rem;"
                                        onclick="FotosCatalogoController.asignarBiblioteca(${it.id})">✓ Usar</button>
                                    <div style="display:flex; gap:0.3rem;">
                                        ${it.prompt_usado ? `
                                            <button type="button" class="fc-btn-sec" style="flex:1; min-height:34px; font-size:0.72rem; padding:0.25rem;"
                                                onclick="FotosCatalogoController.verReusarPromptBiblioteca(${it.id})">📋 Prompt</button>
                                        ` : ''}
                                        <button type="button" class="fc-btn-sec" style="min-height:34px; font-size:0.72rem; padding:0.25rem 0.5rem; color:#fca5a5;"
                                            onclick="FotosCatalogoController.eliminarBibliotecaItem(${it.id})">🗑️</button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `}
                </div>
            `;
        },

        renderTabDirecta(dest) {
            return `
                <div class="fc-card" id="fc-panel-directa">
                    <div style="font-size:0.86rem; font-weight:800; color:#f8fafc;">Subir foto directa sin pasar por IA</div>
                    <div style="font-size:0.76rem; color:#94a3b8;">Útil si sacaste una foto limpia del producto real y querés aplicarla directo a <strong>${esc(dest.titulo_referencia)}</strong>.</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.55rem;">
                        <button type="button" class="fc-btn-sec" onclick="FotosCatalogoController.dispararFotoDirecta(true)">📷 Sacar foto</button>
                        <button type="button" class="fc-btn-sec" onclick="FotosCatalogoController.dispararFotoDirecta(false)">🖼️ De galería</button>
                    </div>
                    ${this.fotoDirecta ? `
                        <img src="${this.fotoDirecta.dataUrl}" alt="Foto directa" style="width:100%; max-height:280px; object-fit:contain; border-radius:0.75rem; background:#020617;" />
                        <button type="button" class="fc-btn-success" ${this.subiendoDirecta ? 'disabled' : ''} onclick="FotosCatalogoController.subirFotoDirecta(true)">
                            ${this.subiendoDirecta ? '⏳ Subiendo...' : '✅ Guardar y Aplicar a Tiendas'}
                        </button>
                        <button type="button" class="fc-btn-sec" ${this.subiendoDirecta ? 'disabled' : ''} onclick="FotosCatalogoController.subirFotoDirecta(false)">
                            📥 Solo guardar en Biblioteca
                        </button>
                    ` : ''}
                </div>
            `;
        }
    };

    window.FotosCatalogoController = ctrl;
})();
