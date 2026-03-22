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
    
    // Almacenamiento temporal para busquedas (debouncing)
    timerBusqueda: null,

    init() {
        // Interceptar barra de retroceso del navegador (Hardware Back Button)
        if (window.history && window.history.pushState) {
            window.history.pushState('forward', null, './crear-presupuesto-movil.html');
            window.onpopstate = function () {
                WizardController.wizardBack();
            };
        }

        this.bindEvents();
        this.renderStep();
    },

    bindEvents() {
        const inputCliente = document.getElementById('buscar-cliente-input');
        if(inputCliente) {
            inputCliente.addEventListener('input', (e) => {
                clearTimeout(this.timerBusqueda);
                const query = e.target.value;
                if(query.length >= 3) {
                    this.timerBusqueda = setTimeout(() => this.buscarClientesAPI(query), 500);
                } else {
                    document.getElementById('resultados-cliente').innerHTML = '<div class="placeholder-msg">Escribí al menos 3 letras para buscar...</div>';
                }
            });
        }

        const inputArticulo = document.getElementById('buscar-articulo-input');
        if(inputArticulo) {
            inputArticulo.addEventListener('input', (e) => {
                clearTimeout(this.timerBusqueda);
                const query = e.target.value;
                if(query.length >= 2) {
                    this.timerBusqueda = setTimeout(() => this.buscarArticulosAPI(query), 500);
                }
            });
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
                this.buscarArticulosAPI(''); // Carga inicial sugerida
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
        const contenedor = document.getElementById('resultados-cliente');
        contenedor.innerHTML = '<div class="placeholder-msg">Buscando...</div>';
        
        try {
            const res = await fetch(`${API_BASE_URL}/api/presupuestos/clientes/sugerencias?q=${encodeURIComponent(query)}`);
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
        const contenedor = document.getElementById('resultados-articulo');
        contenedor.innerHTML = '<div class="loader-spinner" style="margin:2rem auto"></div><p style="text-align:center; color:#64748b">Buscando en catálogo...</p>';
        const qRaw = (query || '').trim();

        try {
            // El backend ya tiene búsqueda por Token (AND). Enviamos la query completa
            const offset = qRaw.length === 0 ? 15 : 150; 
            
            const res = await fetch(`${API_BASE_URL}/api/presupuestos/articulos/sugerencias?q=${encodeURIComponent(qRaw)}&limit=${offset}`);
            const data = await res.json();
            
            if(data.success && data.data) {
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
                const queryLower = qRaw.toLowerCase();
                
                let articulosFiltrados = data.data;

                // Doble chequeo en RAM (opcional pero hace que el tecleo sea instantáneo)
                if (terms.length > 0) {
                    articulosFiltrados = data.data.filter(a => {
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
                        const jsonSafe = JSON.stringify(a).replace(/"/g, '&quot;');
                        
                        card.innerHTML = `
                            <div class="articulo-info">
                                <span class="articulo-nombre">${a.descripcion || a.nombre} <br><small style="color:#94a3b8; font-weight:normal;">Cod: ${fallBckId} &nbsp;|&nbsp; <strong>Stock: ${Math.floor(a.stock_actual || 0)}</strong></small></span>
                                <span class="articulo-precio">$${parseFloat(a.precio_venta || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}</span>
                            </div>
                            <div class="articulo-actions">
                                <button class="stepper-btn btn-minus" onclick='WizardController.actualizarCantidad(${jsonSafe}, -1)'>-</button>
                                <span class="stepper-qty" id="qty-${fallBckId}">${qtyActual}</span>
                                <button class="stepper-btn btn-plus" onclick='WizardController.actualizarCantidad(${jsonSafe}, 1)'>+</button>
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
        } catch(e) {
            console.error(e);
            contenedor.innerHTML = '<div class="placeholder-msg" style="color:red">Error consultando catálogo.</div>';
        }
    },

    actualizarCantidad(producto, delta) {
        const id = producto.codigo_articulo || producto.numero || producto.codigo_barras;
        if(!this.cart.items[id]) {
            if(delta < 0) return; // No se puede bajar de 0
            this.cart.items[id] = {
                id: id,
                numero: id,
                nombre: producto.descripcion || producto.nombre,
                precio: parseFloat(producto.precio_venta || 0),
                cantidad: 0
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
        lista.innerHTML = '';
        
        let total = 0;
        for(let key in this.cart.items) {
            const p = this.cart.items[key];
            const subtotal = p.cantidad * p.precio;
            total += subtotal;

            const row = document.createElement('div');
            row.className = 'ticket-row';
            row.innerHTML = `
                <span>${p.cantidad}x ${p.nombre}</span>
                <span style="font-weight:bold">$${subtotal.toLocaleString('es-AR', {minimumFractionDigits:2})}</span>
            `;
            lista.appendChild(row);
        }

        document.getElementById('ticket-total-final').innerText = `$ ${total.toLocaleString('es-AR', {minimumFractionDigits:2})}`;
    },

    async confirmarVenta() {
        // Recolectar datos
        const selectOperacion = document.getElementById('tipo-operacion');
        const isOrdenRetiro = selectOperacion.value === 'retiro';
        const obs = document.getElementById('observaciones-input').value.trim();

        // Armar Payload 100% Data-Parity con Desktop para evitar inserciones Null/Consumidor Final
        const hoy = new Date().toISOString().split('T')[0];
        
        const payload = {
            id_cliente: String(this.cart.cliente.id),
            fecha: hoy,
            fecha_entrega: hoy,
            agente: state.sesion.usuario || 'Cajero Móvil',
            tipo_comprobante: isOrdenRetiro ? 'Orden de Retiro' : 'Factura',
            estado: isOrdenRetiro ? 'Orden de Retiro' : 'Presupuesto/Orden',
            estado_logistico: isOrdenRetiro ? 'ESPERANDO_MOSTRADOR' : 'PENDIENTE_ASIGNAR',
            informe_generado: 'Pendiente',
            nota: obs,
            punto_entrega: 'Mostrador / Automático (Móvil)',
            descuento: 0,
            secuencia: 'Pedido_Listo',
            detalles: []
        };

        for(let key in this.cart.items) {
            const netPriceDesktop = this.cart.items[key].precio / 1.21; // Emulando un IVA 21 default (si no, precio1 hace de total unitario validado)
            
            payload.detalles.push({
                articulo: this.cart.items[key].id.toString(), // El back exige el nro o barcode
                cantidad: parseFloat(this.cart.items[key].cantidad),
                valor1: parseFloat(netPriceDesktop.toFixed(2)),
                iva1: 21,
                precio1: parseFloat(this.cart.items[key].precio.toFixed(2)) // Desktop envia el valor_final_unitario como precio1
            });
        }

        // Mostrar Loader
        document.getElementById('full-loader').classList.remove('hidden');

        try {
            const response = await fetch(`${API_BASE_URL}/api/presupuestos`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.sesion.token}`
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            
            // Ocultar Loader
            document.getElementById('full-loader').classList.add('hidden');

            if(data.success || data.presupuestoId) {
                // Notificación Nativa Swal
                Swal.fire({
                    icon: 'success',
                    title: 'Operación Exitosa',
                    text: `El documento fue emitido bajo el N° ${data.presupuestoId || data.id}`,
                    confirmButtonText: 'Aceptar',
                    confirmButtonColor: '#2563eb'
                }).then(() => {
                    window.location.href = 'presupuestos.html';
                });
            } else {
                Swal.fire('Error del Servidor', "Ocurrió un defecto al guardar: " + (data.error || "Desconocido"), 'error');
            }

        } catch(e) {
            document.getElementById('full-loader').classList.add('hidden');
            console.error(e);
            Swal.fire('Fallo de Red', "No se pudo alcanzar el servidor central. Verificá tus datos móviles.", 'error');
        }
    }
};

// Exponer de forma global para eventos en duro (HTML DOM onclick)
window.WizardController = WizardController;
window.avanzarPaso = (n) => WizardController.avanzarPaso(n);
window.wizardBack = () => WizardController.wizardBack();
window.cancelarWizard = () => WizardController.cancelarWizard();
window.confirmarVenta = () => WizardController.confirmarVenta();
