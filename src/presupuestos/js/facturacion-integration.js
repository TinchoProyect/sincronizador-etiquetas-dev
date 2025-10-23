/**
 * Módulo de Integración con Facturación
 * Maneja la creación de facturas desde presupuestos
 */
(function() {
    console.log('🧾 [FACTURACION-INT] Cargando módulo de integración con facturación...');

    // Constantes
    const FECHA_HITO = '2025-10-12';
    const FACTURACION_API_URL = 'http://localhost:3004/facturacion';

    /**
     * Verificar si un presupuesto puede ser facturado
     * @param {Object} presupuesto - Datos del presupuesto
     * @returns {Object} { puede: boolean, razon: string }
     */
    function puedeFacturar(presupuesto) {
        console.log('🔍 [FACTURACION-INT] Verificando si puede facturar:', presupuesto);

        // Verificar fecha del presupuesto
        const fechaPresupuesto = presupuesto.fecha ? presupuesto.fecha.split('T')[0] : null;
        if (!fechaPresupuesto || fechaPresupuesto < FECHA_HITO) {
            return {
                puede: false,
                razon: `Solo presupuestos desde ${FECHA_HITO} pueden facturarse con el nuevo sistema`
            };
        }

        // Verificar flag usar_facturador_nuevo (por defecto true para presupuestos >= hito)
        const usarFacturadorNuevo = presupuesto.usar_facturador_nuevo !== false;
        if (!usarFacturadorNuevo) {
            return {
                puede: false,
                razon: 'Este presupuesto no está marcado para usar el facturador nuevo'
            };
        }

        // Verificar si ya tiene factura asociada
        if (presupuesto.factura_id) {
            return {
                puede: false,
                razon: 'Este presupuesto ya tiene una factura asociada',
                facturaId: presupuesto.factura_id
            };
        }

        return { puede: true };
    }

    /**
     * Mapear datos del presupuesto al formato de facturación
     * @param {Object} presupuesto - Datos del presupuesto
     * @param {Object} cliente - Datos del cliente (desde backend)
     * @param {Array} detalles - Detalles del presupuesto
     * @returns {Object} Payload para crear factura
     */
    function mapearPresupuestoAFactura(presupuesto, cliente, detalles) {
        console.log('🔄 [FACTURACION-INT] Mapeando presupuesto a factura...');
        console.log('👤 [FACTURACION-INT] Datos del cliente:', cliente);

        // Obtener datos del cliente
        const clienteId = parseInt(presupuesto.id_cliente) || parseInt(cliente?.cliente_id) || 0;
        
        // Mapear tipo de documento según datos reales del cliente
        // USAR LA MISMA LÓGICA QUE EL BACKEND (presupuestoFacturaService.js)
        let docTipo = 99; // Default: Consumidor Final
        let docNro = '0';
        let condicionIvaId = 5; // Consumidor Final por defecto
        let razonSocial = 'Consumidor Final';
        let motivo = 'Cliente sin documento válido';

        if (cliente) {
            // Usar datos reales del cliente
            razonSocial = cliente.nombre || 'Cliente';
            if (cliente.apellido) {
                razonSocial += ' ' + cliente.apellido;
            }

            console.log(`🔍 [FACTURACION-INT] Determinando documento para cliente ${clienteId}:`, {
                nombre: razonSocial,
                condicion_iva: cliente.condicion_iva,
                cuit: cliente.cuit,
                cuil: cliente.cuil,
                dni: cliente.dni
            });

            // Prioridad: CUIT > CUIL > DNI > Consumidor Final (igual que backend)
            // 1. Si tiene CUIT (Responsable Inscripto, Monotributo, Exento)
            if (cliente.cuit && cliente.cuit.trim()) {
                const cuitLimpio = cliente.cuit.replace(/[-\s]/g, '');
                if (cuitLimpio.length === 11 && /^\d+$/.test(cuitLimpio)) {
                    docTipo = 80; // CUIT
                    docNro = cuitLimpio;
                    motivo = 'CUIT válido encontrado';
                }
            }

            // 2. Si tiene CUIL (menos común, pero posible)
            if (docTipo === 99 && cliente.cuil && cliente.cuil.trim()) {
                const cuilLimpio = cliente.cuil.replace(/[-\s]/g, '');
                if (cuilLimpio.length === 11 && /^\d+$/.test(cuilLimpio)) {
                    docTipo = 86; // CUIL
                    docNro = cuilLimpio;
                    motivo = 'CUIL válido encontrado';
                }
            }

            // 3. Si tiene DNI (No Responsable)
            if (docTipo === 99 && cliente.dni && cliente.dni.trim()) {
                const dniLimpio = cliente.dni.replace(/[-\s]/g, '');
                if (dniLimpio.length >= 7 && dniLimpio.length <= 8 && /^\d+$/.test(dniLimpio)) {
                    docTipo = 96; // DNI
                    docNro = dniLimpio;
                    motivo = 'DNI válido encontrado';
                }
            }

            // 4. Solo usar 99 si realmente no hay documento
            if (docTipo === 99) {
                motivo = 'Cliente sin CUIT/CUIL/DNI válido - Consumidor Final';
            }

            console.log(`📋 [FACTURACION-INT] Documento determinado: Tipo ${docTipo}, Nro "${docNro}", Motivo: ${motivo}`);
            
            // Mapear condición IVA del cliente (campo TEXT)
            if (cliente.condicion_iva) {
                const condicionTexto = String(cliente.condicion_iva).trim();
                
                // Mapear texto a ID de AFIP
                const mapeoCondicion = {
                    'Responsable Inscripto': 1,
                    'Responsable no Inscripto': 2,
                    'No Responsable': 3,
                    'Exento': 4,
                    'Consumidor Final': 5,
                    'Responsable Monotributo': 6,
                    'Monotributo': 6,
                    'IVA Liberado': 10
                };
                
                condicionIvaId = mapeoCondicion[condicionTexto] || 5;
                console.log(`✅ [FACTURACION-INT] Condición IVA: "${condicionTexto}" → ID ${condicionIvaId}`);
            }
        }

        // Mapear items
        const items = detalles.map(detalle => {
            // Normalizar valores
            const cantidad = parseFloat(detalle.cantidad) || 1;
            const valorUnitario = parseFloat(detalle.valor1) || 0;
            
            // IVA: puede venir como porcentaje (21) o decimal (0.21)
            let ivaDecimal = parseFloat(detalle.iva1) || 0;
            if (ivaDecimal > 1) {
                ivaDecimal = ivaDecimal / 100; // Convertir porcentaje a decimal
            }

            // Mapear IVA% a ID de tabla factura_iva_alicuotas
            // ID 1 = 21% (codigo_afip 5)
            // ID 2 = 10.5% (codigo_afip 4)
            // ID 3 = 0% (codigo_afip 3)
            let alicIvaId = 1; // 21% por defecto
            if (Math.abs(ivaDecimal - 0.21) < 0.001) alicIvaId = 1; // 21%
            else if (Math.abs(ivaDecimal - 0.105) < 0.001) alicIvaId = 2; // 10.5%
            else if (Math.abs(ivaDecimal) < 0.001) alicIvaId = 3; // 0% (Exento)

            return {
                descripcion: detalle.detalle || detalle.descripcion || detalle.articulo || 'Sin descripción',
                qty: cantidad,
                p_unit: valorUnitario,
                alic_iva_id: alicIvaId
            };
        });

        // Determinar tipo de comprobante según condición IVA
        let tipoCbte = 6; // Factura B por defecto
        if (condicionIvaId === 1) {
            tipoCbte = 1; // Factura A para Responsable Inscripto
        } else {
            tipoCbte = 6; // Factura B para el resto
        }

        // Construir payload
        const payload = {
            usar_facturador_nuevo: true,
            fecha_presupuesto: presupuesto.fecha ? presupuesto.fecha.split('T')[0] : new Date().toISOString().split('T')[0],
            presupuesto_id: parseInt(presupuesto.id) || parseInt(presupuesto.id_presupuesto_ext),
            usuario_id: presupuesto.usuario_id || null,
            tipo_cbte: tipoCbte,
            pto_vta: 32, // Punto de venta por defecto
            concepto: 1, // Productos
            fecha_emision: new Date().toISOString().split('T')[0],
            cliente: {
                cliente_id: clienteId,
                razon_social: razonSocial,
                doc_tipo: docTipo,
                doc_nro: docNro,
                condicion_iva_id: condicionIvaId
            },
            precio_modo: 'NETO', // Los precios en presupuestos son netos
            moneda: 'PES',
            mon_cotiz: 1,
            items: items,
            requiere_afip: true, // Facturación AFIP por defecto
            serie_interna: null // Solo para facturas internas
        };

        console.log('✅ [FACTURACION-INT] Payload generado:', payload);
        return payload;
    }

    /**
     * Obtener datos del cliente desde el backend
     * @param {number} clienteId - ID del cliente
     * @returns {Promise<Object|null>} Datos del cliente o null
     */
    async function obtenerDatosCliente(clienteId) {
        if (!clienteId) return null;
        
        try {
            console.log(`🔍 [FACTURACION-INT] Obteniendo datos del cliente ${clienteId}...`);
            
            const response = await fetch(`http://localhost:3003/api/presupuestos/clientes/${clienteId}`);
            
            if (!response.ok) {
                console.warn('⚠️ [FACTURACION-INT] No se pudo obtener datos del cliente');
                return null;
            }
            
            const result = await response.json();
            
            if (result.success && result.data) {
                console.log('✅ [FACTURACION-INT] Datos del cliente obtenidos:', result.data);
                return result.data;
            }
            
            return null;
        } catch (error) {
            console.error('❌ [FACTURACION-INT] Error obteniendo datos del cliente:', error);
            return null;
        }
    }

    /**
     * Crear factura desde presupuesto
     * @param {Object} presupuesto - Datos del presupuesto
     * @param {Array} detalles - Detalles del presupuesto
     * @returns {Promise<Object>} Resultado de la creación
     */
    async function crearFactura(presupuesto, detalles) {
        console.log('📤 [FACTURACION-INT] Creando factura desde presupuesto...');

        try {
            // Verificar si puede facturar
            const verificacion = puedeFacturar(presupuesto);
            if (!verificacion.puede) {
                throw new Error(verificacion.razon);
            }

            // Obtener ID del presupuesto
            const presupuestoId = parseInt(presupuesto.id) || parseInt(presupuesto.id_presupuesto_ext);
            
            if (!presupuestoId) {
                throw new Error('No se pudo determinar el ID del presupuesto');
            }

            // Usar la ruta correcta que maneja descuentos automáticamente desde la BD
            console.log('📡 [FACTURACION-INT] Enviando request a:', `${FACTURACION_API_URL}/presupuestos/${presupuestoId}/facturar`);
            const response = await fetch(`${FACTURACION_API_URL}/presupuestos/${presupuestoId}/facturar`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();

            // Manejar respuestas
            if (response.status === 201) {
                // Factura creada exitosamente
                console.log('✅ [FACTURACION-INT] Factura creada:', result.data);
                
                // Obtener facturaId
                const facturaId = result.data.factura_id || result.data.id;
                
                if (!facturaId) {
                    console.error('❌ [FACTURACION-INT] No se pudo obtener el ID de la factura:', result.data);
                    throw new Error('No se pudo obtener el ID de la factura creada');
                }
                
                // Actualizar factura_id en el presupuesto
                try {
                    
                    console.log(`🔄 [FACTURACION-INT] Actualizando factura_id en presupuesto ${presupuestoId}...`);
                    
                    const updateResponse = await fetch(`http://localhost:3003/api/presupuestos/${presupuestoId}/factura`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ factura_id: facturaId })
                    });
                    
                    if (updateResponse.ok) {
                        console.log(`✅ [FACTURACION-INT] factura_id actualizado en presupuesto`);
                    } else {
                        console.warn(`⚠️ [FACTURACION-INT] No se pudo actualizar factura_id en presupuesto`);
                    }
                } catch (updateError) {
                    console.warn(`⚠️ [FACTURACION-INT] Error actualizando factura_id (no crítico):`, updateError);
                }
                
                return {
                    success: true,
                    idempotente: false,
                    facturaId: facturaId,
                    mensaje: `Factura creada exitosamente (ID: ${facturaId})`,
                    data: result.data
                };
            } else if (response.status === 409) {
                // Factura ya existía (idempotencia)
                console.log('ℹ️ [FACTURACION-INT] Factura ya existía:', result.data);
                return {
                    success: true,
                    idempotente: true,
                    facturaId: result.data.id,
                    mensaje: `Ya existía una factura para este presupuesto (ID: ${result.data.id})`,
                    data: result.data
                };
            } else if (response.status === 400) {
                // Error de validación
                console.error('❌ [FACTURACION-INT] Error de validación:', result);
                throw new Error(result.message || result.error || 'Error de validación');
            } else {
                // Otro error
                console.error('❌ [FACTURACION-INT] Error inesperado:', result);
                throw new Error(result.message || result.error || 'Error al crear factura');
            }

        } catch (error) {
            console.error('❌ [FACTURACION-INT] Error al crear factura:', error);
            throw error;
        }
    }

    /**
     * Renderizar botón de facturación
     * @param {Object} presupuesto - Datos del presupuesto
     * @param {Array} detalles - Detalles del presupuesto
     * @param {HTMLElement} container - Contenedor donde insertar el botón
     */
    function renderizarBotonFacturacion(presupuesto, detalles, container) {
        console.log('🎨 [FACTURACION-INT] Renderizando botón de facturación...');

        if (!container) {
            console.error('❌ [FACTURACION-INT] Contenedor no encontrado');
            return;
        }

        // Limpiar contenedor
        container.innerHTML = '';

        // Verificar si puede facturar
        const verificacion = puedeFacturar(presupuesto);

        if (!verificacion.puede) {
            // Si ya tiene factura, mostrar botón para ver
            if (verificacion.facturaId) {
                const btnVer = document.createElement('button');
                btnVer.type = 'button';
                btnVer.className = 'btn btn-info';
                btnVer.innerHTML = '📄 Ver Factura';
                btnVer.onclick = () => {
                    window.open(`http://localhost:3004/pages/ver-factura.html?id=${verificacion.facturaId}`, '_blank');
                };
                container.appendChild(btnVer);
            } else {
                // Mostrar mensaje de por qué no puede facturar
                const mensaje = document.createElement('small');
                mensaje.className = 'text-muted';
                mensaje.textContent = verificacion.razon;
                container.appendChild(mensaje);
            }
            return;
        }

        // Crear botón de facturar
        const btnFacturar = document.createElement('button');
        btnFacturar.type = 'button';
        btnFacturar.className = 'btn btn-success';
        btnFacturar.innerHTML = '🧾 Facturar';
        btnFacturar.id = 'btn-facturar';

        // Agregar spinner (oculto inicialmente)
        const spinner = document.createElement('span');
        spinner.className = 'loading-spinner';
        spinner.style.display = 'none';
        btnFacturar.insertBefore(spinner, btnFacturar.firstChild);

        // Manejar click
        btnFacturar.onclick = async () => {
            console.log('🖱️ [FACTURACION-INT] Click en botón Facturar');

            // Confirmar acción
            if (!confirm('¿Desea crear una factura para este presupuesto?')) {
                return;
            }

            // Mostrar loading
            btnFacturar.disabled = true;
            spinner.style.display = 'inline-block';

            try {
                // Crear factura
                const resultado = await crearFactura(presupuesto, detalles);

                // Mostrar mensaje de éxito
                mostrarToast(resultado.mensaje, resultado.idempotente ? 'info' : 'success');

                // Actualizar UI
                if (resultado.idempotente) {
                    // Ya existía, mostrar botón para ver
                    btnFacturar.innerHTML = '📄 Ver Factura';
                    btnFacturar.className = 'btn btn-info';
                    btnFacturar.onclick = () => {
                        window.open(`http://localhost:3004/pages/ver-factura.html?id=${resultado.facturaId}`, '_blank');
                    };
                } else {
                    // Recién creada, agregar badge
                    const badge = document.createElement('span');
                    badge.className = 'badge badge-success';
                    badge.textContent = `Factura #${resultado.facturaId}`;
                    badge.style.marginLeft = '10px';
                    container.appendChild(badge);

                    // Cambiar botón a "Ver Factura"
                    btnFacturar.innerHTML = '📄 Ver Factura';
                    btnFacturar.className = 'btn btn-info';
                    btnFacturar.onclick = () => {
                        window.open(`http://localhost:3004/pages/ver-factura.html?id=${resultado.facturaId}`, '_blank');
                    };
                }

                // TODO: Persistir factura_id en el presupuesto (requiere endpoint en backend)
                console.log('ℹ️ [FACTURACION-INT] TODO: Persistir factura_id en presupuesto');

            } catch (error) {
                console.error('❌ [FACTURACION-INT] Error:', error);
                mostrarToast(`Error: ${error.message}`, 'error');
            } finally {
                // Ocultar loading
                btnFacturar.disabled = false;
                spinner.style.display = 'none';
            }
        };

        container.appendChild(btnFacturar);
        console.log('✅ [FACTURACION-INT] Botón renderizado');
    }

    /**
     * Mostrar toast/notificación
     * @param {string} mensaje - Mensaje a mostrar
     * @param {string} tipo - Tipo de mensaje (success, error, info)
     */
    function mostrarToast(mensaje, tipo = 'info') {
        console.log(`💬 [FACTURACION-INT] Toast: ${mensaje} (${tipo})`);

        // Buscar contenedor de mensajes existente
        let container = document.getElementById('message-container');
        
        if (!container) {
            // Crear contenedor si no existe
            container = document.createElement('div');
            container.id = 'message-container';
            container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; max-width: 400px;';
            document.body.appendChild(container);
        }

        // Crear toast
        const toast = document.createElement('div');
        toast.className = `message ${tipo}`;
        toast.style.cssText = 'margin-bottom: 10px; padding: 15px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); animation: slideIn 0.3s ease-out;';
        toast.textContent = mensaje;

        // Estilos según tipo
        if (tipo === 'success') {
            toast.style.backgroundColor = '#d4edda';
            toast.style.color = '#155724';
            toast.style.border = '1px solid #c3e6cb';
        } else if (tipo === 'error') {
            toast.style.backgroundColor = '#f8d7da';
            toast.style.color = '#721c24';
            toast.style.border = '1px solid #f5c6cb';
        } else {
            toast.style.backgroundColor = '#d1ecf1';
            toast.style.color = '#0c5460';
            toast.style.border = '1px solid #bee5eb';
        }

        container.appendChild(toast);

        // Auto-remover después de 5 segundos
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }

    /**
     * Verificar si el presupuesto ya tiene factura en el backend
     * @param {number} presupuestoId - ID del presupuesto
     * @returns {Promise<Object|null>} Factura existente o null
     */
    async function verificarFacturaExistente(presupuestoId) {
        console.log(`🔍 [FACTURACION-INT] Verificando factura existente para presupuesto ${presupuestoId}...`);
        
        try {
            const response = await fetch(`${FACTURACION_API_URL}/facturas?presupuesto_id=${presupuestoId}`);
            
            if (!response.ok) {
                console.warn('⚠️ [FACTURACION-INT] Error consultando facturas:', response.status);
                return null;
            }
            
            const result = await response.json();
            
            if (result.success && result.data && result.data.length > 0) {
                // Encontró factura(s) para este presupuesto
                const factura = result.data[0]; // Tomar la primera
                console.log(`✅ [FACTURACION-INT] Factura existente encontrada: ID ${factura.id}`);
                return factura;
            }
            
            console.log('✅ [FACTURACION-INT] No hay factura existente');
            return null;
            
        } catch (error) {
            console.error('❌ [FACTURACION-INT] Error verificando factura:', error);
            return null;
        }
    }

    /**
     * Inicializar integración de facturación
     * @param {Object} presupuesto - Datos del presupuesto
     * @param {Array} detalles - Detalles del presupuesto
     */
    async function inicializar(presupuesto, detalles) {
        console.log('🚀 [FACTURACION-INT] Inicializando integración de facturación...');

        // Buscar contenedor existente en el HTML
        let facturacionContainer = document.getElementById('facturacion-container');
        
        if (!facturacionContainer) {
            console.warn('⚠️ [FACTURACION-INT] Contenedor #facturacion-container no encontrado, creando uno...');
            
            // Buscar contenedor para el botón (en las acciones del formulario)
            const formActions = document.querySelector('.form-actions');
            if (!formActions) {
                console.error('❌ [FACTURACION-INT] Contenedor .form-actions no encontrado');
                return;
            }

            // Crear contenedor para el botón de facturación
            facturacionContainer = document.createElement('div');
            facturacionContainer.id = 'facturacion-container';
            facturacionContainer.style.cssText = 'margin-right: auto;'; // Alinear a la izquierda

            // Insertar antes del botón de cancelar
            const btnCancelar = formActions.querySelector('.btn-secondary');
            if (btnCancelar) {
                formActions.insertBefore(facturacionContainer, btnCancelar);
            } else {
                formActions.insertBefore(facturacionContainer, formActions.firstChild);
            }
        }

        console.log('✅ [FACTURACION-INT] Contenedor encontrado:', facturacionContainer);

        // Verificar si ya existe factura en el backend
        const presupuestoId = parseInt(presupuesto.id) || parseInt(presupuesto.id_presupuesto_ext);
        if (presupuestoId) {
            const facturaExistente = await verificarFacturaExistente(presupuestoId);
            
            if (facturaExistente) {
                // Agregar factura_id al objeto presupuesto para que puedeFacturar() lo detecte
                presupuesto.factura_id = facturaExistente.id;
                console.log(`✅ [FACTURACION-INT] Presupuesto ya tiene factura asociada: ${facturaExistente.id}`);
            }
        }

        // Renderizar botón
        renderizarBotonFacturacion(presupuesto, detalles, facturacionContainer);

        console.log('✅ [FACTURACION-INT] Integración inicializada');
    }

    // Exponer funciones globalmente
    window.FacturacionIntegration = {
        inicializar,
        puedeFacturar,
        crearFactura,
        renderizarBotonFacturacion,
        mostrarToast
    };

    console.log('✅ [FACTURACION-INT] Módulo cargado correctamente');

})();
