/**
 * Modal "Abrir Caja Manual" - Desempacar producto de cajas cerradas a unidades
 * Versión: 4.0 - UX Clara + Búsqueda por Nombre + Asignación de Lote e Impresión Dual
 * 
 * @module modal-abrir-caja
 */

const ModalAbrirCaja = (function () {
    'use strict';

    // Variables privadas del módulo
    let modalElement = null;
    let datosArticuloUnidad = null; // El contenido (la unidad a extraer)
    let cajaSeleccionada = null;    // El origen (la caja cerrada)
    let loteActual = '';            // Código de lote asignado
    let origenLote = 'generado';    // 'lote_caja' o 'generado'
    let etiquetasImpresas = false;
    let modoManual = false;

    // Formatear fechas predeterminadas (hoy y hoy + 8 meses)
    function obtenerFechasPorDefecto() {
        const hoy = new Date();
        const elabDia = String(hoy.getDate()).padStart(2, '0');
        const elabMes = String(hoy.getMonth() + 1).padStart(2, '0');
        const elabAnio = hoy.getFullYear();
        const elaboracion = `${elabDia}/${elabMes}/${elabAnio}`;

        const venc = new Date(hoy);
        venc.setMonth(venc.getMonth() + 8);
        const vencDia = String(venc.getDate()).padStart(2, '0');
        const vencMes = String(venc.getMonth() + 1).padStart(2, '0');
        const vencAnio = venc.getFullYear();
        const vencimiento = `${vencDia}/${vencMes}/${vencAnio}`;

        return { elaboracion, vencimiento };
    }

    // Normalizar texto
    function normalizarTexto(texto) {
        if (!texto) return '';
        return texto.toString()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/ñ/g, 'n');
    }

    // ==========================================
    // INICIALIZACIÓN
    // ==========================================

    function inicializarModal() {
        modalElement = document.getElementById('modal-abrir-caja');

        if (!modalElement) {
            console.error('❌ [ABRIR-CAJA] Modal no encontrado en el DOM');
            return false;
        }

        console.log('✅ [ABRIR-CAJA] Modal encontrado, configurando listeners...');
        configurarEventListeners();
        hacerDraggable();
        return true;
    }

    function configurarEventListeners() {
        // Tabs de búsqueda de CAJA
        document.getElementById('btn-codigo-caja')?.addEventListener('click', () => cambiarModoBusquedaCaja('codigo'));
        document.getElementById('btn-descripcion-caja')?.addEventListener('click', () => cambiarModoBusquedaCaja('descripcion'));

        // Búsqueda CAJA - Código
        const inputCodigo = document.getElementById('input-codigo-caja');
        if (inputCodigo) {
            inputCodigo.addEventListener('input', debounce(buscarPorCodigo, 300));
            inputCodigo.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    buscarPorCodigo();
                }
            });
        }

        // Búsqueda CAJA - Descripción
        const inputDesc = document.getElementById('input-descripcion-caja');
        if (inputDesc) {
            inputDesc.addEventListener('input', debounce(buscarPorDescripcion, 400));
        }

        // Búsqueda UNIDAD (Paso 1 Manual por Nombre)
        const inputBusquedaUnidad = document.getElementById('input-busqueda-unidad');
        if (inputBusquedaUnidad) {
            inputBusquedaUnidad.addEventListener('input', debounce(buscarUnidadAvanzada, 300));
            inputBusquedaUnidad.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    buscarUnidadAvanzada();
                }
            });
        }

        // Botón Cambiar Unidad
        document.getElementById('btn-cambiar-unidad')?.addEventListener('click', configurarModoManual);

        // Botón Regenerar Lote
        document.getElementById('btn-regenerar-lote')?.addEventListener('click', () => {
            solicitarLoteSugerido(cajaSeleccionada?.articulo_numero, datosArticuloUnidad?.articulo_numero, true);
        });

        // Entrada manual en input de lote
        document.getElementById('abrir-caja-lote')?.addEventListener('input', (e) => {
            loteActual = e.target.value.trim().toUpperCase();
            e.target.value = loteActual;
            actualizarInfoLote();
            validarFormulario();
        });

        // Botones de Acción
        document.getElementById('btn-imprimir-caja')?.addEventListener('click', imprimirEtiquetas);
        document.getElementById('btn-confirmar-caja')?.addEventListener('click', confirmarApertura);

        // Validación y sincronización de cantidad
        document.getElementById('abrir-caja-usuario')?.addEventListener('change', validarFormulario);
        document.getElementById('abrir-caja-cantidad')?.addEventListener('input', () => {
            actualizarContadorEtiquetas();
            validarFormulario();
        });
    }

    function hacerDraggable() {
        const modal = document.querySelector('#modal-abrir-caja .modal-content');
        const header = document.getElementById('modal-abrir-caja-header');

        if (!modal || !header) return;

        let isDragging = false;
        let currentX, currentY, initialX, initialY;

        header.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('modal-close')) return;
            isDragging = true;
            initialX = e.clientX - (modal.offsetLeft || 0);
            initialY = e.clientY - (modal.offsetTop || 0);
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            modal.style.position = 'fixed';
            modal.style.left = currentX + 'px';
            modal.style.top = currentY + 'px';
            modal.style.transform = 'none';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    // ==========================================
    // FLUJO Y ESTADOS
    // ==========================================

    /**
     * PASO 1 (Modo Manual): Búsqueda clara del producto a extraer por nombre
     */
    function configurarModoManual() {
        modoManual = true;

        mostrarElemento('paso-seleccion-unidad', true);
        mostrarElemento('paso-seleccion-caja', false);

        const inputBusqueda = document.getElementById('input-busqueda-unidad');
        if (inputBusqueda) inputBusqueda.value = '';
        const resUnidad = document.getElementById('resultados-unidad');
        if (resUnidad) resUnidad.style.display = 'none';

        document.getElementById('btn-cambiar-unidad').style.display = 'none';

        datosArticuloUnidad = null;
        cajaSeleccionada = null;
        loteActual = '';
        etiquetasImpresas = false;

        setTimeout(() => document.getElementById('input-busqueda-unidad')?.focus(), 100);
        console.log('🛠️ [ABRIR-CAJA] Paso 1 activado: Selección de producto por nombre');
    }

    /**
     * PASO 2 (Modo Contextual o tras elegir unidad): Selección de caja, lote y confirmación
     */
    async function configurarModoContextual(articuloNumero, datosArticulo) {
        datosArticuloUnidad = datosArticulo || { articulo_numero: articuloNumero };

        mostrarElemento('paso-seleccion-unidad', false);
        mostrarElemento('paso-seleccion-caja', true);

        // Botón de cambiar disponible siempre que se abrió o se seleccionó
        document.getElementById('btn-cambiar-unidad').style.display = 'inline-block';

        // Llenar info de la unidad a extraer
        const descripcion = datosArticuloUnidad.descripcion || datosArticuloUnidad.nombre || '-';
        const sku = datosArticuloUnidad.articulo_numero || datosArticuloUnidad.codigo || articuloNumero;
        const barcode = datosArticuloUnidad.codigo_barras || datosArticuloUnidad.codigo || sku;
        const stock = datosArticuloUnidad.stock_disponible !== undefined
            ? parseFloat(datosArticuloUnidad.stock_disponible).toFixed(2)
            : (datosArticuloUnidad.stock_consolidado !== undefined 
                ? parseFloat(datosArticuloUnidad.stock_consolidado).toFixed(2)
                : (datosArticuloUnidad.stock !== undefined ? parseFloat(datosArticuloUnidad.stock).toFixed(2) : '-'));

        document.getElementById('unidad-descripcion-caja').textContent = descripcion;
        document.getElementById('unidad-codigo-caja').textContent = sku;
        const elBarcode = document.getElementById('unidad-barcode-caja');
        if (elBarcode) elBarcode.textContent = barcode;
        document.getElementById('unidad-stock-caja').textContent = `${stock} un.`;

        // Pre-cargar fechas de envasado/vencimiento sugeridas
        const fechasDef = obtenerFechasPorDefecto();
        const inputElab = document.getElementById('abrir-caja-fecha-elab');
        const inputVenc = document.getElementById('abrir-caja-fecha-venc');
        if (inputElab && !inputElab.value) inputElab.value = fechasDef.elaboracion;
        if (inputVenc && !inputVenc.value) inputVenc.value = fechasDef.vencimiento;

        // Resetear caja seleccionada
        document.getElementById('caja-seleccionada-display').style.display = 'none';
        cajaSeleccionada = null;
        etiquetasImpresas = false;

        document.getElementById('btn-imprimir-caja').disabled = true;
        document.getElementById('btn-confirmar-caja').disabled = true;

        actualizarContadorEtiquetas();

        // Cargar usuarios y sugerencias de cajas
        await cargarUsuarios();
        await cargarSugerencias(sku);

        // Obtener lote preliminar para la unidad
        await solicitarLoteSugerido(null, sku);

        console.log(`✅ [ABRIR-CAJA] Unidad lista para desempacar: ${sku} - ${descripcion}`);
    }

    // ==========================================
    // BÚSQUEDA DEL PRODUCTO A EXTRAER (PASO 1)
    // ==========================================

    async function buscarUnidadAvanzada() {
        const input = document.getElementById('input-busqueda-unidad');
        const texto = input?.value.trim();

        if (!texto || texto.length < 2) {
            const container = document.getElementById('resultados-unidad');
            if (container) container.style.display = 'none';
            return;
        }

        const container = document.getElementById('resultados-unidad');
        if (container) {
            container.innerHTML = '<div style="padding: 12px; color: #1976d2;"><i class="fas fa-spinner fa-spin"></i> Buscando artículos...</div>';
            container.style.display = 'block';
        }

        try {
            // Usamos el endpoint unificado /api/produccion/buscar-articulos que aplica AND sobre tokens
            const response = await fetch(`/api/produccion/buscar-articulos?q=${encodeURIComponent(texto)}`);
            if (!response.ok) throw new Error('Error al buscar artículos');

            const data = await response.json();
            const resultados = data.articulos || data.data || [];

            mostrarResultadosUnidad(resultados);
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error búsqueda avanzada de unidad:', error);
            if (container) container.innerHTML = '<div style="padding: 12px; color: #d32f2f;">Error al consultar artículos. Intente nuevamente.</div>';
        }
    }

    function mostrarResultadosUnidad(resultados) {
        const container = document.getElementById('resultados-unidad');
        if (!container) return;

        container.innerHTML = '';

        if (!resultados || resultados.length === 0) {
            container.innerHTML = '<div style="padding: 12px; color: #757575; font-size: 13px;">No se encontraron artículos con esa descripción. Intente con otra palabra.</div>';
            container.style.display = 'block';
            return;
        }

        const muestra = resultados.slice(0, 40);

        muestra.forEach(art => {
            const div = document.createElement('div');
            div.style.cssText = 'padding: 10px 14px; border-bottom: 1px solid #e0e0e0; cursor: pointer; transition: background-color 0.15s;';

            const nombre = art.descripcion || art.nombre || '-';
            const sku = art.articulo_numero || art.codigo || '-';
            const barcode = art.codigo_barras || '-';
            const stock = parseFloat(art.stock_consolidado ?? art.stock_disponible ?? art.stock ?? 0).toFixed(2);

            div.innerHTML = `
                <div style="font-weight: 700; color: #0d47a1; font-size: 14px;">${nombre}</div>
                <div style="font-size: 12px; color: #555; margin-top: 3px; display: flex; gap: 12px;">
                    <span>SKU: <strong style="font-family: monospace;">${sku}</strong></span>
                    <span>Cód. Barras: <span style="font-family: monospace;">${barcode}</span></span>
                    <span>Stock: <strong style="color: ${parseFloat(stock) > 0 ? '#2e7d32' : '#c62828'};">${stock} un.</strong></span>
                </div>
            `;

            div.onclick = () => {
                seleccionarUnidad({
                    articulo_numero: sku,
                    descripcion: nombre,
                    codigo_barras: barcode,
                    stock_disponible: stock,
                    kilos_unidad: art.kilos_unidad || 0
                });
            };

            div.addEventListener('mouseenter', () => div.style.backgroundColor = '#e3f2fd');
            div.addEventListener('mouseleave', () => div.style.backgroundColor = 'white');

            container.appendChild(div);
        });

        if (resultados.length > 40) {
            const footer = document.createElement('div');
            footer.style.padding = '8px';
            footer.style.textAlign = 'center';
            footer.style.color = '#757575';
            footer.style.fontSize = '12px';
            footer.style.background = '#f9f9f9';
            footer.textContent = `Mostrando los primeros 40 de ${resultados.length} resultados. Escriba más detalles para acotar.`;
            container.appendChild(footer);
        }

        container.style.display = 'block';
    }

    function seleccionarUnidad(articulo) {
        console.log('✅ [ABRIR-CAJA] Unidad seleccionada:', articulo);
        const numero = articulo.articulo_numero || articulo.codigo;
        configurarModoContextual(numero, articulo);
    }

    // ==========================================
    // SUGERENCIAS Y BÚSQUEDA DE CAJA (PASO 2)
    // ==========================================

    function cambiarModoBusquedaCaja(modo) {
        const btnCodigo = document.getElementById('btn-codigo-caja');
        const btnDesc = document.getElementById('btn-descripcion-caja');
        const containerCodigo = document.getElementById('container-codigo-caja');
        const containerDesc = document.getElementById('container-descripcion-caja');

        if (modo === 'codigo') {
            btnCodigo?.classList.add('active');
            btnDesc?.classList.remove('active');
            if (containerCodigo) containerCodigo.style.display = 'block';
            if (containerDesc) containerDesc.style.display = 'none';
            document.getElementById('input-codigo-caja')?.focus();
        } else {
            btnCodigo?.classList.remove('active');
            btnDesc?.classList.add('active');
            if (containerCodigo) containerCodigo.style.display = 'none';
            if (containerDesc) containerDesc.style.display = 'block';
            document.getElementById('input-descripcion-caja')?.focus();
        }

        ocultarResultadosCaja();
    }

    async function cargarSugerencias(articuloNumero) {
        try {
            const response = await fetch(`/api/produccion/abrir-caja/sugerencias?articulo_unidad=${articuloNumero}`);
            if (!response.ok) return;

            const data = await response.json();
            if (data.success && data.sugerencias && data.sugerencias.length > 0) {
                mostrarSugerencias(data.sugerencias);
            } else {
                const container = document.getElementById('sugerencias-container-caja');
                if (container) container.style.display = 'none';
            }
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error al cargar sugerencias de cajas:', error);
        }
    }

    function mostrarSugerencias(sugerencias) {
        const container = document.getElementById('sugerencias-container-caja');
        const lista = document.getElementById('sugerencias-lista-caja');

        if (!container || !lista) return;
        lista.innerHTML = '';

        sugerencias.forEach((sug, idx) => {
            const div = document.createElement('div');
            div.style.cssText = `
                padding: 10px 14px;
                background: ${idx === 0 ? '#e8f5e9' : '#f9f9f9'};
                border: 2px solid ${idx === 0 ? '#4caf50' : '#e0e0e0'};
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
            `;
            div.setAttribute('title', 'Clic para seleccionar esta caja de origen');

            div.innerHTML = `
                <div style="font-weight: 700; color: #212121; font-size: 13px;">${sug.descripcion_caja}</div>
                <div style="font-size: 12px; color: #616161; margin-top: 3px; display: flex; gap: 12px;">
                    <span>Código: <strong style="font-family: monospace;">${sug.codigo_caja}</strong></span>
                    <span>Stock: <strong style="color: ${parseFloat(sug.stock_actual) > 0 ? '#2e7d32' : '#c62828'};">${parseFloat(sug.stock_actual).toFixed(2)} cajas</strong></span>
                    ${idx === 0 ? '<span style="color: #2e7d32; font-weight: 700;">⭐ Frecuente</span>' : ''}
                </div>
            `;

            div.addEventListener('click', () => seleccionarCaja({
                articulo_numero: sug.codigo_caja,
                descripcion: sug.descripcion_caja,
                codigo_barras: sug.codigo_barras,
                stock_actual: sug.stock_actual,
                pack_unidades: sug.pack_unidades || sug.cantidad_promedio || 0
            }));

            lista.appendChild(div);
        });

        container.style.display = 'block';
    }

    async function buscarPorCodigo() {
        const input = document.getElementById('input-codigo-caja');
        const codigo = input?.value.trim();

        if (!codigo) {
            ocultarResultadosCaja();
            return;
        }

        try {
            const response = await fetch(`/api/produccion/abrir-caja/buscar?codigo_barras=${encodeURIComponent(codigo)}`);
            if (!response.ok) throw new Error('Error en búsqueda por código');

            const data = await response.json();
            if (data.success && data.resultados && data.resultados.length > 0) {
                seleccionarCaja(data.resultados[0]);
            } else {
                mostrarMensaje('No se encontró caja con ese código de barras en el depósito.', 'warning');
            }
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error búsqueda código:', error);
            mostrarMensaje('Error al buscar caja por código', 'error');
        }
    }

    async function buscarPorDescripcion() {
        const input = document.getElementById('input-descripcion-caja');
        const desc = input?.value.trim();

        if (!desc || desc.length < 2) {
            ocultarResultadosCaja();
            return;
        }

        try {
            const response = await fetch(`/api/produccion/abrir-caja/buscar?descripcion=${encodeURIComponent(desc)}`);
            if (!response.ok) throw new Error('Error en búsqueda de caja');

            const data = await response.json();
            if (data.success && data.resultados && data.resultados.length > 0) {
                mostrarResultadosCaja(data.resultados);
            } else {
                mostrarMensaje('No se encontraron cajas con esa descripción.', 'warning');
            }
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error búsqueda descripción:', error);
            mostrarMensaje('Error al buscar cajas', 'error');
        }
    }

    function mostrarResultadosCaja(resultados) {
        const container = document.getElementById('resultados-caja');
        if (!container) return;
        container.innerHTML = '';

        resultados.forEach(res => {
            const div = document.createElement('div');
            div.style.cssText = 'padding: 10px; border-bottom: 1px solid #e0e0e0; cursor: pointer; transition: background 0.15s;';

            div.innerHTML = `
                <div style="font-weight: 700; color: #212121; font-size: 13px;">${res.descripcion}</div>
                <div style="font-size: 12px; color: #616161; margin-top: 3px; display: flex; gap: 12px;">
                    <span>Código: <strong style="font-family: monospace;">${res.articulo_numero}</strong></span>
                    <span>Stock: <strong style="color: ${parseFloat(res.stock_actual) > 0 ? '#2e7d32' : '#c62828'};">${parseFloat(res.stock_actual).toFixed(2)} cajas</strong></span>
                    ${res.pack_unidades ? `<span>Unidades: <strong>${res.pack_unidades}</strong></span>` : ''}
                </div>
            `;

            div.addEventListener('click', () => seleccionarCaja(res));
            div.addEventListener('mouseenter', () => div.style.background = '#f1f8e9');
            div.addEventListener('mouseleave', () => div.style.background = 'white');

            container.appendChild(div);
        });

        container.style.display = 'block';
    }

    function ocultarResultadosCaja() {
        const container = document.getElementById('resultados-caja');
        if (container) container.style.display = 'none';
    }

    function seleccionarCaja(caja) {
        cajaSeleccionada = caja;

        document.getElementById('caja-nombre').textContent = caja.descripcion;
        document.getElementById('caja-codigo').textContent = caja.articulo_numero;
        const elBarcode = document.getElementById('caja-barcode');
        if (elBarcode) elBarcode.textContent = caja.codigo_barras || '-';
        document.getElementById('caja-stock').textContent = `${parseFloat(caja.stock_actual || 0).toFixed(2)} cajas`;
        document.getElementById('caja-seleccionada-display').style.display = 'block';

        ocultarResultadosCaja();

        // Si la caja ya tiene pack_unidades definido, autocompletar cantidad
        const inputCant = document.getElementById('abrir-caja-cantidad');
        if (inputCant && caja.pack_unidades && parseInt(caja.pack_unidades) > 0) {
            inputCant.value = caja.pack_unidades;
        } else if (inputCant && (!inputCant.value || parseInt(inputCant.value) <= 0)) {
            inputCant.value = 12; // Valor sugerido habitual si no está configurado
        }

        // Limpiar inputs de búsqueda de caja
        const inputCodigo = document.getElementById('input-codigo-caja');
        const inputDesc = document.getElementById('input-descripcion-caja');
        if (inputCodigo) inputCodigo.value = '';
        if (inputDesc) inputDesc.value = '';

        // Solicitar lote sugerido vinculado a la caja
        solicitarLoteSugerido(caja.articulo_numero, datosArticuloUnidad?.articulo_numero);

        actualizarContadorEtiquetas();
        validarFormulario();
        mostrarMensaje('Caja seleccionada correctamente', 'success');

        console.log('✅ [ABRIR-CAJA] Caja de origen seleccionada:', caja.articulo_numero);
    }

    // ==========================================
    // GESTIÓN DE LOTES Y TRAZABILIDAD
    // ==========================================

    async function solicitarLoteSugerido(codigoCaja = null, codigoUnidad = null, forzarNuevo = false) {
        try {
            let url = `/api/produccion/abrir-caja/lote-sugerido?forzar_nuevo=${forzarNuevo ? '1' : '0'}`;
            if (codigoCaja) url += `&codigo_caja=${encodeURIComponent(codigoCaja)}`;
            if (codigoUnidad) url += `&codigo_unidad=${encodeURIComponent(codigoUnidad)}`;

            const response = await fetch(url);
            if (!response.ok) throw new Error('Error al consultar lote');

            const data = await response.json();
            if (data.success && data.lote) {
                loteActual = data.lote;
                origenLote = data.origen || 'generado';

                const inputLote = document.getElementById('abrir-caja-lote');
                if (inputLote) inputLote.value = loteActual;

                actualizarInfoLote(data.descripcion);
            }
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error al obtener lote:', error);
            // Fallback: generar código rápido en cliente
            if (!loteActual) {
                loteActual = 'L' + Math.random().toString(36).substring(2, 9).toUpperCase();
                const inputLote = document.getElementById('abrir-caja-lote');
                if (inputLote) inputLote.value = loteActual;
                actualizarInfoLote();
            }
        }
    }

    function actualizarInfoLote(descripcionExtra = '') {
        const badge = document.getElementById('badge-origen-lote');
        const info = document.getElementById('info-lote-origen');

        if (badge) {
            if (origenLote === 'lote_caja') {
                badge.style.background = '#e8f5e9';
                badge.style.color = '#2e7d32';
                badge.textContent = '🟢 Heredado de Caja';
            } else {
                badge.style.background = '#e3f2fd';
                badge.style.color = '#1565c0';
                badge.textContent = '✨ Lote Generado';
            }
        }

        if (info) {
            if (descripcionExtra) {
                info.textContent = descripcionExtra;
            } else if (origenLote === 'lote_caja') {
                info.textContent = 'Lote vinculado a la partida de la caja seleccionada.';
            } else {
                info.textContent = 'Lote nuevo asignado a las unidades extraídas.';
            }
        }
    }

    function actualizarContadorEtiquetas() {
        const cantidadInput = document.getElementById('abrir-caja-cantidad')?.value;
        const cantidad = parseInt(cantidadInput) || 0;
        const display = document.getElementById('display-cant-etiquetas');
        const btnImprimir = document.getElementById('btn-imprimir-caja');

        if (display) {
            if (cantidad > 0) {
                display.textContent = `${cantidad} pares de etiquetas (${cantidad} de producto + ${cantidad} de lote)`;
            } else {
                display.textContent = `0 etiquetas listas para imprimir`;
            }
        }

        if (btnImprimir) {
            if (cantidad > 0) {
                btnImprimir.textContent = `🏷️ Imprimir ${cantidad} Etiquetas (con Lote)`;
            } else {
                btnImprimir.textContent = `🏷️ Imprimir Etiquetas (con Lote)`;
            }
        }
    }

    // ==========================================
    // IMPRESIÓN DE ETIQUETAS (CON LOTE)
    // ==========================================

    async function imprimirEtiquetas() {
        const cantidad = parseInt(document.getElementById('abrir-caja-cantidad')?.value);
        const loteInput = document.getElementById('abrir-caja-lote')?.value.trim();
        const lote = loteInput || loteActual;

        if (!cantidad || cantidad < 1) {
            mostrarMensaje('Ingrese la cantidad de unidades que trae la caja', 'warning');
            return;
        }

        if (!datosArticuloUnidad) {
            mostrarMensaje('Error: datos del producto a extraer no disponibles', 'error');
            return;
        }

        const fechaElab = document.getElementById('abrir-caja-fecha-elab')?.value.trim();
        const fechaVenc = document.getElementById('abrir-caja-fecha-venc')?.value.trim();

        try {
            mostrarMensaje(`Enviando ${cantidad} etiquetas con Lote ${lote} a la impresora...`, 'info');

            const payload = {
                articulo: {
                    nombre: datosArticuloUnidad.descripcion || datosArticuloUnidad.nombre,
                    numero: datosArticuloUnidad.articulo_numero || datosArticuloUnidad.codigo,
                    codigo_barras: datosArticuloUnidad.codigo_barras || datosArticuloUnidad.articulo_numero
                },
                cantidad: cantidad,
                lote: lote,
                fechas: (fechaElab && fechaVenc) ? {
                    elaboracion: fechaElab,
                    vencimiento: fechaVenc
                } : null
            };

            const response = await fetch('http://localhost:3000/api/imprimir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error('Error al conectar con la impresora');

            etiquetasImpresas = true;
            mostrarMensaje(`✅ ${cantidad} etiquetas impresas exitosamente con Lote ${lote}`, 'success');
            validarFormulario();

            console.log('✅ [ABRIR-CAJA] Impresión completada con Lote:', lote);
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error impresión:', error);
            mostrarMensaje(`Error al imprimir etiquetas: ${error.message}`, 'error');
        }
    }

    // ==========================================
    // REGISTRO Y APERTURA DE CAJA
    // ==========================================

    async function confirmarApertura() {
        if (!validarFormulario()) {
            mostrarMensaje('Complete los campos obligatorios (Usuario, Cantidad y Caja de Origen)', 'warning');
            return;
        }

        const lote = document.getElementById('abrir-caja-lote')?.value.trim() || loteActual;

        if (!etiquetasImpresas) {
            const confirmarSinImprimir = confirm(
                `⚠️ Aún no has impreso las etiquetas con el lote asignado (${lote}).\n\n¿Deseas imprimir las etiquetas antes de continuar?`
            );
            if (confirmarSinImprimir) {
                await imprimirEtiquetas();
                return;
            }
        }

        const usuarioId = parseInt(document.getElementById('abrir-caja-usuario').value);
        const cantidad = parseInt(document.getElementById('abrir-caja-cantidad').value);

        try {
            document.getElementById('btn-confirmar-caja').disabled = true;
            document.getElementById('btn-imprimir-caja').disabled = true;

            mostrarMensaje('Procesando apertura y actualización de stock...', 'info');

            const response = await fetch('/api/produccion/abrir-caja', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    codigo_caja: cajaSeleccionada.articulo_numero,
                    codigo_unidad: datosArticuloUnidad.articulo_numero || datosArticuloUnidad.codigo,
                    cantidad_unidades: cantidad,
                    usuario_id: usuarioId,
                    lote: lote,
                    kilos_caja: 0,
                    kilos_unidad: datosArticuloUnidad.kilos_unidad || 0
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detalle || errorData.error || 'Error al abrir caja');
            }

            const result = await response.json();

            mostrarMensaje(`✅ Caja abierta con éxito: ${cantidad} unidades sumadas al stock (Lote: ${lote})`, 'success');

            setTimeout(() => {
                cerrarModal();
                if (typeof window.actualizarResumenFaltantes === 'function') {
                    window.actualizarResumenFaltantes();
                }
                setTimeout(() => location.reload(), 600);
            }, 1800);

            console.log('✅ [ABRIR-CAJA] Apertura exitosa:', result);
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error al confirmar apertura:', error);
            mostrarMensaje(`Error: ${error.message}`, 'error');
            document.getElementById('btn-confirmar-caja').disabled = false;
            document.getElementById('btn-imprimir-caja').disabled = false;
        }
    }

    function validarFormulario() {
        const usuario = document.getElementById('abrir-caja-usuario')?.value;
        const cantidad = document.getElementById('abrir-caja-cantidad')?.value;
        const lote = document.getElementById('abrir-caja-lote')?.value.trim();
        const btnImprimir = document.getElementById('btn-imprimir-caja');
        const btnConfirmar = document.getElementById('btn-confirmar-caja');

        const datosCompletos = usuario && cantidad && parseInt(cantidad) > 0 && cajaSeleccionada && datosArticuloUnidad && lote;

        if (btnImprimir) {
            btnImprimir.disabled = !cajaSeleccionada || !datosArticuloUnidad || !cantidad || parseInt(cantidad) < 1 || !lote;
        }
        if (btnConfirmar) {
            btnConfirmar.disabled = !datosCompletos;
        }

        return datosCompletos;
    }

    async function cargarUsuarios() {
        try {
            const response = await fetch('/api/usuarios/con-permiso/Produccion');
            if (!response.ok) throw new Error('Error al cargar usuarios');

            const usuarios = await response.json();
            const select = document.getElementById('abrir-caja-usuario');

            if (select) {
                const valorPrevio = select.value;
                select.innerHTML = '<option value="">-- Seleccionar usuario --</option>';
                usuarios.forEach(u => {
                    const opt = document.createElement('option');
                    opt.value = u.id;
                    opt.textContent = u.nombre_completo;
                    select.appendChild(opt);
                });
                if (valorPrevio) select.value = valorPrevio;
            }
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error al cargar usuarios:', error);
        }
    }

    function mostrarMensaje(texto, tipo) {
        const el = document.getElementById('mensaje-abrir-caja');
        if (!el) return;

        el.textContent = texto;
        el.className = tipo === 'success' ? 'alert alert-success' :
            tipo === 'error' ? 'alert alert-danger' :
            tipo === 'warning' ? 'alert alert-warning' : 'alert alert-info';
        el.style.display = 'block';

        if (tipo === 'success') {
            setTimeout(() => { if (el) el.style.display = 'none'; }, 6000);
        }
    }

    function resetearModal() {
        datosArticuloUnidad = null;
        cajaSeleccionada = null;
        loteActual = '';
        origenLote = 'generado';
        etiquetasImpresas = false;
        modoManual = false;

        const select = document.getElementById('abrir-caja-usuario');
        const inputCant = document.getElementById('abrir-caja-cantidad');
        const inputCod = document.getElementById('input-codigo-caja');
        const inputDesc = document.getElementById('input-descripcion-caja');
        const inputBusquedaUnidad = document.getElementById('input-busqueda-unidad');
        const inputLote = document.getElementById('abrir-caja-lote');

        if (select) select.value = '';
        if (inputCant) inputCant.value = '';
        if (inputCod) inputCod.value = '';
        if (inputDesc) inputDesc.value = '';
        if (inputBusquedaUnidad) inputBusquedaUnidad.value = '';
        if (inputLote) inputLote.value = '';

        ocultarResultadosCaja();
        const resultadosUnidad = document.getElementById('resultados-unidad');
        if (resultadosUnidad) resultadosUnidad.style.display = 'none';

        const sugerenciasContainer = document.getElementById('sugerencias-container-caja');
        if (sugerenciasContainer) sugerenciasContainer.style.display = 'none';

        document.getElementById('caja-seleccionada-display').style.display = 'none';
        document.getElementById('mensaje-abrir-caja').style.display = 'none';

        cambiarModoBusquedaCaja('codigo');
        actualizarContadorEtiquetas();

        document.getElementById('btn-imprimir-caja').disabled = true;
        document.getElementById('btn-confirmar-caja').disabled = true;
    }

    function cerrarModal() {
        if (modalElement) modalElement.style.display = 'none';
    }

    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    function mostrarElemento(id, mostrar) {
        const el = document.getElementById(id);
        if (el) el.style.display = mostrar ? 'block' : 'none';
    }

    // ==========================================
    // API PÚBLICA
    // ==========================================

    function abrir(articuloNumero = null, datosArticulo = null) {
        console.log(`📦 [ABRIR-CAJA] Solicitud de apertura. Arg:`, articuloNumero);

        if (!modalElement) {
            if (!inicializarModal()) {
                alert('Error: Modal Abrir Caja no inicializado.');
                return;
            }
        }

        resetearModal();
        modalElement.style.display = 'flex';

        if (articuloNumero) {
            // MODO CONTEXTUAL: Ya tenemos el artículo
            modoManual = false;
            configurarModoContextual(articuloNumero, datosArticulo);
        } else {
            // MODO MANUAL: Paso 1 Búsqueda por Nombre
            configurarModoManual();
        }
    }

    return {
        abrir: abrir,
        cerrar: cerrarModal
    };
})();

