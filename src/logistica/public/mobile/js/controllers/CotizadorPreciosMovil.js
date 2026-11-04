/**
 * CotizadorPreciosMovil.js
 * Controlador táctil para cotización rápida de precios en calle (LAMDA Móvil)
 * Con resolución de listas de precios Búnker, detección de clientes sin lista,
 * vinculación estructural de artículos hijos exclusivamente por Primary Key / pack_hijo_codigo
 * (sin heurísticas de texto ni expresiones regulares),
 * selector de modo de precios y flujo en 2 etapas.
 */

window.CotizadorPreciosMovil = {
    esProspecto: false,
    cliente: null,
    listaActiva: null,
    todasLasListas: [],
    mapaBunkerPacks: new Map(),
    articulosHabituales: new Map(), // key -> { articulo_id, descripcion, frecuencia_compra, ultima_compra }
    filtroSoloHabituales: false,
    familiasAbiertas: new Set(),
    atributosAbiertos: new Set(),
    todosLosArticulos: [],
    articulosFiltrados: [],
    articulosSeleccionados: new Set(),
    familias: [],
    familiaActiva: '',
    terminoBusqueda: '',
    modoIVA: 'con_iva',
    ocultarColumnaIVA: false,
    modoPrecio: 'ambos',
    mostrarHijos: true,
    nivelesAgrupamiento: new Set(['familia', 'principal']),
    tituloInforme: 'Consulta de Precios',
    categoriasParticipantes: [],
    mapaFotosLotes: {},
    timerBusqueda: null,

    async init() {
        console.log('📱 [COTIZADOR-MÓVIL] Inicializando...');
        const params = new URLSearchParams(window.location.search);
        const clienteIdParam = params.get('clienteId');

        this.esProspecto = (!clienteIdParam || clienteIdParam === 'prospecto' || clienteIdParam === 'libre');

        try {
            await this.cargarDatosIniciales(clienteIdParam);
        } catch (e) {
            console.error('Error al inicializar cotizador:', e);
            Swal.fire('Error', 'No se pudieron cargar los datos del cotizador: ' + e.message, 'error');
        }
    },

    async cargarDatosIniciales(clienteIdParam) {
        // 0. Cargar mapa de fotografías activas de partidas por lote (no bloqueante)
        fetch('/api/logistica/b2b-fotos-lotes/mapa')
            .then(r => r.json())
            .then(json => {
                if (json && json.success && json.data) {
                    this.mapaFotosLotes = json.data;
                    if (this.todosLosArticulos.length > 0) this.renderCatalogo();
                }
            })
            .catch(() => {});

        // 1. Cargar todas las listas comerciales de Búnker desde el endpoint oficial
        try {
            const resListas = await fetch('/api/logistica/bunker/listas');
            const dataListas = await resListas.json();
            if (dataListas.success && Array.isArray(dataListas.data)) {
                this.todasLasListas = dataListas.data;
            }
        } catch (err) {
            console.warn('Error cargando listas de precios Búnker:', err);
        }

        // 2. Cargar catálogo maestro del Búnker para conocer la estructura relacional de Packs e Hijos
        try {
            const resListado = await fetch('/api/logistica/bunker/listado');
            const dataListado = await resListado.json();
            const listadoArts = dataListado.articulos || dataListado.data || [];
            if (Array.isArray(listadoArts)) {
                this.mapaBunkerPacks.clear();
                listadoArts.forEach(art => {
                    if (art.articulo_id) {
                        const key = String(art.articulo_id).trim().toUpperCase();
                        this.mapaBunkerPacks.set(key, {
                            articulo_id: art.articulo_id,
                            es_pack: art.es_pack === true || art.es_pack === 't' || art.es_pack === 'true' || (art.pack_unidades && parseInt(art.pack_unidades) > 1),
                            pack_unidades: parseInt(art.pack_unidades || 1, 10),
                            pack_hijo_codigo: art.pack_hijo_codigo || null,
                            kilos_unidad: parseFloat(art.kilos_unidad || 1),
                            nomenclatura: art.nomenclatura || art.descripcion,
                            descripcion: art.descripcion || art.nomenclatura
                        });
                    }
                });
            }
        } catch (errPacks) {
            console.warn('Error cargando catálogo relacional de packs:', errPacks);
        }

        // Si es cotización libre / prospecto:
        if (this.esProspecto) {
            const fallbackList = this.todasLasListas.find(l => l.id === 5) || this.todasLasListas[0] || { id: 5, nombre: 'Dietetica' };
            this.listaActiva = fallbackList;
            this.politicaCliente = null;

            this.cliente = {
                id: 'prospecto',
                lomas_soft_id: '',
                codigo_bunker: 'PROSPECTO',
                nombre: 'Consulta de Precios (Prospecto)',
                razon_social: 'Cliente Potencial / Cotización Libre',
                cuit: '',
                condicion_iva: 'Consumidor Final',
                tiene_lista_asignada: false,
                lista_precios_id: this.listaActiva.id,
                lista_precios_nombre: this.listaActiva.nombre,
                whatsapp_facturas: '[]',
                email_facturas: '[]',
                saldo: 0
            };

            // Renderizar datos del prospecto en la cabecera
            const lblCodigo = document.getElementById('lbl-cliente-codigo');
            if (lblCodigo) lblCodigo.innerText = 'PROSPECTO';
            const lblNombre = document.getElementById('lbl-cliente-nombre');
            if (lblNombre) lblNombre.innerText = 'Consulta de Precios (Prospecto)';
            const lblCuit = document.getElementById('lbl-cliente-cuit');
            if (lblCuit) lblCuit.innerText = 'Sin CUIT';
            const lblCond = document.getElementById('lbl-cliente-condicion');
            if (lblCond) lblCond.innerText = 'Consumidor Final';

            const lblSaldo = document.getElementById('lbl-cliente-saldo');
            if (lblSaldo) {
                lblSaldo.innerText = 'Cotización Libre';
                lblSaldo.style.color = '#c084fc';
                lblSaldo.title = 'Modo de cotización libre para prospectos';
            }
            const boxSaldo = document.getElementById('box-cliente-saldo');
            if (boxSaldo) {
                const titleLabel = boxSaldo.querySelector('div');
                if (titleLabel) titleLabel.innerText = 'MODO';
            }

            const lblListaBtn = document.getElementById('lbl-lista-activa');
            if (lblListaBtn) {
                lblListaBtn.innerText = this.listaActiva.nombre;
            }

            this.modoIVA = 'con_iva';

            await this.cargarArticulosHabituales();
            await this.cargarArticulosCatalogo();
            return;
        }

        // 3. Cargar datos del Cliente
        let clienteData = null;
        try {
            const resBunker = await fetch(`/api/logistica/bunker/clientes/${encodeURIComponent(clienteIdParam)}`);
            if (resBunker.ok) {
                const jsonB = await resBunker.json();
                if (jsonB.success && jsonB.data) clienteData = jsonB.data;
            }
        } catch (e) {
            console.warn('Fallback a sugerencias de cliente:', e);
        }

        if (!clienteData) {
            const resSug = await fetch(`/api/presupuestos/clientes/sugerencias?q=${encodeURIComponent(clienteIdParam)}`);
            const jsonSug = await resSug.json();
            if (jsonSug.success && jsonSug.data && jsonSug.data.length > 0) {
                clienteData = jsonSug.data[0];
            }
        }

        if (!clienteData) {
            throw new Error('Cliente no encontrado');
        }

        // 4. Determinar lista comercial asignada
        let tieneLista = false;
        let listaAsignadaId = null;
        let listaAsignadaNombre = '';

        if (Array.isArray(clienteData.listas_precios) && clienteData.listas_precios.length > 0) {
            tieneLista = true;
            listaAsignadaId = clienteData.listas_precios[0].id;
            listaAsignadaNombre = clienteData.listas_precios[0].nombre;
        } else if (clienteData.bunker_lista_id) {
            tieneLista = true;
            listaAsignadaId = clienteData.bunker_lista_id;
            const lFound = this.todasLasListas.find(l => l.id == clienteData.bunker_lista_id);
            listaAsignadaNombre = lFound ? lFound.nombre : 'Lista Asignada';
        }

        this.cliente = {
            id: clienteData.id || clienteData.codigo_bunker_cliente || clienteIdParam,
            lomas_soft_id: clienteData.lomas_soft_id || clienteData.codigo_legacy || '',
            codigo_bunker: clienteData.codigo_bunker_cliente || 'S/C',
            nombre: clienteData.cliente_nombre || clienteData.razon_social || 'Cliente',
            razon_social: clienteData.razon_social || '',
            cuit: clienteData.cuit_cuil || clienteData.cuit || '',
            condicion_iva: clienteData.condicion_iva || 'Consumidor Final',
            tiene_lista_asignada: tieneLista,
            lista_precios_id: listaAsignadaId || 5,
            lista_precios_nombre: listaAsignadaNombre || 'Sin lista asignada',
            whatsapp_facturas: clienteData.whatsapp_facturas || '[]',
            email_facturas: clienteData.email_facturas || '[]'
        };

        // Renderizar datos del cliente en la cabecera
        document.getElementById('lbl-cliente-codigo').innerText = this.cliente.codigo_bunker;
        document.getElementById('lbl-cliente-nombre').innerText = this.cliente.nombre;
        document.getElementById('lbl-cliente-cuit').innerText = this.cliente.cuit ? `CUIT: ${this.cliente.cuit}` : 'Sin CUIT';
        document.getElementById('lbl-cliente-condicion').innerText = this.cliente.condicion_iva;

        // Renderizar saldo de Cuenta Corriente en tiempo real
        const saldoVal = parseFloat(clienteData.saldo || 0);
        this.cliente.saldo = saldoVal;
        const lblSaldo = document.getElementById('lbl-cliente-saldo');
        if (lblSaldo) {
            const formatted = `$ ${Math.abs(saldoVal).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            if (saldoVal > 0) {
                lblSaldo.innerText = formatted;
                lblSaldo.style.color = '#f87171'; // Rojo / Deuda
                lblSaldo.title = 'Saldo deudor (pendiente de pago)';
            } else if (saldoVal < 0) {
                lblSaldo.innerText = `-${formatted}`;
                lblSaldo.style.color = '#38bdf8'; // Celeste / Saldo a favor
                lblSaldo.title = 'Saldo a favor del cliente';
            } else {
                lblSaldo.innerText = '$ 0,00';
                lblSaldo.style.color = '#34d399'; // Verde / Al día
                lblSaldo.title = 'Cuenta corriente al día';
            }
        }

        // Auto-detección de IVA
        this.modoIVA = 'con_iva';

        // 5. Asignar lista activa
        if (tieneLista) {
            const matchLista = this.todasLasListas.find(l => l.id == this.cliente.lista_precios_id);
            this.listaActiva = matchLista || { id: this.cliente.lista_precios_id, nombre: this.cliente.lista_precios_nombre };
        } else {
            const fallbackList = this.todasLasListas.find(l => l.id === 5) || this.todasLasListas[0] || { id: 5, nombre: 'Dietetica' };
            this.listaActiva = fallbackList;
        }

        const lblListaBtn = document.getElementById('lbl-lista-activa');
        if (lblListaBtn) {
            lblListaBtn.innerText = this.cliente.tiene_lista_asignada ? this.listaActiva.nombre : `${this.listaActiva.nombre} (S/A)`;
        }

        // Cargar política comercial asignada al cliente
        this.politicaCliente = null;
        try {
            const idParaPolitica = this.cliente.lomas_soft_id || this.cliente.id || clienteIdParam;
            const polRes = await fetch(`/api/presupuestos/politicas/cliente/${idParaPolitica}`);
            if (polRes.ok) {
                const polJson = await polRes.json();
                if (polJson.success && polJson.data) {
                    this.politicaCliente = polJson.data;
                    console.log('🏷️ [COTIZADOR-MOVIL] Política comercial cargada:', this.politicaCliente);
                }
            }
        } catch (errPol) {
            console.warn('⚠️ [COTIZADOR-MOVIL] Error al consultar política comercial:', errPol);
            this.politicaCliente = null;
        }

        // 6. Cargar artículos habituales del cliente
        await this.cargarArticulosHabituales();

        // 7. Cargar catálogo de artículos con precios del cliente
        await this.cargarArticulosCatalogo();
    },

    async cargarArticulosHabituales() {
        this.articulosHabituales.clear();
        this.filtroSoloHabituales = false;
        const btnHab = document.getElementById('btn-toggle-habituales-cotiz');
        const btnActionHab = document.getElementById('btn-tildar-habituales-action');
        const badge = document.getElementById('habituales-cotiz-count');

        if (btnHab) btnHab.classList.remove('active');

        if (this.esProspecto) {
            if (badge) badge.style.display = 'none';
            if (btnHab) btnHab.style.display = 'none';
            if (btnActionHab) btnActionHab.style.display = 'none';
            return;
        }

        const clienteParam = this.cliente ? (this.cliente.lomas_soft_id || this.cliente.id) : null;
        if (!clienteParam) return;

        try {
            const res = await fetch('/api/presupuestos/clientes/' + encodeURIComponent(clienteParam) + '/articulos-habituales');
            const data = await res.json();
            if (data.success && Array.isArray(data.data)) {
                data.data.forEach(item => {
                    const key = String(item.articulo_id || '').trim().toUpperCase();
                    if (key) {
                        this.articulosHabituales.set(key, item);
                    }
                });
            }

            const count = this.articulosHabituales.size;
            if (badge) {
                badge.innerText = count;
                badge.style.display = count > 0 ? 'inline-block' : 'none';
            }
            if (btnHab) {
                btnHab.style.display = count > 0 ? 'inline-flex' : 'none';
            }
            if (btnActionHab) {
                btnActionHab.style.display = count > 0 ? 'inline-block' : 'none';
                btnActionHab.innerHTML = '⭐ Tildar Habituales (' + count + ')';
            }
        } catch (e) {
            console.warn('Error cargando habituales en cotizador:', e);
        }
    },

    obtenerInfoHabitual(art) {
        if (!art) return null;
        const candidateKeys = [
            art.articulo_numero,
            art.producto_codigo,
            art.codigo_articulo,
            art.codigo_barras,
            art.numero,
            art.articulo_id,
            art.id
        ].map(k => String(k || '').trim().toUpperCase()).filter(Boolean);

        for (const k of candidateKeys) {
            if (this.articulosHabituales.has(k)) {
                return this.articulosHabituales.get(k);
            }
        }
        return null;
    },

    toggleFamilia(famNombre) {
        if (this.familiasAbiertas.has(famNombre)) {
            this.familiasAbiertas.delete(famNombre);
        } else {
            this.familiasAbiertas.add(famNombre);
        }
        this.renderCatalogo();
    },

    toggleAtributo(attrKey) {
        if (this.atributosAbiertos.has(attrKey)) {
            this.atributosAbiertos.delete(attrKey);
        } else {
            this.atributosAbiertos.add(attrKey);
        }
        this.renderCatalogo();
    },

    toggleFiltroHabituales() {
        if (this.articulosHabituales.size === 0) {
            Swal.fire({
                title: 'Sin Compras Históricas',
                text: 'El cliente no posee compras habituales registradas.',
                icon: 'info',
                background: '#1e293b',
                color: '#f8fafc',
                timer: 2000,
                showConfirmButton: false
            });
            return;
        }

        this.filtroSoloHabituales = !this.filtroSoloHabituales;
        const btn = document.getElementById('btn-toggle-habituales-cotiz');
        if (btn) {
            btn.classList.toggle('active', this.filtroSoloHabituales);
        }

        if (this.filtroSoloHabituales) {
            this.todosLosArticulos.forEach(art => {
                if (this.obtenerInfoHabitual(art)) {
                    const fam = art.familia || art.familia_nombre || 'General';
                    const artP = art.articulo_principal || 'General';
                    this.familiasAbiertas.add(fam);
                    this.atributosAbiertos.add(`${fam}___${artP}`);
                }
            });
        }

        this.filtrarArticulos(this.terminoBusqueda);
    },

    tildarHabituales() {
        if (this.articulosHabituales.size === 0) {
            Swal.fire({
                title: 'Sin Compras Históricas',
                text: 'El cliente no posee compras habituales registradas.',
                icon: 'info',
                background: '#1e293b',
                color: '#f8fafc',
                timer: 2000,
                showConfirmButton: false
            });
            return;
        }

        let countAdded = 0;
        this.todosLosArticulos.forEach(art => {
            if (this.obtenerInfoHabitual(art)) {
                this.articulosSeleccionados.add(art.id);
                countAdded++;
                const fam = art.familia || art.familia_nombre || 'General';
                const artP = art.articulo_principal || 'General';
                this.familiasAbiertas.add(fam);
                this.atributosAbiertos.add(`${fam}___${artP}`);
            }
        });

        this.renderCatalogo();
        this.actualizarResumenSeleccion();

        Swal.fire({
            icon: 'success',
            title: '⭐ Habituales Seleccionados',
            text: 'Se tildaron ' + countAdded + ' artículos habituales de ' + this.cliente.nombre + '.',
            background: '#1e293b',
            color: '#f8fafc',
            timer: 1800,
            showConfirmButton: false
        });
    },

    async cargarArticulosCatalogo() {
        const container = document.getElementById('catalogo-articulos-cotizar');
        const countTxt = document.getElementById('txt-cotiz-articulos-count');
        container.innerHTML = `
            <div class="placeholder-card" style="padding: 2rem 1rem; text-align: center;">
                <div class="loader-spinner" style="margin: 0 auto 0.75rem; width: 28px; height: 28px;"></div>
                <p style="font-size: 0.85rem; color: #94a3b8;">Cargando catálogo (${this.listaActiva.nombre})...</p>
            </div>
        `;

        const clienteParam = this.esProspecto ? '0' : (this.cliente.lomas_soft_id || this.cliente.id);
        const listaIdParam = this.listaActiva ? this.listaActiva.id : '';
        const res = await fetch(`/api/presupuestos/articulos/sugerencias?all=true&cliente_id=${encodeURIComponent(clienteParam)}&lista_id=${encodeURIComponent(listaIdParam)}&limit=3000&usar_precios_bunker=true`);
        const json = await res.json();

        if (!json.success || !Array.isArray(json.data)) {
            container.innerHTML = '<div class="placeholder-msg">No se pudo cargar el catálogo de artículos.</div>';
            return;
        }

        this.todosLosArticulos = json.data.map(a => {
            const artIdStr = a.articulo_numero || a.producto_codigo || a.articulo_id || a.codigo_articulo || a.codigo_barras || '';
            const keyUpper = String(artIdStr).trim().toUpperCase();
            const packData = this.mapaBunkerPacks.get(keyUpper) || {};

            const nom = a.descripcion || a.producto_descripcion || a.nomenclatura || `Art #${artIdStr}`;
            const fam = a.familia_nombre || a.familia || 'General';
            const princ = a.articulo_principal || a.principal || 'General';
            const subCat = a.sub_categoria || null;
            const subSubCat = a.sub_sub_categoria || null;
            const subSubSubCat = a.sub_sub_sub_categoria || null;

            const precioFinal = parseFloat(a.precio_final || a.precio_venta || 0);
            const precioNeto = parseFloat(a.precio_neto || (precioFinal / (1 + (a.iva || 21)/100)));
            const precioKiloFinal = parseFloat(a.precio_kilo || (a.kilos_unidad > 0 ? precioFinal / a.kilos_unidad : 0));
            const precioKiloNeto = parseFloat(a.precio_kilo_neto || (a.kilos_unidad > 0 ? precioNeto / a.kilos_unidad : 0));

            const esPack = (packData.es_pack === true) || (a.es_pack === true || a.es_pack === 't' || a.es_pack === 'true');
            const packUnits = parseInt(packData.pack_unidades || a.pack_unidades || 1, 10);
            const packHijoCodigo = packData.pack_hijo_codigo || a.pack_hijo_codigo || null;

            const uniqueId = String(a.articulo_numero || a.codigo_articulo || a.codigo_barras || a.numero || artIdStr).trim();

            return {
                id: uniqueId,
                articulo_numero: a.articulo_numero || '',
                producto_codigo: a.producto_codigo || '',
                codigo_articulo: a.codigo_articulo || '',
                codigo_barras: a.codigo_barras || '',
                numero: a.numero || '',
                articulo_id: artIdStr,
                codigo: a.articulo_numero || a.codigo_barras || a.codigo_articulo || '',
                nomenclatura: nom,
                descripcion: nom,
                descripcion_generada: a.descripcion_generada || nom,
                familia_nombre: fam.trim().toUpperCase(),
                familia: fam.trim(),
                articulo_principal: princ.trim(),
                sub_categoria: subCat ? subCat.trim() : null,
                sub_sub_categoria: subSubCat ? subSubCat.trim() : null,
                sub_sub_sub_categoria: subSubSubCat ? subSubSubCat.trim() : null,
                kilos_unidad: parseFloat(a.kilos_unidad || 1),
                presentacion_str: a.presentacion_str || (a.kilos_unidad ? `${a.kilos_unidad}kg` : 'Unidad'),
                iva: parseFloat(a.iva || a.iva_porcentaje || 21),
                precio_bulto_final: precioFinal,
                precio_bulto_neto: precioNeto,
                precio_kilo_final: precioKiloFinal,
                precio_kilo_neto: precioKiloNeto,
                propiedades_dinamicas: a.propiedades_dinamicas || {},
                es_pack: esPack,
                pack_unidades: packUnits,
                stock_fisico: parseFloat(a.stock_fisico !== undefined ? a.stock_fisico : (a.stock_consolidado || 0)) || 0,
                stock_reservado: parseFloat(a.stock_reservado || 0) || 0,
                stock_disponible: parseFloat(a.stock_disponible !== undefined ? a.stock_disponible : (a.stock_consolidado || 0)) || 0,
                stock: parseFloat(a.stock_disponible !== undefined ? a.stock_disponible : (a.stock_consolidado || 0)) || 0,
                stock_consolidado: parseFloat(a.stock_disponible !== undefined ? a.stock_disponible : (a.stock_consolidado || 0)) || 0,
                oferta_activa: a.oferta_activa || null
            };
        });

        // Extraer familias únicas ordenadas
        const famSet = new Set();
        this.todosLosArticulos.forEach(a => {
            if (a.familia_nombre && a.familia_nombre !== 'SIN FAMILIA') {
                famSet.add(a.familia_nombre);
            }
        });
        this.familias = Array.from(famSet).sort();

        // Renderizar chips de familias
        this.renderChipsFamilias();

        // Aplicar filtros iniciales
        this.filtrarArticulos('');
        if (countTxt) countTxt.innerText = `${this.todosLosArticulos.length} artículos disponibles`;
    },

    renderChipsFamilias() {
        const cont = document.getElementById('container-chips-familias');
        if (!cont) return;

        let html = `<button class="family-chip-btn ${this.familiaActiva === '' ? 'active' : ''}" onclick="CotizadorPreciosMovil.seleccionarFamilia('')">🌾 Todas</button>`;
        
        this.familias.forEach(f => {
            const isAct = this.familiaActiva === f;
            html += `<button class="family-chip-btn ${isAct ? 'active' : ''}" onclick="CotizadorPreciosMovil.seleccionarFamilia('${f}')">${this.formatearNombreFamilia(f)}</button>`;
        });

        cont.innerHTML = html;
    },

    formatearNombreFamilia(nombre) {
        if (!nombre) return '';
        const lower = nombre.toLowerCase();
        if (lower.includes('cereal')) return '🌾 ' + nombre;
        if (lower.includes('barrit')) return '🍫 ' + nombre;
        if (lower.includes('granol')) return '🥣 ' + nombre;
        if (lower.includes('fruto') || lower.includes('seco')) return '🥜 ' + nombre;
        if (lower.includes('semill')) return '🌱 ' + nombre;
        if (lower.includes('legumb')) return '🫘 ' + nombre;
        if (lower.includes('especi')) return '🧂 ' + nombre;
        if (lower.includes('harin')) return '🌾 ' + nombre;
        return '📦 ' + nombre;
    },

    seleccionarFamilia(familia) {
        this.familiaActiva = familia;
        this.renderChipsFamilias();
        this.filtrarArticulos(this.terminoBusqueda);
    },

    filtrarArticulos(query) {
        this.terminoBusqueda = (query || '').trim();
        const btnClear = document.getElementById('btn-clear-search-cotiz');
        if (btnClear) {
            btnClear.style.display = this.terminoBusqueda.length > 0 ? 'block' : 'none';
        }

        const terms = this.terminoBusqueda.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(t => t.length > 0);

        this.articulosFiltrados = this.todosLosArticulos.filter(art => {
            // Filtro por artículos habituales
            if (this.filtroSoloHabituales && !this.obtenerInfoHabitual(art)) {
                return false;
            }

            // Filtro por familia
            if (this.familiaActiva && art.familia_nombre !== this.familiaActiva) {
                return false;
            }

            // Filtro por términos (Regla #3 Universal LAMDA: acumulativo AND)
            if (terms.length > 0) {
                const corpus = [
                    art.codigo,
                    art.nomenclatura,
                    art.descripcion,
                    art.familia_nombre,
                    art.articulo_principal,
                    art.presentacion_str,
                    JSON.stringify(art.propiedades_dinamicas || {})
                ].join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

                return terms.every(t => corpus.includes(t));
            }

            return true;
        });

        this.renderCatalogo();
    },

    limpiarBusqueda() {
        const input = document.getElementById('input-buscar-articulos-cotiz');
        if (input) {
            input.value = '';
            input.focus();
        }
        this.filtrarArticulos('');
    },

    renderCatalogo() {
        const container = document.getElementById('catalogo-articulos-cotizar');
        const cantEl = document.getElementById('lbl-cant-visibles');
        if (!container) return;

        if (cantEl) cantEl.innerText = this.articulosFiltrados.length;

        if (this.articulosFiltrados.length === 0) {
            container.innerHTML = `
                <div class="placeholder-msg" style="padding:2.5rem 1rem; text-align:center; color:#94a3b8;">
                    <p style="margin:0 0 0.75rem; font-size:0.95rem;">No se encontraron artículos con ese criterio.</p>
                    <button class="btn-primary-action" style="background:#334155; color:#cbd5e1; border:none; padding:0.4rem 0.85rem; border-radius:0.6rem; font-size:0.8rem; cursor:pointer;" onclick="CotizadorPreciosMovil.limpiarBusqueda()">Ver todo el catálogo</button>
                </div>
            `;
            return;
        }

        // Si hay una búsqueda activa o filtro de habituales, auto-abrir ramas
        const isSearchOrFilterActive = (this.terminoBusqueda.length > 0) || this.filtroSoloHabituales;
        if (isSearchOrFilterActive) {
            this.articulosFiltrados.forEach(art => {
                const fam = art.familia || art.familia_nombre || 'General';
                const artP = art.articulo_principal || 'General';
                this.familiasAbiertas.add(fam);
                this.atributosAbiertos.add(`${fam}___${artP}`);
            });
        }

        // 1. Agrupar por Familia -> Artículo Principal
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

        let html = '';

        const familiasOrdenadas = Array.from(familiasMap.entries()).sort((a, b) => 
            a[0].localeCompare(b[0], 'es', { sensitivity: 'base' })
        );

        familiasOrdenadas.forEach(([familiaNombre, articulosPrincipalMap]) => {
            const isFamOpen = this.familiasAbiertas.has(familiaNombre);
            let totalArticulosEnFamilia = 0;
            let totalSeleccionadosFamilia = 0;

            articulosPrincipalMap.forEach(prods => {
                totalArticulosEnFamilia += prods.length;
                prods.forEach(a => {
                    if (this.articulosSeleccionados.has(a.id)) totalSeleccionadosFamilia++;
                });
            });

            const articulosOrdenados = Array.from(articulosPrincipalMap.entries()).sort((a, b) => 
                a[0].localeCompare(b[0], 'es', { sensitivity: 'base' })
            );

            html += `
                <div class="bunker-familia-card ${isFamOpen ? 'open' : ''}" style="margin-bottom:0.75rem;">
                    <!-- Header Familia (Nivel 1) -->
                    <div class="bunker-familia-header" onclick="CotizadorPreciosMovil.toggleFamilia('${familiaNombre.replace(/'/g, "\\'")}')">
                        <div class="bunker-familia-title-group">
                            <span class="bunker-chevron" style="transform: ${isFamOpen ? 'rotate(90deg)' : 'rotate(0deg)'}">▶</span>
                            <h3 class="bunker-familia-name">${this.formatearNombreFamilia(familiaNombre)}</h3>
                        </div>
                        <div style="display:flex; align-items:center; gap:0.4rem;">
                            ${totalSeleccionadosFamilia > 0 ? `
                                <span style="font-size:0.7rem; font-weight:800; background:#10b981; color:white; padding:0.15rem 0.45rem; border-radius:999px;">
                                    ✓ ${totalSeleccionadosFamilia}
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
                                const isAttrOpen = this.atributosAbiertos.has(attrKey);

                                let totalSeleccionadosAttr = 0;
                                productos.forEach(a => {
                                    if (this.articulosSeleccionados.has(a.id)) totalSeleccionadosAttr++;
                                });

                                return `
                                    <div class="bunker-atributo-group ${isAttrOpen ? 'open' : ''}">
                                        <!-- Header Artículo Principal (Nivel 2) -->
                                        <div class="bunker-atributo-header" onclick="CotizadorPreciosMovil.toggleAtributo('${attrKey.replace(/'/g, "\\'")}')">
                                            <div style="display:flex; align-items:center; gap:0.5rem;">
                                                <span style="font-size:0.75rem; color:#60a5fa; transform:${isAttrOpen ? 'rotate(90deg)' : 'rotate(0deg)'}">▶</span>
                                                <span class="bunker-atributo-name">${artPrincipalNombre}</span>
                                            </div>
                                            <div style="display:flex; align-items:center; gap:0.4rem;">
                                                ${totalSeleccionadosAttr > 0 ? `
                                                    <span style="font-size:0.68rem; font-weight:800; background:#10b981; color:white; padding:0.1rem 0.4rem; border-radius:999px;">
                                                        ✓ ${totalSeleccionadosAttr}
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

        container.innerHTML = html;
        this.actualizarResumenSeleccion();
    },

    /**
     * Construye el HTML de la jerarquía multinivel (N3, N4, N5) en el cotizador móvil.
     */
    renderHtmlNodosJerarquia(productos) {
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

        // Si no hay Nivel 3 (Directo)
        if (!hasN3) {
            return this.renderHtmlGrupoProductos(productos);
        }

        // Productos huérfanos a 'General'
        const sinSub = productos.filter(p => !p.sub_categoria || p.sub_categoria.trim() === '');
        if (sinSub.length > 0) {
            if (!subMap.has('general')) {
                subMap.set('general', { nombre: 'General', prods: [] });
            }
            subMap.get('general').prods.push(...sinSub);
        }

        // Ordenar Nivel 3 alfabéticamente con 'General' al final
        const subList = Array.from(subMap.values()).sort((a, b) => {
            if (a.nombre.toLowerCase() === 'general') return 1;
            if (b.nombre.toLowerCase() === 'general') return -1;
            return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
        });

        return subList.map(subItem => {
            const h3Html = `
                <div class="bunker-subcat-header n3">
                    <span>🏷️ ${subItem.nombre}</span>
                    <span class="bunker-count-badge mini">${subItem.prods.length}</span>
                </div>
            `;

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
                        <span>↳ 🌿 ${subSubItem.nombre}</span>
                        <span class="bunker-count-badge mini">${subSubItem.prods.length}</span>
                    </div>
                `;

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
                            <span>↳ 🔹 ${subSubSubItem.nombre}</span>
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
     * Ordena productos separando fracciones directas (arriba, kilos DESC)
     * de artículos padre / packs (abajo, con divisor sutil).
     */
    renderHtmlGrupoProductos(productos) {
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
            return (a.descripcion || a.nomenclatura || '').localeCompare(b.descripcion || b.nomenclatura || '', 'es', { sensitivity: 'base' });
        };

        fracciones.sort(sortFn);
        packs.sort(sortFn);

        let outHtml = '';

        // 1. Fracciones directas arriba
        outHtml += fracciones.map(art => this.renderCardArticulo(art)).join('');

        // 2. Artículos padre / packs abajo con separador sutil
        if (packs.length > 0) {
            if (fracciones.length > 0) {
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
        const isSel = this.articulosSeleccionados.has(art.id);
        const habData = this.obtenerInfoHabitual(art);
        const oferta = art.oferta_activa;
        const precioBultoOriginal = this.modoIVA === 'con_iva' ? art.precio_bulto_final : art.precio_bulto_neto;
        const precioKiloOriginal = this.modoIVA === 'con_iva' ? art.precio_kilo_final : art.precio_kilo_neto;

        const precioBulto = oferta 
            ? (this.modoIVA === 'con_iva' ? (oferta.precio_oferta_final || precioBultoOriginal) : (oferta.precio_oferta_neto || precioBultoOriginal))
            : precioBultoOriginal;
        const precioKilo = oferta 
            ? (this.modoIVA === 'con_iva' ? (oferta.precio_kilo_oferta_final || precioKiloOriginal) : (oferta.precio_kilo_oferta_neto || precioKiloOriginal))
            : precioKiloOriginal;

        const cardStyle = oferta 
            ? 'style="border-color: rgba(239, 68, 68, 0.5) !important; background: linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, #1e293b 100%) !important; box-shadow: 0 0 10px rgba(239, 68, 68, 0.15);"' 
            : '';
        const titleStyle = oferta ? 'style="margin: 0; font-size: 0.88rem; font-weight: 800; color: #f87171; line-height: 1.25;"' : 'style="margin: 0; font-size: 0.88rem; font-weight: 800; color: #f8fafc; line-height: 1.25;"';

        const stockFis = parseFloat(art.stock_fisico !== undefined ? art.stock_fisico : (art.stock_consolidado || 0)) || 0;
        const stockRes = parseFloat(art.stock_reservado || 0) || 0;
        const stockDisp = parseFloat(art.stock_disponible !== undefined ? art.stock_disponible : (art.stock !== undefined ? art.stock : (art.stock_consolidado || 0))) || 0;

        const formattedDisp = Number.isInteger(stockDisp) ? stockDisp : stockDisp.toFixed(1);
        const formattedFis = Number.isInteger(stockFis) ? stockFis : stockFis.toFixed(1);
        const formattedRes = Number.isInteger(stockRes) ? stockRes : stockRes.toFixed(1);
        const hasStock = stockDisp > 0;

        const codLookup = String(art.codigo || art.id || '').trim();
        const infoPartida = (this.mapaFotosLotes && this.mapaFotosLotes[codLookup]) ? this.mapaFotosLotes[codLookup] : null;
        const cantFotosPartida = Array.isArray(infoPartida?.imagenes) ? infoPartida.imagenes.length : 0;
        const safeCod = codLookup.replace(/'/g, "\\'");

        return `
            <div class="item-cotiz-card ${isSel ? 'selected' : ''}" ${cardStyle} onclick="CotizadorPreciosMovil.toggleArticulo('${art.id}')">
                <input type="checkbox" class="item-cotiz-checkbox" ${isSel ? 'checked' : ''} onclick="event.stopPropagation(); CotizadorPreciosMovil.toggleArticulo('${art.id}')">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.2rem; flex-wrap: wrap;">
                        <span class="badge-code-gray" style="font-size:0.68rem; padding:0.1rem 0.35rem;">${art.codigo || 'S/C'}</span>
                        ${art.es_pack ? '<span style="font-size:0.65rem; font-weight:800; color:#38bdf8; background:rgba(56,189,248,0.15); padding:0.1rem 0.35rem; border-radius:4px;">📦 PACK ' + art.pack_unidades + 'U</span>' : ''}
                        ${habData ? `<span style="font-size:0.65rem; font-weight:800; color:#facc15; background:rgba(234,179,8,0.18); border:1px solid rgba(234,179,8,0.3); padding:0.1rem 0.4rem; border-radius:4px;">⭐ Habitual ${habData.frecuencia_compra ? '(' + habData.frecuencia_compra + ')' : ''}</span>` : ''}
                        ${oferta ? `<span style="font-size:0.65rem; font-weight:800; color:#fca5a5; background:rgba(239,68,68,0.22); border:1px solid rgba(239,68,68,0.45); padding:0.1rem 0.4rem; border-radius:4px;">🔥 OFERTA ${oferta.descuento_porcentaje}% OFF</span>` : ''}
                        ${cantFotosPartida > 0 ? `<button type="button" onclick="event.stopPropagation(); CotizadorPreciosMovil.verFotosPartidaArticulo('${safeCod}')" style="font-size:0.66rem; font-weight:800; color:#5eead4; background:rgba(13,148,136,0.22); border:1px solid rgba(20,184,166,0.5); padding:0.1rem 0.45rem; border-radius:5px; cursor:pointer;">📷 Ver partida (${cantFotosPartida})</button>` : ''}
                    </div>
                    <h4 ${titleStyle} class="text-truncate">${art.nomenclatura}</h4>
                    <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 0.25rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                        <span>Pres: <strong>${art.presentacion_str}</strong> ${art.kilos_unidad > 1 ? `(${art.kilos_unidad} kg)` : ''}</span>
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
                <div style="text-align: right; white-space: nowrap;">
                    ${oferta ? `
                        <div style="font-size: 0.72rem; color: #94a3b8; text-decoration: line-through;">
                            $ ${precioBultoOriginal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                    ` : ''}
                    <div style="font-size: 0.95rem; font-weight: 900; color: ${oferta ? '#f87171' : '#34d399'};">
                        $ ${precioBulto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    ${precioKilo > 0 ? `
                        <div style="font-size: 0.72rem; color: #cbd5e1; font-weight: 600;">
                            $ ${precioKilo.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    },

    verFotosPartidaArticulo(codLookup) {
        const info = this.mapaFotosLotes ? this.mapaFotosLotes[codLookup] : null;
        if (!info || !Array.isArray(info.imagenes) || info.imagenes.length === 0) return;

        const art = this.todosLosArticulos.find(a => String(a.codigo || a.id || '').trim() === String(codLookup));
        const titulo = art ? art.nomenclatura : `Artículo #${codLookup}`;

        const imgsHtml = info.imagenes.map((img, i) => `
            <div style="margin-bottom: 0.65rem;">
                <img src="${img.url}" alt="Foto ${i + 1}" style="width: 100%; max-height: 320px; object-fit: contain; border-radius: 0.65rem; border: 1px solid #334155; background: #050811;">
                <div style="font-size: 0.68rem; color: #64748b; margin-top: 2px;">Toma ${i + 1} de ${info.imagenes.length}</div>
            </div>
        `).join('');

        Swal.fire({
            title: `<div style="font-size: 0.95rem; font-weight: 800; color: #f8fafc;">📷 Inspección de Partida • #${codLookup}</div>`,
            html: `
                <div style="text-align: left; font-size: 0.8rem; color: #cbd5e1;">
                    <div style="font-weight: 700; margin-bottom: 0.4rem; color: #5eead4;">${titulo}</div>
                    ${info.lote_codigo ? `<div style="margin-bottom: 0.35rem; font-size: 0.74rem; color: #94a3b8;">🏷️ Partida / Lote: <strong>${info.lote_codigo}</strong></div>` : ''}
                    ${info.es_referencia_caja_madre ? `<div style="margin-bottom: 0.5rem; padding: 0.4rem 0.6rem; background: rgba(14,165,233,0.12); border: 1px solid rgba(14,165,233,0.35); border-radius: 0.45rem; font-size: 0.72rem; color: #bae6fd;">ℹ️ Referencia de Caja Madre (Línea 1): ${info.articulo_madre_nombre || info.articulo_madre_id}</div>` : ''}
                    ${info.observacion_tecnica ? `<div style="margin-bottom: 0.55rem; padding: 0.4rem 0.6rem; background: rgba(30,41,59,0.8); border-left: 3px solid #14b8a6; border-radius: 0.35rem; font-size: 0.75rem;">📝 ${info.observacion_tecnica}</div>` : ''}
                    <div style="max-height: 55vh; overflow-y: auto; padding-right: 2px;">
                        ${imgsHtml}
                    </div>
                </div>
            `,
            background: '#0f172a',
            color: '#f8fafc',
            confirmButtonText: 'Cerrar',
            confirmButtonColor: '#0d9488'
        });
    },

    toggleArticulo(id) {
        if (this.articulosSeleccionados.has(id)) {
            this.articulosSeleccionados.delete(id);
        } else {
            this.articulosSeleccionados.add(id);
        }
        this.renderCatalogo();
    },

    tildarVisibles() {
        this.articulosFiltrados.forEach(a => this.articulosSeleccionados.add(a.id));
        this.renderCatalogo();
    },

    desmarcarTodos() {
        this.articulosSeleccionados.clear();
        this.renderCatalogo();
    },

    actualizarResumenSeleccion() {
        const count = this.articulosSeleccionados.size;
        const resEl = document.getElementById('lbl-resumen-seleccion');
        const btnDespacho = document.getElementById('btn-abrir-despacho');

        if (resEl) resEl.innerText = `${count} artículo${count === 1 ? '' : 's'}`;
        if (btnDespacho) {
            btnDespacho.style.opacity = count > 0 ? '1' : '0.6';
        }
    },

    // =========================================================
    // ESCANEO TAXONÓMICO DINÁMICO (Paridad Desktop)
    // =========================================================
    obtenerCategoriasParticipantes(artList) {
        if (!Array.isArray(artList) || artList.length === 0) return [];
        const categoriasFound = new Map();

        artList.forEach(art => {
            const pd = art.propiedades_dinamicas || {};
            if (pd.posiciones && typeof pd.posiciones === 'object') {
                Object.keys(pd.posiciones).forEach(posKey => {
                    const posObj = pd.posiciones[posKey];
                    if (!posObj || typeof posObj !== 'object') return;

                    const catNombre = posObj.eje || posObj.categoria || posObj.nombre_categoria || posObj.nombre || posKey;
                    const rawVal = posObj.valor || posObj.termino || posObj.texto;

                    if (catNombre && rawVal && String(rawVal).trim() !== '') {
                        const catCleanKey = String(catNombre).toLowerCase().trim();
                        const valClean = String(rawVal).trim();

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

        return result;
    },

    // Selector de Lista de Precios al vuelo con las listas oficiales
    async abrirSelectorListas() {
        if (this.todasLasListas.length === 0) {
            try {
                const resListas = await fetch('/api/logistica/bunker/listas');
                const dataListas = await resListas.json();
                if (dataListas.success && Array.isArray(dataListas.data)) {
                    this.todasLasListas = dataListas.data;
                }
            } catch (e) {}
        }

        let optionsHtml = '';
        this.todasLasListas.forEach(l => {
            const isSel = (l.id == this.listaActiva.id || l.lista_id == this.listaActiva.id);
            optionsHtml += `<option value="${l.id || l.lista_id}" ${isSel ? 'selected' : ''}>${l.nombre}</option>`;
        });

        const { value: nuevaListaId } = await Swal.fire({
            title: 'Cambiar Lista de Precios',
            html: `
                <div style="text-align:left; font-size:0.85rem; color:#cbd5e1;">
                    <label style="font-weight:700; display:block; margin-bottom:0.4rem;">Seleccioná la lista comercial para cotizar:</label>
                    <select id="swal-select-lista-cotiz" class="wizard-select" style="background:#0f172a; color:white; border-color:#475569;">
                        ${optionsHtml}
                    </select>
                </div>
            `,
            background: '#1e293b',
            color: '#f8fafc',
            showCancelButton: true,
            confirmButtonText: 'Aplicar Lista',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#7c3aed',
            preConfirm: () => {
                return document.getElementById('swal-select-lista-cotiz').value;
            }
        });

        if (nuevaListaId && nuevaListaId != this.listaActiva.id) {
            const found = this.todasLasListas.find(l => (l.id == nuevaListaId || l.lista_id == nuevaListaId));
            if (found) {
                this.listaActiva = found;
                const lbl = document.getElementById('lbl-lista-activa');
                if (lbl) lbl.innerText = found.nombre;
                await this.cargarArticulosCatalogo();
            }
        }
    },

    extraerContactos() {
        let phoneContacts = [];
        let emailContacts = [];

        try {
            if (typeof this.cliente.whatsapp_facturas === 'string' && this.cliente.whatsapp_facturas.startsWith('[')) {
                phoneContacts = JSON.parse(this.cliente.whatsapp_facturas);
            } else if (this.cliente.whatsapp_facturas) {
                phoneContacts = [{ numero: this.cliente.whatsapp_facturas, default: true }];
            }
        } catch(e) {}

        try {
            if (typeof this.cliente.email_facturas === 'string' && this.cliente.email_facturas.startsWith('[')) {
                emailContacts = JSON.parse(this.cliente.email_facturas);
            } else if (this.cliente.email_facturas) {
                emailContacts = [{ email: this.cliente.email_facturas, default: true }];
            }
        } catch(e) {}

        return { phoneContacts, emailContacts };
    },

    // =========================================================
    // FLUJO DE 2 ETAPAS: ETAPA 1 (FORMATO & AGRUPAMIENTO DINÁMICO)
    // =========================================================
    async abrirModalConfiguracionYDespacho() {
        if (this.articulosSeleccionados.size === 0) {
            Swal.fire({
                title: 'Selección Vacía',
                text: 'Por favor tildá al menos un artículo para cotizar.',
                icon: 'warning',
                background: '#1e293b',
                color: '#f8fafc',
                confirmButtonColor: '#7c3aed'
            });
            return;
        }

        const articulosSelList = this.todosLosArticulos.filter(a => this.articulosSeleccionados.has(a.id));
        const countSel = articulosSelList.length;

        // Escanear todas las categorías secundarias participantes
        this.categoriasParticipantes = this.obtenerCategoriasParticipantes(articulosSelList);

        // Preseleccionar por defecto TODOS los niveles disponibles según solicitud del usuario
        this.nivelesAgrupamiento.clear();
        this.nivelesAgrupamiento.add('familia');
        this.nivelesAgrupamiento.add('principal');
        this.categoriasParticipantes.forEach(c => this.nivelesAgrupamiento.add(c.key));

        // Generar chips dinámicos de categorías
        let chipsTaxonomicosHtml = `
            <button type="button" class="family-chip-btn" style="background:#475569; color:white; border-color:#64748b;" onclick="CotizadorPreciosMovil.limpiarNivelesAgrupamiento(this)">
                📋 Sin Agrupar
            </button>
            <button type="button" id="btn-grp-familia" class="family-chip-btn ${this.nivelesAgrupamiento.has('familia') ? 'active' : ''}" onclick="CotizadorPreciosMovil.toggleNivelAgrupamiento('familia', this)">
                🌾 Familia
            </button>
            <button type="button" id="btn-grp-principal" class="family-chip-btn ${this.nivelesAgrupamiento.has('principal') ? 'active' : ''}" onclick="CotizadorPreciosMovil.toggleNivelAgrupamiento('principal', this)">
                🌽 Atributo Principal
            </button>
        `;

        this.categoriasParticipantes.forEach(c => {
            const isAct = this.nivelesAgrupamiento.has(c.key);
            chipsTaxonomicosHtml += `
                <button type="button" id="btn-grp-${c.key}" class="family-chip-btn ${isAct ? 'active' : ''}" onclick="CotizadorPreciosMovil.toggleNivelAgrupamiento('${c.key}', this)">
                    🏷️ ${c.label}
                </button>
            `;
        });

        // Banner informativo de lista comercial
        let bannerListaHtml = '';
        if (this.cliente.tiene_lista_asignada) {
            bannerListaHtml = `
                <div style="margin-bottom:0.75rem; background:linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); padding:0.55rem 0.75rem; border-radius:0.65rem; border:1px solid rgba(124,58,237,0.3); display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-size:0.7rem; color:#c084fc; text-transform:uppercase; font-weight:700; display:block;">Lista Comercial Asignada:</span>
                        <strong style="font-size:0.85rem; color:#34d399;">🏷️ ${this.listaActiva.nombre}</strong>
                    </div>
                    <button type="button" style="background:#334155; border:1px solid #475569; color:#c084fc; font-size:0.72rem; font-weight:700; padding:0.25rem 0.6rem; border-radius:0.4rem; cursor:pointer;" onclick="Swal.close(); CotizadorPreciosMovil.abrirSelectorListas();">
                        ✏️ Cambiar
                    </button>
                </div>
            `;
        } else {
            bannerListaHtml = `
                <div style="margin-bottom:0.75rem; background:rgba(245,158,11,0.12); padding:0.55rem 0.75rem; border-radius:0.65rem; border:1px solid rgba(245,158,11,0.4); display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-size:0.7rem; color:#fbbf24; text-transform:uppercase; font-weight:700; display:block;">⚠️ Cliente sin lista asignada:</span>
                        <strong style="font-size:0.85rem; color:#f8fafc;">Aplicando: ${this.listaActiva.nombre}</strong>
                    </div>
                    <button type="button" style="background:#78350f; border:1px solid #d97706; color:#fde68a; font-size:0.72rem; font-weight:700; padding:0.25rem 0.6rem; border-radius:0.4rem; cursor:pointer;" onclick="Swal.close(); CotizadorPreciosMovil.abrirSelectorListas();">
                        ✏️ Elegir Lista
                    </button>
                </div>
            `;
        }

        const etapa1Html = `
            <div style="text-align:left; font-size:0.85rem; color:#f8fafc;">
                <!-- INDICADOR DE LISTA COMERCIAL ACTIVA -->
                ${bannerListaHtml}

                <!-- 1. NIVELES DE AGRUPAMIENTO DINÁMICOS -->
                <div style="margin-bottom:0.75rem; background:#0f172a; padding:0.65rem 0.75rem; border-radius:0.75rem; border:1px solid #334155;">
                    <div style="font-weight:800; color:#c084fc; font-size:0.76rem; text-transform:uppercase; margin-bottom:0.4rem; display:flex; justify-content:space-between; align-items:center;">
                        <span>📦 Niveles de Agrupamiento</span>
                        <span style="font-size:0.68rem; color:#34d399; font-weight:700;">Todos Activos ✓</span>
                    </div>
                    <div style="display:flex; gap:0.35rem; flex-wrap:wrap;" id="container-chips-agrupamiento-modal">
                        ${chipsTaxonomicosHtml}
                    </div>
                </div>

                <!-- 2. OPCIÓN: INCLUIR PRESENTACIONES FRACCIONADAS HIJAS -->
                <div style="margin-bottom:0.75rem; background:#0f172a; padding:0.65rem 0.75rem; border-radius:0.75rem; border:1px solid #334155; display:flex; align-items:center; gap:0.6rem; cursor:pointer;" onclick="document.getElementById('chk-swal-hijos').click()">
                    <input type="checkbox" id="chk-swal-hijos" style="width:1.25rem; height:1.25rem; accent-color:#10b981;" ${this.mostrarHijos ? 'checked' : ''} onclick="event.stopPropagation()">
                    <div style="flex:1;">
                        <label for="chk-swal-hijos" style="font-weight:700; color:#f8fafc; font-size:0.8rem; cursor:pointer; margin:0; display:block;">
                            📦 Incluir presentaciones fraccionadas (hijos / packs)
                        </label>
                        <span style="font-size:0.68rem; color:#94a3b8; display:block;">Deriva unidades individuales de packs comerciales</span>
                    </div>
                </div>

                <!-- 3. TRATAMIENTO DE IVA, PRECIOS A MOSTRAR Y TÍTULO -->
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-bottom:0.75rem;">
                    <div>
                        <label style="font-weight:700; color:#cbd5e1; display:block; margin-bottom:0.25rem; font-size:0.75rem;">💰 Formato de I.V.A.:</label>
                        <select id="swal-cotiz-select-iva" class="wizard-select" style="background:#0f172a; color:white; border-color:#475569; font-size:0.76rem; padding:0.45rem;">
                            <option value="con_iva" ${this.modoIVA === 'con_iva' ? 'selected' : ''}>Con IVA (Final)</option>
                            <option value="sin_iva" ${this.modoIVA === 'sin_iva' ? 'selected' : ''}>Sin IVA (Neto)</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-weight:700; color:#cbd5e1; display:block; margin-bottom:0.25rem; font-size:0.75rem;">💵 Precios a Mostrar:</label>
                        <select id="swal-cotiz-select-modo-precio" class="wizard-select" style="background:#0f172a; color:white; border-color:#475569; font-size:0.76rem; padding:0.45rem;">
                            <option value="ambos" ${this.modoPrecio === 'ambos' ? 'selected' : ''}>Ambos (Bulto y Kilo)</option>
                            <option value="kilo" ${this.modoPrecio === 'kilo' ? 'selected' : ''}>Solo Precio Kilo</option>
                            <option value="bulto" ${this.modoPrecio === 'bulto' ? 'selected' : ''}>Solo Precio Bulto</option>
                        </select>
                    </div>
                </div>

                <!-- 4. OPCIÓN: OMITIR COLUMNA DE % IVA EN EL INFORME PDF -->
                <div style="margin-bottom:0.75rem; background:#0f172a; padding:0.65rem 0.75rem; border-radius:0.75rem; border:1px solid #334155; display:flex; align-items:center; gap:0.6rem; cursor:pointer;" onclick="document.getElementById('chk-swal-ocultar-iva').click()">
                    <input type="checkbox" id="chk-swal-ocultar-iva" style="width:1.25rem; height:1.25rem; accent-color:#a855f7;" ${this.ocultarColumnaIVA ? 'checked' : ''} onclick="event.stopPropagation()">
                    <div style="flex:1;">
                        <label for="chk-swal-ocultar-iva" style="font-weight:700; color:#f8fafc; font-size:0.8rem; cursor:pointer; margin:0; display:block;">
                            🚫 Omitir columna de % IVA en el PDF
                        </label>
                        <span style="font-size:0.68rem; color:#94a3b8; display:block;">Muestra solo precios finales sin mencionar la palabra ni columna de IVA</span>
                    </div>
                </div>

                <div>
                    <label style="font-weight:700; color:#cbd5e1; display:block; margin-bottom:0.25rem; font-size:0.75rem;">🏷️ Título del Documento:</label>
                    <input type="text" id="swal-cotiz-input-titulo" value="${this.tituloInforme}" class="wizard-input-mobile" style="background:#0f172a; color:white; border-color:#475569; font-size:0.78rem; padding:0.45rem; border-radius:0.5rem;">
                </div>
            </div>
        `;

        const { isConfirmed } = await Swal.fire({
            title: `<div style="font-size:1.05rem; font-weight:800; color:#34d399;">⚙️ Opciones de Formato (${countSel} arts)</div>`,
            html: etapa1Html,
            background: '#1e293b',
            color: '#f8fafc',
            width: '92%',
            showCancelButton: true,
            confirmButtonText: 'Siguiente: Envíos ➔',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#7c3aed',
            cancelButtonColor: '#475569',
            preConfirm: () => {
                this.modoIVA = document.getElementById('swal-cotiz-select-iva').value;
                this.modoPrecio = document.getElementById('swal-cotiz-select-modo-precio').value;
                this.mostrarHijos = document.getElementById('chk-swal-hijos') ? document.getElementById('chk-swal-hijos').checked : true;
                this.ocultarColumnaIVA = document.getElementById('chk-swal-ocultar-iva') ? document.getElementById('chk-swal-ocultar-iva').checked : false;
                this.tituloInforme = document.getElementById('swal-cotiz-input-titulo').value.trim() || 'Consulta de Precios';
                return true;
            }
        });

        if (isConfirmed) {
            await this.abrirEtapa2Despacho(countSel);
        }
    },

    toggleNivelAgrupamiento(nivel, btn) {
        if (this.nivelesAgrupamiento.has(nivel)) {
            this.nivelesAgrupamiento.delete(nivel);
            if (btn) btn.classList.remove('active');
        } else {
            this.nivelesAgrupamiento.add(nivel);
            if (btn) btn.classList.add('active');
        }
    },

    limpiarNivelesAgrupamiento(btn) {
        this.nivelesAgrupamiento.clear();
        const container = document.getElementById('container-chips-agrupamiento-modal');
        if (container) {
            container.querySelectorAll('.family-chip-btn').forEach(b => b.classList.remove('active'));
        }
    },

    // =========================================================
    // FLUJO DE 2 ETAPAS: ETAPA 2 (DESTINATARIOS WHATSAPP / EMAIL)
    // =========================================================
    async abrirEtapa2Despacho(countSel) {
        const { phoneContacts, emailContacts } = this.extraerContactos();

        let textoPoliticaWp = '';
        if (this.politicaCliente && this.politicaCliente.tiene_politica && !this.politicaCliente.excepcion) {
            const tramos = this.politicaCliente.politica?.tramos || [];
            if (tramos.length > 0) {
                const tramoDesc = tramos.map(t => {
                    const montoMinFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(parseFloat(t.monto_minimo));
                    return `Superando ${montoMinFmt}: ${parseFloat(t.descuento_porcentaje).toFixed(1)}% de bonificación automática`;
                }).join(' / ');
                textoPoliticaWp = `\n🎉 Condiciones comerciales especiales: ${tramoDesc}`;
            }
        } else {
            textoPoliticaWp = `\n💡 Consulte por bonificaciones y escalas de descuento comercial por volumen.`;
        }

        let defaultMsg = this.esProspecto
            ? `Hola, te enviamos la cotización de precios actualizada de LAMDA.${textoPoliticaWp}\nQuedamos atentos a cualquier consulta. ¡Muchas gracias!`
            : `Hola ${this.cliente.nombre}, te enviamos la cotización de precios actualizada de LAMDA.${textoPoliticaWp}\nQuedamos atentos a cualquier consulta. ¡Muchas gracias!`;

        // Render contactos WhatsApp
        let wpHtml = '';
        if (phoneContacts.length === 0) {
            wpHtml = '<div style="font-size:0.75rem; color:#94a3b8; padding:0.4rem; text-align:center;">No hay teléfonos registrados en la ficha.</div>';
        } else {
            phoneContacts.forEach((c, idx) => {
                const rawNum = String(c.numero || c).trim();
                const isChk = (typeof c.default === 'boolean') ? c.default : (idx === 0);
                wpHtml += `
                    <label style="display:flex; align-items:flex-start; gap:0.5rem; background:#0f172a; padding:0.5rem 0.65rem; border-radius:0.6rem; border:1px solid #334155; margin-bottom:0.35rem; cursor:pointer;">
                        <input type="checkbox" class="swal-cotiz-wp-chk" value="${rawNum.replace(/\D/g, '')}" ${isChk ? 'checked' : ''} style="width:1.15rem; height:1.15rem; accent-color:#10b981; margin-top:2px;">
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:0.78rem; font-weight:700; color:#f8fafc;">${c.nombre || 'Contacto #' + (idx+1)} ${c.cargo ? `<span style="font-size:0.65rem; background:rgba(59,130,246,0.2); color:#93c5fd; padding:1px 4px; border-radius:3px;">${c.cargo}</span>` : ''}</div>
                            <div style="font-size:0.74rem; color:#34d399; font-weight:600;">📱 ${rawNum}</div>
                        </div>
                    </label>
                `;
            });
        }

        // Render contactos Email
        let emailHtml = '';
        if (emailContacts.length === 0) {
            emailHtml = '<div style="font-size:0.75rem; color:#94a3b8; padding:0.4rem; text-align:center;">No hay correos registrados en la ficha.</div>';
        } else {
            emailContacts.forEach((e, idx) => {
                const emailAddr = String(e.email || e).trim();
                const isChk = (typeof e.default === 'boolean') ? e.default : (idx === 0);
                emailHtml += `
                    <label style="display:flex; align-items:flex-start; gap:0.5rem; background:#0f172a; padding:0.5rem 0.65rem; border-radius:0.6rem; border:1px solid #334155; margin-bottom:0.35rem; cursor:pointer;">
                        <input type="checkbox" class="swal-cotiz-email-chk" value="${emailAddr}" ${isChk ? 'checked' : ''} style="width:1.15rem; height:1.15rem; accent-color:#8b5cf6; margin-top:2px;">
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:0.78rem; font-weight:700; color:#f8fafc;">${e.nombre || 'Contacto #' + (idx+1)}</div>
                            <div style="font-size:0.74rem; color:#c084fc; word-break:break-all;">📧 ${emailAddr}</div>
                        </div>
                    </label>
                `;
            });
        }

        const etapa2Html = `
            <div style="text-align:left; font-size:0.85rem; color:#f8fafc;">
                <!-- BOTÓN COMPARTIR DIRECTO WHATSAPP NATIVO -->
                <button type="button" id="btn-swal-share-whatsapp-native" class="btn-modal-link" style="background:#059669; color:white; padding:0.65rem 1rem; border-radius:0.75rem; font-weight:800; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:0.5rem; width:100%; margin-bottom:0.85rem; font-size:0.85rem; box-shadow:0 4px 12px rgba(5,150,105,0.35);">
                    📲 Compartir por WhatsApp (Elegir Contacto)
                </button>

                <!-- 1. DESTINATARIOS WHATSAPP -->
                <div style="margin-bottom:0.75rem;">
                    <div style="font-size:0.76rem; font-weight:800; color:#34d399; text-transform:uppercase; margin-bottom:0.35rem;">
                        📱 Destinatarios WhatsApp
                    </div>
                    ${wpHtml}
                    <input type="text" id="swal-cotiz-custom-phone" placeholder="➕ Otro teléfono WhatsApp (ej: 2216615746)" class="wizard-input-mobile" style="background:#0f172a; color:white; border-color:#334155; font-size:0.76rem; padding:0.4rem 0.65rem; border-radius:0.5rem; margin-top:0.25rem;">
                </div>

                <!-- 2. DESTINATARIOS EMAIL -->
                <div style="margin-bottom:0.75rem;">
                    <div style="font-size:0.76rem; font-weight:800; color:#c084fc; text-transform:uppercase; margin-bottom:0.35rem;">
                        📧 Destinatarios Correo Electrónico
                    </div>
                    ${emailHtml}
                    <input type="email" id="swal-cotiz-custom-email" placeholder="➕ Otro email (ej: compras@cliente.com)" class="wizard-input-mobile" style="background:#0f172a; color:white; border-color:#334155; font-size:0.76rem; padding:0.4rem 0.65rem; border-radius:0.5rem; margin-top:0.25rem;">
                </div>

                <!-- 3. MENSAJE -->
                <div>
                    <label style="font-size:0.76rem; font-weight:800; color:#34d399; text-transform:uppercase; display:block; margin-bottom:0.25rem;">
                        📝 Mensaje Acompañamiento:
                    </label>
                    <textarea id="swal-cotiz-msg" rows="3" class="wizard-input-mobile" style="background:#0f172a; color:white; border-color:#334155; font-size:0.78rem; padding:0.45rem; border-radius:0.5rem; width:100%; box-sizing:border-box; resize:vertical;">${defaultMsg}</textarea>
                </div>
            </div>
        `;

        const { value: formValues } = await Swal.fire({
            title: `<div style="font-size:1.05rem; font-weight:800; color:#7c3aed;">📤 Despacho (${countSel} arts)</div>`,
            html: etapa2Html,
            background: '#1e293b',
            color: '#f8fafc',
            width: '92%',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: '🚀 Enviar (WhatsApp / Email)',
            denyButtonText: '📄 Ver PDF',
            cancelButtonText: '‹ Volver',
            confirmButtonColor: '#10b981',
            denyButtonColor: '#7c3aed',
            cancelButtonColor: '#475569',
            didOpen: () => {
                const btnNative = document.getElementById('btn-swal-share-whatsapp-native');
                if (btnNative) {
                    btnNative.onclick = async () => {
                        const customMsg = document.getElementById('swal-cotiz-msg')?.value?.trim() || defaultMsg;
                        Swal.close();
                        await this.generarYCompartirPDF(this.modoIVA, this.tituloInforme, this.modoPrecio, this.mostrarHijos, customMsg);
                    };
                }
            },
            preConfirm: () => {
                const wps = Array.from(document.querySelectorAll('.swal-cotiz-wp-chk:checked')).map(el => el.value);
                const emails = Array.from(document.querySelectorAll('.swal-cotiz-email-chk:checked')).map(el => el.value);
                const customPhone = document.getElementById('swal-cotiz-custom-phone')?.value?.trim() || '';
                const customEmail = document.getElementById('swal-cotiz-custom-email')?.value?.trim() || '';
                const msg = document.getElementById('swal-cotiz-msg')?.value?.trim() || defaultMsg;

                if (customPhone) {
                    const cleaned = customPhone.replace(/\D/g, '');
                    if (cleaned) wps.push(cleaned);
                }
                if (customEmail && customEmail.includes('@')) {
                    emails.push(customEmail);
                }

                if (wps.length === 0 && emails.length === 0 && this.esProspecto) {
                    return {
                        wps: [],
                        emails: [],
                        msg,
                        modoIva: this.modoIVA,
                        modoPrecio: this.modoPrecio,
                        mostrarHijos: this.mostrarHijos,
                        titulo: this.tituloInforme,
                        action: 'compartir_nativo'
                    };
                }

                return {
                    wps,
                    emails,
                    msg,
                    modoIva: this.modoIVA,
                    modoPrecio: this.modoPrecio,
                    mostrarHijos: this.mostrarHijos,
                    titulo: this.tituloInforme,
                    action: 'enviar'
                };
            }
        });

        // Si tocó "Ver PDF"
        if (Swal.getDenyButton() && document.activeElement === Swal.getDenyButton()) {
            await this.generarYCompartirPDF(this.modoIVA, this.tituloInforme, this.modoPrecio, this.mostrarHijos);
            return;
        }

        // Si tocó "‹ Volver", volvemos a la Etapa 1
        if (Swal.getCancelButton() && document.activeElement === Swal.getCancelButton()) {
            await this.abrirModalConfiguracionYDespacho();
            return;
        }

        if (formValues && formValues.action === 'compartir_nativo') {
            await this.generarYCompartirPDF(formValues.modoIva, formValues.titulo, formValues.modoPrecio, formValues.mostrarHijos, formValues.msg);
            return;
        }

        if (formValues && formValues.action === 'enviar') {
            await this.ejecutarDespachoOmnicanal(formValues);
        }
    },

    construirPayloadCotizacion(modoIva, titulo, modoPrecio, mostrarHijos) {
        const articulosSeleccionadosList = this.todosLosArticulos.filter(a => this.articulosSeleccionados.has(a.id));
        const incluirHijosFlag = (mostrarHijos !== false && this.mostrarHijos !== false);

        const resultadoArticulos = [];

        articulosSeleccionadosList.forEach(art => {
            // Padre principal
            const padreItem = {
                articulo_id: art.articulo_id,
                nomenclatura: art.nomenclatura,
                descripcion: art.descripcion,
                descripcion_generada: art.descripcion_generada,
                kilos_unidad: art.kilos_unidad,
                presentacion_str: art.presentacion_str,
                iva: art.iva,
                precio_bulto_final: art.precio_bulto_final,
                precio_bulto_neto: art.precio_bulto_neto,
                precio_kilo_final: art.precio_kilo_final,
                precio_kilo_neto: art.precio_kilo_neto,
                familia_nombre: art.familia_nombre,
                articulo_principal: art.articulo_principal,
                propiedades_dinamicas: art.propiedades_dinamicas,
                es_hijo: false,
                padre_id: null,
                es_pack: art.es_pack,
                pack_unidades: art.pack_unidades
            };
            resultadoArticulos.push(padreItem);

            // Derivar hijo fraccionado ÚNICAMENTE si es un PACK REAL en Búnker estructurado en base de datos
            if (incluirHijosFlag && art.es_pack === true && (parseInt(art.pack_unidades) > 1 || !!art.pack_hijo_codigo)) {
                const packUnits = parseInt(art.pack_unidades, 10) || 1;
                let hijoObjReal = null;

                if (art.pack_hijo_codigo) {
                    const keyHijo = String(art.pack_hijo_codigo).trim().toUpperCase();
                    hijoObjReal = this.todosLosArticulos.find(a => String(a.articulo_id || a.codigo).trim().toUpperCase() === keyHijo) || this.mapaBunkerPacks.get(keyHijo);
                }

                const factorKg = parseFloat(art.kilos_unidad || 1);
                const factorKgHijo = (hijoObjReal && hijoObjReal.kilos_unidad) ? parseFloat(hijoObjReal.kilos_unidad) : (factorKg / packUnits);
                const pFinalHijo = factorKgHijo * art.precio_kilo_final;
                const pNetoHijo = factorKgHijo * art.precio_kilo_neto;
                const presStrHijo = (hijoObjReal && hijoObjReal.presentacion_str) ? hijoObjReal.presentacion_str : (factorKgHijo < 1.0 ? `${Math.round(factorKgHijo * 1000)} g` : `${factorKgHijo.toFixed(2)} kg`);
                const nomHijo = (hijoObjReal && (hijoObjReal.nomenclatura || hijoObjReal.descripcion)) ? (hijoObjReal.nomenclatura || hijoObjReal.descripcion) : padreItem.nomenclatura;

                resultadoArticulos.push({
                    articulo_id: (hijoObjReal && (hijoObjReal.articulo_id || hijoObjReal.id)) ? (hijoObjReal.articulo_id || hijoObjReal.id) : `${art.articulo_id}_HIJO`,
                    nomenclatura: nomHijo,
                    descripcion: nomHijo,
                    descripcion_generada: nomHijo,
                    kilos_unidad: factorKgHijo,
                    presentacion_str: presStrHijo,
                    iva: art.iva,
                    precio_bulto_final: pFinalHijo,
                    precio_bulto_neto: pNetoHijo,
                    precio_kilo_final: art.precio_kilo_final,
                    precio_kilo_neto: art.precio_kilo_neto,
                    familia_nombre: art.familia_nombre,
                    articulo_principal: art.articulo_principal,
                    propiedades_dinamicas: art.propiedades_dinamicas,
                    es_hijo: true,
                    padre_id: art.articulo_id,
                    es_pack: false,
                    pack_unidades: 1
                });
            }
        });

        let textoPoliticaPdf = '';
        if (this.politicaCliente && this.politicaCliente.tiene_politica && !this.politicaCliente.excepcion) {
            const tramos = this.politicaCliente.politica?.tramos || [];
            if (tramos.length > 0) {
                const tramoDesc = tramos.map(t => {
                    const montoMinFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(parseFloat(t.monto_minimo));
                    return `Superando ${montoMinFmt}: ${parseFloat(t.descuento_porcentaje).toFixed(1)}% de bonificación automática`;
                }).join(' | ');
                textoPoliticaPdf = `Condición Comercial: ${tramoDesc}`;
            }
        } else {
            textoPoliticaPdf = 'Consulte por bonificaciones y escalas de descuento comercial por volumen.';
        }

        return {
            cliente_nombre: this.cliente.nombre,
            cliente_id: this.cliente.id,
            politica_texto: textoPoliticaPdf,
            whatsapp: '',
            lista_nombre: this.listaActiva.nombre,
            titulo_informe: titulo || this.tituloInforme,
            modo_iva: modoIva || this.modoIVA,
            ocultar_columna_iva: this.ocultarColumnaIVA === true,
            modo_precio: modoPrecio || this.modoPrecio || 'ambos',
            mostrar_hijos: incluirHijosFlag,
            separar_packs: false,
            agrupar_por_atributo: Array.from(this.nivelesAgrupamiento),
            articulos: resultadoArticulos
        };
    },

    async generarYCompartirPDF(modoIva, titulo, modoPrecio, mostrarHijos, customMsg) {
        Swal.fire({
            title: 'Generando PDF...',
            text: 'Preparando catálogo de precios...',
            background: '#1e293b',
            color: '#f8fafc',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            const payload = this.construirPayloadCotizacion(modoIva, titulo, modoPrecio, mostrarHijos);
            const res = await fetch('/api/logistica/bunker/cotizaciones/exportar-pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error('Error al generar PDF en el servidor');

            const blob = await res.blob();
            const fileName = `Cotizacion_${this.cliente.nombre.replace(/\s+/g, '_')}.pdf`;
            const file = new File([blob], fileName, { type: 'application/pdf' });

            Swal.close();

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: `Cotización LAMDA - ${this.cliente.nombre}`,
                    text: customMsg || (this.esProspecto ? 'Hola, te adjuntamos la cotización de precios de LAMDA.' : `Hola ${this.cliente.nombre}, te adjuntamos la cotización de precios.`),
                    files: [file]
                });
            } else {
                const objectUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = objectUrl;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(objectUrl);
            }
        } catch (err) {
            console.error('Error generando/compartiendo PDF:', err);
            Swal.fire('Atención', 'No se pudo generar o compartir el PDF: ' + err.message, 'warning');
        }
    },

    async ejecutarDespachoOmnicanal(formValues) {
        const { wps, emails, msg, modoIva, titulo, modoPrecio, mostrarHijos } = formValues;

        if (wps.length === 0 && emails.length === 0) {
            Swal.fire('Atención', 'Seleccioná al menos un número de WhatsApp o correo electrónico para enviar.', 'warning');
            return;
        }

        Swal.fire({
            title: 'Despachando Cotización...',
            text: 'Generando PDF oficial y enviando por WhatsApp/Email...',
            background: '#1e293b',
            color: '#f8fafc',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            // 1. Generar PDF en Base64
            const payload = this.construirPayloadCotizacion(modoIva, titulo, modoPrecio, mostrarHijos);
            const resPdf = await fetch('/api/logistica/bunker/cotizaciones/exportar-pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!resPdf.ok) throw new Error('Fallo al generar el PDF de cotización');

            const pdfBlob = await resPdf.blob();
            const arrayBuffer = await pdfBlob.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const pdfBase64Data = btoa(binary);

            const cleanNombre = this.cliente.nombre.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');
            const filename = `Cotizacion_${cleanNombre}.pdf`;

            let enviadoWp = false;

            // 2. Despacho a WhatsApp
            if (wps.length > 0) {
                const resWp = await fetch('/api/facturacion/whatsapp/enviar-documento', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        destinatarios: wps.join(', '),
                        pdfBase64: pdfBase64Data,
                        filename: filename,
                        mensajeTexto: msg
                    })
                });

                if (resWp.ok) {
                    const dataWp = await resWp.json();
                    if (dataWp.success) enviadoWp = true;
                }
            }

            Swal.fire({
                title: '¡Cotización Despachada!',
                html: `
                    <div style="font-size:0.9rem; color:#cbd5e1; text-align:left;">
                        <p>✅ <strong>PDF adjunto enviado exitosamente</strong> a los destinatarios:</p>
                        ${wps.length > 0 ? `<p style="color:#34d399;">📱 WhatsApp: ${wps.join(', ')}</p>` : ''}
                        ${emails.length > 0 ? `<p style="color:#c084fc;">📧 Correo: ${emails.join(', ')}</p>` : ''}
                    </div>
                `,
                icon: 'success',
                background: '#1e293b',
                color: '#f8fafc',
                confirmButtonText: 'Volver a Clientes',
                confirmButtonColor: '#10b981'
            }).then(() => {
                window.location.href = 'clientes.html';
            });

        } catch (err) {
            console.error('Error al despachar cotización:', err);
            Swal.fire('Error de Despacho', 'No se pudo completar el envío: ' + err.message, 'error');
        }
    }
};
