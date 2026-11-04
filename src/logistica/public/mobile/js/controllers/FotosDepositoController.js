/**
 * FotosDepositoController.js
 * Controlador de la App Móvil LAMDA para captura, compresión en navegador (<canvas>)
 * y publicación inmediata de fotografías de partidas por lote hacia el Portal B2B.
 */

if (typeof window.obtenerTextoBusquedaArticulo !== 'function') {
    window.obtenerTextoBusquedaArticulo = function (art) {
        if (!art) return '';
        if (art.busqueda_texto) return String(art.busqueda_texto);
        const estaticos = [
            art.articulo_id,
            art.codigo_visible,
            art.nomenclatura,
            art.descripcion,
            art.nombre_corto,
            art.marca,
            art.categoria,
            art.familia_nombre,
            art.articulo_principal,
            art.atributo_principal_texto,
            art.sub_categoria,
            art.sub_sub_categoria,
            art.sub_sub_sub_categoria,
            art.ultimo_lote?.lote_id_supabase
        ]
            .filter(Boolean)
            .join(' ');
        let dinamicos = '';
        if (art.propiedades_dinamicas && typeof art.propiedades_dinamicas === 'object') {
            dinamicos = Object.values(art.propiedades_dinamicas)
                .map(v => (typeof v === 'object' && v !== null ? (v.texto || v.valor || JSON.stringify(v)) : String(v || '')))
                .join(' ');
        }
        return `${estaticos} ${dinamicos}`
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    };
}