// Menú contextual en tabla de producción
window.agregarOpcionAbrirCajaAlMenu = function (menuContextual, articuloNumero, datosArticulo) {
    if (!menuContextual) return;

    const opcion = document.createElement('div');
    opcion.className = 'context-menu-item';
    opcion.innerHTML = '📦 Abrir Caja';
    opcion.style.cssText = `
        padding: 12px 16px;
        cursor: pointer;
        transition: background 0.2s;
        border-bottom: 1px solid #e0e0e0;
        font-size: 14px;
        font-weight: 500;
        color: #212121;
    `;

    opcion.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const menuElement = document.getElementById('context-menu-articulo');
        if (menuElement) menuElement.remove();

        if (window.ModalAbrirCaja && typeof window.ModalAbrirCaja.abrir === 'function') {
            window.ModalAbrirCaja.abrir(articuloNumero, datosArticulo);
        } else {
            console.error('❌ [ABRIR-CAJA] ModalAbrirCaja no disponible');
        }

        return false;
    }, true);

    opcion.addEventListener('mouseenter', () => opcion.style.background = '#f5f5f5');
    opcion.addEventListener('mouseleave', () => opcion.style.background = 'white');

    menuContextual.insertBefore(opcion, menuContextual.firstChild);
};

// Exponer módulo globalmente
window.ModalAbrirCaja = ModalAbrirCaja;

// Inicialización de listener del botón global
document.addEventListener('DOMContentLoaded', function () {
    const btnGlobal = document.getElementById('btn-abrir-caja-global');
    if (btnGlobal) {
        btnGlobal.addEventListener('click', function (e) {
            e.preventDefault();
            console.log('🔘 [ABRIR-CAJA] Click en botón global detectado');
            if (window.ModalAbrirCaja && typeof window.ModalAbrirCaja.abrir === 'function') {
                window.ModalAbrirCaja.abrir();
            } else {
                console.error('❌ [ABRIR-CAJA] Módulo no listo');
                alert('El módulo de Abrir Caja no está listo aún. Intente de nuevo.');
            }
        });
    }
});
