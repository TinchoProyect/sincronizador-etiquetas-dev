/**
 * [CARROS-UI] Módulo para configurar carros desde la portada de Producción
 * Permite armar carros directamente desde el Resumen de Faltantes y Parciales
 * sin navegar al espacio de trabajo por usuario.
 * 
 * REGLA: Solo se seleccionan HIJOS de packs y artículos SIMPLES.
 * Los padres de pack son solo referencia visual.
 */

(function () {
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

        container.innerHTML = `
            <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border: 1.5px solid #7dd3fc; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                    <strong style="color: #075985; font-size: 13.5px;">📦 2° Etapa — Fracciones Comerciales Pedidas (Línea de Negocio 2)</strong>
                    <span style="background: #ffffff; color: #0369a1; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; border: 1px solid #7dd3fc;">Envasado Final</span>
                </div>
                <div style="font-size: 12px; color: #0c4a6e; margin-top: 4px;">
                    Estos son los artículos fraccionados que pidieron los clientes (ej: x 2kg, x 5kg). Se arman a partir del <strong>ingrediente simple</strong> (que recibe al Artículo Puente del mix). Si primero necesitás preparar la mezcla a granel, armá el carro desde <strong>"Sugerencias de Producción (Línea 3 — 1° Etapa)"</strong> más abajo.
                </div>
            </div>
        `;

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
                const faltante = parseFloat(art.faltante || 0);
                return estado === 'FALTANTE' || estado === 'PARCIAL' || faltante > 0;
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

            // NUEVA FUNCIONALIDAD: Agregar botones de ingredientes, receta inline y sugerencias para HIJO
            const articuloHijo = {
                articulo_numero: packMapping.articulo_kilo_numero || packMapping.articulo_kilo_codigo,
                codigo_barras: packMapping.articulo_kilo_codigo_barras || packMapping.articulo_kilo_codigo,
                descripcion: packMapping.articulo_kilo_nombre || 'Sin descripción'
            };
            const filaAccionesHijo = await construirFilaAccionesReceta(articuloHijo, hijoDiv);
            hijoInfoDiv.appendChild(filaAccionesHijo);

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
                manejarSeleccionArticuloSimple(articulo, e.target.checked, e.target);
            });

            const infoDiv = document.createElement('div');
            infoDiv.className = 'carros-item-info';
            infoDiv.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 2px;';

            console.log(`[CFG-CARROS] render item => {numero: ${articulo.articulo_numero}, barras: ${articulo.codigo_barras || 'N/A'}, descripcion: ${articulo.descripcion}}`);

            const descripcionSpan = document.createElement('span');
            descripcionSpan.className = 'carros-item-descripcion';
            const textoDescSimple = articulo.descripcion || articulo.articulo_numero || 'Sin descripción';
            descripcionSpan.innerHTML = `${textoDescSimple} <span style="background: #e0f2fe; color: #075985; font-size: 10.5px; font-weight: 700; padding: 1px 6px; border-radius: 4px; border: 1px solid #bae6fd; margin-left: 6px; white-space: nowrap;">📦 L2 Fracción (2° Etapa)</span>`;

            const codigoSpan = document.createElement('span');
            codigoSpan.className = 'carros-item-codigo';
            const codigoBarrasTexto = articulo.codigo_barras ? ` · Barras: ${articulo.codigo_barras}` : '';
            codigoSpan.textContent = `Código: ${articulo.articulo_numero}${codigoBarrasTexto}`;

            const estadoSpan = document.createElement('span');
            estadoSpan.className = `carros-item-estado ${estado}`;
            const infoPedidos = articulo.total_pedidos && articulo.total_pedidos > 1 ? ` · ${articulo.total_pedidos} pedidos` : '';
            estadoSpan.textContent = `${estadoTexto} (${faltante.toFixed(2)}${infoPedidos})`;

            infoDiv.appendChild(descripcionSpan);
            infoDiv.appendChild(codigoSpan);
            infoDiv.appendChild(estadoSpan);

            // NUEVA FUNCIONALIDAD: Agregar botones de ingredientes, receta inline y sugerencias para SIMPLE
            const filaAccionesSimple = await construirFilaAccionesReceta(articulo, itemDiv);
            infoDiv.appendChild(filaAccionesSimple);

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

    /**
     * Determina la línea de negocio actual de los artículos ya seleccionados en estadoCarros
     * @returns {number|null} 3 (Artículos Puente / Mixes), 2 (Fracciones Comerciales) o null si vacío
     */
    function obtenerLineaNegocioSeleccionada() {
        for (const [, it] of estadoCarros.articulosSeleccionados) {
            if (it.lineaNegocio) return it.lineaNegocio;
            if (it.esSugerencia) return 3;
            return 2;
        }
        return null;
    }

    function validarCompatibilidadLineaSeleccion(nuevaLinea, checkboxEl) {
        const lineaActual = obtenerLineaNegocioSeleccionada();
        if (lineaActual && lineaActual !== nuevaLinea) {
            if (checkboxEl) checkboxEl.checked = false;
            const msg = lineaActual === 3
                ? '⚠️ Ya seleccionaste un Artículo Puente / Mix x Kilo (Línea 3 — 1° Etapa). Armá primero el carro del Mix y en otro carro separado las Fracciones (Línea 2).'
                : '⚠️ Ya seleccionaste Fracciones Comerciales (Línea 2 — 2° Etapa). No mezcles en el mismo carro una fracción comercial con un Artículo Puente de 1° Etapa (Línea 3).';
            mostrarMensaje(msg, 'error');
            return false;
        }
        return true;
    }

    function manejarSeleccionArticuloSimple(articulo, seleccionado, checkboxEl) {
        const articuloNumero = articulo.articulo_numero;

        if (seleccionado) {
            if (!validarCompatibilidadLineaSeleccion(2, checkboxEl)) return;
            const inputCant = document.querySelector(`.carros-item:not(.carros-item-sugerencia) input[type="number"][data-articulo="${escaparSelectorAttr(articuloNumero)}"]`);
            const faltante = inputCant ? (parseFloat(inputCant.value) || parseFloat(articulo.faltante || 0)) : parseFloat(articulo.faltante || 0);
            estadoCarros.articulosSeleccionados.set(articuloNumero, {
                articulo: articulo,
                cantidad: faltante,
                esHijo: false,
                codigoPadre: null,
                esSugerencia: false,
                lineaNegocio: 2
            });
            console.log(`[CARROS-UI] Artículo SIMPLE (Línea 2) seleccionado: ${articuloNumero} (${faltante})`);
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
            const checkboxEl = document.querySelector(`.carros-item-checkbox[data-articulo="${escaparSelectorAttr(codigoHijo)}"][data-es-hijo="true"]`);
            if (!validarCompatibilidadLineaSeleccion(2, checkboxEl)) return;
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
                unidadesPorPack: packMapping.unidades || packMapping.multiplicador_ingredientes,
                esSugerencia: false,
                lineaNegocio: 2
            });
            console.log(`[CARROS-UI] HIJO (Línea 2) seleccionado: ${codigoHijo} (${cantidadCalculada}) del padre ${codigoPadre}`);
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

    async function actualizarEstimacionConfiguracionCarro() {
        const container = document.getElementById('carros-estimacion-tiempo-panel');
        if (!container) return;

        if (estadoCarros.articulosSeleccionados.size === 0) {
            container.style.display = 'none';
            return;
        }

        const items = [];
        estadoCarros.articulosSeleccionados.forEach((it, cod) => {
            if (it.cantidad > 0) {
                items.push({
                    articulo_numero: cod,
                    cantidad: it.cantidad,
                    descripcion: it.descripcion || ''
                });
            }
        });

        if (items.length === 0) {
            container.style.display = 'none';
            return;
        }

        try {
            const res = await fetch('/api/tiempos/estimacion-articulos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ articulos: items })
            });

            if (res.ok) {
                const data = await res.json();
                container.style.display = 'flex';
                const valEl = document.getElementById('carros-estimacion-val');
                const badgeEl = document.getElementById('carros-estimacion-badge');
                if (valEl) valEl.textContent = data.tiempo_formateado || '~ 0 min';

                if (badgeEl) {
                    badgeEl.className = 'badge-origen-tiempo';
                    if (data.origen_general === 'planta') {
                        badgeEl.style.cssText = 'background: #ecfdf5; color: #065f46; border: 1px solid #10b981; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;';
                        badgeEl.textContent = '🟢 Planta';
                    } else if (data.origen_general === 'mixto' || data.origen_general === 'planta_parcial') {
                        badgeEl.style.cssText = 'background: #eff6ff; color: #1e40af; border: 1px solid #60a5fa; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;';
                        badgeEl.textContent = '🔵 Planta + Teórico';
                    } else if (data.origen_general === 'arbitraria') {
                        badgeEl.style.cssText = 'background: #fffbeb; color: #92400e; border: 1px solid #f59e0b; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;';
                        badgeEl.textContent = '🟡 Teórico';
                    } else {
                        badgeEl.style.cssText = 'background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;';
                        badgeEl.textContent = '⚪ Sin datos';
                    }
                }
            }
        } catch (e) {
            console.warn('[CARROS-UI] Error obteniendo estimación de tiempo:', e);
        }
    }

    function actualizarEstadoBotones() {
        const btnArmarUno = document.getElementById('carros-armar-uno-btn');

        const tieneUsuario = estadoCarros.usuarioSeleccionado !== null;
        const tieneArticulos = estadoCarros.articulosSeleccionados.size > 0;
        const lineaSeleccionada = obtenerLineaNegocioSeleccionada();

        if (btnArmarUno) {
            btnArmarUno.disabled = !(tieneUsuario && tieneArticulos);
            if (lineaSeleccionada === 3) {
                btnArmarUno.innerHTML = '🥣 Armar Carro Línea 3 (Art. Puente / Mix x Kilo)';
            } else if (lineaSeleccionada === 2) {
                btnArmarUno.innerHTML = '📦 Armar Carro Línea 2 (Fracciones Comerciales)';
            } else {
                btnArmarUno.innerHTML = 'Armar un carro';
            }
        }

        // ⏱️ Actualizar estimación de tiempo del carro en armado
        actualizarEstimacionConfiguracionCarro();

        console.log(`[CARROS-UI] Botones actualizados - Usuario: ${tieneUsuario}, Artículos: ${tieneArticulos}, Línea: ${lineaSeleccionada}`);
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

        const lineaNegocioCarro = obtenerLineaNegocioSeleccionada() || 2;
        const etiquetaLinea = lineaNegocioCarro === 3
            ? 'Línea 3 (Artículo Puente / Mix x Kilo)'
            : 'Línea 2 (Fracciones Comerciales)';

        mostrarMensaje(`Creando carro de ${etiquetaLinea}...`, 'info');

        try {
            console.log(`[CARROS-UI] PASO 1: Creando carro de ${etiquetaLinea}...`);
            const payloadCrearCarro = {
                usuarioId: estadoCarros.usuarioSeleccionado,
                enAuditoria: false,
                tipoCarro: 'interna',
                lineaNegocio: lineaNegocioCarro
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
                mostrarMensaje(`✅ Carro de ${etiquetaLinea} creado con ${articulosAgregados} artículo(s)`, 'exito');
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
            localStorage.setItem('carroActivoSolicitado', String(carroId));
            sessionStorage.setItem('carroActivo', String(carroId));

            console.log('[PROD-FLUJO] Abriendo ventana con datos:', {
                carroId: carroId,
                usuarioId: usuarioId,
                nombreUsuario: usuario.nombre_completo
            });

            // Abrir ventana del carro pasando ?carroId= para garantizar que seleccione el carro recién creado incluso si la pestaña ya estaba abierta
            window.open(`/pages/produccion_personal.html?carroId=${encodeURIComponent(carroId)}`, `ventanaProduccion_${usuarioId}`);

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
    function escaparSelectorAttr(val) {
        return String(val ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function escaparHtmlBasico(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

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
                let response = await fetch(`/api/produccion/receta-detalle?codigo=${codigoEncoded}`);
                if (response.status === 404) {
                    // Verificar si la ruta nueva no está montada o si realmente es 404 de receta
                    const errBody = await response.clone().json().catch(() => null);
                    if (!errBody || !errBody.error) {
                        response = await fetch(`/api/produccion/recetas/${codigoEncoded}`);
                    }
                }

                if (response.ok) {
                    const receta = await response.json();
                    console.log(`[INGREDIENTES] (${tipo}) Receta encontrada para ${codigo}:`, receta);
                    return {
                        tieneReceta: true,
                        descripcion: receta.descripcion || '',
                        ingredientes: receta.ingredientes || [],
                        articulos: receta.articulos || []
                    };
                } else if (response.status === 404) {
                    console.log(`[INGREDIENTES] (${tipo}) Articulo ${codigo} sin receta (404)`);
                    return { tieneReceta: false, ingredientes: [], articulos: [] };
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

        if (resultado && !resultado.tieneReceta && articulo.codigo_barras && articulo.codigo_barras !== articulo.articulo_numero) {
            console.log(`[INGREDIENTES] Fallback: Intentando con codigo de barras ${articulo.codigo_barras}`);
            resultado = await buscarPorCodigo(articulo.codigo_barras, 'barras');
        }

        if (resultado) {
            estadoCarros.cacheIngredientes.set(cacheKey, resultado);
        }

        return resultado;
    }

    /**
     * Construye la fila horizontal de acciones de receta e ingredientes para un ítem de carro
     * (permite refrescar en caliente sin perder selección ni recargar toda la lista)
     */
    async function construirFilaAccionesReceta(articulo, contenedorPadre) {
        const fila = document.createElement('div');
        fila.className = 'carros-acciones-receta-row';
        fila.setAttribute('data-articulo', articulo.articulo_numero);
        fila.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; margin-top: 3px; flex-wrap: wrap;';

        const infoIngredientes = await obtenerIngredientesArticulo(articulo);
        const tieneRecetaConfirmada = Boolean(
            infoIngredientes &&
            infoIngredientes.tieneReceta &&
            ((Array.isArray(infoIngredientes.ingredientes) && infoIngredientes.ingredientes.length > 0) ||
             (Array.isArray(infoIngredientes.articulos) && infoIngredientes.articulos.length > 0))
        );

        const botonIngredientes = await agregarBotonIngredientes(articulo, contenedorPadre, infoIngredientes);
        const botonSugerencia = await agregarBotonSugerencia(articulo, contenedorPadre, tieneRecetaConfirmada);

        fila.appendChild(botonIngredientes);
        fila.appendChild(botonSugerencia);

        if (tieneRecetaConfirmada) {
            const btnEditarReceta = document.createElement('button');
            btnEditarReceta.type = 'button';
            btnEditarReceta.className = 'carros-btn-editar-receta';
            btnEditarReceta.innerHTML = '🧪 Receta';
            btnEditarReceta.title = 'Ver o editar la receta de producción de este artículo';
            btnEditarReceta.style.cssText = 'background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 1px 7px; border-radius: 10px; cursor: pointer; font-size: 10.5px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0;';
            btnEditarReceta.addEventListener('click', (e) => {
                e.stopPropagation();
                abrirModalRecetaCarros(articulo, contenedorPadre);
            });
            fila.appendChild(btnEditarReceta);
        }

        return fila;
    }

    /**
     * Refresca en el acto la fila de botones y el panel de ingredientes de un artículo tras guardar su receta
     */
    async function refrescarBotonesRecetaItem(articulo, contenedorPreferido) {
        const codigo = articulo.articulo_numero;
        estadoCarros.cacheIngredientes.delete(codigo);
        cacheSugerencias.delete(codigo);

        const sel = escaparSelectorAttr(codigo);
        const contenedores = new Set();
        if (contenedorPreferido && document.body.contains(contenedorPreferido)) {
            contenedores.add(contenedorPreferido);
        }
        document.querySelectorAll(`.carros-item[data-articulo="${sel}"], .carros-item-hijo[data-articulo="${sel}"]`).forEach(el => {
            contenedores.add(el);
        });

        for (const itemEl of contenedores) {
            const filaActual = itemEl.querySelector('.carros-acciones-receta-row');
            const infoDiv = itemEl.querySelector('.carros-item-info') || filaActual?.parentElement;
            if (infoDiv) {
                const nuevaFila = await construirFilaAccionesReceta(articulo, itemEl);
                if (filaActual) {
                    filaActual.replaceWith(nuevaFila);
                } else {
                    infoDiv.appendChild(nuevaFila);
                }
            }

            const panelExistente = itemEl.querySelector(`.ingredientes-panel[data-articulo="${sel}"]`);
            if (panelExistente) {
                const estabaVisible = panelExistente.style.display !== 'none';
                panelExistente.remove();
                if (estabaVisible) {
                    const nuevaInfo = await obtenerIngredientesArticulo(articulo);
                    if (nuevaInfo && nuevaInfo.tieneReceta && nuevaInfo.ingredientes.length > 0) {
                        toggleIngredientesPanel(articulo, itemEl, nuevaInfo);
                    }
                }
            }
        }
    }

    /**
     * NUEVA FUNCIONALIDAD: Crea el boton de informacion de ingredientes
     * El boton es ACTIVO (color) si tiene receta, INACTIVO (gris) si no tiene
     */
    async function agregarBotonIngredientes(articulo, contenedorPadre, infoPreCargada = null) {
        const infoIngredientes = infoPreCargada || await obtenerIngredientesArticulo(articulo);

        const botonInfo = document.createElement('button');
        botonInfo.type = 'button';
        botonInfo.className = 'carros-btn-ingredientes';
        botonInfo.textContent = 'i';
        botonInfo.title = 'Información de ingredientes de la receta';

        if (infoIngredientes && infoIngredientes.tieneReceta && infoIngredientes.ingredientes.length > 0) {
            // Boton ACTIVO (tiene ingredientes) - COMPACTO
            botonInfo.style.cssText = 'background: #28a745; color: white; border: none; padding: 0; border-radius: 50%; cursor: pointer; font-size: 10px; font-weight: bold; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;';
            botonInfo.setAttribute('data-tiene-receta', 'true');

            botonInfo.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleIngredientesPanel(articulo, contenedorPadre, infoIngredientes);
            });
        } else {
            // Boton INACTIVO (sin ingredientes) - COMPACTO
            botonInfo.style.cssText = 'background: #6c757d; color: white; border: none; padding: 0; border-radius: 50%; cursor: not-allowed; font-size: 10px; font-weight: bold; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; opacity: 0.5;';
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
    function toggleIngredientesPanel(articuloOrCodigo, contenedorPadre, infoIngredientes) {
        const articuloObj = typeof articuloOrCodigo === 'object' && articuloOrCodigo !== null
            ? articuloOrCodigo
            : { articulo_numero: String(articuloOrCodigo || ''), descripcion: String(articuloOrCodigo || '') };
        const articuloCodigo = articuloObj.articulo_numero;
        const sel = escaparSelectorAttr(articuloCodigo);
        console.log(`[INGREDIENTES] Toggle panel para ${articuloCodigo}`);

        // Buscar panel existente
        let panel = contenedorPadre.querySelector(`.ingredientes-panel[data-articulo="${sel}"]`);

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
        let inputCantidad = contenedorPadre.querySelector(`input[type="number"][data-articulo="${sel}"]`);
        if (!inputCantidad) {
            inputCantidad = contenedorPadre.querySelector(`input[type="number"]`);
        }

        const cantidadSolicitada = inputCantidad ? parseFloat(inputCantidad.value) || 1 : 1;

        // Crear panel nuevo
        panel = document.createElement('div');
        panel.className = 'ingredientes-panel';
        panel.setAttribute('data-articulo', articuloCodigo);
        panel.style.cssText = 'width: 100%; padding: 12px; background: #e7f5f7; border: 1px solid #17a2b8; border-radius: 4px; margin-top: 8px;';

        let html = `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
                <span style="font-weight: bold; color: #17a2b8;">Ingredientes:</span>
                <button type="button" class="btn-editar-receta-panel" style="background: #ffffff; color: #0f766e; border: 1px solid #14b8a6; border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 700; cursor: pointer;">
                    ✏️ Editar receta
                </button>
            </div>
        `;
        html += '<ul style="margin: 0; padding-left: 20px; list-style: disc;">';

        infoIngredientes.ingredientes.forEach(ing => {
            const cantidadBase = parseFloat(ing.cantidad);
            const cantidadBaseFormateada = cantidadBase.toFixed(4).replace(/\.?0+$/, '');
            const cantidadTotal = cantidadBase * cantidadSolicitada;
            const cantidadTotalFormateada = cantidadTotal.toFixed(4).replace(/\.?0+$/, '');

            html += `
                <li style="margin-bottom: 4px; color: #2c5f6f;">
                    <strong>${escaparHtmlBasico(ing.nombre_ingrediente)}</strong>: ${cantidadBaseFormateada} ${escaparHtmlBasico(ing.unidad_medida)} (Base Receta) - Total: ${cantidadTotalFormateada} ${escaparHtmlBasico(ing.unidad_medida)}
                </li>
            `;
        });

        html += '</ul>';
        panel.innerHTML = html;

        const btnEditPanel = panel.querySelector('.btn-editar-receta-panel');
        if (btnEditPanel) {
            btnEditPanel.addEventListener('click', (e) => {
                e.stopPropagation();
                abrirModalRecetaCarros(articuloObj, contenedorPadre);
            });
        }

        contenedorPadre.appendChild(panel);
        console.log(`[INGREDIENTES] Panel creado y mostrado para ${articuloCodigo}`);
    }

    /* ============================================
     * MÓDULO DE SUGERENCIAS DE PRODUCCIÓN
     * ============================================ */

    // Cache para sugerencias consultadas
    const cacheSugerencias = new Map();

    /**
     * Obtiene la sugerencia configurada para un artículo (codificando barras "/" y validando contra receta)
     */
    async function obtenerSugerenciaArticulo(articuloCodigo, codigoBarras = null, tieneRecetaConfirmada = false) {
        if (cacheSugerencias.has(articuloCodigo)) {
            const cached = cacheSugerencias.get(articuloCodigo);
            if (tieneRecetaConfirmada && cached && cached.tiene_receta === false) {
                cacheSugerencias.delete(articuloCodigo);
            } else {
                return cached;
            }
        }

        const consultarPorClave = async (clave) => {
            if (!clave) return null;
            const claveEncoded = encodeURIComponent(clave);
            let response = await fetch(`/api/produccion/receta-sugerencia?codigo=${claveEncoded}`);
            if (response.status === 404) {
                const errJson = await response.clone().json().catch(() => null);
                if (!errJson || errJson.tiene_sugerencia === undefined) {
                    response = await fetch(`/api/produccion/recetas/${claveEncoded}/sugerencia`);
                }
            }
            return response;
        };

        try {
            console.log(`[SUGERENCIAS] Consultando sugerencia para ${articuloCodigo}`);
            let response = await consultarPorClave(articuloCodigo);

            if (response && response.status === 404 && codigoBarras && codigoBarras !== articuloCodigo) {
                response = await consultarPorClave(codigoBarras);
            }

            if (response && response.ok) {
                const data = await response.json();
                data.tiene_receta = true;
                cacheSugerencias.set(articuloCodigo, data);
                return data;
            } else if (response && response.status === 404) {
                const infoIngCache = estadoCarros.cacheIngredientes.get(articuloCodigo);
                const recetaYaConfirmada = Boolean(tieneRecetaConfirmada || (infoIngCache && infoIngCache.tieneReceta));
                const resultado = {
                    tiene_receta: recetaYaConfirmada,
                    tiene_sugerencia: false,
                    sugerencia: null
                };
                cacheSugerencias.set(articuloCodigo, resultado);
                return resultado;
            } else {
                console.error(`[SUGERENCIAS] Error HTTP ${response ? response.status : 'N/A'} para ${articuloCodigo}`);
                return tieneRecetaConfirmada ? { tiene_receta: true, tiene_sugerencia: false, sugerencia: null } : null;
            }
        } catch (error) {
            console.error(`[SUGERENCIAS] Error al consultar sugerencia de ${articuloCodigo}:`, error);
            return tieneRecetaConfirmada ? { tiene_receta: true, tiene_sugerencia: false, sugerencia: null } : null;
        }
    }

    /**
     * Crea el botón de sugerencia (o de alta rápida de receta si aún no posee receta)
     */
    async function agregarBotonSugerencia(articuloOrCodigo, articuloNombreOrPadre, contenedorPadreArg) {
        let articuloObj;
        let contenedorPadre;
        let tieneRecetaConfirmada = false;

        if (typeof articuloOrCodigo === 'object' && articuloOrCodigo !== null) {
            articuloObj = articuloOrCodigo;
            contenedorPadre = articuloNombreOrPadre;
            tieneRecetaConfirmada = Boolean(contenedorPadreArg);
        } else {
            articuloObj = {
                articulo_numero: articuloOrCodigo,
                descripcion: articuloNombreOrPadre || articuloOrCodigo
            };
            contenedorPadre = contenedorPadreArg;
        }

        const articuloCodigo = articuloObj.articulo_numero;
        const articuloNombre = articuloObj.descripcion || articuloCodigo;
        const infoSugerencia = await obtenerSugerenciaArticulo(
            articuloCodigo,
            articuloObj.codigo_barras || null,
            tieneRecetaConfirmada
        );

        const botonSugerencia = document.createElement('button');
        botonSugerencia.type = 'button';
        botonSugerencia.className = 'carros-btn-sugerencia';

        if (infoSugerencia && infoSugerencia.tiene_sugerencia) {
            // Estado 2: CON VÍNCULO (naranja, ícono de lápiz)
            botonSugerencia.innerHTML = '✏️';
            botonSugerencia.title = `Editar Sugerencia: ${infoSugerencia.sugerencia.nombre}`;
            botonSugerencia.style.cssText = 'background: #fd7e14; color: white; border: none; padding: 0; border-radius: 50%; cursor: pointer; font-size: 10px; font-weight: bold; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;';
            botonSugerencia.setAttribute('data-tiene-sugerencia', 'true');
            botonSugerencia.setAttribute('data-sugerencia-numero', infoSugerencia.sugerencia.articulo_numero);

            botonSugerencia.addEventListener('click', (e) => {
                e.stopPropagation();
                abrirModalSugerencias(articuloCodigo, articuloNombre, infoSugerencia);
            });
        } else if (!tieneRecetaConfirmada && infoSugerencia && infoSugerencia.tiene_receta === false) {
            // Estado 3: SIN RECETA -> Botón interactivo directo para crear/completar la receta desde Producción
            botonSugerencia.innerHTML = '⚠️ Requiere crear receta primero';
            botonSugerencia.title = 'Haga clic aquí para crear o completar la receta directamente en Producción';
            botonSugerencia.style.cssText = 'background: #dc2626; color: #ffffff; border: 1px solid #b91c1c; padding: 2px 9px; border-radius: 12px; cursor: pointer; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; box-shadow: 0 1px 2px rgba(220,38,38,0.25);';
            botonSugerencia.setAttribute('data-tiene-sugerencia', 'false');
            botonSugerencia.setAttribute('data-tiene-receta', 'false');

            botonSugerencia.addEventListener('click', (e) => {
                e.stopPropagation();
                abrirModalRecetaCarros(articuloObj, contenedorPadre);
            });
        } else {
            // Estado 1: CON RECETA Y SIN VÍNCULO (gris, ícono de link)
            botonSugerencia.innerHTML = '🔗';
            botonSugerencia.title = 'Asignar Sugerencia de Artículo Puente';
            botonSugerencia.style.cssText = 'background: #6c757d; color: white; border: none; padding: 0; border-radius: 50%; cursor: pointer; font-size: 10px; font-weight: bold; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;';
            botonSugerencia.setAttribute('data-tiene-sugerencia', 'false');

            botonSugerencia.addEventListener('click', (e) => {
                e.stopPropagation();
                abrirModalSugerencias(articuloCodigo, articuloNombre, infoSugerencia);
            });
        }

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
                    <div id="sugerencia-modal-mensaje" style="display:none; margin-bottom: 15px; padding: 10px; border-radius: 4px; background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; font-size: 14px; font-weight: bold;"></div>
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

            const responseData = await response.json();
            // ✅ CORRECCIÓN: Manejar nuevo formato de respuesta { success, data, total }
            const todosLosArticulos = responseData.data || responseData;

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

        const mostrarErrorModal = (mensaje) => {
            const errorDiv = document.getElementById('sugerencia-modal-mensaje');
            if (errorDiv) {
                errorDiv.textContent = mensaje;
                errorDiv.style.display = 'block';
            } else {
                mostrarMensaje(mensaje, 'error');
            }
        };

        if (!radioSeleccionado) {
            mostrarErrorModal('Debe seleccionar un artículo');
            return;
        }

        const articuloSugerido = radioSeleccionado.value;

        console.log(`[SUGERENCIAS] Guardando: ${articuloOrigen} → ${articuloSugerido}`);

        try {
            const codigoEncoded = encodeURIComponent(articuloOrigen);
            let response = await fetch(`/api/produccion/receta-sugerencia?codigo=${codigoEncoded}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    articulo_numero: articuloOrigen,
                    articulo_sugerido_numero: articuloSugerido
                })
            });
            if (response.status === 404) {
                response = await fetch(`/api/produccion/recetas/${codigoEncoded}/sugerencia`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ articulo_sugerido_numero: articuloSugerido })
                });
            }

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

            await refrescarBotonesRecetaItem({ articulo_numero: articuloOrigen, descripcion: modalOverlay.getAttribute('data-articulo-nombre') || articuloOrigen }, null);
            await procesarYRenderizarSugerencias();

        } catch (error) {
            console.error('[SUGERENCIAS] Error al guardar:', error);
            mostrarErrorModal(`Error: ${error.message}`);
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
            const codigoEncoded = encodeURIComponent(articuloOrigen);
            let response = await fetch(`/api/produccion/receta-sugerencia?codigo=${codigoEncoded}`, {
                method: 'DELETE'
            });
            if (response.status === 404) {
                response = await fetch(`/api/produccion/recetas/${codigoEncoded}/sugerencia`, {
                    method: 'DELETE'
                });
            }

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Error al eliminar sugerencia');
            }

            console.log(`[SUGERENCIAS] ✅ Sugerencia eliminada`);

            // Invalidar cache
            cacheSugerencias.delete(articuloOrigen);

            mostrarMensaje('Sugerencia eliminada exitosamente', 'exito');
            cerrarModalSugerencias();

            await refrescarBotonesRecetaItem({ articulo_numero: articuloOrigen, descripcion: modalOverlay.getAttribute('data-articulo-nombre') || articuloOrigen }, null);
            await procesarYRenderizarSugerencias();

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

    /* ============================================================
     * MODAL INLINE DE CREACIÓN / EDICIÓN DE RECETA EN PRODUCCIÓN
     * ============================================================ */
    let catalogoIngredientesCache = null;
    let estadoModalRecetaCarros = {
        articulo: null,
        contenedorPadre: null,
        ingredientes: [],
        ingredienteSeleccionado: null
    };

    function normalizarBusquedaReceta(str) {
        if (!str) return '';
        return String(str)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    async function cargarCatalogoIngredientesProduccion() {
        if (Array.isArray(catalogoIngredientesCache) && catalogoIngredientesCache.length > 0) {
            return catalogoIngredientesCache;
        }
        const res = await fetch('/api/produccion/ingredientes');
        if (!res.ok) {
            throw new Error(`No se pudieron cargar los ingredientes (HTTP ${res.status})`);
        }
        const raw = await res.json();
        catalogoIngredientesCache = Array.isArray(raw) ? raw : (raw.data || []);
        return catalogoIngredientesCache;
    }

    function cerrarModalRecetaCarros() {
        const overlay = document.getElementById('modal-receta-carros-overlay');
        if (overlay) {
            overlay.style.display = 'none';
            overlay.innerHTML = '';
        }
    }

    function renderTablaIngredientesModalCarros() {
        const tbody = document.getElementById('carros-receta-modal-tbody');
        if (!tbody) return;

        const lista = estadoModalRecetaCarros.ingredientes || [];
        if (lista.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; padding: 16px; color: #64748b; font-style: italic;">
                        Aún no hay componentes cargados. Busque el ingrediente principal y la bolsa/envase abajo para añadirlos.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = lista.map((ing, idx) => `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px 10px; font-weight: 600; color: #1e293b;">
                    ${escaparHtmlBasico(ing.nombre_ingrediente)}
                </td>
                <td style="padding: 8px 10px; text-align: center;">
                    <input
                        type="text"
                        inputmode="decimal"
                        data-idx="${idx}"
                        class="carros-receta-row-cant"
                        value="${escaparHtmlBasico(String(ing.cantidad))}"
                        style="width: 92px; text-align: center; padding: 5px 6px; border: 1px solid #cbd5e1; border-radius: 5px; font-family: monospace; font-weight: 700;">
                </td>
                <td style="padding: 8px 10px; text-align: center; color: #475569; font-size: 12px; font-weight: 700;">
                    ${escaparHtmlBasico(ing.unidad_medida)}
                </td>
                <td style="padding: 8px 10px; text-align: center;">
                    <button
                        type="button"
                        data-idx="${idx}"
                        class="carros-receta-row-del"
                        title="Quitar componente"
                        style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; border-radius: 5px; padding: 3px 8px; cursor: pointer; font-size: 12px;">
                        🗑️
                    </button>
                </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.carros-receta-row-cant').forEach(inp => {
            inp.addEventListener('input', (e) => {
                const i = Number(e.target.getAttribute('data-idx'));
                const num = parseFloat(String(e.target.value || '').replace(',', '.'));
                if (!isNaN(num) && num > 0 && estadoModalRecetaCarros.ingredientes[i]) {
                    estadoModalRecetaCarros.ingredientes[i].cantidad = num;
                }
            });
        });

        tbody.querySelectorAll('.carros-receta-row-del').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const i = Number(e.currentTarget.getAttribute('data-idx'));
                estadoModalRecetaCarros.ingredientes.splice(i, 1);
                renderTablaIngredientesModalCarros();
            });
        });
    }

    function filtrarDropdownIngredientesCarros(texto) {
        const listEl = document.getElementById('carros-receta-resultados-dropdown');
        if (!listEl) return;

        const catalogo = catalogoIngredientesCache || [];
        const tokens = normalizarBusquedaReceta(texto).split(/\s+/).filter(Boolean);

        if (tokens.length === 0) {
            listEl.style.display = 'none';
            listEl.innerHTML = '';
            return;
        }

        const coincidencias = catalogo.filter(item => {
            const bolsaBusqueda = normalizarBusquedaReceta(
                `${item.nombre || ''} ${item.codigo || ''} ${item.categoria || ''} ${item.rubro || ''} ${item.unidad_medida || ''} ${item.id || ''}`
            );
            return tokens.every(t => bolsaBusqueda.includes(t));
        }).slice(0, 20);

        if (coincidencias.length === 0) {
            listEl.innerHTML = '<div style="padding: 8px 10px; color: #64748b; font-size: 12.5px; font-style: italic;">Sin coincidencias</div>';
            listEl.style.display = 'block';
            return;
        }

        listEl.innerHTML = '';
        coincidencias.forEach(item => {
            const row = document.createElement('div');
            row.style.cssText = 'padding: 7px 10px; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 13px; display: flex; justify-content: space-between; align-items: center; gap: 8px; background: #ffffff;';
            row.innerHTML = `
                <span style="font-weight: 600; color: #0f172a;">${escaparHtmlBasico(item.nombre)}</span>
                <span style="font-size: 11px; font-family: monospace; background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; flex-shrink: 0;">
                    ${escaparHtmlBasico(item.unidad_medida || 'Kilo')}
                </span>
            `;
            row.addEventListener('mouseenter', () => { row.style.background = '#eff6ff'; });
            row.addEventListener('mouseleave', () => { row.style.background = '#ffffff'; });
            row.addEventListener('click', () => {
                estadoModalRecetaCarros.ingredienteSeleccionado = {
                    id: Number(item.id),
                    nombre: item.nombre,
                    unidad_medida: item.unidad_medida || 'Kilo'
                };
                const inputBuscar = document.getElementById('carros-receta-buscar-input');
                const badgeUnidad = document.getElementById('carros-receta-unidad-badge');
                const inputCant = document.getElementById('carros-receta-cantidad-input');
                if (inputBuscar) inputBuscar.value = item.nombre;
                if (badgeUnidad) badgeUnidad.textContent = item.unidad_medida || 'Kilo';
                listEl.style.display = 'none';
                listEl.innerHTML = '';
                if (inputCant) {
                    if (!inputCant.value && String(item.unidad_medida || '').toLowerCase().startsWith('unid')) {
                        inputCant.value = '1';
                    }
                    inputCant.focus();
                    inputCant.select();
                }
            });
            listEl.appendChild(row);
        });
        listEl.style.display = 'block';
    }

    function agregarComponenteRecetaModalCarros() {
        const msgBox = document.getElementById('carros-receta-modal-msg');
        const mostrarAviso = (txt) => {
            if (msgBox) {
                msgBox.textContent = txt;
                msgBox.style.display = 'block';
            }
        };
        if (msgBox) msgBox.style.display = 'none';

        const sel = estadoModalRecetaCarros.ingredienteSeleccionado;
        const inputCant = document.getElementById('carros-receta-cantidad-input');
        const inputBuscar = document.getElementById('carros-receta-buscar-input');
        const badgeUnidad = document.getElementById('carros-receta-unidad-badge');

        if (!sel || !sel.id) {
            mostrarAviso('Seleccione primero un ingrediente o envase de la lista desplegable.');
            if (inputBuscar) inputBuscar.focus();
            return;
        }

        const cantNum = parseFloat(String(inputCant?.value || '').replace(',', '.'));
        if (isNaN(cantNum) || cantNum <= 0) {
            mostrarAviso('Ingrese una cantidad mayor a 0 (ej: 0.25 para 250g o 1 para 1 bolsa).');
            if (inputCant) inputCant.focus();
            return;
        }

        const idxExistente = estadoModalRecetaCarros.ingredientes.findIndex(
            i => Number(i.ingrediente_id) === Number(sel.id)
        );
        if (idxExistente >= 0) {
            estadoModalRecetaCarros.ingredientes[idxExistente].cantidad = cantNum;
        } else {
            estadoModalRecetaCarros.ingredientes.push({
                ingrediente_id: Number(sel.id),
                nombre_ingrediente: sel.nombre,
                unidad_medida: sel.unidad_medida,
                cantidad: cantNum
            });
        }

        estadoModalRecetaCarros.ingredienteSeleccionado = null;
        if (inputBuscar) inputBuscar.value = '';
        if (inputCant) inputCant.value = '';
        if (badgeUnidad) badgeUnidad.textContent = 'Unidad';

        renderTablaIngredientesModalCarros();
        if (inputBuscar) inputBuscar.focus();
    }

    async function guardarRecetaModalCarros() {
        const msgBox = document.getElementById('carros-receta-modal-msg');
        const btnGuardar = document.getElementById('carros-receta-btn-guardar');
        const art = estadoModalRecetaCarros.articulo;

        if (!art || !art.articulo_numero) return;

        const ingredientesValidos = (estadoModalRecetaCarros.ingredientes || [])
            .map(ing => ({
                ingrediente_id: ing.ingrediente_id,
                nombre_ingrediente: String(ing.nombre_ingrediente || '').trim(),
                unidad_medida: String(ing.unidad_medida || 'Kilo').trim(),
                cantidad: parseFloat(String(ing.cantidad || '').replace(',', '.'))
            }))
            .filter(ing => ing.nombre_ingrediente && !isNaN(ing.cantidad) && ing.cantidad > 0);

        if (ingredientesValidos.length === 0) {
            if (msgBox) {
                msgBox.textContent = 'Agregue al menos un ingrediente con cantidad mayor a cero antes de guardar.';
                msgBox.style.display = 'block';
            }
            return;
        }

        if (btnGuardar) {
            btnGuardar.disabled = true;
            btnGuardar.textContent = '⏳ Guardando...';
        }

        try {
            const payload = {
                articulo_numero: art.articulo_numero,
                descripcion: `Receta de ${art.descripcion || art.articulo_numero}`,
                ingredientes: ingredientesValidos,
                articulos: [],
                esProduccionExternaConArticuloPrincipal: false,
                upsert: true
            };

            const res = await fetch('/api/produccion/recetas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `Error HTTP ${res.status}`);
            }

            await refrescarBotonesRecetaItem(art, estadoModalRecetaCarros.contenedorPadre);
            cerrarModalRecetaCarros();
            mostrarMensaje(`✅ Receta guardada para "${art.descripcion || art.articulo_numero}". Estado actualizado en Configurar Carros.`, 'exito');
        } catch (err) {
            console.error('[RECETA-CARROS] Error al guardar receta:', err);
            if (msgBox) {
                msgBox.textContent = `Error al guardar: ${err.message}`;
                msgBox.style.display = 'block';
            }
            if (btnGuardar) {
                btnGuardar.disabled = false;
                btnGuardar.textContent = '💾 Guardar Receta';
            }
        }
    }

    async function abrirModalRecetaCarros(articulo, contenedorPadre) {
        const codigo = articulo?.articulo_numero || '';
        const nombre = articulo?.descripcion || codigo;

        estadoModalRecetaCarros = {
            articulo: {
                articulo_numero: codigo,
                codigo_barras: articulo?.codigo_barras || null,
                descripcion: nombre
            },
            contenedorPadre: contenedorPadre || null,
            ingredientes: [],
            ingredienteSeleccionado: null
        };

        let overlay = document.getElementById('modal-receta-carros-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'modal-receta-carros-overlay';
            document.body.appendChild(overlay);
        }

        overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(15, 23, 42, 0.58); z-index: 10050; display: flex; align-items: center; justify-content: center; padding: 16px;';
        overlay.innerHTML = `
            <div style="background: #ffffff; width: 100%; max-width: 660px; border-radius: 12px; box-shadow: 0 20px 45px rgba(15,23,42,0.28); overflow: hidden; display: flex; flex-direction: column; max-height: 90vh;">
                <div style="background: #0f172a; color: #ffffff; padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                    <div>
                        <div style="font-size: 15px; font-weight: 700;">🧪 Configurar Receta de Producción</div>
                        <div style="font-size: 12px; color: #cbd5e1; margin-top: 2px;">
                            ${escaparHtmlBasico(nombre)} · <span style="font-family: monospace; color: #93c5fd;">${escaparHtmlBasico(codigo)}</span>
                        </div>
                    </div>
                    <button type="button" id="carros-receta-btn-cerrar-x" style="background: rgba(255,255,255,0.12); color: #ffffff; border: none; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 18px; line-height: 1;">&times;</button>
                </div>

                <div style="padding: 16px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px;">
                    <div id="carros-receta-modal-msg" style="display: none; padding: 9px 12px; border-radius: 6px; background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; font-size: 12.5px; font-weight: 600;"></div>

                    <div style="border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                            <thead>
                                <tr style="background: #f8fafc; border-bottom: 1px solid #cbd5e1; color: #475569;">
                                    <th style="text-align: left; padding: 8px 10px;">Ingrediente / Envase</th>
                                    <th style="text-align: center; padding: 8px 10px; width: 115px;">Cant. por Unidad</th>
                                    <th style="text-align: center; padding: 8px 10px; width: 90px;">Unidad</th>
                                    <th style="text-align: center; padding: 8px 10px; width: 65px;">Quitar</th>
                                </tr>
                            </thead>
                            <tbody id="carros-receta-modal-tbody">
                                <tr>
                                    <td colspan="4" style="text-align: center; padding: 16px; color: #64748b;">Cargando receta e ingredientes...</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
                        <div style="font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 8px;">
                            ➕ Añadir ingrediente o bolsa / envase (por 1 unidad comercial del artículo)
                        </div>
                        <div style="display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap;">
                            <div style="flex: 1 1 260px; position: relative;">
                                <input
                                    type="text"
                                    id="carros-receta-buscar-input"
                                    placeholder="Buscar ej: almendra nonparei, bolsa 15 x 18..."
                                    autocomplete="off"
                                    style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; box-sizing: border-box;">
                                <div
                                    id="carros-receta-resultados-dropdown"
                                    style="display: none; position: absolute; top: calc(100% + 3px); left: 0; right: 0; max-height: 210px; overflow-y: auto; background: #ffffff; border: 1px solid #94a3b8; border-radius: 6px; box-shadow: 0 10px 25px rgba(15,23,42,0.16); z-index: 30;">
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <input
                                    type="text"
                                    inputmode="decimal"
                                    id="carros-receta-cantidad-input"
                                    placeholder="Ej: 0.25"
                                    style="width: 95px; padding: 8px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-family: monospace; text-align: center; box-sizing: border-box;">
                                <span id="carros-receta-unidad-badge" style="font-size: 11.5px; color: #475569; background: #e2e8f0; padding: 5px 8px; border-radius: 5px; font-weight: 700; min-width: 58px; text-align: center;">Unidad</span>
                                <button
                                    type="button"
                                    id="carros-receta-btn-agregar"
                                    style="padding: 8px 14px; background: #0284c7; color: #ffffff; border: none; border-radius: 6px; font-weight: 700; font-size: 13px; cursor: pointer;">
                                    Añadir
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div style="padding: 12px 18px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 10px;">
                    <button type="button" id="carros-receta-btn-cancelar" style="padding: 8px 16px; background: #ffffff; color: #334155; border: 1px solid #cbd5e1; border-radius: 6px; font-weight: 600; cursor: pointer;">
                        Cancelar
                    </button>
                    <button type="button" id="carros-receta-btn-guardar" style="padding: 8px 18px; background: #16a34a; color: #ffffff; border: none; border-radius: 6px; font-weight: 700; cursor: pointer;">
                        💾 Guardar Receta
                    </button>
                </div>
            </div>
        `;

        document.getElementById('carros-receta-btn-cerrar-x')?.addEventListener('click', cerrarModalRecetaCarros);
        document.getElementById('carros-receta-btn-cancelar')?.addEventListener('click', cerrarModalRecetaCarros);
        document.getElementById('carros-receta-btn-agregar')?.addEventListener('click', agregarComponenteRecetaModalCarros);
        document.getElementById('carros-receta-btn-guardar')?.addEventListener('click', guardarRecetaModalCarros);

        const inputBuscar = document.getElementById('carros-receta-buscar-input');
        const inputCant = document.getElementById('carros-receta-cantidad-input');

        if (inputBuscar) {
            inputBuscar.addEventListener('input', (e) => {
                estadoModalRecetaCarros.ingredienteSeleccionado = null;
                filtrarDropdownIngredientesCarros(e.target.value);
            });
            inputBuscar.addEventListener('focus', (e) => {
                if (e.target.value.trim()) filtrarDropdownIngredientesCarros(e.target.value);
            });
        }

        if (inputCant) {
            inputCant.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    agregarComponenteRecetaModalCarros();
                }
            });
        }

        try {
            await cargarCatalogoIngredientesProduccion();
            estadoCarros.cacheIngredientes.delete(codigo);
            const infoActual = await obtenerIngredientesArticulo(estadoModalRecetaCarros.articulo);
            if (infoActual && infoActual.tieneReceta && Array.isArray(infoActual.ingredientes)) {
                estadoModalRecetaCarros.ingredientes = infoActual.ingredientes.map(ing => ({
                    ingrediente_id: ing.ingrediente_id,
                    nombre_ingrediente: ing.nombre_ingrediente,
                    unidad_medida: ing.unidad_medida,
                    cantidad: parseFloat(ing.cantidad) || 0
                }));
            }
            renderTablaIngredientesModalCarros();
            setTimeout(() => inputBuscar?.focus(), 60);
        } catch (err) {
            console.error('[RECETA-CARROS] Error inicializando modal de receta:', err);
            const msgBox = document.getElementById('carros-receta-modal-msg');
            if (msgBox) {
                msgBox.textContent = err.message || 'Error al cargar datos de recetas';
                msgBox.style.display = 'block';
            }
            renderTablaIngredientesModalCarros();
        }
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
            if (!containerPrincipal) {
                // Intentar buscar el contenedor padre alternativo (carros-panel-container)
                const panelContainer = document.querySelector('.carros-panel-container');
                if (panelContainer) {
                    console.log('[SUGERENCIAS-RENDER] Usando fallback: .carros-panel-container');

                    containerSugerencias = document.createElement('div');
                    containerSugerencias.id = 'carros-sugerencias-container';
                    containerSugerencias.style.cssText = 'margin-top: 30px;';

                    panelContainer.appendChild(containerSugerencias);
                    console.log('[SUGERENCIAS-RENDER] Contenedor de sugerencias creado en fallback');
                } else {
                    console.error('[SUGERENCIAS-RENDER] No se encontró contenedor principal ni fallback');
                    return;
                }
            } else {
                containerSugerencias = document.createElement('div');
                containerSugerencias.id = 'carros-sugerencias-container';
                containerSugerencias.style.cssText = 'margin-top: 30px;';

                // Insertar después del contenedor de lista
                containerPrincipal.insertAdjacentElement('afterend', containerSugerencias);
                console.log('[SUGERENCIAS-RENDER] Contenedor de sugerencias creado via insertAdjacentElement');
            }
        }

        try {
            // Obtener fecha de corte
            const fechaCorte = document.getElementById('fecha-corte-articulos')?.value || '';

            let url = '/api/produccion/pedidos-articulos';
            if (fechaCorte) {
                url += `?fecha=${fechaCorte}`;
            }

            console.log(`[SUGERENCIAS-RENDER] Consultando endpoint: ${url}`);

            let articulos = [];
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Error HTTP: ${response.status}`);
                }
                const result = await response.json();
                articulos = result.data || [];
            } catch (errApi) {
                console.error('[SUGERENCIAS-RENDER] Error crítico al consultar API de artículos:', errApi);
                containerSugerencias.innerHTML = `<div class="carros-mensaje error">Error al cargar sugerencias: ${errApi.message}</div>`;
                return; // Detener solo la carga de sugerencias
            }

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
                // CORRECCIÓN: Usar window.obtenerPackMapping expuesto por produccion-resumen-expandible.js
                let packMapping = null;
                if (typeof window.obtenerPackMapping === 'function') {
                    packMapping = await window.obtenerPackMapping(faltante.articulo_numero);
                } else {
                    console.warn('[SUGERENCIAS-RENDER] window.obtenerPackMapping no está disponible');
                }

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
                <div style="background: linear-gradient(135deg, #15803d 0%, #166534 100%); padding: 12px 16px; border-radius: 8px 8px 0 0; margin-bottom: 0;">
                    <h3 style="margin: 0; color: white; font-size: 1.05em; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                        <span style="display: flex; align-items: center; gap: 8px;">
                            🥣 1° Etapa — Sugerencias de Artículos Puente / Mixes x Kilo (Línea 3)
                            <span style="background: rgba(255,255,255,0.25); padding: 2px 8px; border-radius: 12px; font-size: 0.85em;">${sugerencias.length}</span>
                        </span>
                        <span style="background: #dcfce7; color: #166534; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 10px;">Línea de Negocio 3</span>
                    </h3>
                    <div style="color: #dcfce7; font-size: 12px; margin-top: 4px; font-weight: 400;">
                        Elaboración previa de la mezcla a granel combinando ingredientes de los sectores A/B. Se almacena como <strong>Artículo Puente por kilo</strong> (que luego abastece al ingrediente simple para armar las fracciones en la 2° Etapa).
                    </div>
                </div>
                <div id="sugerencias-lista" style="background: #f0fdf4; padding: 12px; border-radius: 0 0 8px 8px; border: 2px solid #16a34a; border-top: none;"></div>
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
        const cantidadSugerida = faltante > 0 ? faltante : cantidadTotal;

        let estado = 'faltante';
        let estadoTexto = 'FALTANTE';
        if (stockDisponible > 0 && faltante < cantidadTotal && faltante > 0) {
            estado = 'parcial';
            estadoTexto = 'PARCIAL';
        } else if (faltante === 0) {
            estado = 'completo';
            estadoTexto = 'COMPLETO';
        }

        const itemDiv = document.createElement('div');
        itemDiv.className = `carros-item carros-item-sugerencia ${estado}`;
        itemDiv.setAttribute('data-articulo', sugerencia.articulo_numero);
        itemDiv.style.cssText = 'padding: 8px 12px; margin-bottom: 8px; background: white; border-left: 4px solid #16a34a;';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'carros-item-checkbox';
        checkbox.setAttribute('data-articulo', sugerencia.articulo_numero);
        checkbox.addEventListener('change', (e) => {
            manejarSeleccionSugerencia(sugerencia, e.target.checked, cantidadSugerida, e.target);
        });

        const infoDiv = document.createElement('div');
        infoDiv.className = 'carros-item-info';
        infoDiv.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 2px;';

        const descripcionSpan = document.createElement('span');
        descripcionSpan.className = 'carros-item-descripcion';
        descripcionSpan.innerHTML = `🥣 ${sugerencia.descripcion || sugerencia.articulo_numero} <span style="background: #dcfce7; color: #166534; font-size: 10.5px; font-weight: 700; padding: 1px 6px; border-radius: 4px; border: 1px solid #86efac; margin-left: 6px; white-space: nowrap;">L3 Art. Puente x Kilo (1° Etapa)</span>`;
        descripcionSpan.style.color = '#166534';
        descripcionSpan.style.fontWeight = '600';

        const codigoSpan = document.createElement('span');
        codigoSpan.className = 'carros-item-codigo';
        const codigoBarrasTexto = sugerencia.codigo_barras ? ` · Barras: ${sugerencia.codigo_barras}` : '';
        codigoSpan.textContent = `Código: ${sugerencia.articulo_numero}${codigoBarrasTexto}`;

        const origenSpan = document.createElement('span');
        origenSpan.style.fontSize = '11px';
        origenSpan.style.color = '#15803d';
        origenSpan.style.fontStyle = 'italic';
        origenSpan.textContent = `Abastece a la fracción: ${sugerencia.articulos_origen.join(', ')}`;

        const estadoSpan = document.createElement('span');
        estadoSpan.className = `carros-item-estado ${estado}`;
        estadoSpan.textContent = `${estadoTexto} (Sugerido: ${cantidadSugerida.toFixed(2)} kg) · Stock AP: ${stockDisponible.toFixed(2)} kg`;

        infoDiv.appendChild(descripcionSpan);
        infoDiv.appendChild(codigoSpan);
        infoDiv.appendChild(origenSpan);
        infoDiv.appendChild(estadoSpan);

        // Agregar botones de ingredientes, receta inline y sugerencias
        const filaAccionesSugerencia = await construirFilaAccionesReceta(sugerencia, itemDiv);
        infoDiv.appendChild(filaAccionesSugerencia);

        const cantidadDiv = document.createElement('div');
        cantidadDiv.className = 'carros-item-cantidad';

        const labelCantidad = document.createElement('label');
        labelCantidad.textContent = 'Kilos:';

        const inputCantidad = document.createElement('input');
        inputCantidad.type = 'number';
        inputCantidad.min = '0';
        inputCantidad.step = '0.01';
        inputCantidad.value = cantidadSugerida.toFixed(2);
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

            // Consultar la receta del artículo ORIGEN (codificando barras "/")
            const origenEncoded = encodeURIComponent(articuloOrigenCodigo);
            let response = await fetch(`/api/produccion/receta-detalle?codigo=${origenEncoded}`);
            if (response.status === 404) {
                const errBody = await response.clone().json().catch(() => null);
                if (!errBody || !errBody.error) {
                    response = await fetch(`/api/produccion/recetas/${origenEncoded}`);
                }
            }

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
     * Maneja la selección de una sugerencia (1° Etapa — Línea de Negocio 3: Artículo Puente / Mix x Kilo)
     * @param {Object} sugerencia - Datos de la sugerencia
     * @param {boolean} seleccionado - Si está seleccionado o no
     * @param {number} cantidadFaltante - Cantidad faltante calculada
     * @param {HTMLElement} checkboxEl - Checkbox accionado
     */
    function manejarSeleccionSugerencia(sugerencia, seleccionado, cantidadFaltante, checkboxEl) {
        const articuloNumero = sugerencia.articulo_numero;

        if (seleccionado) {
            if (!validarCompatibilidadLineaSeleccion(3, checkboxEl)) return;
            const inputCant = document.querySelector(`.carros-item-sugerencia input[type="number"][data-articulo="${escaparSelectorAttr(articuloNumero)}"]`);
            const cantActual = inputCant ? (parseFloat(inputCant.value) || cantidadFaltante) : cantidadFaltante;
            estadoCarros.articulosSeleccionados.set(articuloNumero, {
                articulo: {
                    articulo_numero: sugerencia.articulo_numero,
                    codigo_barras: sugerencia.codigo_barras,
                    descripcion: sugerencia.descripcion,
                    faltante: cantActual
                },
                cantidad: cantActual,
                esHijo: false,
                codigoPadre: null,
                esSugerencia: true,
                lineaNegocio: 3
            });
            console.log(`[CARROS-UI] SUGERENCIA (Línea 3) seleccionada: ${articuloNumero} (${cantActual})`);
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