window.FotosDepositoController = {
    articulos: [],
    articulosFiltrados: [],
    filtroActivo: 'linea1_stock',
    terminoBusqueda: '',
    familiasAbiertas: new Set(),
    atributosAbiertos: new Set(),
    todoExpandido: false,
    articuloSeleccionado: null,
    loteCodigoEscaneado: null,
    imagenesExistentes: [],
    imagenesNuevas: [],
    reemplazarLote: false,
    guardando: false,

    // Estado del escáner de código de barras (Artículo + Lote opcional)
    escanerActivo: false,
    modoEscaner: 'articulo_y_lote', // 'articulo_y_lote' | 'solo_lote'
    pasoEscaner: 1, // 1 = esperando Artículo (o Lote directo), 2 = Artículo confirmado, esperando Lote opcional
    articuloEscaneadoTemp: null,
    loteEscaneadoTemp: null,
    ultimoCodigoLeido: '',
    ultimoTiempoLectura: 0,
    html5QrScanner: null,
    nativeVideoStream: null,
    nativeScanLoopId: null,

    async init() {
        console.log('📸 [FOTOS-DEPÓSITO] Inicializando módulo...');
        await this.cargarArticulos(false);
    },

    normalizarTexto(str) {
        return String(str || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
    },

    formatearNombreFamilia(nombre) {
        if (!nombre) return '📦 General';
        const lower = nombre.toLowerCase();
        if (lower.includes('cereal')) return '🌾 ' + nombre;
        if (lower.includes('barrit')) return '🍫 ' + nombre;
        if (lower.includes('granol')) return '🥣 ' + nombre;
        if (lower.includes('fruto') || lower.includes('seco')) return '🥜 ' + nombre;
        if (lower.includes('semill')) return '🌱 ' + nombre;
        if (lower.includes('legumb')) return '🫘 ' + nombre;
        if (lower.includes('especi') || lower.includes('condim')) return '🧂 ' + nombre;
        if (lower.includes('harin')) return '🌾 ' + nombre;
        if (lower.includes('fruta') || lower.includes('desec') || lower.includes('deshid')) return '🍒 ' + nombre;
        if (lower.includes('choc') || lower.includes('repost')) return '🍫 ' + nombre;
        return '📦 ' + nombre;
    },

    toggleFamilia(famName) {
        if (this.familiasAbiertas.has(famName)) {
            this.familiasAbiertas.delete(famName);
        } else {
            this.familiasAbiertas.add(famName);
        }
        this.renderizarLista();
    },

    toggleAtributo(attrKey) {
        if (this.atributosAbiertos.has(attrKey)) {
            this.atributosAbiertos.delete(attrKey);
        } else {
            this.atributosAbiertos.add(attrKey);
        }
        this.renderizarLista();
    },

    toggleExpandirTodo() {
        if (this.todoExpandido) {
            this.familiasAbiertas.clear();
            this.atributosAbiertos.clear();
            this.todoExpandido = false;
        } else {
            this.articulosFiltrados.forEach(art => {
                const fam = art.familia || art.familia_nombre || 'General';
                const artP = art.articulo_principal || 'General';
                this.familiasAbiertas.add(fam);
                this.atributosAbiertos.add(`${fam}___${artP}`);
            });
            this.todoExpandido = true;
        }
        this.renderizarLista();
    },

    /**
     * Enriquecimiento determinista en cliente: vincula entre sí todas las presentaciones comerciales
     * que comparten un mismo Artículo Puente (AP), una misma Caja Madre de Línea 1 o un Pack Padre/Hijo.
     * Garantiza funcionamiento inmediato aún sin reiniciar el proceso Node.
     */
    enriquecerVinculosArticulosPuente(lista) {
        if (!Array.isArray(lista) || lista.length === 0) return lista;
        const byId = new Map(lista.map(a => [String(a.articulo_id).trim(), a]));
        const esInternoAp = (a) => {
            const fam = String(a?.familia || a?.familia_nombre || '').toLowerCase();
            const nom = String(a?.nomenclatura || a?.descripcion || '').trim();
            return fam.includes('puente') || /^PROD\s+(AP|UP)\b/i.test(nom);
        };

        // 1. Los artículos puente internos (PROD AP / PROD UP) son nodos de receta, no bultos comerciales de Línea 1
        for (const a of lista) {
            if (esInternoAp(a)) {
                a.es_linea_1 = false;
            }
        }

        // 2. Expandir cada grupo de derivados (sea de un Artículo Puente AP, Madre L1 o Hijo con Pack Padre)
        for (const origen of lista) {
            const derivs = Array.isArray(origen.derivados_linea_2) ? origen.derivados_linea_2 : [];
            if (derivs.length === 0) continue;

            const origenEsAp = esInternoAp(origen);
            const miembrosIds = new Set();
            if (!origenEsAp) {
                miembrosIds.add(String(origen.articulo_id).trim());
            }

            for (const d of derivs) {
                const dId = String(d.articulo_id || '').trim();
                const dObj = byId.get(dId);
                if (dObj && !esInternoAp(dObj)) {
                    miembrosIds.add(dId);
                    // Incluir sub-derivados directos (ej: presentación 300g -> Pack Padre 10x300g)
                    const subDerivs = Array.isArray(dObj.derivados_linea_2) ? dObj.derivados_linea_2 : [];
                    for (const sd of subDerivs) {
                        const sdId = String(sd.articulo_id || '').trim();
                        const sdObj = byId.get(sdId);
                        if (sdObj && !esInternoAp(sdObj)) {
                            miembrosIds.add(sdId);
                        }
                    }
                }
            }

            const todosMiembros = Array.from(miembrosIds).map(id => byId.get(id)).filter(Boolean);
            if (todosMiembros.length <= 1) continue;

            for (const m of todosMiembros) {
                if (origenEsAp) {
                    m.articulo_puente = {
                        articulo_id: origen.articulo_id,
                        descripcion: origen.nomenclatura || origen.descripcion,
                        es_articulo_puente: true
                    };
                    m.es_linea_1 = true;
                } else if (!m.articulo_puente) {
                    m.articulo_puente = {
                        articulo_id: origen.articulo_id,
                        descripcion: origen.nomenclatura || origen.descripcion,
                        es_articulo_puente: false
                    };
                }

                const mapExist = new Map(
                    (Array.isArray(m.derivados_linea_2) ? m.derivados_linea_2 : [])
                        .filter(x => {
                            const xObj = byId.get(String(x.articulo_id || '').trim());
                            return xObj ? !esInternoAp(xObj) : true;
                        })
                        .map(x => [String(x.articulo_id).trim(), x])
                );

                for (const h of todosMiembros) {
                    if (h.articulo_id === m.articulo_id) continue;
                    if (!mapExist.has(h.articulo_id)) {
                        mapExist.set(h.articulo_id, {
                            articulo_id: h.articulo_id,
                            descripcion: h.descripcion || h.nomenclatura,
                            nomenclatura: h.nomenclatura || h.descripcion,
                            kilos_unidad: Number(h.kilos_unidad || 0),
                            es_pack: Boolean(h.es_pack),
                            tipo_derivado: origenEsAp ? 'HERMANO_ARTICULO_PUENTE' : 'FRACCION_DIRECTA_L2'
                        });
                    }
                }

                m.derivados_linea_2 = Array.from(mapExist.values()).sort((a, b) => {
                    const kDiff = Number(b.kilos_unidad || 0) - Number(a.kilos_unidad || 0);
                    if (kDiff !== 0) return kDiff;
                    return String(a.nomenclatura || '').localeCompare(String(b.nomenclatura || ''), 'es', { sensitivity: 'base' });
                });
            }
        }

        // 3. Calcular stock de Packs Comerciales (Artículos Padre) a partir de su Artículo Hijo cuando su stock directo es 0
        for (const a of lista) {
            const esPack = (a.es_pack === true) || (Number(a.pack_unidades || 1) > 1);
            if (!esPack) continue;
            const packUnids = Math.max(1, parseInt(a.pack_unidades || 1, 10));
            if (packUnids <= 1) continue;

            let hijoCode = a.pack_hijo_codigo ? String(a.pack_hijo_codigo).trim() : null;
            if (!hijoCode && Array.isArray(a.derivados_linea_2)) {
                const derivHijo = a.derivados_linea_2.find(d => d.tipo_derivado === 'FRACCION_HIJA_PACK');
                if (derivHijo && derivHijo.articulo_id) {
                    hijoCode = String(derivHijo.articulo_id).trim();
                }
            }
            if (hijoCode) {
                const hijoObj = byId.get(hijoCode);
                if (hijoObj && Number(a.stock_bultos || 0) <= 0) {
                    const packsArmables = Math.floor(Number(hijoObj.stock_bultos || 0) / packUnids);
                    if (packsArmables > 0) {
                        a.stock_bultos = packsArmables;
                        a.tiene_stock = true;
                    }
                }
            }
        }

        return lista;
    },

    async cargarArticulos(mostrarToast = false) {
        const contenedor = document.getElementById('contenedor-articulos-fotos');
        if (contenedor && this.articulos.length === 0) {
            contenedor.innerHTML = `
                <div style="text-align: center; padding: 3rem 1rem; color: #94a3b8;">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">⏳</div>
                    <div style="font-weight: 700;">Sincronizando catálogo y jerarquía B2B...</div>
                </div>
            `;
        }

        try {
            const resp = await fetch('/api/logistica/b2b-fotos-lotes/articulos');
            const json = await resp.json();
            if (!json.success) {
                throw new Error(json.error || 'No se pudo obtener el listado de artículos');
            }

            const rawLista = (Array.isArray(json.data) ? json.data : []).map(a => {
                const img0 = a.fotos_lote?.imagenes?.[0];
                if (img0 && (img0.es_heredado_madre === true || String(img0.id || '').startsWith('HEREDADO_MADRE:'))) {
                    return { ...a, tiene_fotos: false, fotos_lote: null };
                }
                return a;
            });

            this.articulos = this.enriquecerVinculosArticulosPuente(rawLista);

            // Actualizar indicadores superiores
            const elL1 = document.getElementById('stat-linea1-stock');
            const elFotos = document.getElementById('stat-con-fotos');
            const elOferta = document.getElementById('stat-en-oferta');

            const cantL1Stock = this.articulos.filter(a => a.es_linea_1 && a.tiene_stock).length;
            const cantConFotos = this.articulos.filter(a => a.tiene_fotos).length;
            const cantEnOferta = this.articulos.filter(a => a.en_oferta_activa).length;

            if (elL1) elL1.textContent = cantL1Stock;
            if (elFotos) elFotos.textContent = cantConFotos;
            if (elOferta) elOferta.textContent = cantEnOferta;

            this.aplicarFiltrosYRenderizar();

            if (mostrarToast && typeof Swal !== 'undefined') {
                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: 'Listado y jerarquía actualizados',
                    showConfirmButton: false,
                    timer: 1500,
                    background: '#1e293b',
                    color: '#f8fafc'
                });
            }
        } catch (err) {
            console.error('❌ [FOTOS-DEPÓSITO] Error cargando artículos:', err);
            if (contenedor) {
                contenedor.innerHTML = `
                    <div style="text-align: center; padding: 2.5rem 1rem; color: #fca5a5; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25); border-radius: 1rem;">
                        <div style="font-size: 1.8rem; margin-bottom: 0.4rem;">⚠️</div>
                        <div style="font-weight: 800; margin-bottom: 0.3rem;">Error al cargar artículos</div>
                        <div style="font-size: 0.8rem; color: #cbd5e1; margin-bottom: 0.9rem;">${err.message}</div>
                        <button onclick="FotosDepositoController.cargarArticulos(true)" style="background: #0d9488; color: white; border: none; border-radius: 0.65rem; padding: 0.55rem 1.1rem; font-weight: 800; cursor: pointer;">Reintentar</button>
                    </div>
                `;
            }
        }
    },

    onSearchInput(valor) {
        this.terminoBusqueda = valor || '';
        const btnClear = document.getElementById('btn-clear-search');
        if (btnClear) {
            btnClear.style.display = this.terminoBusqueda.trim().length > 0 ? 'block' : 'none';
        }
        this.aplicarFiltrosYRenderizar();
    },

    limpiarBusqueda() {
        const input = document.getElementById('input-busqueda-fotos');
        if (input) input.value = '';
        this.onSearchInput('');
    },

    cambiarFiltro(nuevoFiltro) {
        this.filtroActivo = nuevoFiltro;
        document.querySelectorAll('.filter-chip').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filtro === nuevoFiltro);
        });
        this.aplicarFiltrosYRenderizar();
    },

    procesarEnterBusqueda(valor) {
        const codigo = String(valor || '').trim();
        if (!codigo) return;
        const match = this.buscarArticuloPorCodigoExacto(codigo);
        if (match && match.articulo) {
            this.emitirBeepExito();
            this.abrirModalArticulo(match.articulo.articulo_id, match.loteDetectado || null);
        }
    },

    aplicarFiltrosYRenderizar() {
        const tokens = this.normalizarTexto(this.terminoBusqueda)
            .split(/\s+/)
            .filter(Boolean);

        this.articulosFiltrados = this.articulos.filter(art => {
            // 1. Filtro por pestaña
            if (this.filtroActivo === 'linea1_stock' && !(art.es_linea_1 && art.tiene_stock)) return false;
            if (this.filtroActivo === 'con_fotos' && !art.tiene_fotos) return false;
            if (this.filtroActivo === 'en_oferta' && !art.en_oferta_activa) return false;
            if (this.filtroActivo === 'linea1_todos' && !art.es_linea_1) return false;

            // 2. Buscador acumulativo universal LAMDA (Fase 49: espacios = AND)
            if (tokens.length > 0) {
                const bolsa = window.obtenerTextoBusquedaArticulo(art);
                for (const tk of tokens) {
                    if (!bolsa.includes(tk)) return false;
                }
            }
            return true;
        });

        // Por defecto los acordeones aparecen replegados; solo se auto-despliegan cuando el operador escribe en el buscador
        if (tokens.length > 0) {
            this.articulosFiltrados.forEach(art => {
                const fam = art.familia || art.familia_nombre || 'General';
                const artP = art.articulo_principal || 'General';
                this.familiasAbiertas.add(fam);
                this.atributosAbiertos.add(`${fam}___${artP}`);
            });
        }

        this.renderizarLista();
    },

    renderizarLista() {
        const contenedor = document.getElementById('contenedor-articulos-fotos');
        if (!contenedor) return;

        const lblResumen = document.getElementById('lbl-jerarquia-resumen');
        const btnExpandir = document.getElementById('btn-toggle-expandir-todo');

        if (this.articulosFiltrados.length === 0) {
            if (lblResumen) lblResumen.textContent = '🌳 0 artículos en esta vista';
            contenedor.innerHTML = `
                <div style="text-align: center; padding: 2.5rem 1.25rem; background: #1e293b; border: 1px dashed #334155; border-radius: 1rem; color: #94a3b8;">
                    <div style="font-size: 2rem; margin-bottom: 0.45rem;">🔍</div>
                    <div style="font-weight: 800; color: #f8fafc; margin-bottom: 0.3rem;">No se encontraron artículos en esta vista</div>
                    <div style="font-size: 0.8rem; margin-bottom: 1rem;">Probá cambiar el filtro rápido o buscar en todo el catálogo.</div>
                    <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
                        <button onclick="FotosDepositoController.cambiarFiltro('linea1_todos')" style="background: rgba(14,165,233,0.18); color: #7dd3fc; border: 1px solid rgba(14,165,233,0.4); border-radius: 0.65rem; padding: 0.5rem 0.9rem; font-size: 0.78rem; font-weight: 800; cursor: pointer;">
                            📦 Ver Toda Línea 1
                        </button>
                        <button onclick="FotosDepositoController.cambiarFiltro('todos')" style="background: rgba(20,184,166,0.18); color: #5eead4; border: 1px solid rgba(20,184,166,0.4); border-radius: 0.65rem; padding: 0.5rem 0.9rem; font-size: 0.78rem; font-weight: 800; cursor: pointer;">
                            🌐 Ver Todos los Artículos
                        </button>
                    </div>
                </div>
            `;
            return;
        }

        // 1. Agrupar por Nivel 1 (Familia) -> Nivel 2 (Artículo Principal)
        const familiasMap = new Map();
        this.articulosFiltrados.forEach(art => {
            const fam = art.familia || art.familia_nombre || 'General';
            const artP = art.articulo_principal || 'General';

            if (!familiasMap.has(fam)) {
                familiasMap.set(fam, new Map());
            }
            const artPMap = familiasMap.get(fam);
            if (!artPMap.has(artP)) {
                artPMap.set(artP, []);
            }
            artPMap.get(artP).push(art);
        });

        const familiasOrdenadas = Array.from(familiasMap.entries()).sort((a, b) => {
            if (a[0].toLowerCase() === 'general' || a[0].toLowerCase() === 'sin familia') return 1;
            if (b[0].toLowerCase() === 'general' || b[0].toLowerCase() === 'sin familia') return -1;
            return a[0].localeCompare(b[0], 'es', { sensitivity: 'base' });
        });

        if (lblResumen) {
            lblResumen.textContent = `🌳 ${familiasOrdenadas.length} familia(s) • ${this.articulosFiltrados.length} artículo(s)`;
        }
        if (btnExpandir) {
            const algunaAbierta = this.familiasAbiertas.size > 0;
            this.todoExpandido = algunaAbierta && this.familiasAbiertas.size >= familiasOrdenadas.length;
            btnExpandir.innerHTML = this.todoExpandido ? '📁 Colapsar todo' : '📂 Expandir todo';
        }

        let html = '';

        familiasOrdenadas.forEach(([familiaNombre, articulosPrincipalMap]) => {
            const isFamOpen = this.familiasAbiertas.has(familiaNombre);
            let totalArticulosEnFamilia = 0;
            let totalConFotosFamilia = 0;
            let totalEnOfertaFamilia = 0;

            articulosPrincipalMap.forEach(prods => {
                totalArticulosEnFamilia += prods.length;
                prods.forEach(a => {
                    if (a.tiene_fotos) totalConFotosFamilia++;
                    if (a.en_oferta_activa) totalEnOfertaFamilia++;
                });
            });

            const articulosOrdenados = Array.from(articulosPrincipalMap.entries()).sort((a, b) => {
                if (a[0].toLowerCase() === 'general') return 1;
                if (b[0].toLowerCase() === 'general') return -1;
                return a[0].localeCompare(b[0], 'es', { sensitivity: 'base' });
            });

            const famSafe = familiaNombre.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

            html += `
                <div class="bunker-familia-card ${isFamOpen ? 'open' : ''}">
                    <!-- Header Familia (Nivel 1) -->
                    <div class="bunker-familia-header" onclick="FotosDepositoController.toggleFamilia('${famSafe}')">
                        <div class="bunker-familia-title-group">
                            <span class="bunker-chevron" style="transform: ${isFamOpen ? 'rotate(90deg)' : 'rotate(0deg)'}">▶</span>
                            <h3 class="bunker-familia-name">${this.escapeHtml(this.formatearNombreFamilia(familiaNombre))}</h3>
                        </div>
                        <div style="display:flex; align-items:center; gap:0.35rem; flex-shrink:0;">
                            ${totalConFotosFamilia > 0 ? `
                                <span style="font-size:0.68rem; font-weight:800; background:rgba(13,148,136,0.25); color:#5eead4; border:1px solid rgba(20,184,166,0.5); padding:0.12rem 0.45rem; border-radius:999px;">
                                    📷 ${totalConFotosFamilia}
                                </span>
                            ` : ''}
                            ${totalEnOfertaFamilia > 0 ? `
                                <span style="font-size:0.68rem; font-weight:800; background:rgba(245,158,11,0.2); color:#fcd34d; border:1px solid rgba(245,158,11,0.4); padding:0.12rem 0.42rem; border-radius:999px;">
                                    🔥 ${totalEnOfertaFamilia}
                                </span>
                            ` : ''}
                            <span class="bunker-count-badge">${totalArticulosEnFamilia}</span>
                        </div>
                    </div>

                    <!-- Body Familia -->
                    ${isFamOpen ? `
                        <div class="bunker-familia-body">
                            ${articulosOrdenados.map(([artPrincipalNombre, productos]) => {
                                const attrKey = `${familiaNombre}___${artPrincipalNombre}`;
                                const attrSafe = attrKey.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                                const isAttrOpen = this.atributosAbiertos.has(attrKey);

                                let totalConFotosAttr = 0;
                                let totalOfertaAttr = 0;
                                productos.forEach(a => {
                                    if (a.tiene_fotos) totalConFotosAttr++;
                                    if (a.en_oferta_activa) totalOfertaAttr++;
                                });

                                return `
                                    <div class="bunker-atributo-group ${isAttrOpen ? 'open' : ''}">
                                        <!-- Header Artículo Principal (Nivel 2) -->
                                        <div class="bunker-atributo-header" onclick="FotosDepositoController.toggleAtributo('${attrSafe}')">
                                            <div style="display:flex; align-items:center; gap:0.5rem;">
                                                <span style="font-size:0.75rem; color:#60a5fa; transform:${isAttrOpen ? 'rotate(90deg)' : 'rotate(0deg)'}">▶</span>
                                                <span class="bunker-atributo-name">${this.escapeHtml(artPrincipalNombre)}</span>
                                            </div>
                                            <div style="display:flex; align-items:center; gap:0.35rem; flex-shrink:0;">
                                                ${totalConFotosAttr > 0 ? `
                                                    <span style="font-size:0.66rem; font-weight:800; background:rgba(13,148,136,0.25); color:#5eead4; border:1px solid rgba(20,184,166,0.5); padding:0.1rem 0.4rem; border-radius:999px;">
                                                        📷 ${totalConFotosAttr}
                                                    </span>
                                                ` : ''}
                                                ${totalOfertaAttr > 0 ? `
                                                    <span style="font-size:0.66rem; font-weight:800; background:rgba(245,158,11,0.2); color:#fcd34d; border:1px solid rgba(245,158,11,0.4); padding:0.1rem 0.38rem; border-radius:999px;">
                                                        🔥 ${totalOfertaAttr}
                                                    </span>
                                                ` : ''}
                                                <span class="bunker-count-badge" style="font-size:0.68rem;">${productos.length}</span>
                                            </div>
                                        </div>

                                        <!-- Body Artículo Principal: Multinivel N3, N4, N5 -->
                                        ${isAttrOpen ? `
                                            <div class="bunker-atributo-body">
                                                <div class="bunker-articulos-subgrid">
                                                    ${this.renderHtmlNodosJerarquia(productos)}
                                                </div>
                                            </div>
                                        ` : ''}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        });

        contenedor.innerHTML = html;
    },

    /**
     * Construye el HTML de la jerarquía multinivel (N3, N4, N5) idéntica al Portal B2B y Cotizador Móvil.
     */
    renderHtmlNodosJerarquia(productos) {
        const subMap = new Map();
        let hasN3 = false;

        productos.forEach(p => {
            const sub = (p.sub_categoria || '').trim();
            if (sub && sub !== '') {
                hasN3 = true;
                const subKey = sub.toLowerCase();
                if (!subMap.has(subKey)) {
                    subMap.set(subKey, { nombre: sub, prods: [] });
                }
                subMap.get(subKey).prods.push(p);
            }
        });

        if (!hasN3) {
            return this.renderHtmlGrupoProductos(productos);
        }

        const sinSub = productos.filter(p => !p.sub_categoria || p.sub_categoria.trim() === '');
        if (sinSub.length > 0) {
            if (!subMap.has('general')) {
                subMap.set('general', { nombre: 'General', prods: [] });
            }
            subMap.get('general').prods.push(...sinSub);
        }

        const subList = Array.from(subMap.values()).sort((a, b) => {
            if (a.nombre.toLowerCase() === 'general') return 1;
            if (b.nombre.toLowerCase() === 'general') return -1;
            return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
        });

        return subList.map(subItem => {
            const h3Html = `
                <div class="bunker-subcat-header n3">
                    <span>🏷️ ${this.escapeHtml(subItem.nombre)}</span>
                    <span class="bunker-count-badge mini">${subItem.prods.length}</span>
                </div>
            `;

            const subSubMap = new Map();
            let hasN4 = false;

            subItem.prods.forEach(sp => {
                const subSub = (sp.sub_sub_categoria || '').trim();
                if (subSub && subSub !== '') {
                    hasN4 = true;
                    const subSubKey = subSub.toLowerCase();
                    if (!subSubMap.has(subSubKey)) {
                        subSubMap.set(subSubKey, { nombre: subSub, prods: [] });
                    }
                    subSubMap.get(subSubKey).prods.push(sp);
                }
            });

            if (!hasN4) {
                return h3Html + this.renderHtmlGrupoProductos(subItem.prods);
            }

            const sinSubSub = subItem.prods.filter(sp => !sp.sub_sub_categoria || sp.sub_sub_categoria.trim() === '');
            if (sinSubSub.length > 0) {
                if (!subSubMap.has('general')) {
                    subSubMap.set('general', { nombre: 'General', prods: [] });
                }
                subSubMap.get('general').prods.push(...sinSubSub);
            }

            const subSubList = Array.from(subSubMap.values()).sort((a, b) => {
                if (a.nombre.toLowerCase() === 'general') return 1;
                if (b.nombre.toLowerCase() === 'general') return -1;
                return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
            });

            const n4Html = subSubList.map(subSubItem => {
                const h4Html = `
                    <div class="bunker-subcat-header n4">
                        <span>↳ 🌿 ${this.escapeHtml(subSubItem.nombre)}</span>
                        <span class="bunker-count-badge mini">${subSubItem.prods.length}</span>
                    </div>
                `;

                const subSubSubMap = new Map();
                let hasN5 = false;

                subSubItem.prods.forEach(ssp => {
                    const subSubSub = (ssp.sub_sub_sub_categoria || '').trim();
                    if (subSubSub && subSubSub !== '') {
                        hasN5 = true;
                        const subSubSubKey = subSubSub.toLowerCase();
                        if (!subSubSubMap.has(subSubSubKey)) {
                            subSubSubMap.set(subSubSubKey, { nombre: subSubSub, prods: [] });
                        }
                        subSubSubMap.get(subSubSubKey).prods.push(ssp);
                    }
                });

                if (!hasN5) {
                    return h4Html + this.renderHtmlGrupoProductos(subSubItem.prods);
                }

                const sinSubSubSub = subSubItem.prods.filter(ssp => !ssp.sub_sub_sub_categoria || ssp.sub_sub_sub_categoria.trim() === '');
                if (sinSubSubSub.length > 0) {
                    if (!subSubSubMap.has('general')) {
                        subSubSubMap.set('general', { nombre: 'General', prods: [] });
                    }
                    subSubSubMap.get('general').prods.push(...sinSubSubSub);
                }

                const subSubSubList = Array.from(subSubSubMap.values()).sort((a, b) => {
                    if (a.nombre.toLowerCase() === 'general') return 1;
                    if (b.nombre.toLowerCase() === 'general') return -1;
                    return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
                });

                const n5Html = subSubSubList.map(subSubSubItem => {
                    const h5Html = `
                        <div class="bunker-subcat-header n5">
                            <span>↳ 🔹 ${this.escapeHtml(subSubSubItem.nombre)}</span>
                            <span class="bunker-count-badge mini">${subSubSubItem.prods.length}</span>
                        </div>
                    `;
                    return h5Html + this.renderHtmlGrupoProductos(subSubSubItem.prods);
                }).join('');

                return h4Html + n5Html;
            }).join('');

            return h3Html + n4Html;
        }).join('');
    },

    /**
     * Ordena los productos dentro de cada rama jerárquica (presentación mayor primero).
     */
    renderHtmlGrupoProductos(productos) {
        const directos = [];
        const packs = [];

        productos.forEach(p => {
            const esPack = (p.es_pack === true) || (p.pack_unidades && parseInt(p.pack_unidades, 10) > 1);
            if (esPack) {
                packs.push(p);
            } else {
                directos.push(p);
            }
        });

        const sortFn = (a, b) => {
            const kA = parseFloat(a.kilos_unidad || 0);
            const kB = parseFloat(b.kilos_unidad || 0);
            if (kB !== kA) return kB - kA;
            return (a.nomenclatura || a.descripcion || '').localeCompare(b.nomenclatura || b.descripcion || '', 'es', { sensitivity: 'base' });
        };

        directos.sort(sortFn);
        packs.sort(sortFn);

        let outHtml = directos.map(art => this.renderCardArticulo(art)).join('');

        if (packs.length > 0) {
            if (directos.length > 0) {
                outHtml += `
                    <div class="bunker-packs-separator">
                        <span>📦 Packs / Cajas Cerradas</span>
                        <span class="bunker-count-badge mini">${packs.length}</span>
                    </div>
                `;
            }
            outHtml += packs.map(art => this.renderCardArticulo(art)).join('');
        }

        return outHtml;
    },

    renderCardArticulo(art) {
        const fotos = art.fotos_lote?.imagenes || [];
        const cantFotos = fotos.length;
        const tieneFotos = cantFotos > 0;
        const loteCodigo = art.fotos_lote?.lote_codigo_corto
            || art.fotos_lote?.lote_id_supabase
            || art.ultimo_lote?.lote_codigo_corto
            || art.ultimo_lote?.lote_id_supabase
            || null;
        const derivadosCount = Array.isArray(art.derivados_linea_2) ? art.derivados_linea_2.length : 0;
        const esPuenteAp = art.articulo_puente?.es_articulo_puente === true;

        const stockBadge = art.tiene_stock
            ? `<span class="badge-tag badge-stock-ok">📦 Stock: ${Number(art.stock_bultos || 0).toLocaleString('es-AR', { maximumFractionDigits: 1 })}</span>`
            : `<span class="badge-tag badge-stock-zero">Sin stock físico</span>`;

        const esPackPadre = (art.es_pack === true) || (Number(art.pack_unidades || 1) > 1);
        const flujoBadge = esPackPadre
            ? `<span class="badge-tag badge-linea1" style="background: rgba(168,85,247,0.18); color: #d8b4fe; border-color: rgba(168,85,247,0.45);">📦 Artículo Padre • Pack (${Number(art.pack_unidades || 1)} u.)</span>`
            : (esPuenteAp
                ? `<span class="badge-tag badge-linea1" style="background: rgba(13,148,136,0.22); color: #5eead4; border-color: rgba(20,184,166,0.45);">🔗 Puente AP • ${this.escapeHtml(art.articulo_puente.articulo_id)}</span>`
                : (art.es_linea_1
                    ? `<span class="badge-tag badge-linea1">Línea 1 • Bulto Madre</span>`
                    : `<span class="badge-tag badge-derivado">Fracción / Derivado</span>`));

        const ofertaBadge = art.en_oferta_activa
            ? `<span class="badge-tag badge-oferta">🔥 En Oferta</span>`
            : '';

        const loteBadge = loteCodigo
            ? `<span class="badge-tag badge-lote">🏷️ ${this.escapeHtml(loteCodigo)}</span>`
            : '';

        let thumbsHtml = '';
        if (tieneFotos) {
            const imgs = fotos.map(f => `<img src="${this.escapeHtml(f.url)}" class="thumb-mini" alt="Foto lote" loading="lazy">`).join('');
            thumbsHtml = `
                <div class="thumbs-preview-strip">
                    ${imgs}
                </div>
            `;
        }

        const seleccionadosDeriv = this.obtenerDerivadosSeleccionadosDeArticulo(art);
        const cantDerivActivos = seleccionadosDeriv.length;
        let textoEstadoDeriv = esPuenteAp ? '(Solo esta presentación)' : '(Solo Línea 1)';
        if (cantDerivActivos > 0) {
            textoEstadoDeriv = cantDerivActivos === derivadosCount
                ? `(Compartiendo en todas: ${derivadosCount}/${derivadosCount} ✓)`
                : `(Compartiendo en ${cantDerivActivos}/${derivadosCount} ✓)`;
        }

        const etiquetaRelacion = esPuenteAp
            ? `${derivadosCount} presentación(es) vía ${this.escapeHtml(art.articulo_puente.articulo_id)}`
            : `${derivadosCount} derivado(s) Línea 2`;

        const derivadosInfo = derivadosCount > 0
            ? `<span style="color: ${cantDerivActivos > 0 ? '#5eead4' : '#94a3b8'}; font-weight: 700;">
                 🔗 ${etiquetaRelacion} ${textoEstadoDeriv}
               </span>`
            : '';

        const skuSafe = this.escapeHtml(art.articulo_id).replace(/'/g, "\\'");

        return `
            <article class="art-foto-card ${tieneFotos ? 'has-photos' : ''}">
                <div class="art-badges-row">
                    <span class="badge-tag badge-sku">${this.escapeHtml(art.articulo_id)}</span>
                    ${flujoBadge}
                    ${stockBadge}
                    ${ofertaBadge}
                    ${loteBadge}
                </div>

                <div class="art-title">${this.escapeHtml(art.nomenclatura)}</div>

                <div class="art-meta-sub">
                    ${art.marca ? `<span>🏷️ Marca: <strong>${this.escapeHtml(art.marca)}</strong></span>` : ''}
                    ${art.kilos_unidad ? `<span>⚖️ ${Number(art.kilos_unidad)} kg</span>` : ''}
                    ${derivadosInfo}
                </div>

                ${art.fotos_lote?.observacion_tecnica ? `
                    <div style="font-size: 0.75rem; color: #cbd5e1; background: rgba(15,23,42,0.6); border-left: 3px solid #14b8a6; padding: 0.35rem 0.6rem; border-radius: 0.35rem; margin-bottom: 0.55rem;">
                        📝 ${this.escapeHtml(art.fotos_lote.observacion_tecnica)}
                    </div>
                ` : ''}

                ${thumbsHtml}

                <button
                    type="button"
                    class="btn-capturar-card ${tieneFotos ? 'edit' : 'primary'}"
                    onclick="FotosDepositoController.abrirModalArticulo('${skuSafe}')"
                >
                    ${tieneFotos
                        ? `📷 Gestionar / Agregar Fotos (${cantFotos}/6)`
                        : `📸 Capturar Fotos de Partida`}
                </button>
            </article>
        `;
    },

    obtenerDerivadosSeleccionadosDeArticulo(art) {
        const derivados = Array.isArray(art?.derivados_linea_2) ? art.derivados_linea_2 : [];
        if (!art?.tiene_fotos || derivados.length === 0) return [];
        const validSkus = new Set(derivados.map(d => String(d.articulo_id).trim()));
        const explicitList = Array.isArray(art.fotos_lote?.derivados_seleccionados)
            ? art.fotos_lote.derivados_seleccionados
            : (Array.isArray(art.fotos_lote?.imagenes?.[0]?.derivados_seleccionados)
                ? art.fotos_lote.imagenes[0].derivados_seleccionados
                : null);
        if (Array.isArray(explicitList)) {
            if (art.fotos_lote?.extender_a_derivados === true && explicitList.length === 0) {
                return Array.from(validSkus);
            }
            return explicitList.map(s => String(s).trim()).filter(s => validSkus.has(s));
        }
        if (art.fotos_lote?.extender_a_derivados === true) {
            return Array.from(validSkus);
        }
        return [];
    },

    abrirModalArticulo(articuloId, loteEscaneadoOpcional = null) {
        const art = this.articulos.find(a => String(a.articulo_id) === String(articuloId));
        if (!art) return;

        this.articuloSeleccionado = art;
        this.loteCodigoEscaneado = loteEscaneadoOpcional
            ? String(loteEscaneadoOpcional).trim()
            : (art.fotos_lote?.lote_codigo_corto || art.fotos_lote?.lote_id_supabase || null);
        this.imagenesExistentes = Array.isArray(art.fotos_lote?.imagenes)
            ? JSON.parse(JSON.stringify(art.fotos_lote.imagenes))
            : [];
        this.imagenesNuevas = [];
        this.reemplazarLote = false;

        // Poblar cabecera del modal
        document.getElementById('modal-art-sku').textContent = art.articulo_id;
        const esPuenteAp = art.articulo_puente?.es_articulo_puente === true;
        const esPackPadre = (art.es_pack === true) || (Number(art.pack_unidades || 1) > 1);
        document.getElementById('modal-art-flujo').textContent = esPackPadre
            ? `Artículo Padre • Pack (${Number(art.pack_unidades || 1)} u.)`
            : (esPuenteAp
                ? `Puente AP • ${art.articulo_puente.articulo_id}`
                : (art.es_linea_1 ? 'Línea 1 • Bulto Madre' : 'Fracción / Derivado'));
        const loteStr = this.loteCodigoEscaneado
            || art.fotos_lote?.lote_codigo_corto
            || art.fotos_lote?.lote_id_supabase
            || art.ultimo_lote?.lote_codigo_corto
            || art.ultimo_lote?.lote_id_supabase
            || 'Lote en Stock';
        document.getElementById('modal-art-lote').textContent = `🏷️ ${loteStr}`;
        document.getElementById('modal-art-nombre').textContent = art.nomenclatura;

        // Observación técnica
        const inputObs = document.getElementById('input-observacion-tecnica');
        if (inputObs) {
            inputObs.value = art.fotos_lote?.observacion_tecnica || '';
        }

        // Selección manual por fracción / presentación hermana (Por defecto: ninguno marcado)
        const seleccionadosIniciales = this.obtenerDerivadosSeleccionadosDeArticulo(art);
        this.derivadosSeleccionadosSet = new Set(seleccionadosIniciales);
        this.renderizarSelectorDerivadosModal();

        // Checkbox de foto permanente (Por defecto: FALSE / destildado)
        const chkPermanente = document.getElementById('chk-es-permanente');
        if (chkPermanente) {
            chkPermanente.checked = art.fotos_lote ? (art.fotos_lote.es_permanente === true) : false;
        }

        // Botón de eliminar partida existente
        const btnEliminar = document.getElementById('btn-eliminar-partida');
        if (btnEliminar) {
            btnEliminar.style.display = art.tiene_fotos ? 'block' : 'none';
        }

        const btnReemplazar = document.getElementById('btn-limpiar-para-nuevo-lote');
        if (btnReemplazar) {
            btnReemplazar.style.display = art.tiene_fotos ? 'inline-block' : 'none';
        }

        this.renderizarGrillaFotosModal();

        const modal = document.getElementById('modal-captura-fotos');
        if (modal) modal.classList.add('open');
    },

    renderizarSelectorDerivadosModal() {
        const art = this.articuloSeleccionado;
        const boxDerivados = document.getElementById('box-extender-derivados');
        const chkDerivados = document.getElementById('chk-extender-derivados');
        const lblCantDerivados = document.getElementById('lbl-cant-derivados');
        const lblTituloDerivados = document.getElementById('lbl-titulo-derivados-modal');
        const lblSubtituloDerivados = document.getElementById('lbl-subtitulo-derivados-modal');
        const listaPreview = document.getElementById('lista-derivados-preview');

        const derivados = Array.isArray(art?.derivados_linea_2) ? art.derivados_linea_2 : [];
        if (!boxDerivados || !chkDerivados || derivados.length === 0) {
            if (boxDerivados) boxDerivados.style.display = 'none';
            if (chkDerivados) {
                chkDerivados.checked = false;
                chkDerivados.indeterminate = false;
            }
            return;
        }

        if (!(this.derivadosSeleccionadosSet instanceof Set)) {
            this.derivadosSeleccionadosSet = new Set();
        }

        boxDerivados.style.display = 'block';
        const total = derivados.length;
        const cantSel = derivados.filter(d => this.derivadosSeleccionadosSet.has(String(d.articulo_id).trim())).length;

        chkDerivados.checked = cantSel > 0;
        chkDerivados.indeterminate = cantSel > 0 && cantSel < total;

        const esPuenteAp = art?.articulo_puente?.es_articulo_puente === true;
        const esPackPadre = (art?.es_pack === true) || (Number(art?.pack_unidades || 1) > 1);
        if (lblTituloDerivados) {
            lblTituloDerivados.textContent = esPackPadre
                ? 'Compartir también en otras presentaciones vinculadas'
                : (esPuenteAp
                    ? `Compartir en presentaciones de ${art.articulo_puente.articulo_id}`
                    : 'Mostrar en fracciones derivadas de Línea 2');
        }
        if (lblSubtituloDerivados) {
            lblSubtituloDerivados.innerHTML = esPackPadre
                ? `Las fotos ya se publican en <strong>${this.escapeHtml(art.nomenclatura)}</strong>. Además, podés elegir si querés replicarlas en su artículo hijo u otras presentaciones:`
                : (esPuenteAp
                    ? `🔗 Vinculadas por Artículo Puente (<strong>${this.escapeHtml(art.articulo_puente.descripcion || art.articulo_puente.articulo_id)}</strong>). Elegí en qué presentaciones mostrar estas fotos:`
                    : `Tocá cada fracción para elegir en cuál <strong>sí</strong> y en cuál <strong>no</strong> mostrar esta partida (aclarando que corresponde a la caja madre).`);
        }

        if (lblCantDerivados) {
            lblCantDerivados.textContent = `${cantSel}/${total} adicionales`;
            lblCantDerivados.style.color = cantSel > 0 ? '#5eead4' : '#94a3b8';
        }

        if (listaPreview) {
            const filaActualHtml = `
                <div
                    style="display: flex; align-items: center; justify-content: space-between; gap: 0.55rem; width: 100%; padding: 0.52rem 0.68rem; border-radius: 0.65rem; user-select: none; background: rgba(16, 185, 129, 0.14); border: 1.5px solid rgba(16, 185, 129, 0.55);"
                >
                    <div style="display: flex; align-items: center; gap: 0.55rem; min-width: 0; flex: 1;">
                        <input
                            type="checkbox"
                            checked
                            disabled
                            style="width: 18px; height: 18px; accent-color: #10b981; flex-shrink: 0; margin: 0; opacity: 0.95;"
                        >
                        <div style="min-width: 0; flex: 1; font-size: 0.77rem; color: #f8fafc; line-height: 1.25;">
                            <strong style="color: #6ee7b7; font-family: monospace;">${this.escapeHtml(art.articulo_id)}</strong>
                            <span> • ${this.escapeHtml(art.nomenclatura)}</span>
                        </div>
                    </div>
                    <span style="font-size: 0.65rem; font-weight: 800; padding: 2px 7px; border-radius: 999px; flex-shrink: 0; background: rgba(16, 185, 129, 0.25); color: #6ee7b7;">
                        ✓ Artículo actual
                    </span>
                </div>
            `;

            listaPreview.innerHTML = filaActualHtml + derivados.map(d => {
                const skuD = String(d.articulo_id).trim();
                const skuSafe = this.escapeHtml(skuD).replace(/'/g, "\\'");
                const checked = this.derivadosSeleccionadosSet.has(skuD);
                return `
                    <div
                        onclick="FotosDepositoController.toggleDerivadoIndividual('${skuSafe}')"
                        style="display: flex; align-items: center; justify-content: space-between; gap: 0.55rem; width: 100%; padding: 0.52rem 0.68rem; border-radius: 0.65rem; cursor: pointer; user-select: none; transition: all 0.15s; background: ${checked ? 'rgba(20, 184, 166, 0.16)' : '#0f172a'}; border: 1.5px solid ${checked ? '#14b8a6' : '#334155'};"
                    >
                        <div style="display: flex; align-items: center; gap: 0.55rem; min-width: 0; flex: 1;">
                            <input
                                type="checkbox"
                                ${checked ? 'checked' : ''}
                                onclick="event.stopPropagation(); FotosDepositoController.toggleDerivadoIndividual('${skuSafe}')"
                                style="width: 18px; height: 18px; accent-color: #0d9488; flex-shrink: 0; cursor: pointer; margin: 0;"
                            >
                            <div style="min-width: 0; flex: 1; font-size: 0.77rem; color: ${checked ? '#f8fafc' : '#94a3b8'}; line-height: 1.25;">
                                <strong style="color: ${checked ? '#5eead4' : '#cbd5e1'}; font-family: monospace;">${this.escapeHtml(skuD)}</strong>
                                <span> • ${this.escapeHtml(d.nomenclatura)}</span>
                            </div>
                        </div>
                        <span style="font-size: 0.66rem; font-weight: 800; padding: 2px 7px; border-radius: 999px; flex-shrink: 0; background: ${checked ? 'rgba(16, 185, 129, 0.22)' : 'rgba(51, 65, 85, 0.5)'}; color: ${checked ? '#6ee7b7' : '#64748b'};">
                            ${checked ? '✓ Sí' : 'No'}
                        </span>
                    </div>
                `;
            }).join('');
        }
    },

    toggleDerivadoIndividual(skuDeriv) {
        const key = String(skuDeriv || '').trim();
        if (!key) return;
        if (!(this.derivadosSeleccionadosSet instanceof Set)) {
            this.derivadosSeleccionadosSet = new Set();
        }
        if (this.derivadosSeleccionadosSet.has(key)) {
            this.derivadosSeleccionadosSet.delete(key);
        } else {
            this.derivadosSeleccionadosSet.add(key);
        }
        this.renderizarSelectorDerivadosModal();
    },

    toggleTodosDerivados(forzarEstado = null) {
        const derivados = Array.isArray(this.articuloSeleccionado?.derivados_linea_2)
            ? this.articuloSeleccionado.derivados_linea_2
            : [];
        if (derivados.length === 0) return;

        if (!(this.derivadosSeleccionadosSet instanceof Set)) {
            this.derivadosSeleccionadosSet = new Set();
        }

        const todosMarcadosActualmente = derivados.every(d => this.derivadosSeleccionadosSet.has(String(d.articulo_id).trim()));
        const nuevoEstado = typeof forzarEstado === 'boolean' ? forzarEstado : !todosMarcadosActualmente;

        if (nuevoEstado) {
            derivados.forEach(d => this.derivadosSeleccionadosSet.add(String(d.articulo_id).trim()));
        } else {
            this.derivadosSeleccionadosSet.clear();
        }
        this.renderizarSelectorDerivadosModal();
    },

    cerrarModal() {
        const modal = document.getElementById('modal-captura-fotos');
        if (modal) modal.classList.remove('open');
        this.articuloSeleccionado = null;
        this.loteCodigoEscaneado = null;
    },

    // =========================================================================
    // ESCÁNER DE CÓDIGO DE BARRAS EN VIVO (ARTÍCULO + LOTE OPCIONAL)
    // =========================================================================

    emitirBeepExito() {
        try {
            if (navigator.vibrate) navigator.vibrate(75);
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                const ctx = new AudioCtx();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1046.5, ctx.currentTime); // C6
                gain.gain.setValueAtTime(0.12, ctx.currentTime);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.09);
            }
        } catch (_) { /* ignore audio errors */ }
    },

    /**
     * Busca un artículo en todo el catálogo por código de barras comercial, SKU,
     * código de ingrediente de producción o código de barras de Lote (lote_codigo_corto / lote_id_supabase).
     */
    buscarArticuloPorCodigoExacto(rawCode) {
        const clean = String(rawCode || '').trim().replace(/^L:\s*/i, '');
        if (!clean) return null;
        const lower = clean.toLowerCase();

        // 1. Coincidencia por código de barras comercial, SKU o código de ingrediente vinculado
        for (const art of this.articulos) {
            if (art.codigo_barras && String(art.codigo_barras).trim().toLowerCase() === lower) {
                return { articulo: art, loteDetectado: null, fuePorLote: false };
            }
            if (String(art.articulo_id || '').trim().toLowerCase() === lower) {
                return { articulo: art, loteDetectado: null, fuePorLote: false };
            }
            if (Array.isArray(art.codigos_ingrediente)) {
                if (art.codigos_ingrediente.some(c => String(c).trim().toLowerCase() === lower)) {
                    return { articulo: art, loteDetectado: null, fuePorLote: false };
                }
            }
        }

        // 2. Coincidencia directa por código de barras de Lote (etiqueta derecha Zebra)
        for (const art of this.articulos) {
            if (Array.isArray(art.lotes_vinculados)) {
                const loteMatch = art.lotes_vinculados.find(l =>
                    (l.lote_codigo_corto && String(l.lote_codigo_corto).trim().toLowerCase() === lower) ||
                    (l.lote_id_supabase && String(l.lote_id_supabase).trim().toLowerCase() === lower)
                );
                if (loteMatch) {
                    return {
                        articulo: art,
                        loteDetectado: loteMatch.lote_codigo_corto || loteMatch.lote_id_supabase,
                        fuePorLote: true
                    };
                }
            }
            if (art.ultimo_lote) {
                const ul = art.ultimo_lote;
                if (
                    (ul.lote_codigo_corto && String(ul.lote_codigo_corto).trim().toLowerCase() === lower) ||
                    (ul.lote_id_supabase && String(ul.lote_id_supabase).trim().toLowerCase() === lower)
                ) {
                    return {
                        articulo: art,
                        loteDetectado: ul.lote_codigo_corto || ul.lote_id_supabase,
                        fuePorLote: true
                    };
                }
            }
        }

        return null;
    },

    async abrirEscanerCodigo(modo = 'articulo_y_lote') {
        this.modoEscaner = modo;
        this.pasoEscaner = modo === 'solo_lote' ? 2 : 1;
        this.ultimoCodigoLeido = '';
        this.ultimoTiempoLectura = 0;

        const inputManual = document.getElementById('input-codigo-manual-scanner');
        if (inputManual) inputManual.value = '';

        const stepBadge = document.getElementById('scanner-step-badge');
        const titleEl = document.getElementById('scanner-modal-title');
        const statusEl = document.getElementById('scanner-status-msg');
        const boxConfirmado = document.getElementById('scanner-art-confirmado-box');

        if (modo === 'solo_lote' && this.articuloSeleccionado) {
            this.articuloEscaneadoTemp = this.articuloSeleccionado;
            this.loteEscaneadoTemp = this.loteCodigoEscaneado
                || this.articuloSeleccionado.fotos_lote?.lote_codigo_corto
                || this.articuloSeleccionado.ultimo_lote?.lote_codigo_corto
                || 'Lote en Stock';
            if (stepBadge) stepBadge.textContent = 'Lectura de Lote';
            if (titleEl) titleEl.textContent = 'Apuntá al código de barras del Lote';
            if (statusEl) statusEl.textContent = 'Escaneá la etiqueta derecha (L: ...) de la caja o partida.';
            this.actualizarTarjetaScannerPaso2();
        } else {
            this.articuloEscaneadoTemp = null;
            this.loteEscaneadoTemp = null;
            if (stepBadge) stepBadge.textContent = 'Paso 1 • Escanear Artículo o Lote';
            if (titleEl) titleEl.textContent = 'Apuntá al código de barras de la etiqueta';
            if (statusEl) statusEl.textContent = 'Podés leer el código del artículo (izquierda) o directamente el código del lote (derecha).';
            if (boxConfirmado) boxConfirmado.style.display = 'none';
        }

        const modal = document.getElementById('modal-escaner-codigo');
        if (modal) modal.classList.add('open');

        await this.iniciarCamaraEscaner();
    },

    actualizarTarjetaScannerPaso2() {
        const boxConfirmado = document.getElementById('scanner-art-confirmado-box');
        const skuEl = document.getElementById('scanner-det-sku');
        const nomEl = document.getElementById('scanner-det-nombre');
        const loteEl = document.getElementById('scanner-det-lote');

        if (!this.articuloEscaneadoTemp || !boxConfirmado) return;
        boxConfirmado.style.display = 'block';
        if (skuEl) skuEl.textContent = this.articuloEscaneadoTemp.articulo_id;
        if (nomEl) nomEl.textContent = this.articuloEscaneadoTemp.nomenclatura;
        if (loteEl) loteEl.textContent = this.loteEscaneadoTemp || 'Lote en Stock';
    },

    async cerrarEscanerCodigo() {
        await this.detenerCamaraEscaner();
        const modal = document.getElementById('modal-escaner-codigo');
        if (modal) modal.classList.remove('open');
    },

    async iniciarCamaraEscaner() {
        await this.detenerCamaraEscaner();
        this.escanerActivo = true;

        const videoEl = document.getElementById('scanner-native-video');
        const readerBox = document.getElementById('scanner-reader-box');
        const statusEl = document.getElementById('scanner-status-msg');

        if (statusEl) {
            statusEl.innerHTML = `<span style="color:#5eead4;">⏳ Iniciando cámara trasera... Apuntá al código de barras.</span>`;
        }

        // 1. Iniciar cámara en vivo con Html5Qrcode (soporte universal 1D/2D: Code 128, EAN-13, Code 39, QR)
        if (typeof Html5Qrcode !== 'undefined' && readerBox) {
            try {
                if (videoEl) videoEl.style.display = 'none';
                readerBox.style.display = 'block';
                this.html5QrScanner = new Html5Qrcode('scanner-reader-box');

                const configScanner = {
                    fps: 15,
                    qrbox: (viewfinderWidth, viewfinderHeight) => {
                        const w = Math.min(Math.floor(viewfinderWidth * 0.85), 320);
                        const h = Math.min(Math.floor(viewfinderHeight * 0.55), 140);
                        return { width: Math.max(w, 180), height: Math.max(h, 90) };
                    },
                    aspectRatio: 1.333,
                    experimentalFeatures: {
                        useBarCodeDetectorIfSupported: true
                    }
                };

                await this.html5QrScanner.start(
                    { facingMode: 'environment' },
                    configScanner,
                    (decodedText) => {
                        if (decodedText && this.escanerActivo) {
                            this.procesarLecturaEscaner(decodedText);
                        }
                    },
                    () => {}
                );

                if (statusEl && this.pasoEscaner === 1) {
                    statusEl.innerHTML = `Apuntá al código de barras del <strong>Artículo</strong> (izq.) o del <strong>Lote</strong> (der.).`;
                }

                // Refuerzo adicional en paralelo con BarcodeDetector nativo sobre el <video> activo
                if ('BarcodeDetector' in window) {
                    try {
                        const detector = new window.BarcodeDetector({
                            formats: ['code_128', 'ean_13', 'ean_8', 'code_39', 'qr_code', 'itf', 'upc_a', 'upc_e']
                        });
                        const scanLoop = async () => {
                            if (!this.escanerActivo) return;
                            try {
                                const internalVideo = readerBox.querySelector('video');
                                if (internalVideo && internalVideo.readyState >= 2) {
                                    const barcodes = await detector.detect(internalVideo);
                                    if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                                        this.procesarLecturaEscaner(barcodes[0].rawValue);
                                    }
                                }
                            } catch (_) {}
                            if (this.escanerActivo) {
                                this.nativeScanLoopId = setTimeout(scanLoop, 160);
                            }
                        };
                        scanLoop();
                    } catch (_) {}
                }
                return;
            } catch (err) {
                console.warn('⚠️ [SCANNER] Html5Qrcode no pudo iniciar, probando stream nativo:', err);
            }
        }

        // 2. Fallback directo con getUserMedia + BarcodeDetector si Html5Qrcode falló
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: { ideal: 'environment' },
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    },
                    audio: false
                });
                this.nativeVideoStream = stream;
                if (readerBox) readerBox.style.display = 'none';
                if (videoEl) {
                    videoEl.style.display = 'block';
                    videoEl.srcObject = stream;
                    await videoEl.play();
                }

                if ('BarcodeDetector' in window) {
                    const detector = new window.BarcodeDetector({
                        formats: ['code_128', 'ean_13', 'ean_8', 'code_39', 'qr_code', 'itf', 'upc_a', 'upc_e']
                    });
                    const scanLoop = async () => {
                        if (!this.escanerActivo || !videoEl) return;
                        try {
                            if (videoEl.readyState >= 2) {
                                const barcodes = await detector.detect(videoEl);
                                if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                                    this.procesarLecturaEscaner(barcodes[0].rawValue);
                                }
                            }
                        } catch (_) {}
                        if (this.escanerActivo) {
                            this.nativeScanLoopId = setTimeout(scanLoop, 150);
                        }
                    };
                    scanLoop();
                }
                return;
            } catch (err2) {
                console.error('❌ [SCANNER] Error abriendo cámara:', err2);
            }
        }

        if (statusEl) {
            statusEl.innerHTML = `<span style="color:#fbbf24;">Usá el botón <strong>"📸 Leer Código con Cámara Nativa"</strong> de abajo o escribí el código manualmente.</span>`;
        }
    },

    async procesarFotoCodigoBarras(fileList) {
        if (!fileList || fileList.length === 0) return;
        const file = fileList[0];
        const statusEl = document.getElementById('scanner-status-msg');
        if (statusEl) {
            statusEl.innerHTML = `<span style="color:#38bdf8;">⏳ Analizando código de barras en la imagen...</span>`;
        }

        try {
            // 1. Intentar con BarcodeDetector nativo sobre ImageBitmap
            if ('BarcodeDetector' in window && typeof createImageBitmap === 'function') {
                try {
                    const detector = new window.BarcodeDetector({
                        formats: ['code_128', 'ean_13', 'ean_8', 'code_39', 'qr_code', 'itf', 'upc_a', 'upc_e']
                    });
                    const bitmap = await createImageBitmap(file);
                    const barcodes = await detector.detect(bitmap);
                    if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                        await this.procesarLecturaEscaner(barcodes[0].rawValue, true);
                        return;
                    }
                } catch (_) {}
            }

            // 2. Fallback con Html5Qrcode.scanFile
            if (typeof Html5Qrcode !== 'undefined') {
                await this.detenerCamaraEscaner();
                const fileScanner = new Html5Qrcode('scanner-reader-box');
                const decodedText = await fileScanner.scanFile(file, false);
                fileScanner.clear();
                if (decodedText) {
                    await this.procesarLecturaEscaner(decodedText, true);
                    return;
                }
            }

            if (statusEl) {
                statusEl.innerHTML = `<span style="color:#fca5a5;">⚠️ No se detectó un código nítido en la foto. Acercate un poco más a las barras o ingresalo abajo.</span>`;
            }
        } catch (err) {
            console.warn('⚠️ No se pudo decodificar código desde imagen:', err);
            if (statusEl) {
                statusEl.innerHTML = `<span style="color:#fca5a5;">⚠️ No se pudo leer el código de barras en la foto. Intentá con mejor luz o escribí el código abajo.</span>`;
            }
        } finally {
            const inp = document.getElementById('input-scanner-foto-nativa');
            if (inp) inp.value = '';
        }
    },

    async detenerCamaraEscaner() {
        this.escanerActivo = false;
        if (this.nativeScanLoopId) {
            clearTimeout(this.nativeScanLoopId);
            this.nativeScanLoopId = null;
        }
        if (this.nativeVideoStream) {
            try {
                this.nativeVideoStream.getTracks().forEach(t => t.stop());
            } catch (_) {}
            this.nativeVideoStream = null;
        }
        const videoEl = document.getElementById('scanner-native-video');
        if (videoEl) {
            videoEl.srcObject = null;
            videoEl.style.display = 'none';
        }
        if (this.html5QrScanner) {
            try {
                if (this.html5QrScanner.isScanning) {
                    await this.html5QrScanner.stop();
                }
                this.html5QrScanner.clear();
            } catch (_) {}
            this.html5QrScanner = null;
        }
    },

    procesarCodigoDesdeInputManual() {
        const input = document.getElementById('input-codigo-manual-scanner');
        const val = input ? input.value.trim() : '';
        if (!val) return;
        if (input) input.value = '';
        this.procesarLecturaEscaner(val, true);
    },

    async procesarLecturaEscaner(rawText, forzar = false) {
        const cleanCode = String(rawText || '').trim().replace(/^L:\s*/i, '');
        if (!cleanCode) return;

        const ahora = Date.now();
        if (!forzar && cleanCode === this.ultimoCodigoLeido && (ahora - this.ultimoTiempoLectura) < 1800) {
            return;
        }
        this.ultimoCodigoLeido = cleanCode;
        this.ultimoTiempoLectura = ahora;

        const stepBadge = document.getElementById('scanner-step-badge');
        const titleEl = document.getElementById('scanner-modal-title');
        const statusEl = document.getElementById('scanner-status-msg');

        // Caso A: Estamos en modo 'solo_lote' desde adentro del modal de captura
        if (this.modoEscaner === 'solo_lote' && this.articuloSeleccionado) {
            this.emitirBeepExito();
            this.loteCodigoEscaneado = cleanCode;
            const loteEl = document.getElementById('modal-art-lote');
            if (loteEl) loteEl.textContent = `🏷️ ${cleanCode}`;
            await this.cerrarEscanerCodigo();
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: `Lote leído: ${cleanCode}`,
                    showConfirmButton: false,
                    timer: 1600,
                    background: '#1e293b',
                    color: '#f8fafc'
                });
            }
            return;
        }

        // Caso B: Estamos en Paso 1 (Buscando el Artículo o leyendo directamente un Lote vinculado)
        if (this.pasoEscaner === 1) {
            const resultado = this.buscarArticuloPorCodigoExacto(cleanCode);
            if (!resultado || !resultado.articulo) {
                if (statusEl) {
                    statusEl.innerHTML = `<span style="color:#fbbf24;">⚠️ Código "${this.escapeHtml(cleanCode)}" no vinculado como artículo. Probá con la etiqueta comercial o buscá por nombre.</span>`;
                }
                return;
            }

            this.emitirBeepExito();
            this.articuloEscaneadoTemp = resultado.articulo;
            const lotePorDefecto = resultado.loteDetectado
                || resultado.articulo.fotos_lote?.lote_codigo_corto
                || resultado.articulo.ultimo_lote?.lote_codigo_corto
                || resultado.articulo.ultimo_lote?.lote_id_supabase
                || null;
            this.loteEscaneadoTemp = lotePorDefecto;
            this.pasoEscaner = 2;

            if (stepBadge) {
                stepBadge.textContent = 'Paso 2 (Opcional) • Código de Lote o Sacar Fotos';
                stepBadge.style.background = 'rgba(16, 185, 129, 0.22)';
                stepBadge.style.color = '#6ee7b7';
            }
            if (titleEl) {
                titleEl.textContent = resultado.fuePorLote
                    ? '¡Artículo y Lote identificados!'
                    : '¡Artículo listo! ¿Querés leer el código de Lote?';
            }
            if (statusEl) {
                statusEl.innerHTML = resultado.fuePorLote
                    ? `<span style="color:#6ee7b7;">Se detectó el artículo y el lote <strong>${this.escapeHtml(lotePorDefecto)}</strong> en un solo paso.</span>`
                    : `<span style="color:#5eead4;">Apuntá al código de Lote (derecha) o tocá <strong>"Continuar y Sacar Fotos Ahora"</strong>.</span>`;
            }

            this.actualizarTarjetaScannerPaso2();
            return;
        }

        // Caso C: Estamos en Paso 2 (Ya tenemos el artículo identificado y el operador apunta al segundo código: el Lote)
        if (this.pasoEscaner === 2 && this.articuloEscaneadoTemp) {
            const cbArt = String(this.articuloEscaneadoTemp.codigo_barras || '').trim().toLowerCase();
            const skuArt = String(this.articuloEscaneadoTemp.articulo_id || '').trim().toLowerCase();
            const codsIng = Array.isArray(this.articuloEscaneadoTemp.codigos_ingrediente)
                ? this.articuloEscaneadoTemp.codigos_ingrediente.map(c => String(c).trim().toLowerCase())
                : [];

            if (cleanCode.toLowerCase() === cbArt || cleanCode.toLowerCase() === skuArt || codsIng.includes(cleanCode.toLowerCase())) {
                return;
            }

            this.emitirBeepExito();
            this.loteEscaneadoTemp = cleanCode;
            this.actualizarTarjetaScannerPaso2();
            if (statusEl) {
                statusEl.innerHTML = `<span style="color:#6ee7b7;">✓ Lote <strong>${this.escapeHtml(cleanCode)}</strong> capturado. Abriendo cámara de fotos...</span>`;
            }

            setTimeout(() => {
                this.confirmarEscaneoYTomarFotos();
            }, 350);
        }
    },

    async confirmarEscaneoYTomarFotos() {
        if (!this.articuloEscaneadoTemp) return;
        const sku = this.articuloEscaneadoTemp.articulo_id;
        const lote = this.loteEscaneadoTemp || null;
        await this.cerrarEscanerCodigo();
        this.abrirModalArticulo(sku, lote);
    },

    prepararReemplazoLote() {
        this.reemplazarLote = true;
        this.imagenesExistentes = [];
        this.renderizarGrillaFotosModal();
    },

    async eliminarFotoExistente(index) {
        if (!this.articuloSeleccionado || this.guardando) return;
        if (index < 0 || index >= this.imagenesExistentes.length) return;

        // Quitar la imagen del array activo y refrescar la grilla de inmediato
        this.imagenesExistentes.splice(index, 1);
        this.renderizarGrillaFotosModal();

        const sku = this.articuloSeleccionado.articulo_id;
        const quedanPublicadas = this.imagenesExistentes.length;

        try {
            this.guardando = true;
            if (quedanPublicadas === 0 && this.imagenesNuevas.length === 0) {
                // Si era la única foto publicada, damos de baja la publicación en el acto en servidor y Supabase
                const resp = await fetch(`/api/logistica/b2b-fotos-lotes/${encodeURIComponent(sku)}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ motivo: 'BAJA_MANUAL_OPERADOR' })
                });
                const json = await resp.json();
                if (!resp.ok || !json.success) {
                    throw new Error(json.error || 'No se pudo quitar la foto publicada');
                }

                this.articuloSeleccionado.tiene_fotos = false;
                this.articuloSeleccionado.fotos_lote = null;

                const btnEliminar = document.getElementById('btn-eliminar-partida');
                if (btnEliminar) btnEliminar.style.display = 'none';
                const btnReemplazar = document.getElementById('btn-limpiar-para-nuevo-lote');
                if (btnReemplazar) btnReemplazar.style.display = 'none';
            } else {
                // Si tenía varias fotos publicadas y quitó una sola, persistimos las restantes en el acto
                const sesion = (typeof obtenerSesion === 'function') ? obtenerSesion() : null;
                const usuarioNombre = sesion?.nombre || sesion?.usuario || 'operador_deposito';
                const obs = document.getElementById('input-observacion-tecnica')?.value?.trim() || '';
                const derivadosDisp = Array.isArray(this.articuloSeleccionado?.derivados_linea_2)
                    ? this.articuloSeleccionado.derivados_linea_2
                    : [];
                const seleccionados = (this.derivadosSeleccionadosSet instanceof Set)
                    ? Array.from(this.derivadosSeleccionadosSet)
                    : [];
                const todasMarcadas = derivadosDisp.length > 0 && seleccionados.length === derivadosDisp.length;
                const esPermanente = document.getElementById('chk-es-permanente')?.checked === true;

                const resp = await fetch('/api/logistica/b2b-fotos-lotes/guardar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        articulo_id: sku,
                        imagenes_existentes: this.imagenesExistentes,
                        imagenes_nuevas: [],
                        reemplazar: false,
                        lote_codigo_escaneado: this.loteCodigoEscaneado || null,
                        extender_a_derivados: todasMarcadas,
                        derivados_seleccionados: seleccionados,
                        es_permanente: esPermanente,
                        observacion_tecnica: obs,
                        usuario: `${usuarioNombre}||DERIV:${JSON.stringify(seleccionados)}`
                    })
                });
                const json = await resp.json();
                if (!resp.ok || !json.success) {
                    throw new Error(json.error || 'No se pudo actualizar la galería de fotos');
                }
            }

            // Actualizar listado de fondo conservando acordeones abiertos
            await this.cargarArticulos(false);
            const actualizado = this.articulos.find(a => String(a.articulo_id) === String(sku));
            if (actualizado) {
                this.articuloSeleccionado = actualizado;
            }

            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: quedanPublicadas === 0
                        ? '🗑️ Foto eliminada del Portal B2B'
                        : `🗑️ Foto quitada (${quedanPublicadas} publicada/s)`,
                    showConfirmButton: false,
                    timer: 1800,
                    background: '#1e293b',
                    color: '#f8fafc'
                });
            }
        } catch (err) {
            console.error('❌ [FOTOS-DEPÓSITO] Error al eliminar foto publicada:', err);
            await this.cargarArticulos(false);
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'error',
                    title: 'Error al quitar foto',
                    text: err.message,
                    background: '#1e293b',
                    color: '#f8fafc'
                });
            }
        } finally {
            this.guardando = false;
        }
    },

    eliminarFotoNueva(index) {
        this.imagenesNuevas.splice(index, 1);
        this.renderizarGrillaFotosModal();
    },

    verFotoPantallaCompleta(srcUrl) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                imageUrl: srcUrl,
                imageAlt: 'Vista previa de partida',
                background: '#0f172a',
                color: '#f8fafc',
                confirmButtonText: 'Cerrar',
                confirmButtonColor: '#0d9488'
            });
        }
    },

    renderizarGrillaFotosModal() {
        const grid = document.getElementById('grid-fotos-preview');
        const contador = document.getElementById('lbl-contador-fotos');
        if (!grid) return;

        const total = this.imagenesExistentes.length + this.imagenesNuevas.length;
        if (contador) contador.textContent = total;

        if (total === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 1.35rem 0.75rem; background: rgba(30,41,59,0.5); border: 1px dashed #334155; border-radius: 0.75rem; color: #64748b; font-size: 0.78rem;">
                    Todavía no hay fotos cargadas para esta partida. Tocá <strong>"Sacar Foto Ahora"</strong> o <strong>"Elegir de Galería"</strong>.
                </div>
            `;
            return;
        }

        const htmlExistentes = this.imagenesExistentes.map((img, idx) => `
            <div class="photo-slot-item">
                <img src="${this.escapeHtml(img.url)}" alt="Foto publicada" onclick="FotosDepositoController.verFotoPantallaCompleta('${this.escapeHtml(img.url)}')">
                <span class="photo-slot-badge">☁️ Publicada</span>
                <button type="button" class="photo-slot-del" onclick="FotosDepositoController.eliminarFotoExistente(${idx})" title="Eliminar foto publicada">✕</button>
            </div>
        `).join('');

        const htmlNuevas = this.imagenesNuevas.map((img, idx) => `
            <div class="photo-slot-item" style="border-color: #14b8a6;">
                <img src="${img.dataUrl}" alt="Nueva foto" onclick="FotosDepositoController.verFotoPantallaCompleta('${img.dataUrl}')">
                <span class="photo-slot-badge" style="color: #fde047;">✨ Nueva (${img.sizeKB} KB)</span>
                <button type="button" class="photo-slot-del" onclick="FotosDepositoController.eliminarFotoNueva(${idx})" title="Quitar imagen">✕</button>
            </div>
        `).join('');

        grid.innerHTML = htmlExistentes + htmlNuevas;
    },

    /**
     * Comprime cualquier foto tomada con la cámara del celular a JPEG liviano (~120-180 KB)
     * directamente en el navegador mediante HTML5 Canvas antes de transmitirla.
     */
    comprimirImagenCanvas(file, maxWidth = 1280, quality = 0.82) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth || height > maxWidth) {
                        if (width >= height) {
                            height = Math.round((height * maxWidth) / width);
                            width = maxWidth;
                        } else {
                            width = Math.round((width * maxWidth) / height);
                            height = maxWidth;
                        }
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const dataUrl = canvas.toDataURL('image/jpeg', quality);
                    canvas.width = 0;
                    canvas.height = 0;
                    const base64 = dataUrl.split(',')[1];
                    const sizeKB = Math.round((base64.length * 3) / 4 / 1024);

                    resolve({
                        dataUrl,
                        base64,
                        mimeType: 'image/jpeg',
                        sizeKB
                    });
                };
                img.onerror = () => reject(new Error('No se pudo decodificar la imagen seleccionada'));
                img.src = ev.target.result;
            };
            reader.onerror = () => reject(new Error('Error leyendo el archivo de imagen'));
            reader.readAsDataURL(file);
        });
    },

    async procesarArchivosSeleccionados(fileList) {
        if (!fileList || fileList.length === 0) return;

        const disponibles = 6 - (this.imagenesExistentes.length + this.imagenesNuevas.length);
        if (disponibles <= 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Límite de 6 fotos por partida',
                text: 'Eliminá alguna imagen existente si querés agregar otra toma.',
                background: '#1e293b',
                color: '#f8fafc',
                confirmButtonColor: '#0d9488'
            });
            return;
        }

        const archivos = Array.from(fileList).slice(0, disponibles);
        const boxEstado = document.getElementById('estado-compresion-box');
        if (boxEstado) boxEstado.style.display = 'block';

        try {
            for (const file of archivos) {
                const comprimida = await this.comprimirImagenCanvas(file, 1280, 0.82);
                this.imagenesNuevas.push(comprimida);
            }
            this.renderizarGrillaFotosModal();
        } catch (err) {
            console.error('Error comprimiendo imagen:', err);
            Swal.fire({
                icon: 'error',
                title: 'Error al procesar foto',
                text: err.message,
                background: '#1e293b',
                color: '#f8fafc'
            });
        } finally {
            if (boxEstado) boxEstado.style.display = 'none';
            const inputCam = document.getElementById('input-camera-direct');
            const inputGal = document.getElementById('input-gallery-multi');
            if (inputCam) inputCam.value = '';
            if (inputGal) inputGal.value = '';
        }
    },

    async guardarCambios() {
        if (this.guardando || !this.articuloSeleccionado) return;

        const totalFotos = this.imagenesExistentes.length + this.imagenesNuevas.length;
        if (totalFotos === 0) {
            // Si el artículo tenía fotos publicadas y el operador dejó la grilla vacía, dar de baja directamente
            if (this.articuloSeleccionado.tiene_fotos) {
                try {
                    this.guardando = true;
                    const resp = await fetch(`/api/logistica/b2b-fotos-lotes/${encodeURIComponent(this.articuloSeleccionado.articulo_id)}`, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ motivo: 'BAJA_MANUAL_OPERADOR' })
                    });
                    const json = await resp.json();
                    if (!resp.ok || !json.success) {
                        throw new Error(json.error || 'No se pudieron dar de baja las imágenes');
                    }
                    this.cerrarModal();
                    await this.cargarArticulos(false);
                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        icon: 'info',
                        title: 'Publicación de fotos dada de baja',
                        showConfirmButton: false,
                        timer: 2000,
                        background: '#1e293b',
                        color: '#f8fafc'
                    });
                } catch (err) {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error al quitar fotos',
                        text: err.message,
                        background: '#1e293b',
                        color: '#f8fafc'
                    });
                } finally {
                    this.guardando = false;
                }
                return;
            }

            Swal.fire({
                icon: 'warning',
                title: 'Sin imágenes',
                text: 'Capturá al menos una fotografía para publicar la partida.',
                background: '#1e293b',
                color: '#f8fafc',
                confirmButtonColor: '#0d9488'
            });
            return;
        }

        const btnPublicar = document.getElementById('btn-publicar-fotos');
        const textoOriginal = btnPublicar ? btnPublicar.innerHTML : '💾 Publicar en Portal B2B';

        try {
            this.guardando = true;
            if (btnPublicar) {
                btnPublicar.disabled = true;
                btnPublicar.innerHTML = '⏳ Subiendo y sincronizando con Portal B2B...';
            }

            const sesion = (typeof obtenerSesion === 'function') ? obtenerSesion() : null;
            const usuarioNombre = sesion?.nombre || sesion?.usuario || 'operador_deposito';
            const obs = document.getElementById('input-observacion-tecnica')?.value?.trim() || '';
            const derivadosDisp = Array.isArray(this.articuloSeleccionado?.derivados_linea_2)
                ? this.articuloSeleccionado.derivados_linea_2
                : [];
            const seleccionados = (this.derivadosSeleccionadosSet instanceof Set)
                ? Array.from(this.derivadosSeleccionadosSet)
                : [];
            const todasMarcadas = derivadosDisp.length > 0 && seleccionados.length === derivadosDisp.length;
            const esPermanente = document.getElementById('chk-es-permanente')?.checked === true;

            const payload = {
                articulo_id: this.articuloSeleccionado.articulo_id,
                imagenes_existentes: this.imagenesExistentes,
                imagenes_nuevas: this.imagenesNuevas.map(img => ({
                    base64: img.base64,
                    mimeType: img.mimeType
                })),
                reemplazar: this.reemplazarLote,
                lote_codigo_escaneado: this.loteCodigoEscaneado || null,
                extender_a_derivados: todasMarcadas,
                derivados_seleccionados: seleccionados,
                es_permanente: esPermanente,
                observacion_tecnica: obs,
                usuario: `${usuarioNombre}||DERIV:${JSON.stringify(seleccionados)}`
            };

            const resp = await fetch('/api/logistica/b2b-fotos-lotes/guardar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await resp.json();

            if (!resp.ok || !json.success) {
                throw new Error(json.error || 'No se pudieron guardar las imágenes');
            }

            this.cerrarModal();
            await this.cargarArticulos(false);

            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: 'Partida publicada en Portal B2B',
                showConfirmButton: false,
                timer: 2200,
                background: '#1e293b',
                color: '#f8fafc'
            });
        } catch (err) {
            console.error('❌ [FOTOS-DEPÓSITO] Error guardando:', err);
            Swal.fire({
                icon: 'error',
                title: 'Error al publicar',
                text: err.message,
                background: '#1e293b',
                color: '#f8fafc',
                confirmButtonColor: '#0d9488'
            });
        } finally {
            this.guardando = false;
            if (btnPublicar) {
                btnPublicar.disabled = false;
                btnPublicar.innerHTML = textoOriginal;
            }
        }
    },

    async eliminarPartidaActual() {
        if (!this.articuloSeleccionado) return;
        const art = this.articuloSeleccionado;

        const confirm = await Swal.fire({
            icon: 'warning',
            title: '¿Dar de baja las fotos?',
            text: `Se quitarán las imágenes activas de "${art.nomenclatura}" del Portal B2B.`,
            showCancelButton: true,
            confirmButtonText: 'Sí, dar de baja',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#334155',
            background: '#1e293b',
            color: '#f8fafc'
        });

        if (!confirm.isConfirmed) return;

        try {
            const resp = await fetch(`/api/logistica/b2b-fotos-lotes/${encodeURIComponent(art.articulo_id)}`, {
                method: 'DELETE'
            });
            const json = await resp.json();
            if (!resp.ok || !json.success) {
                throw new Error(json.error || 'Error al dar de baja las fotos');
            }

            this.cerrarModal();
            await this.cargarArticulos(false);

            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'info',
                title: 'Fotos dadas de baja del Portal B2B',
                showConfirmButton: false,
                timer: 2000,
                background: '#1e293b',
                color: '#f8fafc'
            });
        } catch (err) {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: err.message,
                background: '#1e293b',
                color: '#f8fafc'
            });
        }
    },

    escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
};
