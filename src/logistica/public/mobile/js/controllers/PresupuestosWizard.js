/**
 * Controlador Exclusivo para el Cajero Móvil / Wizard Comercial (LAMDA Móvil)
 * Archivo: PresupuestosWizard.js
 * Adaptado con Nomenclador Búnker, Búsqueda Universal LAMDA y Opciones WhatsApp
 */

const WizardController = {
    step: 1,
    cart: {
        cliente: null,
        items: {}, // key: codigo_articulo, value: { id, numero, nombre, precio, cantidad, iva_pct, kilos_unidad, precio_final, precio_kilo }
        observaciones: "",
        tipo: 'venta',
        editId: null,
        descuentoPct: 0
    },

    politicaCliente: null,
    descuentoManual: false,
    modoIVA: 'con_iva',

    // Estado del Catálogo Búnker en RAM
    catalogoCompleto: [],
    catalogoFiltrado: [],
    familiasAbiertas: new Set(),
    atributosAbiertos: new Set(),
    modalQtyArticulo: null,
    ultimoPresupuestoGuardado: null,

    // Artículos Habituales del Cliente (Historial B2B)
    articulosHabituales: new Map(), // key: codigo_articulo en minuscula -> { articulo_id, descripcion, frecuencia_compra, ultima_compra }
    filtroSoloHabituales: false,
    cargandoHabituales: false,

    // Timers y AbortControllers
    timerBusquedaCliente: null,
    timerBusquedaArticulo: null,
    abortControllerClientes: null,
    abortControllerCatalogo: null,
    abortControllerHabituales: null,
    currentLoadSessionId: 0,
    isSubmitting: false,

    async init() {
        const params = new URLSearchParams(window.location.search);
        const editId = params.get('edit');
        const clienteIdParam = params.get('clienteId') || params.get('cliente_id') || params.get('cliente');

        // Hardware / Gestures Back Button
        if (window.history && window.history.pushState) {
            window.history.replaceState({ step: 1 }, null, window.location.href);
            window.onpopstate = (e) => {
                if (e.state && e.state.step) {
                    this.avanzarPaso(e.state.step, false);
                } else {
                    this.wizardBack(false);
                }
            };
        }

        this.bindEvents();

        if (editId) {
            await this.cargarPresupuestoParaEdicion(editId);
        } else if (clienteIdParam) {
            await this.autoSeleccionarClientePorId(clienteIdParam);
        }
    },

    seleccionarProspecto() {
        const prospecto = {
            id: '0',
            lomas_soft_id: null,
            codigo_bunker_cliente: 'PROSPECTO',
            nombre: 'Consulta / Cotización Libre (Prospecto)',
            apellido: '',
            razon_social: 'Cliente Potencial / Cotización Libre',
            condicion_iva: 'Consumidor Final',
            telefono: '',
            saldo: 0,
            es_prospecto: true
        };
        this.seleccionarCliente(prospecto);
    },

    async autoSeleccionarClientePorId(clienteIdParam) {
        try {
            if (!clienteIdParam) return;
            const paramLower = String(clienteIdParam).trim().toLowerCase();
            if (paramLower === 'prospecto' || paramLower === 'libre' || paramLower === '0') {
                this.seleccionarProspecto();
                return;
            }

            let clienteEncontrado = null;

            // 1. Intentar resolver por el endpoint de bunker clientes
            try {
                const resBunker = await fetch(`/api/logistica/bunker/clientes/${encodeURIComponent(clienteIdParam)}`);
                if (resBunker.ok) {
                    const dataBunker = await resBunker.json();
                    if (dataBunker.success && dataBunker.data) {
                        const b = dataBunker.data;
                        let primerTel = '';
                        if (b.whatsapp_facturas) {
                            try {
                                const parsed = JSON.parse(b.whatsapp_facturas);
                                if (Array.isArray(parsed) && parsed.length > 0) primerTel = parsed[0].numero;
                                else if (typeof b.whatsapp_facturas === 'string') primerTel = b.whatsapp_facturas;
                            } catch (e) {
                                primerTel = b.whatsapp_facturas;
                            }
                        }
                        clienteEncontrado = {
                            id: b.lomas_soft_id ? parseInt(b.lomas_soft_id, 10) : b.id,
                            lomas_soft_id: b.lomas_soft_id,
                            codigo_bunker_cliente: b.codigo_bunker_cliente,
                            nombre: b.cliente_nombre || b.razon_social || `Cliente #${b.id}`,
                            apellido: b.razon_social || '',
                            condicion_iva: b.condicion_iva || 'Consumidor final',
                            telefono: primerTel
                        };
                    }
                }
            } catch (errBunker) {
                console.warn('Fallback al buscador de presupuestos:', errBunker);
            }

            // 2. Si no se encontró por ID de bunker, buscar en sugerencias de clientes legacy
            if (!clienteEncontrado) {
                const resSugerencias = await fetch(`/api/presupuestos/clientes/sugerencias?q=${encodeURIComponent(clienteIdParam)}`);
                if (resSugerencias.ok) {
                    const dataSug = await resSugerencias.json();
                    if (dataSug.success && Array.isArray(dataSug.data) && dataSug.data.length > 0) {
                        clienteEncontrado = dataSug.data.find(c => String(c.id) === String(clienteIdParam)) || dataSug.data[0];
                    }
                }
            }

            if (clienteEncontrado) {
                await this.seleccionarCliente(clienteEncontrado);
            } else {
                console.warn(`No se pudo resolver el cliente con ID: ${clienteIdParam}`);
            }
        } catch (e) {
            console.error('Error al autoseleccionar cliente:', e);
        }
    },

    bindEvents() {
        // Buscador de Clientes (Paso 1)
        const inputCliente = document.getElementById('buscar-cliente-input');
        if (inputCliente) {
            inputCliente.addEventListener('input', (e) => {
                clearTimeout(this.timerBusquedaCliente);
                const query = e.target.value.trim();
                if (query.length >= 2) {
                    this.timerBusquedaCliente = setTimeout(() => this.buscarClientesAPI(query), 300);
                } else {
                    document.getElementById('resultados-cliente').innerHTML = '<div class="placeholder-msg">Escribí al menos 2 letras para buscar en la cartera de clientes...</div>';
                }
            });
        }

        // Buscador Universal de Artículos (Paso 2)
        const inputArticulo = document.getElementById('buscar-articulo-input');
        if (inputArticulo) {
            inputArticulo.addEventListener('input', (e) => {
                const query = e.target.value;
                const btnClear = document.getElementById('btn-clear-articulo');
                if (btnClear) {
                    btnClear.style.display = query.length > 0 ? 'flex' : 'none';
                }
                clearTimeout(this.timerBusquedaArticulo);
                this.timerBusquedaArticulo = setTimeout(() => this.filtrarCatalogoBunker(query), 200);
            });
        }
    },

    limpiarInputArticulo() {
        const input = document.getElementById('buscar-articulo-input');
        if (input) {
            input.value = '';
            input.focus();
        }
        const btnClear = document.getElementById('btn-clear-articulo');
        if (btnClear) {
            btnClear.style.display = 'none';
        }
        this.filtrarCatalogoBunker('');
    },

    // =========================================================
    // NAVEGACIÓN ENTRE PASOS
    // =========================================================
    wizardBack(popHistory = true) {
        if (this.step > 1) {
            const targetStep = this.step - 1;
            this.avanzarPaso(targetStep, false);
            if (popHistory && window.history && window.history.back) {
                try { window.history.back(); } catch (e) {}
            }
        } else {
            window.location.href = 'presupuestos.html';
        }
    },

    avanzarPaso(numero, pushHistory = true) {
        if (numero === 2 && !this.cart.cliente) {
            Swal.fire('Atención', 'Debe seleccionar un cliente para continuar.', 'warning');
            return;
        }
        if (numero === 3 && Object.keys(this.cart.items).length === 0) {
            Swal.fire('Atención', 'Debe agregar al menos un artículo al pedido.', 'warning');
            return;
        }

        if (numero === 1) {
            // Cancelar peticiones en curso de productos para evitar colisiones
            if (this.abortControllerCatalogo) {
                this.abortControllerCatalogo.abort();
                this.abortControllerCatalogo = null;
            }
            if (this.abortControllerHabituales) {
                this.abortControllerHabituales.abort();
                this.abortControllerHabituales = null;
            }
            this.filtroSoloHabituales = false;
        }

        document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active-step'));
        document.getElementById(`step-${numero}`).classList.add('active-step');

        this.step = numero;
        document.getElementById('wizard-progress').style.width = `${numero * 33.33}%`;
        document.getElementById('wizard-step-indicator').innerText = `${numero}/3`;

        const titulos = ["", "Paso 1: Cliente", "Paso 2: Productos Búnker", "Paso 3: Resumen"];
        document.getElementById('wizard-title').innerText = titulos[numero];

        if (numero === 2) {
            document.getElementById('label-cliente-seleccionado').innerText = this.cart.cliente ? this.cart.cliente.nombre : 'Cliente';
            const badgeSaldo = document.getElementById('badge-wizard-saldo');
            if (badgeSaldo && this.cart.cliente) {
                const s = parseFloat(this.cart.cliente.saldo || 0);
                const formatted = `$ ${Math.abs(s).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                if (s > 0) {
                    badgeSaldo.innerText = formatted;
                    badgeSaldo.style.color = '#f87171';
                    badgeSaldo.style.background = 'rgba(239, 68, 68, 0.18)';
                    badgeSaldo.title = 'Saldo Deudor C/C';
                } else if (s < 0) {
                    badgeSaldo.innerText = `-${formatted}`;
                    badgeSaldo.style.color = '#38bdf8';
                    badgeSaldo.style.background = 'rgba(56, 189, 248, 0.18)';
                    badgeSaldo.title = 'Saldo a Favor C/C';
                } else {
                    badgeSaldo.innerText = '$ 0,00';
                    badgeSaldo.style.color = '#34d399';
                    badgeSaldo.style.background = 'rgba(16, 185, 129, 0.18)';
                    badgeSaldo.title = 'Cuenta al Día';
                }
            }
        }
        if (numero === 3) {
            this.renderCheckout();
        }

        if (pushHistory && window.history && window.history.pushState) {
            window.history.pushState({ step: numero }, null, window.location.href);
        }
    },

    cancelarWizard() {
        Swal.fire({
            title: '¿Cancelar operación?',
            text: "Se perderán los cambios que no hayan sido confirmados.",
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Sí, salir',
            cancelButtonText: 'Continuar acá'
        }).then((result) => {
            if (result.isConfirmed) {
                window.location.href = 'presupuestos.html';
            }
        });
    },

    // =========================================================
    // PASO 1: CLIENTES
    // =========================================================
    async buscarClientesAPI(query) {
        if (this.abortControllerClientes) {
            this.abortControllerClientes.abort();
        }
        this.abortControllerClientes = new AbortController();

        const contenedor = document.getElementById('resultados-cliente');
        contenedor.innerHTML = '<div class="loader-spinner" style="margin:2rem auto; width:30px; height:30px;"></div>';

        try {
            const res = await fetch(`/api/presupuestos/clientes/sugerencias?q=${encodeURIComponent(query)}`, {
                signal: this.abortControllerClientes.signal
            });
            const data = await res.json();

            if (data.success && data.data && data.data.length > 0) {
                contenedor.innerHTML = '';
                data.data.forEach(c => {
                    const card = document.createElement('div');
                    card.className = 'card-cliente';
                    const condIva = c.condicion_iva || 'Consumidor Final';
                    const isRI = condIva.toLowerCase().includes('inscripto');

                    card.innerHTML = `
                        <div style="flex:1; min-width:0;">
                            <span class="cliente-nombre text-truncate">${c.nombre}</span>
                            <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                                <span class="cliente-id">Cód: ${c.id}</span>
                                <span class="cliente-iva-tag" style="background:${isRI ? 'rgba(59,130,246,0.15)' : 'rgba(16,185,129,0.15)'}; color:${isRI ? '#93c5fd' : '#6ee7b7'}; border-color:${isRI ? 'rgba(59,130,246,0.3)' : 'rgba(16,185,129,0.3)'}">
                                    ${isRI ? 'Resp. Inscripto (A)' : 'Consumidor Final (B)'}
                                </span>
                                ${c.telefono ? `<span style="font-size:0.75rem; color:#94a3b8;">📱 ${c.telefono}</span>` : ''}
                            </div>
                        </div>
                        <div style="font-size:1.3rem; color:#10b981; margin-left:0.5rem;">›</div>
                    `;
                    card.onclick = () => this.seleccionarCliente(c);
                    contenedor.appendChild(card);
                });
            } else {
                contenedor.innerHTML = '<div class="placeholder-msg">No se encontraron clientes con ese criterio.</div>';
            }
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.error('Error buscando clientes:', e);
            contenedor.innerHTML = '<div class="placeholder-msg" style="color:#ef4444">Error de conexión al buscar clientes.</div>';
        }
    },

    async seleccionarCliente(cliente) {
        // Abortar cualquier petición en vuelo previa
        if (this.abortControllerCatalogo) this.abortControllerCatalogo.abort();
        if (this.abortControllerHabituales) this.abortControllerHabituales.abort();

        this.abortControllerCatalogo = new AbortController();
        this.abortControllerHabituales = new AbortController();

        const sessionId = ++this.currentLoadSessionId;

        this.cart.cliente = cliente;
        this.cart.items = {}; // Limpiar carrito al cambiar de cliente
        this.politicaCliente = null;
        this.descuentoManual = false;
        this.filtroSoloHabituales = false;
        this.articulosHabituales.clear();
        this.catalogoCompleto = [];
        this.catalogoFiltrado = [];
        this.familiasAbiertas.clear();
        this.atributosAbiertos.clear();

        // Resetear controles visuales del paso 2
        const inputSearch = document.getElementById('buscar-articulo-input');
        if (inputSearch) inputSearch.value = '';
        const btnClear = document.getElementById('btn-clear-articulo');
        if (btnClear) btnClear.style.display = 'none';

        const btnHab = document.getElementById('btn-toggle-habituales');
        if (btnHab) btnHab.classList.remove('active');
        const badgeHab = document.getElementById('habituales-badge');
        if (badgeHab) { badgeHab.innerText = '0'; badgeHab.style.display = 'none'; }
        const txtHab = document.getElementById('habituales-btn-text');
        if (txtHab) txtHab.innerText = 'Habituales';

        // Auto-detección de modo IVA según condición fiscal del cliente
        const condIva = (cliente && cliente.condicion_iva) ? cliente.condicion_iva.toLowerCase() : '';
        const isRI = condIva.includes('inscripto');
        this.modoIVA = isRI ? 'sin_iva' : 'con_iva';
        this.actualizarBotonModoIVA();

        this.renderCarritoFlotante();
        this.avanzarPaso(2);

        // Cargar catálogo Búnker completo, artículos habituales y política comercial en paralelo con session lock
        const idCliente = cliente ? (cliente.id || cliente.cliente_id) : null;
        await Promise.all([
            this.cargarCatalogoCompletoCliente(sessionId),
            this.cargarArticulosHabitualesCliente(sessionId),
            this.cargarPoliticaComercialCliente(idCliente)
        ]);

        // Renderizado consolidado único para máximo rendimiento en móviles
        if (sessionId === this.currentLoadSessionId && this.catalogoCompleto.length > 0) {
            this.renderArbolBunker();
        }
    },

    async cargarPoliticaComercialCliente(clienteId) {
        this.politicaCliente = null;
        this.descuentoManual = false;
        if (!clienteId) return;
        try {
            const res = await fetch(`/api/presupuestos/politicas/cliente/${clienteId}`);
            if (res.ok) {
                const json = await res.json();
                if (json.success && json.data) {
                    this.politicaCliente = json.data;
                    console.log('🏷️ [WIZARD-MOVIL] Política comercial cargada:', this.politicaCliente);
                }
            }
        } catch (e) {
            console.warn('⚠️ [WIZARD-MOVIL] Error cargando política comercial:', e);
            this.politicaCliente = null;
        }
    },

    // =========================================================
    // PASO 2: CATÁLOGO BÚNKER (5 NIVELES + BÚSQUEDA UNIVERSAL + HABITUALES)
    // =========================================================
    async cargarCatalogoCompletoCliente(sessionId) {
        const treeContainer = document.getElementById('bunker-tree-container');
        if (treeContainer) {
            treeContainer.innerHTML = '<div class="loader-spinner" style="margin:2.5rem auto; width:36px; height:36px;"></div><p style="text-align:center; color:#94a3b8; font-size:0.9rem;">Cargando catálogo y precios Búnker...</p>';
        }

        try {
            const clienteId = this.cart.cliente ? this.cart.cliente.id : null;
            if (clienteId === null || clienteId === undefined || clienteId === '') return;

            const res = await fetch(`/api/presupuestos/articulos/sugerencias?all=true&cliente_id=${encodeURIComponent(clienteId)}&limit=3000&usar_precios_bunker=true`, {
                signal: this.abortControllerCatalogo ? this.abortControllerCatalogo.signal : undefined
            });
            const data = await res.json();

            // Si la sesión quedó obsoleta porque el usuario cambió de cliente antes de terminar, descartar
            if (sessionId && sessionId !== this.currentLoadSessionId) return;

            if (data.success && data.data && data.data.length > 0) {
                this.catalogoCompleto = data.data;
                this.catalogoFiltrado = data.data;
                
                // Los acordeones arrancan plegados por defecto a pedido del usuario
                this.familiasAbiertas.clear();
                this.atributosAbiertos.clear();
            } else {
                if (treeContainer) {
                    treeContainer.innerHTML = '<div class="placeholder-msg">No se encontraron productos asignados a la lista de precios de este cliente.</div>';
                }
            }
        } catch (e) {
            if (e.name === 'AbortError') return;
            if (sessionId && sessionId !== this.currentLoadSessionId) return;
            console.error('Error cargando catálogo Búnker:', e);
            if (treeContainer) {
                treeContainer.innerHTML = '<div class="placeholder-msg" style="color:#ef4444">Error al cargar el catálogo Búnker.</div>';
            }
        }
    },

    async cargarArticulosHabitualesCliente(sessionId) {
        const badge = document.getElementById('habituales-badge');
        const btnText = document.getElementById('habituales-btn-text');
        const btnHab = document.getElementById('btn-toggle-habituales');

        if (!this.cart.cliente || !this.cart.cliente.id || this.cart.cliente.es_prospecto || this.cart.cliente.id === '0' || this.cart.cliente.id === 'prospecto') {
            this.articulosHabituales.clear();
            if (badge) badge.style.display = 'none';
            if (btnHab) btnHab.style.display = 'none';
            return;
        }

        if (btnHab) btnHab.style.display = 'inline-flex';
        this.cargandoHabituales = true;
        this.articulosHabituales.clear();

        if (btnText) btnText.innerText = 'Buscando...';

        try {
            const clienteId = this.cart.cliente.id;
            // Endpoint unificado de artículos habituales
            const res = await fetch(`/api/presupuestos/clientes/${clienteId}/articulos-habituales`, {
                signal: this.abortControllerHabituales ? this.abortControllerHabituales.signal : undefined
            });
            const data = await res.json();

            // Si la sesión cambió, descartar respuesta
            if (sessionId && sessionId !== this.currentLoadSessionId) return;

            if (data.success && Array.isArray(data.data)) {
                data.data.forEach(item => {
                    const key = String(item.articulo_id || '').trim().toLowerCase();
                    if (key) {
                        this.articulosHabituales.set(key, item);
                    }
                });
            }

            const total = this.articulosHabituales.size;
            if (btnText) btnText.innerText = 'Habituales';
            if (badge) {
                badge.innerText = total;
                badge.style.display = total > 0 ? 'inline-block' : 'none';
            }
        } catch (e) {
            if (e.name === 'AbortError') return;
            if (sessionId && sessionId !== this.currentLoadSessionId) return;
            console.error('Error cargando artículos habituales:', e);
            if (btnText) btnText.innerText = 'Habituales';
        } finally {
            if (!sessionId || sessionId === this.currentLoadSessionId) {
                this.cargandoHabituales = false;
            }
        }
    },

    toggleFiltroHabituales() {
        if (this.cargandoHabituales) return;

        if (this.articulosHabituales.size === 0) {
            Swal.fire({
                title: 'Sin Compras Históricas',
                text: `El cliente no posee registros de compras o facturas previas.`,
                icon: 'info',
                timer: 2000,
                showConfirmButton: false
            });
            return;
        }

        this.filtroSoloHabituales = !this.filtroSoloHabituales;
        const btn = document.getElementById('btn-toggle-habituales');
        if (btn) {
            btn.classList.toggle('active', this.filtroSoloHabituales);
        }

        const inputSearch = document.getElementById('buscar-articulo-input');
        const currentQuery = inputSearch ? inputSearch.value : '';
        this.filtrarCatalogoBunker(currentQuery);
    },

    toggleModoIVA() {
        this.modoIVA = (this.modoIVA === 'con_iva') ? 'sin_iva' : 'con_iva';
        this.actualizarBotonModoIVA();
        this.renderArbolBunker();
        this.renderCarritoFlotante();
    },

    actualizarBotonModoIVA() {
        const btn = document.getElementById('btn-toggle-modo-iva');
        const lbl = document.getElementById('lbl-modo-iva');
        if (!btn || !lbl) return;

        if (this.modoIVA === 'sin_iva') {
            lbl.innerText = 'S/IVA';
            btn.className = 'btn-toggle-modo-iva sin-iva';
            btn.title = 'Precios Netos (Sin IVA). Tocar para ver con IVA.';
        } else {
            lbl.innerText = 'C/IVA';
            btn.className = 'btn-toggle-modo-iva con-iva';
            btn.title = 'Precios Finales (Con IVA incluido). Tocar para ver Netos.';
        }
    },

    normalizarTexto(txt) {
        return (txt || '').toString().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .trim();
    },

    filtrarCatalogoBunker(query) {
        const qClean = this.normalizarTexto(query);
        const terms = qClean.split(/\s+/).filter(Boolean);

        // 1. Dataset Base: Todos los productos o solo los Habituales
        let dataset = this.catalogoCompleto;
        if (this.filtroSoloHabituales) {
            dataset = dataset.filter(art => {
                const key1 = String(art.articulo_numero || '').trim().toLowerCase();
                const key2 = String(art.codigo_barras || '').trim().toLowerCase();
                return this.articulosHabituales.has(key1) || this.articulosHabituales.has(key2);
            });
        }

        // 2. Filtro Universal multi-término (Fase 49)
        if (terms.length === 0) {
            this.catalogoFiltrado = dataset;
        } else {
            this.catalogoFiltrado = dataset.filter(art => {
                const searchCorpus = this.normalizarTexto([
                    art.descripcion || '',
                    art.articulo_numero || '',
                    art.codigo_barras || '',
                    art.familia || '',
                    art.articulo_principal || '',
                    art.sub_categoria || '',
                    art.sub_sub_categoria || '',
                    art.sub_sub_sub_categoria || '',
                    art.descripcion_legacy || ''
                ].join(' '));

                return terms.every(term => searchCorpus.includes(term));
            });
        }

        // Si hay búsqueda activa por texto, expandir ramas que coinciden
        if (terms.length > 0) {
            this.familiasAbiertas.clear();
            this.atributosAbiertos.clear();
            this.catalogoFiltrado.forEach(a => {
                if (a.familia) this.familiasAbiertas.add(a.familia);
                if (a.articulo_principal) this.atributosAbiertos.add(`${a.familia || 'General'}___${a.articulo_principal}`);
            });
        } else {
            // Sin texto de búsqueda (incluso con filtro Habituales), mantener plegadas
            this.familiasAbiertas.clear();
            this.atributosAbiertos.clear();
        }

        this.renderArbolBunker();
    },

    renderArbolBunker() {
        const treeContainer = document.getElementById('bunker-tree-container');
        if (!treeContainer) return;

        if (this.catalogoFiltrado.length === 0) {
            treeContainer.innerHTML = `
                <div class="placeholder-msg">
                    No se encontraron productos que coincidan con la búsqueda.<br>
                    <button class="btn-cancel" style="margin-top:0.75rem; font-size:0.85rem;" onclick="WizardController.limpiarInputArticulo()">Ver todo el catálogo</button>
                </div>
            `;
            return;
        }

        // 1. Agrupar por Familia -> Artículo Principal
        const familiasMap = new Map();

        this.catalogoFiltrado.forEach(art => {
            const fam = art.familia || 'General';
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

        treeContainer.innerHTML = '';

        // 2. Renderizar Árbol ordenado alfabéticamente por Familia y Artículo Principal
        const familiasOrdenadas = Array.from(familiasMap.entries()).sort((a, b) => 
            a[0].localeCompare(b[0], 'es', { sensitivity: 'base' })
        );

        familiasOrdenadas.forEach(([familiaNombre, articulosMap]) => {
            const isFamOpen = this.familiasAbiertas.has(familiaNombre);
            let totalArticulosEnFamilia = 0;
            articulosMap.forEach(items => totalArticulosEnFamilia += items.length);

            const famCard = document.createElement('div');
            famCard.className = `bunker-familia-card ${isFamOpen ? 'open' : ''}`;

            // Header Familia (Nivel 1)
            const famHeader = document.createElement('div');
            famHeader.className = 'bunker-familia-header';
            famHeader.onclick = () => this.toggleFamilia(familiaNombre);
            famHeader.innerHTML = `
                <div class="bunker-familia-title-group">
                    <span class="bunker-chevron" style="transform: ${isFamOpen ? 'rotate(90deg)' : 'rotate(0deg)'}">▶</span>
                    <h3 class="bunker-familia-name">${familiaNombre}</h3>
                </div>
                <span class="bunker-count-badge">${totalArticulosEnFamilia}</span>
            `;
            famCard.appendChild(famHeader);

            // Body Familia
            if (isFamOpen) {
                const famBody = document.createElement('div');
                famBody.className = 'bunker-familia-body';

                const articulosOrdenados = Array.from(articulosMap.entries()).sort((a, b) => 
                    a[0].localeCompare(b[0], 'es', { sensitivity: 'base' })
                );

                articulosOrdenados.forEach(([artPrincipalNombre, productos]) => {
                    const attrKey = `${familiaNombre}___${artPrincipalNombre}`;
                    const isAttrOpen = this.atributosAbiertos.has(attrKey);

                    const attrGroup = document.createElement('div');
                    attrGroup.className = `bunker-atributo-group ${isAttrOpen ? 'open' : ''}`;

                    // Header Artículo Principal (Nivel 2)
                    const attrHeader = document.createElement('div');
                    attrHeader.className = 'bunker-atributo-header';
                    attrHeader.onclick = () => this.toggleAtributo(attrKey);
                    attrHeader.innerHTML = `
                        <div style="display:flex; align-items:center; gap:0.5rem;">
                            <span style="font-size:0.75rem; color:#60a5fa; transform:${isAttrOpen ? 'rotate(90deg)' : 'rotate(0deg)'}">▶</span>
                            <span class="bunker-atributo-name">${artPrincipalNombre}</span>
                        </div>
                        <span class="bunker-count-badge" style="font-size:0.68rem;">${productos.length}</span>
                    `;
                    attrGroup.appendChild(attrHeader);

                    // Body Artículo Principal: Jerarquía multinivel (N3, N4, N5) y ordenamiento por Kilos
                    if (isAttrOpen) {
                        const attrBody = document.createElement('div');
                        attrBody.className = 'bunker-atributo-body';

                        const subgrid = document.createElement('div');
                        subgrid.className = 'bunker-articulos-subgrid';

                        this.renderNodosJerarquia(subgrid, productos);

                        attrBody.appendChild(subgrid);
                        attrGroup.appendChild(attrBody);
                    }

                    famBody.appendChild(attrGroup);
                });

                famCard.appendChild(famBody);
            }

            treeContainer.appendChild(famCard);
        });

        this.renderCarritoFlotante();
    },

    /**
     * Renderiza la estructura jerárquica multinivel (Nivel 3, Nivel 4, Nivel 5)
     * dentro de un Artículo Principal en el catálogo móvil.
     */
    renderNodosJerarquia(container, productos) {
        // Analizar si hay Nivel 3 (subcategorías)
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

        // Caso 1: Sin Nivel 3 configurado (Directo)
        if (!hasN3) {
            this.renderGrupoProductos(container, productos);
            return;
        }

        // Agregar productos huérfanos a 'General'
        const sinSub = productos.filter(p => !p.sub_categoria || p.sub_categoria.trim() === '');
        if (sinSub.length > 0) {
            if (!subMap.has('general')) {
                subMap.set('general', { nombre: 'General', prods: [] });
            }
            subMap.get('general').prods.push(...sinSub);
        }

        // Ordenar Nivel 3 alfabéticamente, con 'General' al final
        const subList = Array.from(subMap.values()).sort((a, b) => {
            if (a.nombre.toLowerCase() === 'general') return 1;
            if (b.nombre.toLowerCase() === 'general') return -1;
            return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
        });

        subList.forEach(subItem => {
            // Divisor Nivel 3
            const h3 = document.createElement('div');
            h3.className = 'bunker-subcat-header n3';
            h3.innerHTML = `
                <span>🏷️ ${subItem.nombre}</span>
                <span class="bunker-count-badge mini">${subItem.prods.length}</span>
            `;
            container.appendChild(h3);

            // Analizar Nivel 4 dentro de esta subcategoría
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
                this.renderGrupoProductos(container, subItem.prods);
                return;
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

            subSubList.forEach(subSubItem => {
                // Divisor Nivel 4
                const h4 = document.createElement('div');
                h4.className = 'bunker-subcat-header n4';
                h4.innerHTML = `
                    <span>↳ 🌿 ${subSubItem.nombre}</span>
                    <span class="bunker-count-badge mini">${subSubItem.prods.length}</span>
                `;
                container.appendChild(h4);

                // Analizar Nivel 5 dentro de esta sub-subcategoría
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
                    this.renderGrupoProductos(container, subSubItem.prods);
                    return;
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

                subSubSubList.forEach(subSubSubItem => {
                    const h5 = document.createElement('div');
                    h5.className = 'bunker-subcat-header n5';
                    h5.innerHTML = `
                        <span>↳ 🔹 ${subSubSubItem.nombre}</span>
                        <span class="bunker-count-badge mini">${subSubSubItem.prods.length}</span>
                    `;
                    container.appendChild(h5);
                    this.renderGrupoProductos(container, subSubSubItem.prods);
                });
            });
        });
    },

    /**
     * Ordena productos separando fracciones directas (arriba, kilos DESC)
     * de artículos padre / packs (abajo, con divisor sutil).
     */
    renderGrupoProductos(container, productos) {
        const fracciones = [];
        const packs = [];

        productos.forEach(p => {
            const esPack = (p.es_pack === true) || (p.pack_unidades && parseInt(p.pack_unidades) > 1);
            if (esPack) {
                packs.push(p);
            } else {
                fracciones.push(p);
            }
        });

        const sortFn = (a, b) => {
            const kA = parseFloat(a.kilos_unidad || 0);
            const kB = parseFloat(b.kilos_unidad || 0);
            if (kB !== kA) return kB - kA; // Mayor presentación primero (25kg, 10kg, 5kg, 1kg...)
            return (a.descripcion || '').localeCompare(b.descripcion || '', 'es', { sensitivity: 'base' });
        };

        fracciones.sort(sortFn);
        packs.sort(sortFn);

        // 1. Fracciones directas arriba
        fracciones.forEach(prod => {
            const card = this.renderProductCard(prod);
            container.appendChild(card);
        });

        // 2. Artículos padre / packs abajo con separador sutil
        if (packs.length > 0) {
            if (fracciones.length > 0) {
                const sep = document.createElement('div');
                sep.className = 'bunker-packs-separator';
                sep.innerHTML = `
                    <span>📦 Packs / Cajas Cerradas</span>
                    <span class="bunker-count-badge mini">${packs.length}</span>
                `;
                container.appendChild(sep);
            }
            packs.forEach(prod => {
                const card = this.renderProductCard(prod);
                container.appendChild(card);
            });
        }
    },

    renderProductCard(prod) {
        const id = prod.articulo_numero || prod.codigo_barras;
        const currentQty = this.cart.items[id] ? this.cart.items[id].cantidad : 0;
        const hasItems = currentQty > 0;

        const key1 = String(prod.articulo_numero || '').trim().toLowerCase();
        const key2 = String(prod.codigo_barras || '').trim().toLowerCase();
        const habitualInfo = this.articulosHabituales.get(key1) || this.articulosHabituales.get(key2);
        const esHabitual = !!habitualInfo;

        const card = document.createElement('div');
        card.className = `bunker-product-card ${hasItems ? 'has-items' : ''}`;
        card.id = `prod-card-${id}`;

        const stockFis = parseFloat(prod.stock_fisico !== undefined ? prod.stock_fisico : (prod.stock_consolidado || 0)) || 0;
        const stockRes = parseFloat(prod.stock_reservado || 0) || 0;
        const stockDisp = parseFloat(prod.stock_disponible !== undefined ? prod.stock_disponible : (prod.stock_consolidado !== undefined ? prod.stock_consolidado : (prod.stock_actual !== undefined ? prod.stock_actual : 0))) || 0;

        const formattedDisp = Number.isInteger(stockDisp) ? stockDisp : stockDisp.toFixed(1);
        const formattedFis = Number.isInteger(stockFis) ? stockFis : stockFis.toFixed(1);
        const formattedRes = Number.isInteger(stockRes) ? stockRes : stockRes.toFixed(1);
        const hasStock = stockDisp > 0;
        const kilos = parseFloat(prod.kilos_unidad || 1.0) || 1.0;
        const ivaPct = parseFloat(prod.iva || 21);
        const precioBultoFinal = parseFloat(prod.precio_final || (prod.precio_venta * (1 + ivaPct / 100)));
        const precioBultoNeto = parseFloat(prod.precio_venta || (precioBultoFinal / (1 + ivaPct / 100)));
        const precioKiloFinal = parseFloat(prod.precio_kilo || (precioBultoFinal / kilos));
        const precioKiloNeto = precioBultoNeto / kilos;

        const oferta = prod.oferta_activa;
        const esModoNeto = (this.modoIVA === 'sin_iva');
        const precioMostrar = esModoNeto 
            ? (oferta && oferta.precio_oferta_neto ? oferta.precio_oferta_neto : precioBultoNeto)
            : (oferta && oferta.precio_oferta_final ? oferta.precio_oferta_final : precioBultoFinal);
        const precioKiloMostrar = esModoNeto 
            ? (oferta && oferta.precio_kilo_oferta_neto ? oferta.precio_kilo_oferta_neto : precioKiloNeto)
            : (oferta && oferta.precio_kilo_oferta_final ? oferta.precio_kilo_oferta_final : precioKiloFinal);

        if (oferta) {
            card.style.borderColor = 'rgba(239, 68, 68, 0.45)';
            card.style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, #1e293b 100%)';
            card.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.15)';
        }

        card.innerHTML = `
            <div class="bunker-product-top">
                <div class="bunker-product-title-group">
                    <span class="stock-dot ${hasStock ? '' : 'no-stock'}" title="${hasStock ? `Disponible: ${formattedDisp} u (Físico: ${formattedFis} u, Reservado: ${formattedRes} u)` : 'Sin Stock Disponible'}"></span>
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap; margin-bottom:0.25rem;">
                            <h4 class="bunker-product-name" style="${oferta ? 'color: #f87171 !important; font-weight:800;' : ''}">${prod.descripcion}</h4>
                            ${esHabitual ? `<span class="badge-frecuente" title="Comprado habitualmente (${habitualInfo.frecuencia_compra} veces)">⭐ x${habitualInfo.frecuencia_compra}</span>` : ''}
                            ${oferta ? `<span style="font-size:0.65rem; font-weight:800; color:#fca5a5; background:rgba(239,68,68,0.22); border:1px solid rgba(239,68,68,0.45); padding:0.1rem 0.4rem; border-radius:4px;">🔥 OFERTA ${oferta.descuento_porcentaje}% OFF</span>` : ''}
                        </div>
                        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                            <span class="bunker-product-code">Cod: ${id}</span>
                            ${kilos > 0 ? `<span class="bunker-presentacion-tag">📦 ${kilos} kg</span>` : ''}
                            ${prod.es_pack ? `<span style="font-size:0.65rem; font-weight:800; color:#38bdf8; background:rgba(56,189,248,0.15); padding:0.1rem 0.35rem; border-radius:4px;">📦 PACK ${prod.pack_unidades || 1}U</span>` : ''}
                            ${stockRes > 0 ? `
                            <span title="Físico: ${formattedFis} u | Reservado: ${formattedRes} u" style="font-size:0.75rem; font-weight:800; color:${hasStock ? '#38bdf8' : '#f59e0b'}; background:${hasStock ? 'rgba(56,189,248,0.15)' : 'rgba(245,158,11,0.15)'}; border:1px solid ${hasStock ? 'rgba(56,189,248,0.35)' : 'rgba(245,158,11,0.35)'}; padding:0.1rem 0.45rem; border-radius:5px;">
                                📦 Disp: ${formattedDisp} <span style="font-size:0.68rem; opacity:0.85; font-weight:600;">(${formattedRes} res.)</span>
                            </span>
                            ` : `
                            <span style="font-size:0.75rem; font-weight:800; color:${hasStock ? '#34d399' : '#f59e0b'}; background:${hasStock ? 'rgba(52,211,153,0.12)' : 'rgba(245,158,11,0.12)'}; border:1px solid ${hasStock ? 'rgba(52,211,153,0.3)' : 'rgba(245,158,11,0.3)'}; padding:0.1rem 0.45rem; border-radius:5px;">
                                📦 Stock: ${formattedDisp}
                            </span>
                            `}
                        </div>
                    </div>
                </div>
                ${esModoNeto 
                    ? `<span class="bunker-iva-pill" style="background:rgba(99,102,241,0.18); color:#a5b4fc; border-color:rgba(99,102,241,0.35);">Neto (+${ivaPct}%)</span>` 
                    : `<span class="bunker-iva-pill">${ivaPct}% IVA</span>`}
            </div>

            <div class="bunker-product-bottom">
                <div class="bunker-stepper">
                    ${hasItems ? `
                        <button type="button" class="bunker-btn-step" onclick="WizardController.modificarCantidad('${id}', -1)">-</button>
                        <span class="bunker-step-qty" id="qty-${id}" onclick="WizardController.abrirModalCantidad('${id}')" title="Tocar para cambiar número">${currentQty}</span>
                        <button type="button" class="bunker-btn-step" onclick="WizardController.modificarCantidad('${id}', 1)">+</button>
                    ` : `
                        <button type="button" class="bunker-btn-add-initial" onclick="WizardController.modificarCantidad('${id}', 1)">
                            <span>➕</span> Agregar
                        </button>
                    `}
                </div>

                <div class="bunker-prices-container">
                    ${oferta ? `
                        <div style="font-size:0.75rem; color:#94a3b8; text-decoration:line-through; text-align:right;">
                            $ ${(esModoNeto ? precioKiloNeto : precioKiloFinal).toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}/kg
                        </div>
                    ` : ''}
                    <div class="bunker-price-kilo" style="${oferta ? 'color:#f87171 !important;' : ''}">
                        $ ${precioKiloMostrar.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}
                        <span class="bunker-price-kilo-unit">/kg</span>
                    </div>
                    ${kilos > 1 ? `
                        <div class="bunker-price-bulto">
                            Bulto (${kilos}kg): $ ${precioMostrar.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        return card;
    },

    toggleFamilia(familiaNombre) {
        if (this.familiasAbiertas.has(familiaNombre)) {
            this.familiasAbiertas.delete(familiaNombre);
        } else {
            this.familiasAbiertas.add(familiaNombre);
        }
        this.renderArbolBunker();
    },

    toggleAtributo(attrKey) {
        if (this.atributosAbiertos.has(attrKey)) {
            this.atributosAbiertos.delete(attrKey);
        } else {
            this.atributosAbiertos.add(attrKey);
        }
        this.renderArbolBunker();
    },

    // =========================================================
    // MODIFICACIÓN DE CANTIDADES Y MODAL DIRECTO
    // =========================================================
    modificarCantidad(idArticulo, delta) {
        const prod = this.catalogoCompleto.find(a => (a.articulo_numero || a.codigo_barras) == idArticulo);
        
        if (!this.cart.items[idArticulo]) {
            if (delta <= 0) return;
            if (!prod) return;

            const kilos = parseFloat(prod.kilos_unidad || 1.0) || 1.0;
            const iva = parseFloat(prod.iva || 21);
            const neto = parseFloat(prod.precio_venta || (prod.precio_final / (1 + iva / 100)));
            const oferta = prod.oferta_activa;
            const precioNetoEfectivo = oferta && oferta.precio_oferta_neto ? oferta.precio_oferta_neto : neto;
            const precioFinalEfectivo = oferta && oferta.precio_oferta_final ? oferta.precio_oferta_final : (prod.precio_final || (neto * (1 + iva / 100)));

            this.cart.items[idArticulo] = {
                id: idArticulo,
                numero: idArticulo,
                nombre: prod.descripcion,
                precio: precioNetoEfectivo,
                precio_final: precioFinalEfectivo,
                cantidad: delta,
                iva_pct: iva,
                kilos_unidad: kilos,
                es_oferta: !!oferta,
                oferta_id: oferta ? oferta.oferta_id : null,
                descuento_porcentaje: oferta ? oferta.descuento_porcentaje : 0
            };
        } else {
            const nuevaCantidad = this.cart.items[idArticulo].cantidad + delta;
            if (nuevaCantidad <= 0) {
                delete this.cart.items[idArticulo];
            } else {
                this.cart.items[idArticulo].cantidad = nuevaCantidad;
            }
        }

        this.actualizarCardDOM(idArticulo);
        this.renderCarritoFlotante();
    },

    actualizarCardDOM(idArticulo) {
        const prod = this.catalogoCompleto.find(a => (a.articulo_numero || a.codigo_barras) == idArticulo);
        const cardDOM = document.getElementById(`prod-card-${idArticulo}`);
        if (cardDOM && prod) {
            const newCard = this.renderProductCard(prod);
            cardDOM.replaceWith(newCard);
        }
    },

    abrirModalCantidad(idArticulo) {
        this.modalQtyArticulo = idArticulo;
        const item = this.cart.items[idArticulo];
        if (!item) return;

        const prod = this.catalogoCompleto.find(a => (a.articulo_numero || a.codigo_barras) == idArticulo);
        const stockFis = prod ? parseFloat(prod.stock_fisico !== undefined ? prod.stock_fisico : (prod.stock_consolidado || 0)) || 0 : 0;
        const stockRes = prod ? parseFloat(prod.stock_reservado || 0) || 0 : 0;
        const stockDisp = prod ? parseFloat(prod.stock_disponible !== undefined ? prod.stock_disponible : (prod.stock_consolidado !== undefined ? prod.stock_consolidado : (prod.stock_actual !== undefined ? prod.stock_actual : 0))) || 0 : 0;

        const formattedDisp = Number.isInteger(stockDisp) ? stockDisp : stockDisp.toFixed(1);
        const formattedFis = Number.isInteger(stockFis) ? stockFis : stockFis.toFixed(1);
        const formattedRes = Number.isInteger(stockRes) ? stockRes : stockRes.toFixed(1);

        const modal = document.getElementById('modal-cantidad-directa');
        const input = document.getElementById('modal-qty-input');
        const title = document.getElementById('modal-qty-product-name');
        const subtitle = document.getElementById('modal-qty-subtitle');

        if (title) title.innerText = item.nombre;
        if (subtitle) {
            if (stockRes > 0) {
                subtitle.innerHTML = `Ingresá la cantidad &bull; <strong style="color:${stockDisp > 0 ? '#38bdf8' : '#f59e0b'};">Disp: ${formattedDisp} u</strong> <span style="font-size:0.75rem; color:#94a3b8;">(Físico: ${formattedFis} u &bull; ${formattedRes} u reservadas en pedidos)</span>`;
            } else {
                subtitle.innerHTML = `Ingresá la cantidad &bull; <strong style="color:${stockDisp > 0 ? '#34d399' : '#f59e0b'};">Stock disponible: ${formattedDisp} u</strong>`;
            }
        }
        if (input) {
            input.value = item.cantidad;
            setTimeout(() => { input.focus(); input.select(); }, 100);
        }
        if (modal) modal.style.display = 'flex';
    },

    cerrarModalCantidad() {
        const modal = document.getElementById('modal-cantidad-directa');
        if (modal) modal.style.display = 'none';
        this.modalQtyArticulo = null;
    },

    guardarModalCantidad() {
        if (!this.modalQtyArticulo) return;
        const input = document.getElementById('modal-qty-input');
        const val = parseInt(input.value, 10);

        if (isNaN(val) || val <= 0) {
            delete this.cart.items[this.modalQtyArticulo];
        } else {
            if (this.cart.items[this.modalQtyArticulo]) {
                this.cart.items[this.modalQtyArticulo].cantidad = val;
            }
        }

        const idArt = this.modalQtyArticulo;
        this.cerrarModalCantidad();
        this.actualizarCardDOM(idArt);
        this.renderCarritoFlotante();
    },

    renderCarritoFlotante() {
        let itemsCount = 0;
        let totalNetoBase = 0;
        let totalBrutoBase = 0;

        for (let key in this.cart.items) {
            const p = this.cart.items[key];
            itemsCount += p.cantidad;
            const subNeto = p.cantidad * p.precio;
            totalNetoBase += subNeto;
            const ivaMult = 1 + ((p.iva_pct !== undefined ? p.iva_pct : 21) / 100);
            totalBrutoBase += (subNeto * ivaMult);
        }

        const esModoNeto = (this.modoIVA === 'sin_iva');
        let totalBase = esModoNeto ? totalNetoBase : totalBrutoBase;

        // Evaluar política comercial de volumen en tiempo real
        const tienePolitica = this.politicaCliente && this.politicaCliente.tiene_politica && !this.politicaCliente.excepcion;
        let tramoAplicado = null;
        let proximoTramo = null;
        let faltaMonto = 0;
        let bloqueadoPorSaldo = false;
        let saldoCC = 0;
        let tolerancia = 150;

        if (tienePolitica && this.politicaCliente.politica && itemsCount > 0) {
            const pol = this.politicaCliente.politica;
            saldoCC = parseFloat(this.politicaCliente.saldo_cuenta_corriente ?? pol.saldo_cuenta_corriente) || 0;
            tolerancia = parseFloat(pol.tolerancia_saldo) || 150;
            const exigeSaldoCero = pol.exige_saldo_cero !== false;
            bloqueadoPorSaldo = exigeSaldoCero && (saldoCC > tolerancia);

            const baseEval = pol.aplica_sobre === 'BRUTO' ? totalBrutoBase : totalNetoBase;
            const tramos = (pol.tramos || []).slice().sort((a, b) => parseFloat(a.monto_minimo) - parseFloat(b.monto_minimo));

            if (!bloqueadoPorSaldo) {
                for (let i = tramos.length - 1; i >= 0; i--) {
                    if (baseEval >= parseFloat(tramos[i].monto_minimo)) {
                        tramoAplicado = tramos[i];
                        break;
                    }
                }

                for (let i = 0; i < tramos.length; i++) {
                    if (baseEval < parseFloat(tramos[i].monto_minimo)) {
                        proximoTramo = tramos[i];
                        faltaMonto = parseFloat(tramos[i].monto_minimo) - baseEval;
                        break;
                    }
                }
            }
        }

        const qtyEl = document.getElementById('cart-qty');
        const totEl = document.getElementById('cart-total');
        const totOrigEl = document.getElementById('cart-total-original');
        const badgePolicyEl = document.getElementById('cart-policy-badge');
        const hintPolicyEl = document.getElementById('cart-policy-hint');
        const sublabelIvaEl = document.getElementById('cart-iva-sublabel');

        if (qtyEl) qtyEl.innerText = `${itemsCount} ítem${itemsCount === 1 ? '' : 's'} selec.`;
        if (sublabelIvaEl) sublabelIvaEl.innerText = esModoNeto ? 'Neto' : 'c/IVA';

        if (bloqueadoPorSaldo) {
            if (!this.descuentoManual) {
                this.descuentoPct = 0;
            }
            if (totEl) totEl.innerText = `$ ${totalBase.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
            if (totOrigEl) totOrigEl.style.display = 'none';
            if (badgePolicyEl) {
                badgePolicyEl.innerHTML = `⛔ 5% RETENIDO`;
                badgePolicyEl.style.display = 'inline-flex';
                badgePolicyEl.style.background = '#ef4444';
            }
            if (hintPolicyEl) {
                hintPolicyEl.innerHTML = `⛔ Bonificación retenida: Saldo deudor $${saldoCC.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})} (tolerancia $${tolerancia})`;
                hintPolicyEl.style.display = 'block';
                hintPolicyEl.style.color = '#f87171';
            }
        } else if (tramoAplicado) {
            const pct = parseFloat(tramoAplicado.descuento_porcentaje);
            if (!this.descuentoManual) {
                this.descuentoPct = pct;
            }
            const descuentoMonto = totalBase * (pct / 100);
            const totalFinal = totalBase - descuentoMonto;

            if (totEl) totEl.innerText = `$ ${totalFinal.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
            if (totOrigEl) {
                totOrigEl.innerText = `$ ${totalBase.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
                totOrigEl.style.display = 'inline';
            }
            if (badgePolicyEl) {
                badgePolicyEl.innerHTML = `🎉 ${pct}% OFF`;
                badgePolicyEl.style.display = 'inline-flex';
                badgePolicyEl.style.background = '';
            }
            if (hintPolicyEl) {
                hintPolicyEl.innerHTML = `🎉 Superó $${Number(tramoAplicado.monto_minimo).toLocaleString('es-AR')} (-$${descuentoMonto.toLocaleString('es-AR', {maximumFractionDigits:0})})`;
                hintPolicyEl.style.display = 'block';
                hintPolicyEl.style.color = '#34d399';
            }
        } else if (proximoTramo && itemsCount > 0) {
            if (!this.descuentoManual) {
                this.descuentoPct = 0;
            }
            if (totEl) totEl.innerText = `$ ${totalBase.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
            if (totOrigEl) totOrigEl.style.display = 'none';
            if (badgePolicyEl) badgePolicyEl.style.display = 'none';
            if (hintPolicyEl) {
                hintPolicyEl.innerHTML = `💡 Faltan $${Math.ceil(faltaMonto).toLocaleString('es-AR')} para ${proximoTramo.descuento_porcentaje}% OFF`;
                hintPolicyEl.style.display = 'block';
                hintPolicyEl.style.color = '#93c5fd';
            }
        } else {
            if (!this.descuentoManual) {
                this.descuentoPct = 0;
            }
            if (totEl) totEl.innerText = `$ ${totalBase.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
            if (totOrigEl) totOrigEl.style.display = 'none';
            if (badgePolicyEl) badgePolicyEl.style.display = 'none';
            if (hintPolicyEl) hintPolicyEl.style.display = 'none';
        }
    },

    // =========================================================
    // PASO 3: CHECKOUT, DESCUENTO 5% Y CÁLCULO FISCAL
    // =========================================================
    toggleQuickDiscount5() {
        const btn = document.getElementById('btn-quick-discount');
        const input = document.getElementById('descuento-input');
        const actual = parseFloat((input.value || '0').replace(',', '.')) || 0;

        let targetPct = 5;
        let bloqueadoPorSaldo = false;
        let saldoCC = 0;
        let tolerancia = 150;

        if (this.politicaCliente && this.politicaCliente.politica) {
            const pol = this.politicaCliente.politica;
            saldoCC = parseFloat(this.politicaCliente.saldo_cuenta_corriente ?? pol.saldo_cuenta_corriente) || 0;
            tolerancia = parseFloat(pol.tolerancia_saldo) || 150;
            const exigeSaldoCero = pol.exige_saldo_cero !== false;
            bloqueadoPorSaldo = exigeSaldoCero && (saldoCC > tolerancia);
            if (pol.tramos?.length > 0) {
                targetPct = parseFloat(pol.tramos[0].descuento_porcentaje) || 5;
            }
        }

        if (actual > 0) {
            input.value = '0';
            if (btn) btn.classList.remove('active');
            this.descuentoManual = true;
        } else {
            if (bloqueadoPorSaldo) {
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Bonificación Retenida',
                        text: `El cliente registra un saldo pendiente de $${saldoCC.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})} en cuenta corriente (tolerancia $${tolerancia}). ¿Desea aplicar el descuento manualmente de todas formas?`,
                        showCancelButton: true,
                        confirmButtonText: 'Sí, aplicar',
                        cancelButtonText: 'Cancelar',
                        confirmButtonColor: '#d97706'
                    }).then((result) => {
                        if (result.isConfirmed) {
                            input.value = targetPct.toString();
                            if (btn) btn.classList.add('active');
                            this.descuentoManual = true;
                            this.renderCheckout();
                        }
                    });
                    return;
                }
            }
            input.value = targetPct.toString();
            if (btn) btn.classList.add('active');
            this.descuentoManual = true;
        }

        this.renderCheckout();
    },

    onDiscountChanged() {
        this.descuentoManual = true;
        const btn = document.getElementById('btn-quick-discount');
        const input = document.getElementById('descuento-input');
        const val = parseFloat((input.value || '0').replace(',', '.')) || 0;

        if (val > 0) {
            if (btn) btn.classList.add('active');
        } else {
            if (btn) btn.classList.remove('active');
        }

        this.renderCheckout();
    },

    renderCheckout() {
        document.getElementById('ticket-cliente').innerText = this.cart.cliente ? this.cart.cliente.nombre : 'Cliente';
        const lista = document.getElementById('ticket-items-lista');
        lista.innerHTML = '';

        const condIva = (this.cart.cliente && this.cart.cliente.condicion_iva) ? this.cart.cliente.condicion_iva.toLowerCase() : '';
        const isRI = condIva.includes('inscripto');

        // 1. Calcular subtotales base de los ítems
        let totalNetoBase = 0;
        let totalBrutoBaseOriginal = 0;

        for (let key in this.cart.items) {
            const p = this.cart.items[key];
            const subtotalNeto = p.cantidad * p.precio;
            totalNetoBase += subtotalNeto;

            const ivaItem = p.iva_pct !== undefined ? p.iva_pct : 21;
            const ivaMultiplicador = 1 + (ivaItem / 100);
            totalBrutoBaseOriginal += (subtotalNeto * ivaMultiplicador);
        }

        // 2. Evaluar Política Comercial de Volumen
        const btnQuick = document.getElementById('btn-quick-discount');
        const inputDesc = document.getElementById('descuento-input');
        const badgePol = document.getElementById('badge-politica-movil');

        if (this.politicaCliente && this.politicaCliente.tiene_politica) {
            if (this.politicaCliente.excepcion) {
                // Cliente excluido
                if (badgePol) {
                    badgePol.style.display = 'block';
                    badgePol.style.background = 'rgba(239, 68, 68, 0.15)';
                    badgePol.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                    badgePol.style.color = '#fca5a5';
                    badgePol.innerHTML = '🚫 Cliente excluido de bonificaciones por volumen';
                }
                if (btnQuick) btnQuick.innerHTML = '⚡ 5% OFF';
            } else if (this.politicaCliente.politica) {
                const pol = this.politicaCliente.politica;
                const saldoCC = parseFloat(this.politicaCliente.saldo_cuenta_corriente ?? pol.saldo_cuenta_corriente) || 0;
                const tolerancia = parseFloat(pol.tolerancia_saldo) || 150;
                const exigeSaldoCero = pol.exige_saldo_cero !== false;
                const bloqueadoPorSaldo = exigeSaldoCero && (saldoCC > tolerancia);

                const baseEval = pol.aplica_sobre === 'BRUTO' ? totalBrutoBaseOriginal : totalNetoBase;
                const tramos = (pol.tramos || []).slice().sort((a, b) => parseFloat(a.monto_minimo) - parseFloat(b.monto_minimo));

                if (bloqueadoPorSaldo) {
                    if (!this.descuentoManual && inputDesc) {
                        inputDesc.value = '0';
                        if (btnQuick) btnQuick.classList.remove('active');
                    }
                    if (btnQuick) btnQuick.innerHTML = '⚡ 5% (Retenido)';
                    if (badgePol) {
                        badgePol.style.display = 'block';
                        badgePol.style.background = 'rgba(239, 68, 68, 0.15)';
                        badgePol.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                        badgePol.style.color = '#fca5a5';
                        badgePol.innerHTML = `⛔ <strong>Bonificación retenida por saldo pendiente:</strong> El cliente registra un saldo deudor de $${saldoCC.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})} (tolerancia $${tolerancia}). Regularice el saldo para aplicar el 5% OFF.`;
                    }
                } else {
                    let tramoAplicado = null;
                    for (let i = tramos.length - 1; i >= 0; i--) {
                        if (baseEval >= parseFloat(tramos[i].monto_minimo)) {
                            tramoAplicado = tramos[i];
                            break;
                        }
                    }

                    let proximoTramo = null;
                    for (let i = 0; i < tramos.length; i++) {
                        if (baseEval < parseFloat(tramos[i].monto_minimo)) {
                            proximoTramo = tramos[i];
                            break;
                        }
                    }

                    if (tramoAplicado) {
                        const pctTramo = parseFloat(tramoAplicado.descuento_porcentaje);
                        if (!this.descuentoManual && inputDesc) {
                            inputDesc.value = pctTramo.toString();
                            if (btnQuick) btnQuick.classList.add('active');
                        }
                        if (btnQuick) btnQuick.innerHTML = `⚡ ${pctTramo}% OFF`;
                        if (badgePol) {
                            badgePol.style.display = 'block';
                            badgePol.style.background = 'rgba(16, 185, 129, 0.15)';
                            badgePol.style.border = '1px solid rgba(16, 185, 129, 0.4)';
                            badgePol.style.color = '#6ee7b7';
                            badgePol.innerHTML = `🎉 ¡Bonificación ${pctTramo}% aplicada por superar $${Number(tramoAplicado.monto_minimo).toLocaleString('es-AR')}!`;
                        }
                    } else if (proximoTramo) {
                        const falta = parseFloat(proximoTramo.monto_minimo) - baseEval;
                        const pctProx = parseFloat(proximoTramo.descuento_porcentaje);
                        if (!this.descuentoManual && inputDesc) {
                            inputDesc.value = '0';
                            if (btnQuick) btnQuick.classList.remove('active');
                        }
                        if (btnQuick) btnQuick.innerHTML = `⚡ ${pctProx}% > $${Number(proximoTramo.monto_minimo).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
                        if (badgePol) {
                            badgePol.style.display = 'block';
                            badgePol.style.background = 'rgba(59, 130, 246, 0.15)';
                            badgePol.style.border = '1px solid rgba(59, 130, 246, 0.4)';
                            badgePol.style.color = '#93c5fd';
                            badgePol.innerHTML = `💡 Faltan $${Number(falta).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} para el ${pctProx}% de bonificación`;
                        }
                    } else {
                        if (!this.descuentoManual && inputDesc) {
                            inputDesc.value = '0';
                            if (btnQuick) btnQuick.classList.remove('active');
                        }
                        if (btnQuick) btnQuick.innerHTML = '⚡ 5% OFF';
                        if (badgePol) {
                            badgePol.style.display = 'none';
                        }
                    }
                }
            }
        } else {
            if (badgePol) {
                badgePol.style.display = 'none';
            }
            if (btnQuick) btnQuick.innerHTML = '⚡ 5% OFF';
        }

        // 3. Cálculos fiscales finales con el descuento activo
        const descRaw = (inputDesc?.value || '0').replace(',', '.');
        const descInput = parseFloat(descRaw) || 0;
        const descuentoDecimal = descInput / 100;

        let totalTotalizadorIVA = 0;

        for (let key in this.cart.items) {
            const p = this.cart.items[key];
            const subtotalNeto = p.cantidad * p.precio;
            const ivaItem = p.iva_pct !== undefined ? p.iva_pct : 21;
            const ivaMultiplicador = 1 + (ivaItem / 100);

            const row = document.createElement('div');
            row.className = 'ticket-row';

            const esModoNeto = (this.modoIVA === 'sin_iva');
            const subtotalMostrar = esModoNeto ? subtotalNeto : (subtotalNeto * ivaMultiplicador);

            row.innerHTML = `
                <span class="text-truncate" style="max-width:65%">${p.cantidad}x ${p.nombre}</span>
                <span class="ticket-money">$ ${subtotalMostrar.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
            `;
            lista.appendChild(row);

            const baseLinea = subtotalNeto * (1 - descuentoDecimal);
            const ivaLinea = baseLinea * (ivaItem / 100);
            totalTotalizadorIVA += ivaLinea;
        }

        const descNeto = totalNetoBase * descuentoDecimal;
        const subtotalNetoConDesc = totalNetoBase - descNeto;
        const totalFinal = subtotalNetoConDesc + totalTotalizadorIVA;

        const rowSubtotal = document.getElementById('row-subtotal');
        const rowSubDesc = document.getElementById('row-subtotal-desc');
        const rowIva = document.getElementById('row-iva');

        if (isRI) {
            // Discriminar IVA (Factura A)
            rowSubtotal.style.display = 'flex';
            rowSubDesc.style.display = descInput > 0 ? 'flex' : 'none';
            rowIva.style.display = 'flex';

            rowSubtotal.querySelector('span').innerText = 'Subtotal Neto (Sin IVA)';
            rowSubDesc.querySelector('span').innerText = `Subtotal c/Desc (${descInput}%)`;

            document.getElementById('ticket-subtotal-neto').innerText = `$ ${totalNetoBase.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
            document.getElementById('ticket-subtotal-desc').innerText = `$ ${subtotalNetoConDesc.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
            document.getElementById('ticket-iva').innerText = `$ ${totalTotalizadorIVA.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
        } else {
            // IVA Incluido (Factura B / Final)
            rowSubtotal.style.display = 'flex';
            rowSubDesc.style.display = descInput > 0 ? 'flex' : 'none';
            rowIva.style.display = 'none';

            rowSubtotal.querySelector('span').innerText = 'Subtotal (Bruto)';
            rowSubDesc.querySelector('span').innerText = `Subtotal c/Desc (${descInput}%)`;

            document.getElementById('ticket-subtotal-neto').innerText = `$ ${totalBrutoBaseOriginal.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
            document.getElementById('ticket-subtotal-desc').innerText = `$ ${totalFinal.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
        }

        document.getElementById('ticket-total-final').innerText = `$ ${totalFinal.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    },

    // =========================================================
    // CONFIRMACIÓN DE VENTA & DISPATCH WHATSAPP
    // =========================================================
    async confirmarVenta() {
        if (this.isSubmitting) return;

        const btnConfirm = document.getElementById('btn-confirmar-venta');
        if (btnConfirm) {
            btnConfirm.disabled = true;
            btnConfirm.style.opacity = '0.5';
            btnConfirm.innerText = '⏳ PROCESANDO...';
        }
        this.isSubmitting = true;

        const obs = document.getElementById('observaciones-input').value.trim();
        const estadoSeleccionado = document.getElementById('estado-input').value;
        const descuentoRaw = (document.getElementById('descuento-input').value || '0').replace(',', '.');
        const descuentoVisual = parseFloat(descuentoRaw) || 0;
        const descuentoInputFormateado = descuentoVisual / 100;

        const hoy = new Date().toISOString().split('T')[0];

        const payload = {
            id_cliente: String(this.cart.cliente.id),
            fecha: hoy,
            fecha_entrega: hoy,
            agente: (window.state && window.state.sesion && window.state.sesion.usuario) ? window.state.sesion.usuario : 'Cajero Móvil',
            tipo_comprobante: 'Factura',
            estado: estadoSeleccionado,
            estado_logistico: 'SIN_ESTADO',
            informe_generado: 'Pendiente',
            nota: obs,
            punto_entrega: 'Mostrador / Venta Móvil',
            descuento: descuentoInputFormateado,
            usar_precios_bunker: true, // Forzado por default
            secuencia: 'Imprimir',
            detalles: []
        };

        for (let key in this.cart.items) {
            const item = this.cart.items[key];
            const neto = item.precio;
            const iva = item.iva_pct !== undefined ? item.iva_pct : 21;
            const bruto = neto * (1 + (iva / 100));

            payload.detalles.push({
                articulo: item.id.toString(),
                cantidad: parseFloat(item.cantidad),
                valor1: parseFloat(neto.toFixed(2)),
                iva1: parseFloat(iva),
                precio1: parseFloat(bruto.toFixed(2))
            });
        }

        document.getElementById('full-loader').classList.remove('hidden');

        try {
            const isEdit = !!this.cart.editId;
            const endpointUrl = isEdit ? `/api/presupuestos/${this.cart.editId}` : `/api/presupuestos`;
            const methodHttp = isEdit ? 'PUT' : 'POST';

            const token = (window.state && window.state.sesion && window.state.sesion.token) ? window.state.sesion.token : '';
            const response = await fetch(endpointUrl, {
                method: methodHttp,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            document.getElementById('full-loader').classList.add('hidden');

            if (data.success || data.presupuestoId || data.data) {
                const idGenerado = data.presupuestoId || (data.data && data.data.id) || this.cart.editId || 'N/A';
                this.ultimoPresupuestoGuardado = {
                    id: idGenerado,
                    cliente: this.cart.cliente,
                    items: { ...this.cart.items },
                    total: document.getElementById('ticket-total-final').innerText
                };

                // Abrir Modal Omnicanal Unificado
                if (window.DashboardComercial && typeof window.DashboardComercial.abrirModalEnvioOmnicanal === 'function') {
                    await window.DashboardComercial.abrirModalEnvioOmnicanal(idGenerado);
                    window.location.href = 'presupuestos.html';
                } else {
                    Swal.fire({
                        title: '¡Guardado!',
                        text: `Presupuesto N° ${idGenerado} registrado con éxito.`,
                        icon: 'success',
                        confirmButtonColor: '#10b981',
                        background: '#1e293b',
                        color: '#f8fafc'
                    }).then(() => {
                        window.location.href = 'presupuestos.html';
                    });
                }
            } else {
                this.isSubmitting = false;
                if (btnConfirm) {
                    btnConfirm.disabled = false;
                    btnConfirm.style.opacity = '1';
                    btnConfirm.innerText = '🚀 REINTENTAR';
                }
                Swal.fire('Error', "No se pudo guardar: " + (data.error || "Desconocido"), 'error');
            }
        } catch (e) {
            this.isSubmitting = false;
            document.getElementById('full-loader').classList.add('hidden');
            if (btnConfirm) {
                btnConfirm.disabled = false;
                btnConfirm.style.opacity = '1';
                btnConfirm.innerText = '🚀 REINTENTAR';
            }
            console.error('Error guardando presupuesto:', e);
            Swal.fire('Error de conexión', 'Verificá tu conexión a internet o el estado del servidor.', 'warning');
        }
    },

    // --- OPCIONES OMNICANAL ---
    async compartirWhatsAppPDF() {
        if (!this.ultimoPresupuestoGuardado) return;
        const idTicket = this.ultimoPresupuestoGuardado.id;
        if (window.DashboardComercial && typeof window.DashboardComercial.abrirModalEnvioOmnicanal === 'function') {
            await window.DashboardComercial.abrirModalEnvioOmnicanal(idTicket, true);
        }
    },

    abrirChatWhatsAppDirecto() {
        if (!this.ultimoPresupuestoGuardado) return;
        const idTicket = this.ultimoPresupuestoGuardado.id;
        if (window.DashboardComercial && typeof window.DashboardComercial.abrirModalEnvioOmnicanal === 'function') {
            window.DashboardComercial.abrirModalEnvioOmnicanal(idTicket, false);
        }
    },

    async enviarWhatsAppBotBackend() {
        if (!this.ultimoPresupuestoGuardado) return;
        const idTicket = this.ultimoPresupuestoGuardado.id;
        if (window.DashboardComercial && typeof window.DashboardComercial.abrirModalEnvioOmnicanal === 'function') {
            await window.DashboardComercial.abrirModalEnvioOmnicanal(idTicket, false);
        }
    },

    finalizarYSalir() {
        window.location.href = 'presupuestos.html';
    },

    // =========================================================
    // MODO EDICIÓN
    // =========================================================
    async cargarPresupuestoParaEdicion(id) {
        try {
            document.getElementById('full-loader').classList.remove('hidden');
            document.getElementById('loader-msg').innerText = 'Cargando presupuesto...';

            const token = (window.state && window.state.sesion && window.state.sesion.token) ? window.state.sesion.token : '';
            const resHeader = await fetch(`/api/presupuestos/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const dataHeader = await resHeader.json();
            if (!dataHeader.success || !dataHeader.data) throw new Error("No se encontró el presupuesto");

            const cabecera = dataHeader.data;

            const resDetalles = await fetch(`/api/presupuestos/${id}/detalles`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const dataDetalles = await resDetalles.json();
            const itemsArray = Array.isArray(dataDetalles.data) ? dataDetalles.data : (dataDetalles.data.detalles || []);

            this.cart.editId = id;
            this.cart.cliente = {
                id: cabecera.id_cliente,
                nombre: cabecera.cliente_nombre || cabecera.concepto || 'Cliente',
                condicion_iva: cabecera.condicion_iva || ''
            };

            document.getElementById('observaciones-input').value = cabecera.nota || '';
            const dropEstado = document.getElementById('estado-input');
            if (dropEstado && cabecera.estado) dropEstado.value = cabecera.estado;

            const txtDescuento = document.getElementById('descuento-input');
            if (txtDescuento && cabecera.descuento) {
                const rawDesc = parseFloat(cabecera.descuento);
                const descVal = rawDesc > 1 ? rawDesc : Math.round(rawDesc * 10000) / 100;
                txtDescuento.value = descVal.toString().replace('.', ',');
                if (Math.abs(descVal - 5) < 0.01) {
                    document.getElementById('btn-quick-discount').classList.add('active');
                }
            }

            // Cargar Catálogo Búnker del cliente y habituales, luego hidratar items
            await Promise.all([
                this.cargarCatalogoCompletoCliente(),
                this.cargarArticulosHabitualesCliente()
            ]);

            itemsArray.forEach(item => {
                const arrId = item.articulo;
                const prodRef = this.catalogoCompleto.find(a => (a.articulo_numero || a.codigo_barras) == arrId);

                this.cart.items[arrId] = {
                    id: arrId,
                    numero: arrId,
                    nombre: item.descripcion || item.descripcion_articulo || (prodRef ? prodRef.descripcion : arrId),
                    precio: parseFloat(item.valor1 || 0),
                    precio_final: prodRef ? prodRef.precio_final : parseFloat(item.precio1 || 0),
                    cantidad: Math.abs(parseFloat(item.cantidad || 0)),
                    iva_pct: item.camp2 ? (parseFloat(item.camp2) < 1 ? parseFloat(item.camp2) * 100 : parseFloat(item.camp2)) : 21,
                    kilos_unidad: prodRef ? prodRef.kilos_unidad : 1.0
                };
            });

            document.getElementById('full-loader').classList.add('hidden');
            this.avanzarPaso(2);
            this.renderArbolBunker();
            this.renderCarritoFlotante();

        } catch (e) {
            document.getElementById('full-loader').classList.add('hidden');
            console.error('Error cargando edición:', e);
            Swal.fire('Error', 'No se pudo cargar el presupuesto para edición: ' + e.message, 'error').then(() => {
                window.location.href = 'presupuestos.html';
            });
        }
    }
};

// Global bindings
window.WizardController = WizardController;
window.avanzarPaso = (n) => WizardController.avanzarPaso(n);
window.wizardBack = () => WizardController.wizardBack();
window.cancelarWizard = () => WizardController.cancelarWizard();
window.confirmarVenta = () => WizardController.confirmarVenta();
window.limpiarInputArticulo = () => WizardController.limpiarInputArticulo();
window.toggleFiltroHabituales = () => WizardController.toggleFiltroHabituales();
window.toggleModoIVA = () => WizardController.toggleModoIVA();
