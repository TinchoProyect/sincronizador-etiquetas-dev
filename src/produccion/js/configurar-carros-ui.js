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

    console.log('[CARROS-UI] Módulo cargado v2.1 - Con visualizacion de ingredientes');

    const estadoCarros = {
        usuarioSeleccionado: null,
        articulosSeleccionados: new Map(),
        articulosDisponibles: [],
        packMappings: new Map(),
        cacheIngredientes: new Map() // Cache para ingredientes consultados
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
        
        // Renderizar faltantes y parciales
        for (const articulo of faltantesYParciales) {
            const itemDiv = await crearItemArticulo(articulo);
            container.appendChild(itemDiv);
        }

        console.log(`[CARROS-UI] Datos cargados (items: ${faltantesYParciales.length})`);
        
        // Procesar y renderizar sugerencias (hace su propia llamada al endpoint)
        await procesarYRenderizarSugerencias();
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
            hijoDiv.style.cssText = 'margin-left: 30px; border-left: 3px solid #6c757d; padding: 8px 12px; margin-bottom: 8px;';
            
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
            hijoInfoDiv.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 2px;';
            
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
            
            // NUEVA FUNCIONALIDAD: Agregar botones de ingredientes y sugerencias para HIJO
            const articuloHijo = {
                articulo_numero: packMapping.articulo_kilo_numero || packMapping.articulo_kilo_codigo,
                codigo_barras: packMapping.articulo_kilo_codigo_barras || packMapping.articulo_kilo_codigo,
                descripcion: packMapping.articulo_kilo_nombre || 'Sin descripción'
            };
            const botonIngredientesHijo = await agregarBotonIngredientes(articuloHijo, hijoDiv);
            const botonSugerenciaHijo = await agregarBotonSugerencia(articuloHijo.articulo_numero, articuloHijo.descripcion, hijoDiv);
            hijoInfoDiv.appendChild(botonIngredientesHijo);
            hijoInfoDiv.appendChild(botonSugerenciaHijo);
            
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
            itemDiv.style.cssText = 'padding: 8px 12px; margin-bottom: 8px;';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'carros-item-checkbox';
            checkbox.setAttribute('data-articulo', articulo.articulo_numero);
            checkbox.addEventListener('change', (e) => {
                manejarSeleccionArticuloSimple(articulo, e.target.checked);
            });
            
            const infoDiv = document.createElement('div');
            infoDiv.className = 'carros-item-info';
            infoDiv.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 2px;';
            
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
            
            // NUEVA FUNCIONALIDAD: Agregar botones de ingredientes y sugerencias para SIMPLE
            const botonIngredientes = await agregarBotonIngredientes(articulo, itemDiv);
            const botonSugerencia = await agregarBotonSugerencia(
                articulo.articulo_numero, 
                articulo.descripcion || articulo.articulo_numero, 
                itemDiv
            );
            infoDiv.appendChild(botonIngredientes);
            infoDiv.appendChild(botonSugerencia);
            
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

    /**
     * NUEVA FUNCIONALIDAD: Obtiene los ingredientes de un articulo desde la API
     * Usa el endpoint existente GET /api/produccion/recetas/:numero_articulo
     * @param {string} articuloCodigo - Codigo alfanumerico o codigo de barras del articulo
     * @returns {Promise<Object|null>} Objeto con ingredientes o null si no tiene receta
     */
    async function obtenerIngredientesArticulo(articulo) {
    const cacheKey = articulo.articulo_numero;
    if (estadoCarros.cacheIngredientes.has(cacheKey)) {
        console.log(`[INGREDIENTES] Usando cache para ${cacheKey}`);
        return estadoCarros.cacheIngredientes.get(cacheKey);
    }

    const buscarPorCodigo = async (codigo, tipo) => {
        if (!codigo) return null;
        try {
            const codigoEncoded = encodeURIComponent(codigo);
            console.log(`[INGREDIENTES] (${tipo}) Consultando receta para ${codigo} (${codigoEncoded})`);
            const response = await fetch(`/api/produccion/recetas/${codigoEncoded}`);
            
            if (response.ok) {
                const receta = await response.json();
                console.log(`[INGREDIENTES] (${tipo}) Receta encontrada para ${codigo}:`, receta);
                return {
                    tieneReceta: true,
                    ingredientes: receta.ingredientes || [],
                    articulos: receta.articulos || []
                };
            } else if (response.status === 404) {
                console.log(`[INGREDIENTES] (${tipo}) Articulo ${codigo} sin receta (404)`);
                return { tieneReceta: false };
            } else {
                console.error(`[INGREDIENTES] (${tipo}) Error HTTP ${response.status} para ${codigo}`);
                return null;
            }
        } catch (error) {
            console.error(`[INGREDIENTES] (${tipo}) Error al consultar receta de ${codigo}:`, error);
            return null;
        }
    };

    let resultado = await buscarPorCodigo(articulo.articulo_numero, 'numero');

    if (resultado && !resultado.tieneReceta && articulo.codigo_barras) {
        console.log(`[INGREDIENTES] Fallback: Intentando con codigo de barras ${articulo.codigo_barras}`);
        resultado = await buscarPorCodigo(articulo.codigo_barras, 'barras');
    }
    
    if (resultado) {
        estadoCarros.cacheIngredientes.set(cacheKey, resultado);
    }

    return resultado;
}

    /**
     * NUEVA FUNCIONALIDAD: Crea el boton de informacion de ingredientes
     * El boton es ACTIVO (color) si tiene receta, INACTIVO (gris) si no tiene
     * @param {string} articuloCodigo - Codigo del articulo
     * @param {HTMLElement} contenedorPadre - Elemento donde se agregara el boton
     */
    async function agregarBotonIngredientes(articulo, contenedorPadre) {
        const infoIngredientes = await obtenerIngredientesArticulo(articulo);
        
        const botonInfo = document.createElement('button');
        botonInfo.className = 'carros-btn-ingredientes';
        botonInfo.textContent = 'i';
        botonInfo.title = 'Informacion de ingredientes';
        
        if (infoIngredientes && infoIngredientes.tieneReceta && infoIngredientes.ingredientes.length > 0) {
            // Boton ACTIVO (tiene ingredientes) - COMPACTO
            botonInfo.style.cssText = 'background: #28a745; color: white; border: none; padding: 0; border-radius: 50%; cursor: pointer; font-size: 10px; font-weight: bold; margin-left: 6px; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;';
            botonInfo.setAttribute('data-tiene-receta', 'true');
            
            botonInfo.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleIngredientesPanel(articulo.articulo_numero, contenedorPadre, infoIngredientes);
            });
        } else {
            // Boton INACTIVO (sin ingredientes) - COMPACTO
            botonInfo.style.cssText = 'background: #6c757d; color: white; border: none; padding: 0; border-radius: 50%; cursor: not-allowed; font-size: 10px; font-weight: bold; margin-left: 6px; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; opacity: 0.5;';
            botonInfo.setAttribute('data-tiene-receta', 'false');
            botonInfo.disabled = true;
        }
        
        return botonInfo;
    }

    /**
     * NUEVA FUNCIONALIDAD: Toggle del panel de ingredientes
     * Muestra/oculta la lista de ingredientes debajo del articulo
     * CORRECCION: Multiplica cantidad base por cantidad solicitada del articulo
     */
    function toggleIngredientesPanel(articuloCodigo, contenedorPadre, infoIngredientes) {
        console.log(`[INGREDIENTES] Toggle panel para ${articuloCodigo}`);
        
        // Buscar panel existente
        let panel = contenedorPadre.querySelector(`.ingredientes-panel[data-articulo="${articuloCodigo}"]`);
        
        if (panel) {
            // Si existe, toggle visibility
            if (panel.style.display === 'none') {
                panel.style.display = 'block';
                console.log(`[INGREDIENTES] Panel expandido para ${articuloCodigo}`);
            } else {
                panel.style.display = 'none';
                console.log(`[INGREDIENTES] Panel colapsado para ${articuloCodigo}`);
            }
            return;
        }
        
        // CORRECCION CRITICA: Buscar el input de cantidad del articulo
        // Para HIJOS: el input tiene data-articulo con el codigo de barras/codigo del hijo
        // Para SIMPLES: el input tiene data-articulo con el codigo alfanumerico
        // Buscar en el contenedor padre (hijoDiv o itemDiv) que contiene tanto el boton como el input
        let inputCantidad = contenedorPadre.querySelector(`input[type="number"][data-articulo="${articuloCodigo}"]`);
        
        // Si no se encuentra, puede ser que el codigo sea diferente (barras vs alfanumerico)
        // Buscar cualquier input de numero en el contenedor
        if (!inputCantidad) {
            inputCantidad = contenedorPadre.querySelector(`input[type="number"]`);
            console.log(`[INGREDIENTES] Input encontrado por selector generico para ${articuloCodigo}`);
        }
        
        const cantidadSolicitada = inputCantidad ? parseFloat(inputCantidad.value) || 1 : 1;
        
        console.log(`[INGREDIENTES] Input encontrado:`, !!inputCantidad);
        console.log(`[INGREDIENTES] Valor del input:`, inputCantidad?.value);
        console.log(`[INGREDIENTES] Cantidad solicitada parseada: ${cantidadSolicitada}`);
        console.log(`[INGREDIENTES] Codigo buscado: ${articuloCodigo}`);
        console.log(`[INGREDIENTES] Data-articulo del input:`, inputCantidad?.getAttribute('data-articulo'));
        
        // Crear panel nuevo
        panel = document.createElement('div');
        panel.className = 'ingredientes-panel';
        panel.setAttribute('data-articulo', articuloCodigo);
        panel.style.cssText = 'width: 100%; padding: 12px; background: #e7f5f7; border: 1px solid #17a2b8; border-radius: 4px; margin-top: 8px;';
        
        let html = '<div style="font-weight: bold; color: #17a2b8; margin-bottom: 8px;">Ingredientes:</div>';
        html += '<ul style="margin: 0; padding-left: 20px; list-style: disc;">';
        
        infoIngredientes.ingredientes.forEach(ing => {
            // Cantidad base de la receta (sin modificar)
            const cantidadBase = parseFloat(ing.cantidad);
            const cantidadBaseFormateada = cantidadBase.toFixed(2).replace(/\.00$/, '');
            
            // Cantidad total calculada (base × cantidad solicitada)
            const cantidadTotal = cantidadBase * cantidadSolicitada;
            const cantidadTotalFormateada = cantidadTotal.toFixed(2).replace(/\.00$/, '');
            
            console.log(`[INGREDIENTES] ${ing.nombre_ingrediente}: Base ${cantidadBase} x Solicitada ${cantidadSolicitada} = Total ${cantidadTotal}`);
            
            html += `
                <li style="margin-bottom: 4px; color: #2c5f6f;">
                    <strong>${ing.nombre_ingrediente}</strong>: ${cantidadBaseFormateada} ${ing.unidad_medida} (Base Receta) - Total: ${cantidadTotalFormateada} ${ing.unidad_medida}
                </li>
            `;
        });
        
        html += '</ul>';
        panel.innerHTML = html;
        
        contenedorPadre.appendChild(panel);
        console.log(`[INGREDIENTES] Panel creado y mostrado para ${articuloCodigo}`);
    }

    /* ============================================
     * MÓDULO DE SUGERENCIAS DE PRODUCCIÓN
     * ============================================ */

    // Cache para sugerencias consultadas
    const cacheSugerencias = new Map();

    /**
     * Obtiene la sugerencia configurada para un artículo
     * @param {string} articuloCodigo - Código del artículo
     * @returns {Promise<Object|null>} Objeto con la sugerencia o null
     */
    async function obtenerSugerenciaArticulo(articuloCodigo) {
        // Verificar cache primero
        if (cacheSugerencias.has(articuloCodigo)) {
            console.log(`[SUGERENCIAS] Usando cache para ${articuloCodigo}`);
            return cacheSugerencias.get(articuloCodigo);
        }

        try {
            console.log(`[SUGERENCIAS] Consultando sugerencia para ${articuloCodigo}`);
            const response = await fetch(`/api/produccion/recetas/${articuloCodigo}/sugerencia`);
            
            if (response.ok) {
                const data = await response.json();
                console.log(`[SUGERENCIAS] Sugerencia encontrada para ${articuloCodigo}:`, data);
                
                // Guardar en cache
                cacheSugerencias.set(articuloCodigo, data);
                return data;
            } else if (response.status === 404) {
                console.log(`[SUGERENCIAS] Artículo ${articuloCodigo} sin receta o sin sugerencia`);
                const resultado = { tiene_sugerencia: false, sugerencia: null };
                cacheSugerencias.set(articuloCodigo, resultado);
                return resultado;
            } else {
                console.error(`[SUGERENCIAS] Error HTTP ${response.status} para ${articuloCodigo}`);
                return null;
            }
        } catch (error) {
            console.error(`[SUGERENCIAS] Error al consultar sugerencia de ${articuloCodigo}:`, error);
            return null;
        }
    }

    /**
     * Crea el botón de sugerencia con estado dinámico
     * @param {string} articuloCodigo - Código del artículo
     * @param {string} articuloNombre - Nombre del artículo
     * @param {HTMLElement} contenedorPadre - Elemento donde se agregará el botón
     * @returns {Promise<HTMLElement>} Botón de sugerencia
     */
    async function agregarBotonSugerencia(articuloCodigo, articuloNombre, contenedorPadre) {
        const infoSugerencia = await obtenerSugerenciaArticulo(articuloCodigo);
        
        const botonSugerencia = document.createElement('button');
        botonSugerencia.className = 'carros-btn-sugerencia';
        
        if (infoSugerencia && infoSugerencia.tiene_sugerencia) {
            // Estado 2: CON VÍNCULO (naranja, ícono de lápiz)
            botonSugerencia.innerHTML = '✏️';
            botonSugerencia.title = `Editar Sugerencia: ${infoSugerencia.sugerencia.nombre}`;
            botonSugerencia.style.cssText = 'background: #fd7e14; color: white; border: none; padding: 0; border-radius: 50%; cursor: pointer; font-size: 10px; font-weight: bold; margin-left: 6px; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;';
            botonSugerencia.setAttribute('data-tiene-sugerencia', 'true');
            botonSugerencia.setAttribute('data-sugerencia-numero', infoSugerencia.sugerencia.articulo_numero);
        } else {
            // Estado 1: SIN VÍNCULO (gris, ícono de link)
            botonSugerencia.innerHTML = '🔗';
            botonSugerencia.title = 'Asignar Sugerencia';
            botonSugerencia.style.cssText = 'background: #6c757d; color: white; border: none; padding: 0; border-radius: 50%; cursor: pointer; font-size: 10px; font-weight: bold; margin-left: 6px; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;';
            botonSugerencia.setAttribute('data-tiene-sugerencia', 'false');
        }
        
        botonSugerencia.addEventListener('click', (e) => {
            e.stopPropagation();
            abrirModalSugerencias(articuloCodigo, articuloNombre, infoSugerencia);
        });
        
        return botonSugerencia;
    }

    /**
     * Abre el modal de configuración de sugerencias
     * @param {string} articuloCodigo - Código del artículo origen
     * @param {string} articuloNombre - Nombre del artículo origen
     * @param {Object} sugerenciaActual - Información de la sugerencia actual (si existe)
     */
    function abrirModalSugerencias(articuloCodigo, articuloNombre, sugerenciaActual) {
        console.log(`[SUGERENCIAS] Abriendo modal para ${articuloCodigo}`);
        
        // Crear overlay del modal
        let modalOverlay = document.getElementById('modal-sugerencias-overlay');
        if (!modalOverlay) {
            modalOverlay = document.createElement('div');
            modalOverlay.id = 'modal-sugerencias-overlay';
            modalOverlay.className = 'modal-sugerencias-overlay';
            document.body.appendChild(modalOverlay);
        }
        
        // Crear contenido del modal
        const modalHTML = `
            <div class="modal-sugerencias-content">
                <div class="modal-sugerencias-header">
                    <h3>Configurar Sugerencia de Producción</h3>
                    <button class="modal-sugerencias-close" onclick="window.cerrarModalSugerencias()">&times;</button>
                </div>
                
                <div class="modal-sugerencias-body">
                    <div class="sugerencia-articulo-origen">
                        <strong>Artículo Origen:</strong> ${articuloNombre} (${articuloCodigo})
                    </div>
                    
                    <div class="sugerencia-buscador-container">
                        <label for="sugerencia-buscador">Buscar artículo sugerido:</label>
                        <input 
                            type="text" 
                            id="sugerencia-buscador" 
                            class="sugerencia-buscador-input"
                            placeholder="Escribir nombre del artículo..."
                            autocomplete="off">
                    </div>
                    
                    <div id="sugerencia-resultados" class="sugerencia-resultados">
                        ${sugerenciaActual && sugerenciaActual.tiene_sugerencia ? 
                            `<div class="sugerencia-actual">
                                <strong>Sugerencia actual:</strong> ${sugerenciaActual.sugerencia.nombre} (${sugerenciaActual.sugerencia.articulo_numero})
                            </div>` : 
                            '<p class="sugerencia-info">Escriba para buscar artículos...</p>'}
                    </div>
                </div>
                
                <div class="modal-sugerencias-footer">
                    ${sugerenciaActual && sugerenciaActual.tiene_sugerencia ? 
                        '<button class="btn-sugerencia-eliminar" onclick="window.eliminarSugerenciaModal()">Eliminar Sugerencia</button>' : ''}
                    <button class="btn-sugerencia-cancelar" onclick="window.cerrarModalSugerencias()">Cancelar</button>
                    <button class="btn-sugerencia-guardar" id="btn-guardar-sugerencia" disabled>Guardar</button>
                </div>
            </div>
        `;
        
        modalOverlay.innerHTML = modalHTML;
        modalOverlay.style.display = 'flex';
        
        // Guardar contexto en el modal
        modalOverlay.setAttribute('data-articulo-origen', articuloCodigo);
        modalOverlay.setAttribute('data-articulo-nombre', articuloNombre);
        
        // Configurar buscador con filtrado multi-criterio
        const buscador = document.getElementById('sugerencia-buscador');
        if (buscador) {
            buscador.addEventListener('input', debounce((e) => {
                buscarArticulosParaSugerencia(e.target.value, articuloCodigo);
            }, 300));
            
            // Enfocar el buscador
            setTimeout(() => buscador.focus(), 100);
        }
        
        // Configurar botón guardar
        const btnGuardar = document.getElementById('btn-guardar-sugerencia');
        if (btnGuardar) {
            btnGuardar.addEventListener('click', guardarSugerenciaModal);
        }
        
        console.log(`[SUGERENCIAS] Modal abierto para ${articuloCodigo}`);
    }

    /**
     * Busca artículos para sugerencia usando filtrado multi-criterio
     * @param {string} textoBusqueda - Texto ingresado por el usuario
     * @param {string} articuloOrigen - Código del artículo origen (para excluirlo)
     */
    async function buscarArticulosParaSugerencia(textoBusqueda, articuloOrigen) {
        const resultadosDiv = document.getElementById('sugerencia-resultados');
        
        if (!textoBusqueda || textoBusqueda.trim() === '') {
            resultadosDiv.innerHTML = '<p class="sugerencia-info">Escriba para buscar artículos...</p>';
            return;
        }
        
        console.log(`[SUGERENCIAS] Buscando artículos con: "${textoBusqueda}"`);
        
        try {
            // Obtener todos los artículos
            const response = await fetch('/api/produccion/articulos');
            if (!response.ok) {
                throw new Error('Error al obtener artículos');
            }
            
            const todosLosArticulos = await response.json();
            
            // Aplicar filtrado multi-criterio (reutilizar lógica de gestionArticulos.js)
            const articulosFiltrados = filtrarArticulosMultiCriterio(todosLosArticulos, textoBusqueda)
                .filter(art => art.numero !== articuloOrigen) // Excluir el artículo origen
                .slice(0, 20); // Limitar a 20 resultados
            
            console.log(`[SUGERENCIAS] Artículos encontrados: ${articulosFiltrados.length}`);
            
            if (articulosFiltrados.length === 0) {
                resultadosDiv.innerHTML = '<p class="sugerencia-info">No se encontraron artículos</p>';
                return;
            }
            
            // Renderizar resultados
            resultadosDiv.innerHTML = '';
            articulosFiltrados.forEach(articulo => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'sugerencia-resultado-item';
                itemDiv.innerHTML = `
                    <input type="radio" 
                           name="articulo-sugerido" 
                           value="${articulo.numero}" 
                           id="sug-${articulo.numero}">
                    <label for="sug-${articulo.numero}">
                        <strong>${articulo.nombre}</strong><br>
                        <small>Código: ${articulo.numero} ${articulo.codigo_barras ? `· Barras: ${articulo.codigo_barras}` : ''}</small>
                    </label>
                `;
                
                const radio = itemDiv.querySelector('input[type="radio"]');
                radio.addEventListener('change', () => {
                    document.getElementById('btn-guardar-sugerencia').disabled = false;
                });
                
                resultadosDiv.appendChild(itemDiv);
            });
            
        } catch (error) {
            console.error('[SUGERENCIAS] Error al buscar artículos:', error);
            resultadosDiv.innerHTML = '<p class="sugerencia-error">Error al buscar artículos</p>';
        }
    }

    /**
     * Filtra artículos usando lógica multi-criterio (AND)
     * Reutiliza la misma lógica implementada en gestionArticulos.js
     * @param {Array} articulos - Array de artículos
     * @param {string} texto - Texto de búsqueda
     * @returns {Array} Artículos filtrados
     */
    function filtrarArticulosMultiCriterio(articulos, texto) {
        if (!texto || texto.trim() === '') {
            return articulos;
        }
        
        // Normalizar texto (eliminar acentos y convertir a minúsculas)
        const normalizarTexto = (str) => {
            if (!str) return '';
            return str.toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
        };
        
        const textoNormalizado = normalizarTexto(texto);
        const tokens = textoNormalizado.split(/\s+/).filter(t => t.length > 0);
        
        if (tokens.length === 0) {
            return articulos;
        }
        
        return articulos.filter(articulo => {
            const nombreNormalizado = normalizarTexto(articulo.nombre);
            return tokens.every(token => nombreNormalizado.includes(token));
        });
    }

    /**
     * Guarda la sugerencia seleccionada
     */
    async function guardarSugerenciaModal() {
        const modalOverlay = document.getElementById('modal-sugerencias-overlay');
        const articuloOrigen = modalOverlay.getAttribute('data-articulo-origen');
        const radioSeleccionado = document.querySelector('input[name="articulo-sugerido"]:checked');
        
        if (!radioSeleccionado) {
            mostrarMensaje('Debe seleccionar un artículo', 'error');
            return;
        }
        
        const articuloSugerido = radioSeleccionado.value;
        
        console.log(`[SUGERENCIAS] Guardando: ${articuloOrigen} → ${articuloSugerido}`);
        
        try {
            const response = await fetch(`/api/produccion/recetas/${articuloOrigen}/sugerencia`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ articulo_sugerido_numero: articuloSugerido })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Error al guardar sugerencia');
            }
            
            const data = await response.json();
            console.log(`[SUGERENCIAS] ✅ Sugerencia guardada:`, data);
            
            // Invalidar cache
            cacheSugerencias.delete(articuloOrigen);
            
            mostrarMensaje('Sugerencia guardada exitosamente', 'exito');
            cerrarModalSugerencias();
            
            // Refrescar la vista para actualizar el botón
            if (typeof window.actualizarResumenFaltantes === 'function') {
                setTimeout(() => window.actualizarResumenFaltantes(), 500);
            }
            
        } catch (error) {
            console.error('[SUGERENCIAS] Error al guardar:', error);
            mostrarMensaje(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Elimina la sugerencia configurada
     */
    async function eliminarSugerenciaModal() {
        const modalOverlay = document.getElementById('modal-sugerencias-overlay');
        const articuloOrigen = modalOverlay.getAttribute('data-articulo-origen');
        
        if (!confirm('¿Está seguro de eliminar esta sugerencia?')) {
            return;
        }
        
        console.log(`[SUGERENCIAS] Eliminando sugerencia para: ${articuloOrigen}`);
        
        try {
            const response = await fetch(`/api/produccion/recetas/${articuloOrigen}/sugerencia`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Error al eliminar sugerencia');
            }
            
            console.log(`[SUGERENCIAS] ✅ Sugerencia eliminada`);
            
            // Invalidar cache
            cacheSugerencias.delete(articuloOrigen);
            
            mostrarMensaje('Sugerencia eliminada exitosamente', 'exito');
            cerrarModalSugerencias();
            
            // Refrescar la vista para actualizar el botón
            if (typeof window.actualizarResumenFaltantes === 'function') {
                setTimeout(() => window.actualizarResumenFaltantes(), 500);
            }
            
        } catch (error) {
            console.error('[SUGERENCIAS] Error al eliminar:', error);
            mostrarMensaje(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Cierra el modal de sugerencias
     */
    function cerrarModalSugerencias() {
        const modalOverlay = document.getElementById('modal-sugerencias-overlay');
        if (modalOverlay) {
            modalOverlay.style.display = 'none';
            modalOverlay.innerHTML = '';
        }
        console.log('[SUGERENCIAS] Modal cerrado');
    }

    /**
     * Procesa y renderiza las sugerencias derivadas de los faltantes
     * CORRECCIÓN: Hace su propia llamada al endpoint para obtener datos con sugerencias
     */
    async function procesarYRenderizarSugerencias() {
        console.log('[SUGERENCIAS-RENDER] Iniciando procesamiento de sugerencias...');
        
        // Buscar o crear contenedor de sugerencias
        let containerSugerencias = document.getElementById('carros-sugerencias-container');
        
        if (!containerSugerencias) {
            // Crear contenedor si no existe
            const containerPrincipal = document.getElementById('carros-lista-container');
            if (!containerPrincipal || !containerPrincipal.parentElement) {
                console.error('[SUGERENCIAS-RENDER] No se encontró contenedor principal');
                return;
            }
            
            containerSugerencias = document.createElement('div');
            containerSugerencias.id = 'carros-sugerencias-container';
            containerSugerencias.style.cssText = 'margin-top: 30px;';
            
            // Insertar después del contenedor de faltantes
            containerPrincipal.parentElement.insertBefore(
                containerSugerencias, 
                containerPrincipal.nextSibling
            );
            
            console.log('[SUGERENCIAS-RENDER] Contenedor de sugerencias creado');
        }
        
        try {
            // Obtener fecha de corte
            const fechaCorte = document.getElementById('fecha-corte-articulos')?.value || '';
            
            let url = '/api/produccion/pedidos-articulos';
            if (fechaCorte) {
                url += `?fecha=${fechaCorte}`;
            }
            
            console.log(`[SUGERENCIAS-RENDER] Consultando endpoint: ${url}`);
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }
            
            const result = await response.json();
            const articulos = result.data || [];
            
            console.log(`[SUGERENCIAS-RENDER] Artículos recibidos: ${articulos.length}`);
            
            // Filtrar solo artículos con sugerencia configurada
            const articulosConSugerencia = articulos.filter(art => art.articulo_sugerido_numero);
            
            console.log(`[SUGERENCIAS-RENDER] Artículos con sugerencia: ${articulosConSugerencia.length}`);
            
            if (articulosConSugerencia.length > 0) {
                console.log('[SUGERENCIAS-RENDER] Detalles de sugerencias encontradas:');
                articulosConSugerencia.forEach(art => {
                    console.log(`  - ${art.articulo_numero} → ${art.articulo_sugerido_numero} (${art.articulo_sugerido_nombre})`);
                });
            }
            
            // Consolidar sugerencias con cálculo correcto de cantidades
            // CORRECCIÓN: Usar factor_conversion_sugerencia del backend
            const sugerenciasMap = new Map();
            
            for (const faltante of articulosConSugerencia) {
                const sugeridoNumero = faltante.articulo_sugerido_numero;
                
                // Calcular cantidad real considerando jerarquía padre/hijo y factor de conversión
                let cantidadCalculada = parseFloat(faltante.faltante || 0);
                
                // Si el artículo origen es un pack, obtener el pack mapping para calcular cantidad de hijos
                const packMapping = await obtenerPackMappingLocal(faltante.articulo_numero);
                
                if (packMapping) {
                    // Es un pack: cantidad de hijos = cantidad de packs × unidades por pack
                    const unidadesPorPack = parseFloat(packMapping.unidades || packMapping.multiplicador_ingredientes || 1);
                    const cantidadHijos = cantidadCalculada * unidadesPorPack;
                    
                    console.log(`[SUGERENCIAS-CALC] Pack ${faltante.articulo_numero}: ${cantidadCalculada} packs × ${unidadesPorPack} unidades = ${cantidadHijos} hijos`);
                    
                    // Obtener el código alfanumérico del hijo para buscar su receta
                    const codigoHijo = packMapping.articulo_kilo_numero || packMapping.articulo_kilo_codigo;
                    
                    // Obtener factor del artículo ORIGEN (hijo)
                    const factorOrigen = await obtenerFactorConversionIngrediente(codigoHijo, sugeridoNumero);
                    
                    // Obtener factor del artículo SUGERIDO
                    const factorSugerido = await obtenerFactorConversionIngrediente(sugeridoNumero, sugeridoNumero);
                    
                    // Calcular factor de conversión real
                    const factorConversion = factorOrigen / factorSugerido;
                    
                    // Aplicar factor de conversión de la receta
                    cantidadCalculada = cantidadHijos * factorConversion;
                    console.log(`[SUGERENCIAS-CALC] ${cantidadHijos} hijos × (${factorOrigen} / ${factorSugerido}) = ${cantidadHijos} × ${factorConversion} = ${cantidadCalculada} total`);
                } else {
                    // Es un artículo simple: obtener ambos factores
                    const factorOrigen = await obtenerFactorConversionIngrediente(faltante.articulo_numero, sugeridoNumero);
                    const factorSugerido = await obtenerFactorConversionIngrediente(sugeridoNumero, sugeridoNumero);
                    
                    // Calcular factor de conversión real
                    const factorConversion = factorOrigen / factorSugerido;
                    
                    // Aplicar factor de conversión
                    cantidadCalculada = cantidadCalculada * factorConversion;
                    console.log(`[SUGERENCIAS-CALC] Simple ${faltante.articulo_numero}: ${faltante.faltante} × (${factorOrigen} / ${factorSugerido}) = ${faltante.faltante} × ${factorConversion} = ${cantidadCalculada}`);
                }
                
                if (sugerenciasMap.has(sugeridoNumero)) {
                    // Si ya existe, sumar la cantidad calculada
                    const existente = sugerenciasMap.get(sugeridoNumero);
                    existente.cantidad_total += cantidadCalculada;
                    existente.articulos_origen.push(faltante.articulo_numero);
                    console.log(`[SUGERENCIAS-CALC] Consolidando ${sugeridoNumero}: +${cantidadCalculada} = ${existente.cantidad_total}`);
                } else {
                    // Crear nueva entrada
                    sugerenciasMap.set(sugeridoNumero, {
                        articulo_numero: sugeridoNumero,
                        descripcion: faltante.articulo_sugerido_nombre || sugeridoNumero,
                        codigo_barras: faltante.articulo_sugerido_codigo_barras,
                        cantidad_total: cantidadCalculada,
                        stock_disponible: parseFloat(faltante.articulo_sugerido_stock || 0),
                        articulos_origen: [faltante.articulo_numero]
                    });
                    console.log(`[SUGERENCIAS-CALC] Nueva sugerencia ${sugeridoNumero}: cantidad=${cantidadCalculada}`);
                }
            }
            
            const sugerencias = Array.from(sugerenciasMap.values());
            
            console.log(`[SUGERENCIAS-RENDER] ${sugerencias.length} sugerencias únicas consolidadas`);
            
            if (sugerencias.length === 0) {
                containerSugerencias.innerHTML = '';
                containerSugerencias.style.display = 'none';
                console.log('[SUGERENCIAS-RENDER] No hay sugerencias para mostrar');
                return;
            }
            
            // Renderizar sección de sugerencias
            containerSugerencias.style.display = 'block';
            containerSugerencias.innerHTML = `
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 12px 16px; border-radius: 8px 8px 0 0; margin-bottom: 0;">
                    <h3 style="margin: 0; color: white; font-size: 1.1em; display: flex; align-items: center; gap: 8px;">
                        💡 Sugerencias de Producción
                        <span style="background: rgba(255,255,255,0.3); padding: 2px 8px; border-radius: 12px; font-size: 0.85em;">${sugerencias.length}</span>
                    </h3>
                </div>
                <div id="sugerencias-lista" style="background: #f8f9fa; padding: 12px; border-radius: 0 0 8px 8px; border: 2px solid #667eea; border-top: none;"></div>
            `;
            
            const listaSugerencias = document.getElementById('sugerencias-lista');
            
            // Renderizar cada sugerencia
            for (const sugerencia of sugerencias) {
                console.log(`[SUGERENCIAS-RENDER] Renderizando sugerencia: ${sugerencia.articulo_numero}`);
                const itemDiv = await crearItemSugerencia(sugerencia);
                listaSugerencias.appendChild(itemDiv);
            }
            
            console.log(`[SUGERENCIAS-RENDER] ✅ ${sugerencias.length} sugerencias renderizadas exitosamente`);
            
        } catch (error) {
            console.error('[SUGERENCIAS-RENDER] Error al procesar sugerencias:', error);
            containerSugerencias.innerHTML = '<p class="mensaje-error">Error al cargar sugerencias</p>';
        }
    }
    
    /**
     * Crea el elemento visual para una sugerencia
     * @param {Object} sugerencia - Datos de la sugerencia
     * @returns {Promise<HTMLElement>} Elemento div de la sugerencia
     */
    async function crearItemSugerencia(sugerencia) {
        const cantidadTotal = parseFloat(sugerencia.cantidad_total || 0);
        const stockDisponible = parseFloat(sugerencia.stock_disponible || 0);
        const faltante = Math.max(0, cantidadTotal - stockDisponible);
        
        let estado = 'faltante';
        let estadoTexto = 'FALTANTE';
        if (stockDisponible > 0 && faltante < cantidadTotal) {
            estado = 'parcial';
            estadoTexto = 'PARCIAL';
        } else if (faltante === 0) {
            estado = 'completo';
            estadoTexto = 'COMPLETO';
        }
        
        const itemDiv = document.createElement('div');
        itemDiv.className = `carros-item carros-item-sugerencia ${estado}`;
        itemDiv.setAttribute('data-articulo', sugerencia.articulo_numero);
        itemDiv.style.cssText = 'padding: 8px 12px; margin-bottom: 8px; background: white; border-left: 4px solid #667eea;';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'carros-item-checkbox';
        checkbox.setAttribute('data-articulo', sugerencia.articulo_numero);
        checkbox.addEventListener('change', (e) => {
            manejarSeleccionSugerencia(sugerencia, e.target.checked, faltante);
        });
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'carros-item-info';
        infoDiv.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 2px;';
        
        const descripcionSpan = document.createElement('span');
        descripcionSpan.className = 'carros-item-descripcion';
        descripcionSpan.innerHTML = `💡 ${sugerencia.descripcion || sugerencia.articulo_numero}`;
        descripcionSpan.style.color = '#667eea';
        descripcionSpan.style.fontWeight = '600';
        
        const codigoSpan = document.createElement('span');
        codigoSpan.className = 'carros-item-codigo';
        const codigoBarrasTexto = sugerencia.codigo_barras ? ` · Barras: ${sugerencia.codigo_barras}` : '';
        codigoSpan.textContent = `Código: ${sugerencia.articulo_numero}${codigoBarrasTexto}`;
        
        const origenSpan = document.createElement('span');
        origenSpan.style.fontSize = '11px';
        origenSpan.style.color = '#6c757d';
        origenSpan.style.fontStyle = 'italic';
        origenSpan.textContent = `Sugerido por: ${sugerencia.articulos_origen.join(', ')}`;
        
        const estadoSpan = document.createElement('span');
        estadoSpan.className = `carros-item-estado ${estado}`;
        estadoSpan.textContent = `${estadoTexto} (${faltante.toFixed(2)}) · Stock: ${stockDisponible.toFixed(2)}`;
        
        infoDiv.appendChild(descripcionSpan);
        infoDiv.appendChild(codigoSpan);
        infoDiv.appendChild(origenSpan);
        infoDiv.appendChild(estadoSpan);
        
        // Agregar botones de ingredientes y sugerencias
        const botonIngredientes = await agregarBotonIngredientes(sugerencia, itemDiv);
        const botonSugerencia = await agregarBotonSugerencia(
            sugerencia.articulo_numero, 
            sugerencia.descripcion || sugerencia.articulo_numero, 
            itemDiv
        );
        infoDiv.appendChild(botonIngredientes);
        infoDiv.appendChild(botonSugerencia);
        
        const cantidadDiv = document.createElement('div');
        cantidadDiv.className = 'carros-item-cantidad';
        
        const labelCantidad = document.createElement('label');
        labelCantidad.textContent = 'Cant:';
        
        const inputCantidad = document.createElement('input');
        inputCantidad.type = 'number';
        inputCantidad.min = '0';
        inputCantidad.step = '0.01';
        inputCantidad.value = faltante.toFixed(2);
        inputCantidad.setAttribute('data-articulo', sugerencia.articulo_numero);
        inputCantidad.addEventListener('change', (e) => {
            actualizarCantidadArticulo(sugerencia.articulo_numero, parseFloat(e.target.value) || 0);
        });
        
        cantidadDiv.appendChild(labelCantidad);
        cantidadDiv.appendChild(inputCantidad);
        
        itemDiv.appendChild(checkbox);
        itemDiv.appendChild(infoDiv);
        itemDiv.appendChild(cantidadDiv);
        
        return itemDiv;
    }
    
    /**
     * Obtiene el factor de conversión consultando la receta del artículo origen
     * CORRECCIÓN: Busca el ingrediente que coincida con el sugerido por nombre
     * @param {string} articuloOrigenCodigo - Código del artículo ORIGEN (ej: MS5)
     * @param {string} articuloSugeridoCodigo - Código del artículo SUGERIDO (ej: MSXK)
     * @returns {Promise<number>} Factor de conversión (cantidad del ingrediente) o 1 si no se encuentra
     */
    async function obtenerFactorConversionIngrediente(articuloOrigenCodigo, articuloSugeridoCodigo) {
        try {
            console.log(`[FACTOR-CONV] Consultando receta de ${articuloOrigenCodigo} para buscar ingrediente relacionado con ${articuloSugeridoCodigo}`);
            
            // Consultar la receta del artículo ORIGEN
            const response = await fetch(`/api/produccion/recetas/${articuloOrigenCodigo}`);
            
            if (!response.ok) {
                console.log(`[FACTOR-CONV] No se encontró receta para ${articuloOrigenCodigo}, usando factor 1`);
                return 1;
            }
            
            const receta = await response.json();
            console.log(`[FACTOR-CONV] Receta obtenida para ${articuloOrigenCodigo}:`, receta);
            
            // Buscar en el array de ingredientes
            if (receta.ingredientes && Array.isArray(receta.ingredientes) && receta.ingredientes.length > 0) {
                console.log(`[FACTOR-CONV] Analizando ${receta.ingredientes.length} ingredientes...`);
                
                // CORRECCIÓN CRÍTICA: Buscar el ingrediente cuyo nombre_ingrediente coincida con el artículo sugerido
                // Ejemplo: Si sugerido es "MSXK", buscar ingrediente con nombre_ingrediente = "MSXK"
                const ingrediente = receta.ingredientes.find(ing => {
                    const coincide = ing.nombre_ingrediente === articuloSugeridoCodigo;
                    if (coincide) {
                        console.log(`[FACTOR-CONV] Ingrediente encontrado:`, ing);
                    }
                    return coincide;
                });
                
                if (ingrediente && ingrediente.cantidad) {
                    const factor = parseFloat(ingrediente.cantidad);
                    console.log(`[FACTOR-CONV] ✅ Factor encontrado: ${factor} ${ingrediente.unidad_medida || ''}`);
                    console.log(`[FACTOR-CONV] Detalle: ${articuloOrigenCodigo} lleva ${factor} ${ingrediente.unidad_medida} de ${ingrediente.nombre_ingrediente}`);
                    return factor;
                }
                
                // Si no se encontró por coincidencia exacta, tomar el primer ingrediente como fallback
                // Esto cubre casos donde el nombre del ingrediente no coincide exactamente con el código del sugerido
                console.log(`[FACTOR-CONV] No se encontró coincidencia exacta, usando primer ingrediente como fallback`);
                const primerIngrediente = receta.ingredientes[0];
                if (primerIngrediente && primerIngrediente.cantidad) {
                    const factor = parseFloat(primerIngrediente.cantidad);
                    console.log(`[FACTOR-CONV] ✅ Factor (fallback): ${factor} ${primerIngrediente.unidad_medida || ''}`);
                    console.log(`[FACTOR-CONV] Detalle: ${articuloOrigenCodigo} lleva ${factor} ${primerIngrediente.unidad_medida} de ${primerIngrediente.nombre_ingrediente}`);
                    return factor;
                }
            }
            
            // Buscar en el array de artículos (si los ingredientes son artículos)
            if (receta.articulos && Array.isArray(receta.articulos) && receta.articulos.length > 0) {
                console.log(`[FACTOR-CONV] Buscando en ${receta.articulos.length} artículos...`);
                
                const articulo = receta.articulos.find(art => 
                    art.articulo_numero === articuloSugeridoCodigo
                );
                
                if (articulo && articulo.cantidad) {
                    const factor = parseFloat(articulo.cantidad);
                    console.log(`[FACTOR-CONV] ✅ Factor encontrado en artículos: ${factor}`);
                    return factor;
                }
            }
            
            console.log(`[FACTOR-CONV] ⚠️ No se encontró factor de conversión para ${articuloOrigenCodigo}, usando factor 1`);
            return 1;
            
        } catch (error) {
            console.error(`[FACTOR-CONV] ❌ Error:`, error);
            return 1;
        }
    }

    /**
     * Maneja la selección de una sugerencia
     * @param {Object} sugerencia - Datos de la sugerencia
     * @param {boolean} seleccionado - Si está seleccionado o no
     * @param {number} cantidadFaltante - Cantidad faltante calculada
     */
    function manejarSeleccionSugerencia(sugerencia, seleccionado, cantidadFaltante) {
        const articuloNumero = sugerencia.articulo_numero;
        
        if (seleccionado) {
            estadoCarros.articulosSeleccionados.set(articuloNumero, {
                articulo: {
                    articulo_numero: sugerencia.articulo_numero,
                    codigo_barras: sugerencia.codigo_barras,
                    descripcion: sugerencia.descripcion,
                    faltante: cantidadFaltante
                },
                cantidad: cantidadFaltante,
                esHijo: false,
                codigoPadre: null,
                esSugerencia: true
            });
            console.log(`[CARROS-UI] SUGERENCIA seleccionada: ${articuloNumero} (${cantidadFaltante})`);
        } else {
            estadoCarros.articulosSeleccionados.delete(articuloNumero);
            console.log(`[CARROS-UI] SUGERENCIA deseleccionada: ${articuloNumero}`);
        }
        
        actualizarEstadoBotones();
    }


    /**
     * Función debounce para optimizar búsquedas
     */
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /* ============================================
     * FIN MÓDULO DE SUGERENCIAS
     * ============================================ */

    document.addEventListener('DOMContentLoaded', () => {
        console.log('[CARROS-UI] DOMContentLoaded - Inicializando...');
        inicializarPanelCarros();
    });

    // Exponer funciones globalmente
    window.configurarCarrosUI = {
        refrescarDatos: refrescarDatosPostCreacion,
        limpiarSeleccion: limpiarSeleccion
    };
    
    // Exponer funciones de sugerencias globalmente para uso en HTML
    window.cerrarModalSugerencias = cerrarModalSugerencias;
    window.guardarSugerenciaModal = guardarSugerenciaModal;
    window.eliminarSugerenciaModal = eliminarSugerenciaModal;

})();