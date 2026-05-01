/**
 * Controlador Exclusivo para el Cajero Móvil / Wizard Comercial
 * Archivo: PresupuestosWizard.js
 */

const WizardController = {
    step: 1,
    cart: {
        cliente: null,
        items: {}, // key: id_articulo, value: {id, nombre, precio, cantidad}
        observaciones: "",
        tipo: 'venta'
    },
    
    // Almacenamiento temporal para busquedas (debouncing y abort controllers)
    timerBusquedaCliente: null,
    timerBusquedaArticulo: null,
    abortControllerClientes: null,
    abortControllerArticulos: null,

    async init() {
        // [NUEVO] Fase 33: Detección de Modo Edición ANTES del pushState limpiador
        const params = new URLSearchParams(window.location.search);
        const editId = params.get('edit');

        // Interceptar barra de retroceso del navegador (Hardware Back Button)
        if (window.history && window.history.pushState) {
            // Preservar la URL real para evitar que se borre el ?edit si se recarga la página
            window.history.pushState('forward', null, window.location.href);
            window.onpopstate = function () {
                WizardController.wizardBack();
            };
        }

        this.bindEvents();

        if(editId) {
            await this.cargarPresupuestoParaEdicion(editId);
        }
    },

    async cargarPresupuestoParaEdicion(id) {
        try {
            document.getElementById('full-loader').classList.remove('hidden'); 
            
            // 1. Obtener Cabecera
            const resHeader = await fetch(`/api/presupuestos/${id}`, {
                headers: { 'Authorization': `Bearer ${state.sesion.token}` }
            });
            const dataHeader = await resHeader.json();
            
            if(!dataHeader.success || !dataHeader.data) throw new Error("No se encontró el original");
            const cabecera = dataHeader.data;
            
            // 2. Obtener Detalles
            const resDetalles = await fetch(`/api/presupuestos/${id}/detalles`, {
                headers: { 'Authorization': `Bearer ${state.sesion.token}` }
            });
            const dataDetalles = await resDetalles.json();
            
            if(!dataDetalles.success || !dataDetalles.data) throw new Error("Fallo en detalles");
            
            const itemsArray = Array.isArray(dataDetalles.data) ? dataDetalles.data : (dataDetalles.data.detalles || []);
            
            // 3. Hidratacion de Estado
            this.cart.editId = id; 
            this.cart.cliente = {
                id: cabecera.id_cliente,
                nombre: cabecera.cliente_nombre || cabecera.concepto || 'Desconocido',
                condicion_iva: cabecera.condicion_iva || ''
            };
            
            // 4. Inyección Visual
            document.getElementById('observaciones-input').value = cabecera.nota || '';
            const dropEstado = document.getElementById('estado-input');
            if(dropEstado && cabecera.estado) dropEstado.value = cabecera.estado;
            
            const txtDescuento = document.getElementById('descuento-input');
            if(txtDescuento && cabecera.descuento) {
                // BUGFIX: El backend devuelve en formato escalar (0.05), el UI espera porcentual (5)
                txtDescuento.value = (parseFloat(cabecera.descuento) * 100).toString().replace('.', ',');
            }
            
            // 5. Hidratar Artículos
            itemsArray.forEach(item => {
                const arrId = item.articulo;
                this.cart.items[arrId] = {
                    id: arrId,
                    nombre: item.descripcion || item.descripcion_articulo || item.articulo,
                    precio: parseFloat(item.valor1 || 0), 
                    cantidad: Math.abs(parseFloat(item.cantidad || 0)),
                    // FIX BUG: item.iva1 contiene el MONTO del impuesto. Usamos camp2 (alícuota base o 0.21)
                    iva_pct: item.camp2 ? (parseFloat(item.camp2) < 1 ? parseFloat(item.camp2) * 100 : parseFloat(item.camp2)) : 21 
                };
            });
            
            document.getElementById('full-loader').classList.add('hidden');
            this.avanzarPaso(2); // Salto Directo a Catálogo
            
            // Re-render del catálogo
            const listContainer = document.getElementById('resultados-articulo');
            if (listContainer) {
                listContainer.innerHTML = '';
                for (const arrId in this.cart.items) {
                    const item = this.cart.items[arrId];
                    const card = document.createElement('div');
                    card.className = 'card-articulo';
                    // Tap over div logic (+1)
                    card.onclick = () => window.WizardController.modificarCantidad(arrId, 1);
                    
                    card.innerHTML = `
                        <div class="articulo-info">
                            <span class="articulo-nombre">${item.nombre} <br><small style="color:#94a3b8; font-weight:normal;">Cod: ${arrId}</small></span>
                            <span class="articulo-precio">$${parseFloat(item.precio || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}</span>
                        </div>
                        <div class="articulo-actions">
                            <button class="stepper-btn btn-minus" onclick="event.stopPropagation(); window.WizardController.modificarCantidad('${arrId}', -1)">-</button>
                            <span class="stepper-qty" id="qty-${arrId}" data-id="${arrId}">${item.cantidad}</span>
                        </div>
                    `;
                    listContainer.appendChild(card);
                }
            }
            this.renderCarritoFlotante();

        } catch(e) {
            document.getElementById('full-loader').classList.add('hidden');
            console.error(e);
            Swal.fire('Error', 'No se pudo recuperar Presupuesto: ' + e.message, 'error').then(()=> {
                window.location.href = 'presupuestos.html';
            });
        }
    },

    bindEvents() {
        const inputCliente = document.getElementById('buscar-cliente-input');
        if(inputCliente) {
            inputCliente.addEventListener('input', (e) => {
                clearTimeout(this.timerBusquedaCliente);
                const query = e.target.value;
                if(query.length >= 3) {
                    this.timerBusquedaCliente = setTimeout(() => this.buscarClientesAPI(query), 350);
                } else {
                    document.getElementById('resultados-cliente').innerHTML = '<div class="placeholder-msg">Escribí al menos 3 letras para buscar...</div>';
                }
            });
        }

        const inputArticulo = document.getElementById('buscar-articulo-input');
        if(inputArticulo) {
            inputArticulo.addEventListener('input', (e) => {
                const query = e.target.value;
                console.log(`[VIGÍA] Evento input de artículo detectado. Valor: "${query}"`);
                
                // Mostrar/Ocultar botón X
                const btnClear = document.getElementById('btn-clear-articulo');
                if (btnClear) {
                    btnClear.style.display = query.length > 0 ? 'flex' : 'none';
                }

                clearTimeout(this.timerBusquedaArticulo);
                
                // REQUERIMIENTO ESTRICTO: Solo disparar si contiene un espacio
                if(!query.includes(' ')) {
                    console.log(`[VIGÍA] Búsqueda bloqueada: No se detectó ESPACIO en el input "${query}"`);
                    if (this.abortControllerArticulos) {
                        this.abortControllerArticulos.abort();
                        this.abortControllerArticulos = null;
                        console.log(`[VIGÍA] Petición asíncrona abortada por regla de espaciador.`);
                    }
                    const contenedor = document.getElementById('resultados-articulo');
                    if(contenedor) {
                        contenedor.innerHTML = '<div class="placeholder-msg">Escriba y presione ESPACIO para buscar...</div>';
                    }
                    return;
                }

                console.log(`[VIGÍA] Espaciador detectado. Iniciando timer de debounce (350ms) para "${query}"`);
                this.timerBusquedaArticulo = setTimeout(() => this.buscarArticulosAPI(query), 350);
            });
        }
    },

    limpiarInputArticulo() {
        console.log(`[VIGÍA] Ejecutando comando cero absoluto (limpiarInputArticulo)`);
        const input = document.getElementById('buscar-articulo-input');
        if (input) {
            input.value = '';
            input.focus();
        }
        const btnClear = document.getElementById('btn-clear-articulo');
        if (btnClear) {
            btnClear.style.display = 'none';
        }
        if (this.abortControllerArticulos) {
            this.abortControllerArticulos.abort();
            this.abortControllerArticulos = null;
            console.log(`[VIGÍA] Operaciones en red canceladas post-limpieza.`);
        }
        const contenedor = document.getElementById('resultados-articulo');
        if (contenedor) {
            contenedor.innerHTML = '<div class="placeholder-msg">Escriba y presione ESPACIO para buscar...</div>';
        }
    },

    // ============================
    // NAVEGACIÓN
    // ============================
    wizardBack() {
        if(this.step > 1) {
            this.avanzarPaso(this.step - 1);
        } else {
            // Regresar al Panel
            window.location.href = 'presupuestos.html';
        }
    },

    avanzarPaso(numero) {
        if(numero === 2 && !this.cart.cliente) {
            alert("Debe seleccionar un cliente primero.");
            return;
        }
        if(numero === 3 && Object.keys(this.cart.items).length === 0) {
            alert("Debe agregar al menos un artículo.");
            return;
        }

        // Ocultar todos
        document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active-step'));
        // Mostrar objetivo
        document.getElementById(`step-${numero}`).classList.add('active-step');
        
        // Actualizar UI Header
        this.step = numero;
        document.getElementById('wizard-progress').style.width = `${numero * 33.33}%`;
        document.getElementById('wizard-step-indicator').innerText = `${numero}/3`;
        
        const titulos = ["", "Paso 1: Cliente", "Paso 2: Productos", "Paso 3: Checkout"];
        document.getElementById('wizard-title').innerText = titulos[numero];

        // Preparar vistas
        if(numero === 2) {
            document.getElementById('label-cliente-seleccionado').innerText = this.cart.cliente.nombre;
            if(Object.keys(this.cart.items).length === 0) {
                console.log(`[VIGÍA] Previniendo Anomalía 1: Se bloquea la búsqueda fantasma automática al cargar el Paso 2.`);
                const contenedor = document.getElementById('resultados-articulo');
                if (contenedor) {
                    contenedor.innerHTML = '<div class="placeholder-msg">Escriba un producto y presione ESPACIO para buscar.</div>';
                }
            }
        }
        if(numero === 3) {
            this.renderCheckout();
        }
    },

    cancelarWizard() {
        if(confirm("¿Seguro que desea cancelar la operación actual?")) {
            window.location.href = 'presupuestos.html';
        }
    },

    // ============================
    // API & DATOS: CLIENTES
    // ============================
    async buscarClientesAPI(query) {
        if (this.abortControllerClientes) {
            this.abortControllerClientes.abort(); // Cancelar petición letal pendiente
        }
        this.abortControllerClientes = new AbortController();
        const signal = this.abortControllerClientes.signal;

        const contenedor = document.getElementById('resultados-cliente');
        contenedor.innerHTML = '<div class="placeholder-msg">Buscando...</div>';
        
        try {
            const res = await fetch(`/api/presupuestos/clientes/sugerencias?q=${encodeURIComponent(query)}`, { signal });
            const data = await res.json();
            
            if(data.success && data.data.length > 0) {
                contenedor.innerHTML = '';
                data.data.forEach(c => {
                    const card = document.createElement('div');
                    card.className = 'card-cliente';
                    card.innerHTML = `
                        <div>
                            <span class="cliente-nombre">${c.nombre}</span>
                            <span class="cliente-id">Cód: ${c.id}</span>
                        </div>
                        <div style="font-size:1.5rem">→</div>
                    `;
                    card.onclick = () => this.seleccionarCliente(c);
                    contenedor.appendChild(card);
                });
            } else {
                contenedor.innerHTML = '<div class="placeholder-msg">No se encontraron resultados.</div>';
            }
        } catch(e) {
            if (e.name === 'AbortError') {
                console.log('Búsqueda de clientes abortada: Prevención de Carrera');
                return;
            }
            console.error(e);
            contenedor.innerHTML = '<div class="placeholder-msg" style="color:red">Error de conexión.</div>';
        }
    },

    seleccionarCliente(cliente) {
        this.cart.cliente = cliente;
        this.avanzarPaso(2);
    },

    // ============================
    // API & DATOS: ARTÍCULOS
    // ============================
    async buscarArticulosAPI(query) {
        console.log(`[VIGÍA] INICIO buscarArticulosAPI. Query ingresado: "${query}"`);
        if (this.abortControllerArticulos) {
            console.log(`[VIGÍA] Petición anterior en curso abortada para dar prioridad a la nueva.`);
            this.abortControllerArticulos.abort(); // Cancelar la cascada paralela anterior
        }
        this.abortControllerArticulos = new AbortController();
        const signal = this.abortControllerArticulos.signal;

        const contenedor = document.getElementById('resultados-articulo');
        const qRaw = (query || '').trim();
        
        // --- INICIO LÓGICA DE CACHÉ EN RAM PARA EVITAR LATENCIA MÓVIL ---
        window.__articulosSearchCache = window.__articulosSearchCache || {};
        
        // Función portearada desde presupuestosCreate.js para Parity de Filtrado Inteligente
        const normalizarTexto = (texto) => {
            return (texto || '').toString().toLowerCase()
                .replace(/[áäâà]/g, 'a')
                .replace(/[éëêè]/g, 'e')
                .replace(/[íïîì]/g, 'i')
                .replace(/[óöôò]/g, 'o')
                .replace(/[úüûù]/g, 'u')
                .replace(/ñ/g, 'n');
        };

        const terms = normalizarTexto(qRaw).split(/\s+/).filter(Boolean);
        const queryParaServidor = terms[0] || ''; // El primer término es el que se envió al servidor
        const queryLower = qRaw.toLowerCase();
        
        let dataServidor = null;
        let vieneDeCache = false;

        // 1. EVALUAR CACHÉ (Evitamos Spinner DOM y FETCH)
        if (queryParaServidor && window.__articulosSearchCache[queryParaServidor]) {
            console.log(`[VIGÍA] RAM HIT: El término base "${queryParaServidor}" ya está en caché. Sub-filtrado local instantáneo.`);
            dataServidor = window.__articulosSearchCache[queryParaServidor];
            vieneDeCache = true;
        } else {
            // 2. FETCH AL SERVIDOR (Solo para el primer término antes del espacio)
            contenedor.innerHTML = '<div class="loader-spinner" style="margin:2rem auto"></div><p style="text-align:center; color:#64748b">Buscando en catálogo...</p>';
            try {
                const offset = qRaw.length === 0 ? 15 : 150; 
                
                console.log(`[VIGÍA] Lanzando petición FETCH al servidor backend con base "${queryParaServidor}" (limit=${offset})...`);
                const res = await fetch(`/api/presupuestos/articulos/sugerencias?q=${encodeURIComponent(queryParaServidor)}&limit=${offset}&cliente_id=${this.cart.cliente.id}`, { signal });
                const data = await res.json();
                console.log(`[VIGÍA] Respuesta del servidor recibida. Éxito: ${data.success}, Elementos: ${data.data ? data.data.length : 0}`);
                
                if (data.success && data.data) {
                    dataServidor = data.data;
                    // Guardar en caché el resultado base
                    if (queryParaServidor) {
                        window.__articulosSearchCache[queryParaServidor] = dataServidor;
                    }
                }
            } catch(e) {
                if (e.name === 'AbortError') {
                    console.log('Búsqueda de artículos abortada: Fast-Typing detectado');
                    return;
                }
                console.error(e);
                contenedor.innerHTML = '<div class="placeholder-msg" style="color:red">Error consultando catálogo.</div>';
                return;
            }
        }

        // 3. SUB-FILTRADO LOCAL EN RAM Y RENDERIZADO
        if (dataServidor) {
            let articulosFiltrados = dataServidor;

            // Doble chequeo en RAM (opcional pero hace que el tecleo sea instantáneo)
            if (terms.length > 0) {
                articulosFiltrados = dataServidor.filter(a => {
                    const descNormalizada = normalizarTexto(a.descripcion || a.nombre || '');
                    // Búsqueda de sufijos espaciados estricta
                    const cumpleDescripcion = terms.every(t => descNormalizada.includes(t));
                    
                    // O bien match directo de ID/Barcode corto
                    const codigo = (a.numero || a.codigo_barras || '').toString().toLowerCase();
                    const cumpleCodigo = codigo.includes(queryLower);
                    
                    return cumpleDescripcion || cumpleCodigo;
                });
            }

            if(articulosFiltrados.length > 0) {
                contenedor.innerHTML = '';
                // Limitamos el render a top 40 para no saturar DOM móvil, de todos modos el Typeahead se achica
                const renders = articulosFiltrados.slice(0, 40);

                renders.forEach(a => {
                    const fallBckId = a.codigo_articulo || a.numero || a.codigo_barras;
                    const qtyActual = this.cart.items[fallBckId] ? this.cart.items[fallBckId].cantidad : 0;
                    
                    const card = document.createElement('div');
                    card.className = 'card-articulo';
                    card.onclick = () => WizardController.actualizarCantidad(a, 1);
                    const jsonSafe = JSON.stringify(a).replace(/"/g, '&quot;');
                    
                    card.innerHTML = `
                        <div class="articulo-info">
                            <span class="articulo-nombre">${a.descripcion || a.nombre} <br><small style="color:#94a3b8; font-weight:normal;">Cod: ${fallBckId} &nbsp;|&nbsp; <strong>Stock: ${Math.floor(a.stock_actual || 0)}</strong></small></span>
                            <span class="articulo-precio">$${parseFloat(a.precio_venta || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}</span>
                        </div>
                        <div class="articulo-actions">
                            <button class="stepper-btn btn-minus" onclick='event.stopPropagation(); WizardController.actualizarCantidad(${jsonSafe}, -1)'>-</button>
                            <span class="stepper-qty" id="qty-${fallBckId}">${qtyActual}</span>
                        </div>
                    `;
                    contenedor.appendChild(card);
                });
            } else {
                contenedor.innerHTML = '<div class="placeholder-msg">El artículo no se encuentra en el inventario activo.</div>';
            }
        } else {
            contenedor.innerHTML = '<div class="placeholder-msg">Sin resultados.</div>';
        }
    },

    actualizarCantidad(producto, delta) {
        const id = producto.codigo_articulo || producto.numero || producto.codigo_barras;
        if(!this.cart.items[id]) {
            if(delta < 0) return; // No se puede bajar de 0
            
            // Extracción robusta de IVA y Fallback Seguro
            let ivaDetectado = 21;
            if (producto.iva !== undefined && producto.iva !== null && producto.iva !== '') {
                const parsedIva = parseFloat(producto.iva);
                if (parsedIva > 0 && parsedIva < 1) ivaDetectado = parsedIva * 100;
                else ivaDetectado = parsedIva;
            } else if (producto.alicuota_iva !== undefined && producto.alicuota_iva !== null && producto.alicuota_iva !== '') {
                const parsedAli = parseFloat(producto.alicuota_iva);
                if (parsedAli > 0 && parsedAli < 1) ivaDetectado = parsedAli * 100;
                else ivaDetectado = parsedAli;
            } else if (producto.camp2) {
                const parsedCamp = parseFloat(producto.camp2);
                if (parsedCamp < 1) ivaDetectado = parsedCamp * 100;
                else ivaDetectado = parsedCamp;
            }
            if (isNaN(ivaDetectado) || ivaDetectado < 0) {
                console.warn(`[WARNING] IVA inválido para artículo ${id}, fallback a 21%`);
                ivaDetectado = 21;
            }

            this.cart.items[id] = {
                id: id,
                numero: id,
                nombre: producto.descripcion || producto.nombre,
                precio: parseFloat(producto.precio_venta || 0),
                cantidad: 0,
                iva_pct: ivaDetectado
            };
        }

        const newQty = this.cart.items[id].cantidad + delta;
        if(newQty <= 0) {
            delete this.cart.items[id];
            document.getElementById(`qty-${id}`).innerText = "0";
        } else {
            this.cart.items[id].cantidad = newQty;
            document.getElementById(`qty-${id}`).innerText = newQty;
        }

        this.renderCarritoFlotante();
    },

    modificarCantidad(idArticulo, delta) {
        // [NUEVO] Handler exclusivo para los ítems re-hidratados desde una Edición
        if(!this.cart.items[idArticulo]) {
            console.warn("Item no hallado en RAM para mutación rápida");
            return;
        }

        const newQty = this.cart.items[idArticulo].cantidad + delta;
        if(newQty <= 0) {
            delete this.cart.items[idArticulo];
            // Eliminación visual definitiva del nodo HTML para evitar confusiones de interfaz
            const display = document.getElementById(`qty-${idArticulo}`);
            if(display) {
                const domCard = display.closest('.card-articulo');
                if(domCard) domCard.remove();
            }
        } else {
            this.cart.items[idArticulo].cantidad = newQty;
            const display = document.getElementById(`qty-${idArticulo}`);
            if(display) display.innerText = newQty;
        }

        this.renderCarritoFlotante();
    },

    renderCarritoFlotante() {
        let itemsCount = 0;
        let totalPesos = 0;

        for(let key in this.cart.items) {
            const p = this.cart.items[key];
            itemsCount += p.cantidad;
            totalPesos += (p.cantidad * p.precio);
        }

        document.getElementById('cart-qty').innerText = `${itemsCount} ítems seleccionados`;
        document.getElementById('cart-total').innerText = `$ ${totalPesos.toLocaleString('es-AR', {minimumFractionDigits:2})}`;
    },

    // ============================
    // CHECKOUT Y CONFIRMACIÓN
    // ============================
    renderCheckout() {
        document.getElementById('ticket-cliente').innerText = this.cart.cliente.nombre;
        const lista = document.getElementById('ticket-items-lista');
        
        // Conservar el DOM renderizado optimizadamente (sólo repintar lista la primera vez si es estática)
        lista.innerHTML = '';
        
        const condIva = (this.cart.cliente.condicion_iva || '').toLowerCase();
        const isRI = condIva.includes('responsable inscripto');

        let totalNetoBase = 0;
        let totalTotalizadorIVA = 0; // Agrupa todas las alícuotas
        let iva21Total = 0; 
        let iva105Total = 0;

        // Leemos porcentaje de descuento para la distribución
        // BUGFIX Soporte Coma: reemplazar coma por punto previo al casteo
        const descRaw = document.getElementById('descuento-input').value.replace(',', '.');
        const descInput = parseFloat(descRaw) || 0;
        const descuentoDecimal = descInput / 100;

        for(let key in this.cart.items) {
            const p = this.cart.items[key];
            const subtotalNeto = p.cantidad * p.precio;
            totalNetoBase += subtotalNeto;

            // Extraemos IVA específico del ítem (Fallback 21% por seguridad)
            const ivaItem = p.iva_pct !== undefined ? p.iva_pct : 21;
            const ivaMultiplicador = 1 + (ivaItem / 100);

            const row = document.createElement('div');
            row.className = 'ticket-row';
            
            // Presentación Visual Filas: En A es Neto, en B mostramos el unitario IVA incluido según su propia alícuota.
            const precioMostrar = isRI ? p.precio : (p.precio * ivaMultiplicador);
            const subtotalMostrar = isRI ? subtotalNeto : (subtotalNeto * ivaMultiplicador);
            
            row.innerHTML = `
                <span>${p.cantidad}x ${p.nombre}</span>
                <span style="font-weight:bold">$${subtotalMostrar.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
            `;
            lista.appendChild(row);

            // === ACUMULADORES IMPOSITIVOS POR FILA ===
            // Calculamos el descuento proporcional a esta fila para la Base Imponible
            const baseLinea = subtotalNeto * (1 - descuentoDecimal);
            const ivaLinea = baseLinea * (ivaItem / 100);

            if (Math.abs(ivaItem - 10.5) < 0.1) {
                iva105Total += ivaLinea;
            } else {
                iva21Total += ivaLinea; // Por defecto recae en 21%
            }

            totalTotalizadorIVA += ivaLinea;
        }

        // --- Cálculos Dinámicos Financieros (Precisión 2 decimales) ---
        const descNeto = totalNetoBase * descuentoDecimal;
        const subtotalNetoConDesc = totalNetoBase - descNeto;
        const totalFinal = subtotalNetoConDesc + totalTotalizadorIVA;

        const rowSubtotal = document.getElementById('row-subtotal');
        const rowSubDesc = document.getElementById('row-subtotal-desc');
        const rowIva = document.getElementById('row-iva');

        if (isRI) {
            // Discriminar IVA (Simulación Factura A)
            rowSubtotal.style.display = 'flex';
            rowSubDesc.style.display = 'flex';
            rowIva.style.display = 'flex';
            
            document.getElementById('row-subtotal').querySelector('span').innerText = 'Subtotal Neto (Sin IVA)';
            document.getElementById('row-subtotal-desc').querySelector('span').innerText = `Subtotal c/Desc (${descInput}%)`;

            document.getElementById('ticket-subtotal-neto').innerText = `$ ${totalNetoBase.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
            document.getElementById('ticket-subtotal-desc').innerText = `$ ${subtotalNetoConDesc.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
            document.getElementById('ticket-iva').innerText = `$ ${totalTotalizadorIVA.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
        } else {
            // Factura B (Consumidor Final, Monotributista) - El IVA va integrado
            rowSubtotal.style.display = 'flex';
            rowSubDesc.style.display = 'flex';
            rowIva.style.display = 'none';

            // Base Bruto Original sumando cada elemento con su respectivo multiplicador
            let totalBrutoBaseOriginal = 0;
            for(let key in this.cart.items) {
                const px = this.cart.items[key];
                const multi = 1 + ((px.iva_pct !== undefined ? px.iva_pct : 21) / 100);
                totalBrutoBaseOriginal += px.cantidad * px.precio * multi;
            }

            document.getElementById('row-subtotal').querySelector('span').innerText = 'Subtotal (Bruto)';
            document.getElementById('row-subtotal-desc').querySelector('span').innerText = `Subtotal c/Desc (${descInput}%)`;

            document.getElementById('ticket-subtotal-neto').innerText = `$ ${totalBrutoBaseOriginal.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
            document.getElementById('ticket-subtotal-desc').innerText = `$ ${totalFinal.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`; // Final contiene neto descontado + IVA descontado
        }

        document.getElementById('ticket-total-final').innerText = `$ ${totalFinal.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    },

    async confirmarVenta() {
        if (this.isSubmitting) {
            console.warn('[VIGÍA] Intento de múltiple sumisión bloqueado.');
            return;
        }
        
        const btnConfirm = document.getElementById('btn-confirmar-venta');
        if (btnConfirm) {
            btnConfirm.disabled = true;
            btnConfirm.style.opacity = '0.5';
            btnConfirm.innerText = '⏳ PROCESANDO...';
        }
        
        this.isSubmitting = true;

        const isOrdenRetiro = false; // Parche Arquitectura: Este wizard ya es exclusivamente de Venta
        const obs = document.getElementById('observaciones-input').value.trim();
        const estadoSeleccionado = document.getElementById('estado-input').value;
        
        // BUGFIX: Parsear coma a punto, y luego dividir por 100 (conversión inversa) al grabar
        const descuentoRaw = document.getElementById('descuento-input').value.replace(',', '.');
        const descuentoVisual = parseFloat(descuentoRaw) || 0;
        const descuentoInputFormateado = descuentoVisual / 100;

        // Armar Payload 100% Data-Parity con Desktop para evitar inserciones Null/Consumidor Final
        const hoy = new Date().toISOString().split('T')[0];
        
        const payload = {
            id_cliente: String(this.cart.cliente.id),
            fecha: hoy,
            fecha_entrega: hoy,
            agente: state.sesion.usuario || 'Cajero Móvil',
            tipo_comprobante: isOrdenRetiro ? 'Orden de Tratamiento' : 'Factura',
            estado: isOrdenRetiro ? 'Orden de Tratamiento' : estadoSeleccionado,
            estado_logistico: isOrdenRetiro ? 'ESPERANDO_MOSTRADOR' : 'SIN_ESTADO',
            informe_generado: 'Pendiente',
            nota: obs,
            punto_entrega: 'Mostrador / Automático (Móvil)',
            descuento: descuentoInputFormateado,
            secuencia: 'Imprimir',
            detalles: []
        };

        for(let key in this.cart.items) {
            const neto = this.cart.items[key].precio; // La BD escupe neto
            const ivaItemPct = this.cart.items[key].iva_pct !== undefined ? this.cart.items[key].iva_pct : 21;
            const bruto = neto * (1 + (ivaItemPct / 100));
            
            payload.detalles.push({
                articulo: this.cart.items[key].id.toString(), // El back exige el nro o barcode
                cantidad: parseFloat(this.cart.items[key].cantidad),
                valor1: parseFloat(neto.toFixed(2)),
                iva1: parseFloat(ivaItemPct), // Transmisión dinámica e intacta de la alícuota (ej: 21, 10.5)
                precio1: parseFloat(bruto.toFixed(2)) // Desktop envia el valor_final_unitario como precio1
            });
        }

        // Mostrar Loader
        document.getElementById('full-loader').classList.remove('hidden');

        try {
            const isEdit = !!this.cart.editId;
            const endpointUrl = isEdit ? `/api/presupuestos/${this.cart.editId}` : `/api/presupuestos`;
            const methodHttp = isEdit ? 'PUT' : 'POST';

            const response = await fetch(endpointUrl, {
                method: methodHttp,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.sesion.token}`
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            
            // Ocultar Loader
            document.getElementById('full-loader').classList.add('hidden');

            if(data.success || data.presupuestoId || data.data) {
                // Notificación Nativa Swal
                const titleSuccess = isEdit ? 'Edición Exitosa' : 'Operación Exitosa';
                const idGenerado = data.presupuestoId || (data.data && data.data.id) || this.cart.editId || 'Desconocido';
                
                if (btnConfirm) {
                    btnConfirm.innerText = '✅ GUARDADO';
                }

                Swal.fire({
                    icon: 'success',
                    title: titleSuccess,
                    text: `El documento fiscal guardado bajo el N° ${idGenerado}`,
                    confirmButtonText: 'Aceptar',
                    confirmButtonColor: '#2563eb',
                    allowOutsideClick: false, // Prevención de doble click accidental
                    allowEscapeKey: false
                }).then(() => {
                    window.location.href = 'presupuestos.html';
                });
            } else {
                this.isSubmitting = false;
                if (btnConfirm) {
                    btnConfirm.disabled = false;
                    btnConfirm.style.opacity = '1';
                    btnConfirm.innerText = '🚀 REINTENTAR';
                }
                Swal.fire('Error del Servidor', "Ocurrió un defecto al guardar: " + (data.error || "Desconocido"), 'error');
            }

        } catch(e) {
            this.isSubmitting = false;
            document.getElementById('full-loader').classList.add('hidden');
            if (btnConfirm) {
                btnConfirm.disabled = false;
                btnConfirm.style.opacity = '1';
                btnConfirm.innerText = '🚀 REINTENTAR VENTA';
            }
            console.error(e);
            Swal.fire({
                icon: 'warning',
                title: 'Fallo de Conexión',
                text: "No se pudo recibir respuesta del servidor. Si sufriste un microcorte, EL PRESUPUESTO PODRÍA ESTAR GUARDADO. Por favor, verifica en la lista principal antes de volver a enviarlo para evitar duplicados.",
                confirmButtonText: 'Entendido'
            });
        }
    }
};

// Exponer de forma global para eventos en duro (HTML DOM onclick)
window.WizardController = WizardController;
window.avanzarPaso = (n) => WizardController.avanzarPaso(n);
window.wizardBack = () => WizardController.wizardBack();
window.cancelarWizard = () => WizardController.cancelarWizard();
window.confirmarVenta = () => WizardController.confirmarVenta();
window.limpiarInputArticulo = () => WizardController.limpiarInputArticulo();
