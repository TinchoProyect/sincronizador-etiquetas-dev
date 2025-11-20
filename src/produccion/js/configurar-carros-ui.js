/**
 * [CARROS-UI] Módulo para configurar carros desde la portada de Producción
 * Permite armar carros directamente desde el Resumen de Faltantes y Parciales
 * sin navegar al espacio de trabajo por usuario.
 * 
 * REGLA: Solo se seleccionan HIJOS de packs y artículos SIMPLES.
 * Los padres de pack son solo referencia visual.
 */

(function() {
    'use strict';

    console.log('[CARROS-UI] Módulo cargado v2.0 - Selección de hijos');

    const estadoCarros = {
        usuarioSeleccionado: null,
        articulosSeleccionados: new Map(),
        articulosDisponibles: [],
        packMappings: new Map()
    };

    function inicializarPanelCarros() {
        console.log('[CARROS-UI] Inicializando panel...');
        cargarUsuariosEnSelector();
        configurarEventListeners();
        sincronizarConResumen();
        console.log('[CARROS-UI] Panel inicializado');
    }

    async function cargarUsuariosEnSelector() {
        console.log('[CARROS-UI] Cargando usuarios...');
        const select = document.getElementById('carros-usuario-select');
        const botonera = document.getElementById('carros-usuario-botonera');

        if (!select) {
            console.error('[CARROS-UI] No se encontró el selector de usuarios');
            return;
        }

        try {
            const response = await fetch('/api/usuarios/con-permiso/Produccion');
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const usuarios = await response.json();
            console.log(`[CARROS-UI] ${usuarios.length} usuarios cargados`);

            select.innerHTML = '<option value="">-- Seleccionar usuario --</option>';

            usuarios.forEach(usuario => {
                const option = document.createElement('option');
                option.value = usuario.id;
                option.textContent = usuario.nombre_completo;
                select.appendChild(option);
            });

            if (botonera) {
                if (usuarios.length === 0) {
                    botonera.style.display = 'none';
                } else {
                    botonera.innerHTML = '';
                    usuarios.forEach(usuario => {
                        const btn = document.createElement('button');
                        btn.className = 'carros-usuario-btn';
                        btn.textContent = usuario.nombre_completo;
                        btn.setAttribute('data-usuario-id', usuario.id);
                        btn.setAttribute('tabindex', '0');
                        btn.setAttribute('role', 'button');
                        btn.setAttribute('aria-label', `Seleccionar ${usuario.nombre_completo}`);
                        
                        btn.addEventListener('click', () => {
                            seleccionarUsuarioDesdeBotonera(usuario.id);
                        });
                        
                        btn.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                seleccionarUsuarioDesdeBotonera(usuario.id);
                            }
                        });
                        
                        botonera.appendChild(btn);
                    });
                }
            }

        } catch (error) {
            console.error('[CARROS-UI] Error al cargar usuarios:', error);
            mostrarMensaje('Error al cargar usuarios', 'error');
            if (botonera) {
                botonera.innerHTML = '<p style="color: #dc3545; font-size: 12px; margin: 0;">Error al cargar usuarios</p>';
            }
        }
    }

    function seleccionarUsuarioDesdeBotonera(usuarioId) {
        console.log(`[CARROS-UI] Usuario seleccionado desde botonera: ${usuarioId}`);
        
        const select = document.getElementById('carros-usuario-select');
        if (select) {
            select.value = usuarioId;
            select.dispatchEvent(new Event('change'));
        }
        
        actualizarEstadoBotonera(usuarioId);
    }

    function actualizarEstadoBotonera(usuarioIdActivo) {
        const botones = document.querySelectorAll('.carros-usuario-btn');
        botones.forEach(btn => {
            const btnId = btn.getAttribute('data-usuario-id');
            if (btnId === String(usuarioIdActivo)) {
                btn.classList.add('activo');
            } else {
                btn.classList.remove('activo');
            }
        });
    }

    function configurarEventListeners() {
        console.log('[CARROS-UI] Configurando event listeners...');

        const selectUsuario = document.getElementById('carros-usuario-select');
        if (selectUsuario) {
            selectUsuario.addEventListener('change', (e) => {
                estadoCarros.usuarioSeleccionado = e.target.value ? parseInt(e.target.value) : null;
                console.log('[CARROS-UI] Usuario seleccionado:', estadoCarros.usuarioSeleccionado);
                
                actualizarEstadoBotonera(e.target.value);
                actualizarEstadoBotones();
            });
        }

        const btnArmarUno = document.getElementById('carros-armar-uno-btn');
        if (btnArmarUno) {
            btnArmarUno.addEventListener('click', armarUnCarro);
        }

        const btnArmarVarios = document.getElementById('carros-armar-varios-btn');
        if (btnArmarVarios) {
            btnArmarVarios.addEventListener('click', () => {
                console.log('[CARROS-UI] TODO: Implementar "Armar varios carros"');
                mostrarMensaje('Funcionalidad en desarrollo', 'info');
            });
        }

        console.log('[CARROS-UI] Event listeners configurados');
    }

    function sincronizarConResumen() {
        console.log('[CARROS-UI] Sincronizando con resumen principal...');

        if (window.__resumenFaltantesDatos && window.__resumenFaltantesDatos.length > 0) {
            console.log('[CARROS-UI] Datos encontrados en caché inmediatamente');
            renderCarrosDesdeResumen(window.__resumenFaltantesDatos);
            return;
        }

        console.log('[CARROS-UI] Suscribiéndose al evento "resumen:faltantes:listo"...');
        window.addEventListener('resumen:faltantes:listo', (e) => {
            console.log('[CARROS-UI] Evento recibido - resumen listo:', e.detail?.datos?.length ?? 0, 'items');
            if (e.detail && e.detail.datos) {
                renderCarrosDesdeResumen(e.detail.datos);
            }
        });

        setTimeout(async () => {
            if (estadoCarros.articulosDisponibles.length === 0) {
                console.log('[CARROS-UI] Fallback activado - no se recibieron datos del resumen');
                await cargarArticulosConFallback();
            }
        }, 1500);
    }

    async function renderCarrosDesdeResumen(datos) {
        console.log('[CARROS-UI] renderCarrosDesdeResumen() - Procesando', datos.length, 'items');
        const container = document.getElementById('carros-lista-container');

        if (!container) {
            console.error('[CARROS-UI] No se encontró el contenedor de lista');
            return;
        }

        const faltantesYParciales = datos.filter(art => {
            const faltante = parseFloat(art.faltante || 0);
            return faltante > 0;
        });

        console.log(`[CARROS-UI] Faltantes y parciales filtrados: ${faltantesYParciales.length}`);
        estadoCarros.articulosDisponibles = faltantesYParciales;

        if (faltantesYParciales.length === 0) {
            container.innerHTML = '<p class="mensaje-info">✅ Sin faltantes ni parciales</p>';
            return;
        }

        container.innerHTML = '';
        
        for (const articulo of faltantesYParciales) {
            const itemDiv = await crearItemArticulo(articulo);
            container.appendChild(itemDiv);
        }

        console.log(`[CARROS-UI] Datos cargados (items: ${faltantesYParciales.length})`);
    }

    async function cargarArticulosConFallback() {
        console.log('[CARROS-UI] FALLBACK: Cargando datos directamente...');
        const container = document.getElementById('carros-lista-container');

        if (!container) return;

        container.innerHTML = '<p class="mensaje-info">Cargando artículos (fallback)...</p>';

        try {
            const fechaCorte = document.getElementById('fecha-corte-articulos')?.value || '';
            
            let url = '/api/produccion/pedidos-articulos';
            if (fechaCorte) {
                url += `?fecha=${fechaCorte}`;
            }

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const result = await response.json();
            const articulos = result.data || [];

            const faltantesYParciales = articulos.filter(art => {
                const estado = (art.estado || '').toUpperCase();
                return estado === 'FALTANTE' || estado === 'PARCIAL';
            });

            renderCarrosDesdeResumen(faltantesYParciales);

        } catch (error) {
            console.error('[CARROS-UI] FALLBACK: Error al cargar datos:', error);
            container.innerHTML = '<p class="mensaje-error">❌ Error al cargar artículos</p>';
        }
    }

    async function crearItemArticulo(articulo) {
        const faltante = parseFloat(articulo.faltante || 0);
        const pedidoTotal = parseFloat(articulo.pedido_total || 0);
        const stockDisponible = parseFloat(articulo.stock_disponible || 0);

        let estado = 'faltante';
        let estadoTexto = 'FALTANTE';
        if (stockDisponible > 0 && faltante < pedidoTotal) {
            estado = 'parcial';
            estadoTexto = 'PARCIAL';
        }

        const packMapping = await obtenerPackMappingLocal(articulo.articulo_numero);
        const esCompuesto = packMapping !== null;

        if (esCompuesto) {
            console.log(`[CARROS-UI] Pack detectado: ${articulo.articulo_numero} → hijo: ${packMapping.articulo_kilo_codigo}`);
            console.log(`[CFG-CARROS] render item => {numero: ${packMapping.articulo_kilo_numero}, barras: ${packMapping.articulo_kilo_codigo_barras}, descripcion: ${packMapping.articulo_kilo_nombre}}`);
            estadoCarros.packMappings.set(articulo.articulo_numero, packMapping);
            
            const containerDiv = document.createElement('div');
            containerDiv.className = 'carros-pack-container';
            containerDiv.setAttribute('data-pack-padre', articulo.articulo_numero);
            containerDiv.style.marginBottom = '15px';
            
            const padreDiv = document.createElement('div');
            padreDiv.className = `carros-item carros-item-padre ${estado}`;
            padreDiv.style.opacity = '0.7';
            padreDiv.style.borderLeft = '4px solid #17a2b8';
            padreDiv.style.backgroundColor = '#e7f5f7';
            padreDiv.style.cursor = 'default';
            
            const padreInfoDiv = document.createElement('div');
            padreInfoDiv.className = 'carros-item-info';
            padreInfoDiv.style.flex = '1';
            padreInfoDiv.style.paddingLeft = '10px';
            
            const padreDescSpan = document.createElement('span');
            padreDescSpan.className = 'carros-item-descripcion';
            padreDescSpan.textContent = `📦 PACK: ${articulo.descripcion || articulo.articulo_numero}`;
            padreDescSpan.style.color = '#17a2b8';
            padreDescSpan.style.fontWeight = 'bold';
            
            const padreCodigoSpan = document.createElement('span');
            padreCodigoSpan.className = 'carros-item-codigo';
            padreCodigoSpan.textContent = `Código padre: ${articulo.articulo_numero}`;
            
            const padreEstadoSpan = document.createElement('span');
            padreEstadoSpan.className = `carros-item-estado ${estado}`;
            padreEstadoSpan.textContent = `${estadoTexto} (${faltante.toFixed(2)} packs)`;
            
            const padreInfoSpan = document.createElement('span');
            padreInfoSpan.style.fontSize = '11px';
            padreInfoSpan.style.color = '#6c757d';
            padreInfoSpan.style.fontStyle = 'italic';
            padreInfoSpan.textContent = '(Referencia - seleccionar hijo abajo)';
            
            padreInfoDiv.appendChild(padreDescSpan);
            padreInfoDiv.appendChild(padreCodigoSpan);
            padreInfoDiv.appendChild(padreEstadoSpan);
            padreInfoDiv.appendChild(padreInfoSpan);
            padreDiv.appendChild(padreInfoDiv);
            
            const unidadesPorPack = parseFloat(packMapping.unidades || packMapping.multiplicador_ingredientes || 1);
            const faltanteHijo = faltante * unidadesPorPack;
            
            const hijoDiv = document.createElement('div');
            hijoDiv.className = `carros-item carros-item-hijo ${estado}`;
            hijoDiv.setAttribute('data-articulo-hijo', packMapping.articulo_kilo_codigo);
            hijoDiv.setAttribute('data-articulo-padre', articulo.articulo_numero);
            hijoDiv.style.marginLeft = '30px';
            hijoDiv.style.borderLeft = '3px solid #6c757d';
            
            const hijoCheckbox = document.createElement('input');
            hijoCheckbox.type = 'checkbox';
            hijoCheckbox.className = 'carros-item-checkbox';
            hijoCheckbox.setAttribute('data-articulo', packMapping.articulo_kilo_codigo);
            hijoCheckbox.setAttribute('data-es-hijo', 'true');
            hijoCheckbox.setAttribute('data-padre', articulo.articulo_numero);
            hijoCheckbox.addEventListener('change', (e) => {
                manejarSeleccionHijo(articulo, packMapping, e.target.checked, faltanteHijo);
            });
            
            const hijoInfoDiv = document.createElement('div');
            hijoInfoDiv.className = 'carros-item-info';
            
            const hijoDescSpan = document.createElement('span');
            hijoDescSpan.className = 'carros-item-descripcion';
            hijoDescSpan.textContent = `└─ ${packMapping.articulo_kilo_nombre || 'Sin descripción'}`;
            hijoDescSpan.style.color = '#495057';
            hijoDescSpan.style.fontWeight = '600';
            
            const hijoCodigoSpan = document.createElement('span');
            hijoCodigoSpan.className = 'carros-item-codigo';
            const codigoAlfa = packMapping.articulo_kilo_numero || packMapping.articulo_kilo_codigo || 'N/A';
            const codigoBarras = packMapping.articulo_kilo_codigo_barras || packMapping.articulo_kilo_codigo || 'N/A';
            hijoCodigoSpan.textContent = `Código: ${codigoAlfa} · Barras: ${codigoBarras}`;
            
            const hijoInfoSpan = document.createElement('span');
            hijoInfoSpan.className = 'carros-item-compuesto';
            hijoInfoSpan.textContent = `Componente (${unidadesPorPack}x por pack)`;
            
            hijoInfoDiv.appendChild(hijoDescSpan);
            hijoInfoDiv.appendChild(hijoCodigoSpan);
            hijoInfoDiv.appendChild(hijoInfoSpan);
            
            const hijoCantidadDiv = document.createElement('div');
            hijoCantidadDiv.className = 'carros-item-cantidad';
            
            const hijoLabelCant = document.createElement('label');
            hijoLabelCant.textContent = 'Cant:';
            
            const hijoInputCant = document.createElement('input');
            hijoInputCant.type = 'number';
            hijoInputCant.min = '0';
            hijoInputCant.step = '0.01';
            hijoInputCant.value = faltanteHijo.toFixed(2);
            hijoInputCant.setAttribute('data-articulo', packMapping.articulo_kilo_codigo);
            hijoInputCant.setAttribute('data-es-hijo', 'true');
            hijoInputCant.addEventListener('change', (e) => {
                actualizarCantidadHijo(packMapping.articulo_kilo_codigo, parseFloat(e.target.value) || 0);
            });
            
            hijoCantidadDiv.appendChild(hijoLabelCant);
            hijoCantidadDiv.appendChild(hijoInputCant);
            
            hijoDiv.appendChild(hijoCheckbox);
            hijoDiv.appendChild(hijoInfoDiv);
            hijoDiv.appendChild(hijoCantidadDiv);
            
            containerDiv.appendChild(padreDiv);
            containerDiv.appendChild(hijoDiv);
            
            return containerDiv;
            
        } else {
            const itemDiv = document.createElement('div');
            itemDiv.className = `carros-item ${estado}`;
            itemDiv.setAttribute('data-articulo', articulo.articulo_numero);
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'carros-item-checkbox';
            checkbox.setAttribute('data-articulo', articulo.articulo_numero);
            checkbox.addEventListener('change', (e) => {
                manejarSeleccionArticuloSimple(articulo, e.target.checked);
            });
            
            const infoDiv = document.createElement('div');
            infoDiv.className = 'carros-item-info';
            
            console.log(`[CFG-CARROS] render item => {numero: ${articulo.articulo_numero}, barras: ${articulo.codigo_barras || 'N/A'}, descripcion: ${articulo.descripcion}}`);
            
            const descripcionSpan = document.createElement('span');
            descripcionSpan.className = 'carros-item-descripcion';
            descripcionSpan.textContent = articulo.descripcion || articulo.articulo_numero || 'Sin descripción';
            
            const codigoSpan = document.createElement('span');
            codigoSpan.className = 'carros-item-codigo';
            const codigoBarrasTexto = articulo.codigo_barras ? ` · Barras: ${articulo.codigo_barras}` : '';
            codigoSpan.textContent = `Código: ${articulo.articulo_numero}${codigoBarrasTexto}`;
            
            const estadoSpan = document.createElement('span');
            estadoSpan.className = `carros-item-estado ${estado}`;
            estadoSpan.textContent = `${estadoTexto} (${faltante.toFixed(2)})`;
            
            infoDiv.appendChild(descripcionSpan);
            infoDiv.appendChild(codigoSpan);
            infoDiv.appendChild(estadoSpan);
            
            const cantidadDiv = document.createElement('div');
            cantidadDiv.className = 'carros-item-cantidad';
            
            const labelCantidad = document.createElement('label');
            labelCantidad.textContent = 'Cant:';
            
            const inputCantidad = document.createElement('input');
            inputCantidad.type = 'number';
            inputCantidad.min = '0';
            inputCantidad.step = '0.01';
            inputCantidad.value = faltante.toFixed(2);
            inputCantidad.setAttribute('data-articulo', articulo.articulo_numero);
            inputCantidad.addEventListener('change', (e) => {
                actualizarCantidadArticulo(articulo.articulo_numero, parseFloat(e.target.value) || 0);
            });
            
            cantidadDiv.appendChild(labelCantidad);
            cantidadDiv.appendChild(inputCantidad);
            
            itemDiv.appendChild(checkbox);
            itemDiv.appendChild(infoDiv);
            itemDiv.appendChild(cantidadDiv);
            
            return itemDiv;
        }
    }

    async function obtenerPackMappingLocal(codigoPadre) {
        if (typeof window.obtenerPackMapping === 'function') {
            return await window.obtenerPackMapping(codigoPadre);
        }
        return null;
    }

    function manejarSeleccionArticuloSimple(articulo, seleccionado) {
        const articuloNumero = articulo.articulo_numero;

        if (seleccionado) {
            const faltante = parseFloat(articulo.faltante || 0);
            estadoCarros.articulosSeleccionados.set(articuloNumero, {
                articulo: articulo,
                cantidad: faltante,
                esHijo: false,
                codigoPadre: null
            });
            console.log(`[CARROS-UI] Artículo SIMPLE seleccionado: ${articuloNumero} (${faltante})`);
        } else {
            estadoCarros.articulosSeleccionados.delete(articuloNumero);
            console.log(`[CARROS-UI] Artículo SIMPLE deseleccionado: ${articuloNumero}`);
        }

        actualizarEstadoBotones();
    }

    function manejarSeleccionHijo(articuloPadre, packMapping, seleccionado, cantidadCalculada) {
        const codigoHijo = packMapping.articulo_kilo_codigo;
        const codigoPadre = articuloPadre.articulo_numero;

        if (seleccionado) {
            estadoCarros.articulosSeleccionados.set(codigoHijo, {
                articulo: {
                    articulo_numero: packMapping.articulo_kilo_numero || codigoHijo,
                    codigo_barras: packMapping.articulo_kilo_codigo_barras || codigoHijo,
                    descripcion: packMapping.articulo_kilo_nombre,
                    faltante: cantidadCalculada
                },
                cantidad: cantidadCalculada,
                esHijo: true,
                codigoPadre: codigoPadre,
                unidadesPorPack: packMapping.unidades || packMapping.multiplicador_ingredientes
            });
            console.log(`[CARROS-UI] HIJO seleccionado: ${codigoHijo} (${cantidadCalculada}) del padre ${codigoPadre}`);
        } else {
            estadoCarros.articulosSeleccionados.delete(codigoHijo);
            console.log(`[CARROS-UI] HIJO deseleccionado: ${codigoHijo}`);
        }

        actualizarEstadoBotones();
    }

    function actualizarCantidadArticulo(articuloNumero, nuevaCantidad) {
        if (estadoCarros.articulosSeleccionados.has(articuloNumero)) {
            const item = estadoCarros.articulosSeleccionados.get(articuloNumero);
            item.cantidad = nuevaCantidad;
            console.log(`[CARROS-UI] Cantidad actualizada: ${articuloNumero} → ${nuevaCantidad}`);
        }
    }

    function actualizarCantidadHijo(codigoHijo, nuevaCantidad) {
        if (estadoCarros.articulosSeleccionados.has(codigoHijo)) {
            const item = estadoCarros.articulosSeleccionados.get(codigoHijo);
            item.cantidad = nuevaCantidad;
            console.log(`[CARROS-UI] Cantidad HIJO actualizada: ${codigoHijo} → ${nuevaCantidad}`);
        }
    }

    function actualizarEstadoBotones() {
        const btnArmarUno = document.getElementById('carros-armar-uno-btn');

        const tieneUsuario = estadoCarros.usuarioSeleccionado !== null;
        const tieneArticulos = estadoCarros.articulosSeleccionados.size > 0;

        if (btnArmarUno) {
            btnArmarUno.disabled = !(tieneUsuario && tieneArticulos);
        }

        console.log(`[CARROS-UI] Botones actualizados - Usuario: ${tieneUsuario}, Artículos: ${tieneArticulos}`);
    }

    async function armarUnCarro() {
        console.log('[CARROS-UI] ===== INICIANDO ARMADO DE CARRO =====');

        if (!estadoCarros.usuarioSeleccionado) {
            mostrarMensaje('Debe seleccionar un usuario', 'error');
            return;
        }

        if (estadoCarros.articulosSeleccionados.size === 0) {
            mostrarMensaje('Debe seleccionar al menos un artículo', 'error');
            return;
        }

        let hayErrores = false;
        estadoCarros.articulosSeleccionados.forEach((item, articuloNumero) => {
            if (item.cantidad <= 0) {
                console.error(`[CARROS-UI] Cantidad inválida para ${articuloNumero}: ${item.cantidad}`);
                hayErrores = true;
            }
        });

        if (hayErrores) {
            mostrarMensaje('Todas las cantidades deben ser mayores a 0', 'error');
            return;
        }

        mostrarMensaje('Creando carro...', 'info');

        try {
            console.log('[CARROS-UI] PASO 1: Creando carro...');
            const payloadCrearCarro = {
                usuarioId: estadoCarros.usuarioSeleccionado,
                enAuditoria: false,
                tipoCarro: 'interna'
            };

            console.log('[CARROS-UI] Payload crear carro:', payloadCrearCarro);

            const responseCrear = await fetch('/api/produccion/carro', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadCrearCarro)
            });

            if (!responseCrear.ok) {
                const errorData = await responseCrear.json();
                throw new Error(errorData.error || 'Error al crear carro');
            }

            const dataCrear = await responseCrear.json();
            const carroId = dataCrear.id;
            console.log(`[CARROS-UI] ✅ Carro creado con ID: ${carroId}`);

            console.log('[CARROS-UI] PASO 2: Agregando artículos al carro (solo hijos y simples)...');
            let articulosAgregados = 0;
            let erroresAgregar = [];

            for (const [articuloNumero, item] of estadoCarros.articulosSeleccionados) {
                const articulo = item.articulo;
                const cantidad = item.cantidad;
                const esHijo = item.esHijo || false;

                // Validar que tenemos código alfanumérico
                if (!articulo.articulo_numero) {
                    console.error(`[CFG-CARROS] ❌ Falta código alfanumérico para artículo:`, articulo);
                    erroresAgregar.push(`${articulo.descripcion || 'Artículo'}: falta código alfanumérico`);
                    continue;
                }

                const payloadAgregar = {
                    articulo_numero: articulo.articulo_numero,
                    descripcion: articulo.descripcion || articulo.articulo_numero,
                    cantidad: cantidad,
                    usuarioId: estadoCarros.usuarioSeleccionado
                };

                const tipoLog = esHijo ? 'HIJO' : 'SIMPLE';
                console.log(`[CFG-CARROS] add payload {numero: ${payloadAgregar.articulo_numero}, barras: ${articulo.codigo_barras || 'N/A'}, desc: ${payloadAgregar.descripcion?.substring(0, 30)}, cant: ${cantidad}}`);
                console.log(`[CARROS-UI] Agregando ${tipoLog}: ${articulo.articulo_numero} (${cantidad})`, payloadAgregar);

                try {
                    const responseAgregar = await fetch(`/api/produccion/carro/${carroId}/articulo`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payloadAgregar)
                    });

                    if (!responseAgregar.ok) {
                        const errorData = await responseAgregar.json();
                        throw new Error(errorData.error || 'Error al agregar artículo');
                    }

                    articulosAgregados++;
                    console.log(`[CARROS-UI] ✅ ${tipoLog} agregado: ${articuloNumero}`);

                } catch (errorAgregar) {
                    console.error(`[CARROS-UI] ❌ Error al agregar ${articuloNumero}:`, errorAgregar);
                    erroresAgregar.push(`${articuloNumero}: ${errorAgregar.message}`);
                }
            }

            console.log(`[CARROS-UI] Artículos agregados: ${articulosAgregados}/${estadoCarros.articulosSeleccionados.size}`);

            if (erroresAgregar.length > 0) {
                console.warn('[CARROS-UI] Errores al agregar artículos:', erroresAgregar);
                mostrarMensaje(`Carro creado con ${articulosAgregados} artículos. ${erroresAgregar.length} errores.`, 'info');
            } else {
                mostrarMensaje(`✅ Carro creado exitosamente con ${articulosAgregados} artículos`, 'exito');
            }

            limpiarSeleccion();

            console.log('[CARROS-UI] PASO 3: Abriendo ventana del carro...');
            await abrirVentanaCarro(carroId, estadoCarros.usuarioSeleccionado);

            console.log('[CARROS-UI] PASO 4: Iniciando refresco...');
            await refrescarDatosPostCreacion();

        } catch (error) {
            console.error('[CARROS-UI] ❌ Error al armar carro:', error);
            mostrarMensaje(`Error: ${error.message}`, 'error');
        }

        console.log('[CARROS-UI] ===== FIN ARMADO DE CARRO =====');
    }

    function limpiarSeleccion() {
        console.log('[CARROS-UI] Limpiando selección...');

        const checkboxes = document.querySelectorAll('.carros-item-checkbox');
        checkboxes.forEach(cb => {
            cb.checked = false;
        });

        estadoCarros.articulosSeleccionados.clear();
        actualizarEstadoBotones();

        console.log('[CARROS-UI] Selección limpiada');
    }

    /**
     * Abre la ventana del carro personal con el carro recién creado
     * Reutiliza el flujo tradicional completo (ingredientes, mixes, etc.)
     */
    async function abrirVentanaCarro(carroId, usuarioId) {
        console.log(`[CARROS-UI] Abriendo ventana del carro ${carroId} para usuario ${usuarioId}`);

        try {
            // Obtener datos completos del usuario
            const response = await fetch('/api/usuarios/con-permiso/Produccion');
            if (!response.ok) {
                throw new Error('Error al obtener datos del usuario');
            }

            const usuarios = await response.json();
            const usuario = usuarios.find(u => u.id === usuarioId);

            if (!usuario) {
                throw new Error('Usuario no encontrado');
            }

            // Configurar localStorage para la ventana del carro
            const colaboradorData = {
                id: usuario.id,
                nombre: usuario.nombre_completo,
                rol_id: usuario.rol_id,
                timestamp: new Date().toISOString()
            };

            localStorage.setItem('colaboradorActivo', JSON.stringify(colaboradorData));
            localStorage.setItem('carroActivo', String(carroId));

            console.log('[PROD-FLUJO] Abriendo ventana con datos:', {
                carroId: carroId,
                usuarioId: usuarioId,
                nombreUsuario: usuario.nombre_completo
            });

            // Abrir ventana del carro (mismo flujo que selección de usuario en portada)
            window.open('/pages/produccion_personal.html', `ventanaProduccion_${usuarioId}`);

            console.log('[CARROS-UI] ✅ Ventana del carro abierta');

        } catch (error) {
            console.error('[CARROS-UI] Error al abrir ventana del carro:', error);
            mostrarMensaje('Carro creado pero no se pudo abrir la ventana', 'info');
        }
    }

    async function refrescarDatosPostCreacion() {
        console.log('[CARROS-UI] REFRESCO PASO 1: invalidarCache...');
        
        if (typeof window.invalidarCachePackMappings === 'function') {
            estadoCarros.packMappings.forEach((mapping, codigo) => {
                window.invalidarCachePackMappings(codigo);
            });
        }

        console.log('[CARROS-UI] REFRESCO PASO 2: actualizarResumenFaltantes()');
        setTimeout(() => {
            if (typeof window.actualizarResumenFaltantes === 'function') {
                window.actualizarResumenFaltantes();
            }
        }, 300);

        console.log('[CARROS-UI] REFRESCO PASO 3: cargarPedidosArticulos()');
        setTimeout(() => {
            if (typeof window.cargarPedidosArticulos === 'function') {
                window.cargarPedidosArticulos();
            }
        }, 600);

        console.log('[CARROS-UI] REFRESCO PASO 4: actualizarIconosExpansion()');
        setTimeout(() => {
            if (typeof window.actualizarIconosExpansion === 'function') {
                window.actualizarIconosExpansion();
            }
        }, 900);

        console.log('[CARROS-UI] ✅ Refresco completo');
    }

    function mostrarMensaje(texto, tipo = 'info') {
        const mensajeDiv = document.getElementById('carros-mensaje');
        if (!mensajeDiv) return;

        mensajeDiv.textContent = texto;
        mensajeDiv.className = `carros-mensaje ${tipo}`;
        mensajeDiv.style.display = 'block';

        if (tipo === 'exito') {
            setTimeout(() => {
                mensajeDiv.style.display = 'none';
            }, 5000);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        console.log('[CARROS-UI] DOMContentLoaded - Inicializando...');
        inicializarPanelCarros();
    });

    window.configurarCarrosUI = {
        refrescarDatos: refrescarDatosPostCreacion,
        limpiarSeleccion: limpiarSeleccion
    };

})();
