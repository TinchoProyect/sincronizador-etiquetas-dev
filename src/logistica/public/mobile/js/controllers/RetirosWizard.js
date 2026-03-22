/**
 * Controlador Exclusivo para Órdenes de Retiro Móvil
 * Archivo: RetirosWizard.js
 */

const WizardController = {
    step: 1,
    cart: {
        cliente: null,
        factura: null, // Guardará la ref a la factura original elegida en Paso 2
        items: {}, // key: id_articulo, value: {id, nombre, precio, cantidad, max_quantity}
        observaciones: "",
        tipo: 'retiro'
    },
    
    timerBusqueda: null,

    init() {
        if (window.history && window.history.pushState) {
            window.history.pushState('forward', null, './crear-retiro-movil.html');
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
    },

    wizardBack() {
        if(this.step > 1) {
            this.avanzarPaso(this.step - 1);
        } else {
            window.location.href = 'presupuestos.html';
        }
    },

    avanzarPaso(numero) {
        if(numero === 2 && !this.cart.cliente) {
            alert("Debe seleccionar un cliente primero.");
            return;
        }
        if(numero === 3 && !this.cart.factura) {
            alert("Debe seleccionar una factura origen primero.");
            return;
        }
        if(numero === 4 && Object.keys(this.cart.items).length === 0) {
            alert("Debe agregar al menos un artículo para retirar.");
            return;
        }

        document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active-step'));
        document.getElementById(`step-${numero}`).classList.add('active-step');
        
        this.step = numero;
        document.getElementById('wizard-progress').style.width = `${numero * 25}%`;
        document.getElementById('wizard-step-indicator').innerText = `${numero}/4`;
        
        const titulos = ["", "Paso 1: Cliente", "Paso 2: Comprobante", "Paso 3: Ítems", "Paso 4: Resumen"];
        document.getElementById('wizard-title').innerText = titulos[numero];

        if(numero === 2) {
            document.getElementById('label-cliente-step-2').innerText = this.cart.cliente.nombre;
            this.buscarFacturasAPI(this.cart.cliente.id);
        }
        if(numero === 3) {
            document.getElementById('label-factura-seleccionada').innerText = `Comprobante N° ${this.cart.factura.id}`;
            this.buscarArticulosOriginalesAPI(this.cart.factura.id);
        }
        if(numero === 4) {
            this.renderCheckout();
        }
    },

    cancelarWizard() {
        if(confirm("¿Seguro que desea cancelar la operación actual?")) {
            window.location.href = 'presupuestos.html';
        }
    },

    // ============================
    // API & DATOS: CLIENTES (Mismo que Ventas)
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
        this.cart.items = {}; // Limpiar si vuelve atrás
        this.cart.factura = null;
        this.avanzarPaso(2);
    },

    // ============================
    // API & DATOS: FACTURAS RECIENTES
    // ============================
    async buscarFacturasAPI(clienteId) {
        const contenedor = document.getElementById('resultados-facturas');
        contenedor.innerHTML = '<div class="loader-spinner" style="border-top-color:#ea580c; margin:2rem auto"></div><p style="text-align:center; color:#64748b">Consultando historial...</p>';
        
        try {
            // Reutilizamos el endpoint genérico de presupuestos pero filtrando cliente.
            // Nos traemos todo para q decidan (idealmente limit: 20)
            const uri = `${API_BASE_URL}/api/presupuestos?page=1&limit=20&search=${encodeURIComponent(clienteId)}`;
            const response = await fetch(uri, {
                headers: { 'Authorization': `Bearer ${state.sesion.token}` }
            });
            const data = await response.json();

            if (data.success && data.data && data.data.length > 0) {
                contenedor.innerHTML = '';
                data.data.forEach(f => {
                    // Filtrar que no sea una orden de retiro ya de por sï
                    if(f.tipo_comprobante === 'Orden de Retiro' || f.estado === 'Orden de Retiro') return;

                    const dateDesc = new Date(f.fecha_registro).toLocaleDateString('es-AR');
                    const badgeClass = f.estado === 'Entregado' ? 'background: #10b981;' : 'background: #64748b;';
                    
                    const card = document.createElement('div');
                    card.className = 'card-cliente'; // Reutilizamos estilo
                    card.style.borderLeftColor = '#ea580c';
                    card.innerHTML = `
                        <div>
                            <span class="cliente-nombre">Comprobante N° ${f.id}</span>
                            <div style="margin-top:0.3rem">
                                <span class="badge-mini" style="${badgeClass}">${f.estado}</span>
                                <span style="font-size:0.8rem; color:#64748b; margin-left:0.5rem">📅 ${dateDesc}</span>
                            </div>
                            <div style="font-size:0.9rem; font-weight:bold; margin-top:0.3rem">$${parseFloat(f.total_final).toLocaleString('es-AR', {minimumFractionDigits:2})}</div>
                        </div>
                        <div style="font-size:1.5rem; color:#ea580c">→</div>
                    `;
                    card.onclick = () => this.seleccionarFactura(f);
                    contenedor.appendChild(card);
                });

                if(contenedor.innerHTML === '') {
                    contenedor.innerHTML = '<div class="placeholder-msg">Este cliente no posee facturas previas o ventas recientes aptas para devolución.</div>';
                }
            } else {
                contenedor.innerHTML = '<div class="placeholder-msg">Sin historial reciente para este cliente.</div>';
            }
        } catch(e) {
            console.error(e);
            contenedor.innerHTML = '<div class="placeholder-msg" style="color:red">Error consultando facturas.</div>';
        }
    },

    seleccionarFactura(factura) {
        this.cart.factura = factura;
        this.cart.items = {}; // Reiniciar carrito devoluciones
        this.renderCarritoFlotante();
        this.avanzarPaso(3);
    },

    // ============================
    // API & DATOS: ARTÍCULOS DE LA FACTURA
    // ============================
    async buscarArticulosOriginalesAPI(facturaId) {
        const contenedor = document.getElementById('resultados-articulo');
        contenedor.innerHTML = '<div class="loader-spinner" style="margin:2rem auto; border-top-color:#ea580c"></div><p style="text-align:center; color:#64748b">Cargando ítems...</p>';
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/presupuestos/${facturaId}/detalles`, {
                headers: { 'Authorization': `Bearer ${state.sesion.token}` }
            });
            const data = await response.json();

            if (data.success && data.data && data.data.length > 0) {
                contenedor.innerHTML = '';
                
                data.data.forEach(item => {
                    const fallbackID = item.articulo || item.codigo_barras || 'N/A';
                    const maxQty = parseFloat(item.cantidad) || 0;
                    
                    const a = {
                        id: fallbackID,
                        codigo_barras: fallbackID,
                        numero: fallbackID,
                        descripcion: item.descripcion_articulo || item.articulo_nombre || 'Artículo sin nombre',
                        precio_venta: parseFloat(item.precio1) || parseFloat(item.valor_final_unitario) || 0,
                        max_quantity: maxQty
                    };

                    const jsonSafe = JSON.stringify(a).replace(/"/g, '&quot;');
                    const card = document.createElement('div');
                    card.className = 'card-articulo';
                    // Tap to add logic
                    card.onclick = () => WizardController.actualizarCantidadDetalle(a, 1);
                    
                    const qtyActual = this.cart.items[a.id] ? this.cart.items[a.id].cantidad : "0";

                    card.innerHTML = `
                        <div class="articulo-info">
                            <span class="articulo-nombre">${a.descripcion} <br>
                                <small style="color:#ef4444; font-weight:bold;">Máx a devolver: ${a.max_quantity}</small>
                            </span>
                            <span class="articulo-precio">$${parseFloat(a.precio_venta).toLocaleString('es-AR', {minimumFractionDigits:2})}</span>
                        </div>
                        <div class="articulo-actions">
                            <button class="stepper-btn btn-minus" onclick='event.stopPropagation(); WizardController.actualizarCantidadDetalle(${jsonSafe}, -1)'>-</button>
                            <span class="stepper-qty" id="qty-${a.id}">${qtyActual}</span>
                        </div>
                    `;
                    contenedor.appendChild(card);
                });
            } else {
                contenedor.innerHTML = '<div class="placeholder-msg">Esta factura está vacía o no tiene artículos retornables.</div>';
            }
        } catch(e) {
            console.error(e);
            contenedor.innerHTML = '<div class="placeholder-msg" style="color:red">Error consultando detalle de ítems.</div>';
        }
    },

    actualizarCantidadDetalle(producto, delta) {
        const id = producto.id || producto.codigo_barras;
        
        if(!this.cart.items[id]) {
            if(delta < 0) return; // No se puede bajar de 0
            this.cart.items[id] = {
                id: id,
                numero: id,
                nombre: producto.descripcion,
                precio: parseFloat(producto.precio_venta || 0),
                cantidad: 0,
                max_quantity: producto.max_quantity
            };
        }

        const newQty = this.cart.items[id].cantidad + delta;
        
        // Regla estricta de Retiro: No podemos devolver más de lo que compró
        if (newQty > this.cart.items[id].max_quantity) {
            return; // Bloqueado, silenciamos o mostramos alerta breve (Swal.fireToast opcional)
        }

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
        let totalQty = 0;
        let totalMoney = 0;
        for(let key in this.cart.items) {
            totalQty += this.cart.items[key].cantidad;
            totalMoney += this.cart.items[key].cantidad * this.cart.items[key].precio;
        }
        document.getElementById('cart-qty').innerText = `${totalQty} ítems a devolver`;
        document.getElementById('cart-total').innerText = `$ ${totalMoney.toLocaleString('es-AR', {minimumFractionDigits:2})}`;
    },

    // ============================
    // CHECKOUT
    // ============================
    renderStep() {},
    
    renderCheckout() {
        document.getElementById('ticket-cliente').innerText = this.cart.cliente.nombre;
        document.getElementById('ticket-factura').innerText = `Ref: Devolución de Comprobante N° ${this.cart.factura.id}`;
        
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

    async confirmarRetiro() {
        const obs = document.getElementById('observaciones-input').value.trim();
        const obsRef = `[DEVOLUCION REF COMPROBANTE N° ${this.cart.factura.id}] ${obs}`;

        const hoy = new Date().toISOString().split('T')[0];
        
        const payload = {
            id_cliente: String(this.cart.cliente.id),
            fecha: hoy,
            fecha_entrega: hoy,
            agente: state.sesion.usuario || 'Cajero Móvil',
            tipo_comprobante: 'Orden de Retiro',
            estado: 'Orden de Retiro',
            estado_logistico: 'ESPERANDO_MOSTRADOR',
            informe_generado: 'Pendiente',
            nota: obsRef,
            punto_entrega: 'Mostrador / Automático (Móvil)',
            descuento: 0,
            secuencia: 'Pedido_Listo',
            detalles: []
        };

        for(let key in this.cart.items) {
            const netPriceDesktop = this.cart.items[key].precio / 1.21; 
            
            payload.detalles.push({
                articulo: this.cart.items[key].id.toString(),
                cantidad: parseFloat(this.cart.items[key].cantidad),
                valor1: parseFloat(netPriceDesktop.toFixed(2)),
                iva1: 21,
                precio1: parseFloat(this.cart.items[key].precio.toFixed(2))
            });
        }

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
            document.getElementById('full-loader').classList.add('hidden');

            if(data.success || data.presupuestoId) {
                Swal.fire({
                    icon: 'success',
                    title: 'Retiro Registrado',
                    text: `La orden de retiro fue ingresada bajo el N° ${data.presupuestoId || data.id}`,
                    confirmButtonText: 'Aceptar',
                    confirmButtonColor: '#ea580c'
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

window.WizardController = WizardController;
window.avanzarPaso = (n) => WizardController.avanzarPaso(n);
