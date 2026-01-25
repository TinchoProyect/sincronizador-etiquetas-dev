/**
 * Modal "Abrir Caja" - Transformar stock de cajas a unidades
 * Versión: 3.1 - Búsqueda Avanzada (Tokenizada)
 * 
 * @module modal-abrir-caja
 */

// ==========================================
// NAMESPACE AISLADO
// ==========================================

const ModalAbrirCaja = (function () {
    'use strict';

    // Variables privadas del módulo
    let modalElement = null;
    let datosArticuloUnidad = null; // El contenido (lo que se produce)
    let cajaSeleccionada = null;    // El origen (la caja cerrada)
    let etiquetasImpresas = false;
    let modoManual = false; // Flag para saber si estamos en flujo manual

    // ==========================================
    // UTILIDADES DE BÚSQUEDA
    // ==========================================

    // Normalizar texto (quitar acentos, minúsculas y ñ→n)
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

        console.log('✅ [ABRIR-CAJA] Modal encontrado, configurando...');
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
            inputDesc.addEventListener('input', debounce(buscarPorDescripcion, 500));
        }

        // NUEVO: Búsqueda UNIDAD (Manual)
        const inputBusquedaUnidad = document.getElementById('input-busqueda-unidad');
        if (inputBusquedaUnidad) {
            inputBusquedaUnidad.addEventListener('input', debounce(buscarUnidadAvanzada, 400));
            inputBusquedaUnidad.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    buscarUnidadAvanzada();
                }
            });
        }

        // NUEVO: Botón Cambiar Unidad
        document.getElementById('btn-cambiar-unidad')?.addEventListener('click', configurarModoManual);

        // NUEVO: Botón Global de Apertura - Se vincula también en DOMContentLoaded por seguridad
        document.getElementById('btn-abrir-caja-global')?.addEventListener('click', () => {
            abrir();
        });

        // Botones de Acción
        document.getElementById('btn-imprimir-caja')?.addEventListener('click', imprimirEtiquetas);
        document.getElementById('btn-confirmar-caja')?.addEventListener('click', confirmarApertura);

        // Validación
        document.getElementById('abrir-caja-usuario')?.addEventListener('change', validarFormulario);
        document.getElementById('abrir-caja-cantidad')?.addEventListener('input', validarFormulario);
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
    // LÓGICA DE NEGOCIO - FLUJO Y ESTADOS
    // ==========================================

    /**
     * Configura el modal para el MODO MANUAL (Búsqueda inicial de unidad)
     */
    function configurarModoManual() {
        modoManual = true;

        // Mostrar paso 1, ocultar paso 2
        mostrarElemento('paso-seleccion-unidad', true);
        mostrarElemento('paso-seleccion-caja', false);

        // Resetear datos
        document.getElementById('input-busqueda-unidad').value = '';
        document.getElementById('resultados-unidad').style.display = 'none';
        document.getElementById('btn-cambiar-unidad').style.display = 'none'; // No se puede cambiar si no seleccionó nada

        datosArticuloUnidad = null;
        cajaSeleccionada = null;

        // Foco
        setTimeout(() => document.getElementById('input-busqueda-unidad')?.focus(), 100);

        console.log('🛠️ [ABRIR-CAJA] Modo Manual activado');
    }

    /**
     * Configura el modal para el MODO CONTEXTUAL (Unidad ya definida)
     * También se usa como "Paso 2" del modo manual
     */
    async function configurarModoContextual(articuloNumero, datosArticulo) {
        // En modo manual, 'modoManual' sigue siendo true, pero avanzamos de paso.
        // Si venimos de click derecho, datosArticulo suele venir lleno.

        datosArticuloUnidad = datosArticulo || { articulo_numero: articuloNumero };

        // Mostrar paso 2, ocultar paso 1
        mostrarElemento('paso-seleccion-unidad', false);
        mostrarElemento('paso-seleccion-caja', true);

        // Mostrar botón de cambiar solo si estamos en modo manual original
        if (modoManual) {
            document.getElementById('btn-cambiar-unidad').style.display = 'inline-block';
        } else {
            document.getElementById('btn-cambiar-unidad').style.display = 'none';
        }

        // Llenar info de la unidad
        document.getElementById('unidad-descripcion-caja').textContent = datosArticuloUnidad.descripcion || datosArticuloUnidad.nombre || '-';
        document.getElementById('unidad-codigo-caja').textContent = articuloNumero;
        document.getElementById('unidad-stock-caja').textContent =
            datosArticuloUnidad.stock_disponible !== undefined
                ? `${parseFloat(datosArticuloUnidad.stock_disponible).toFixed(2)} unidades`
                : (datosArticuloUnidad.stock !== undefined ? `${parseFloat(datosArticuloUnidad.stock).toFixed(2)} unidades` : '-');

        // Resetear selección de caja
        document.getElementById('caja-seleccionada-display').style.display = 'none';
        cajaSeleccionada = null;
        document.getElementById('btn-imprimir-caja').disabled = true;
        document.getElementById('btn-confirmar-caja').disabled = true;

        // Cargar dependencias
        await cargarUsuarios();
        await cargarSugerencias(articuloNumero);

        // Foco en usuario (flujo rápido)
        setTimeout(() => document.getElementById('abrir-caja-usuario')?.focus(), 100);

        console.log(`✅ [ABRIR-CAJA] Unidad configurada: ${articuloNumero}`);
    }

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

    // ==========================================
    // NUEVA LÓGICA: BÚSQUEDA AVANZADA DE UNIDAD
    // ==========================================

    async function buscarUnidadAvanzada() {
        const input = document.getElementById('input-busqueda-unidad');
        const texto = input?.value.trim();

        if (!texto || texto.length < 2) {
            const container = document.getElementById('resultados-unidad');
            if (container) container.style.display = 'none';
            return;
        }

        console.log(`🔍 [ABRIR-CAJA] Buscando unidad (avanzado): "${texto}"`);
        const container = document.getElementById('resultados-unidad');
        if (container) {
            container.innerHTML = '<div style="padding: 10px; color: #666;">Buscando...</div>';
            container.style.display = 'block';
        }

        // 1. Normalización y Tokenización
        const textoNorm = normalizarTexto(texto);
        // Dividir por espacios y filtrar vacíos
        const tokens = textoNorm.split(/\s+/).filter(t => t.length > 0);

        if (tokens.length === 0) return;

        try {
            // 2. Estrategia de Búsqueda:
            // Si parece código de barras (solo números), buscar exacto.
            // Si es texto, usar el PRIMER token para traer candidatos y filtrar en cliente.

            let resultadosCandidatos = [];
            const esCodigo = /^\d+$/.test(texto);

            if (esCodigo) {
                // Búsqueda exacta por código
                const response = await fetch(`/api/produccion/articulos?codigo_barras=${encodeURIComponent(texto)}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.data) resultadosCandidatos = data.data;
                }
            } else {
                // Búsqueda por descripción (usando primer token para ser eficiente con el backend)
                // Usamos el endpoint que sabemos que busca por "q" o descripción
                const primerToken = tokens[0];
                const response = await fetch(`/api/produccion/buscar-articulos?q=${encodeURIComponent(primerToken)}`);

                if (response.ok) {
                    const data = await response.json();
                    // Algunos endpoints devuelven { success: true, articulos: [...] } o { success: true, data: [...] }
                    // Unificamos
                    if (data.success) {
                        resultadosCandidatos = data.articulos || data.data || [];
                    }
                } else {
                    // Fallback a endpoint genérico si el de buscar-articulos falla
                    const response2 = await fetch(`/api/produccion/articulos?q=${encodeURIComponent(primerToken)}`);
                    if (response2.ok) {
                        const data2 = await response2.json();
                        if (data2.success) resultadosCandidatos = data2.data || [];
                    }
                }
            }

            // 3. Filtrado Cliente (AND Logic)
            // Solo si no fue búsqueda directa por código
            let resultadosFiltrados = resultadosCandidatos;

            if (!esCodigo && resultadosCandidatos.length > 0) {
                resultadosFiltrados = resultadosCandidatos.filter(art => {
                    // Normalizar descripción del artículo
                    const descripcionArt = normalizarTexto(art.descripcion || art.nombre || '');
                    const codigoArt = normalizarTexto(art.codigo_barras || art.articulo_numero || '');

                    // Verificar que CADA token esté presente en la descripción O en el código
                    return tokens.every(token =>
                        descripcionArt.includes(token) || codigoArt.includes(token)
                    );
                });
            }

            mostrarResultadosUnidad(resultadosFiltrados);

        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error búsqueda avanzada:', error);
            if (container) container.innerHTML = '<div style="padding: 10px; color: red;">Error al buscar</div>';
        }
    }

    function mostrarResultadosUnidad(resultados) {
        const container = document.getElementById('resultados-unidad');
        if (!container) return;

        container.innerHTML = '';

        if (!resultados || resultados.length === 0) {
            container.innerHTML = '<div style="padding: 10px; color: #666;">No se encontraron artículos.</div>';
            return;
        }

        // Limitar a 50 resultados para no saturar UI
        const muestra = resultados.slice(0, 50);

        muestra.forEach(art => {
            const div = document.createElement('div');
            // Estilo unificado
            div.style.cssText = 'padding: 10px; border-bottom: 1px solid #eee; cursor: pointer; transition: background-color 0.2s;';

            // Highlight match (opcional, simple)
            const nombre = art.descripcion || art.nombre;
            const codigo = art.articulo_numero || art.codigo || art.codigo_barras;
            const stock = art.stock_disponible || art.stock || 0;

            div.innerHTML = `
                <div style="font-weight: bold; color: #333;">${nombre}</div>
                <div style="font-size: 12px; color: #888;">
                    Cód: <span style="font-family: monospace;">${codigo}</span> | 
                    Stock: <strong>${stock}</strong>
                </div>
            `;

            div.onclick = () => seleccionarUnidad(art);

            div.addEventListener('mouseenter', () => div.style.backgroundColor = '#f0f0f0');
            div.addEventListener('mouseleave', () => div.style.backgroundColor = 'white');

            container.appendChild(div);
        });

        if (resultados.length > 50) {
            const footer = document.createElement('div');
            footer.style.padding = '8px';
            footer.style.textAlign = 'center';
            footer.style.color = '#888';
            footer.style.fontSize = '12px';
            footer.textContent = `Mostrando 50 de ${resultados.length} resultados. Refine su búsqueda.`;
            container.appendChild(footer);
        }

        container.style.display = 'block';
    }

    function seleccionarUnidad(articulo) {
        console.log('✅ [ABRIR-CAJA] Unidad seleccionada:', articulo);

        // Normalizar datos
        const numero = articulo.articulo_numero || articulo.codigo || articulo.codigo_barras; // Asegurar campo

        // Avanzar al paso 2 (Configuración igual a Contextual)
        configurarModoContextual(numero, articulo);
    }

    // ==========================================
    // LÓGICA DE NEGOCIO - CARGA DE DATOS Y CAJAS
    // ==========================================

    async function cargarUsuarios() {
        try {
            const response = await fetch('/api/usuarios/con-permiso/Produccion');
            if (!response.ok) throw new Error('Error al cargar usuarios');

            const usuarios = await response.json();
            const select = document.getElementById('abrir-caja-usuario');

            if (select) {
                // Mantener selección si existe
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

            console.log(`✅ [ABRIR-CAJA] ${usuarios.length} usuarios cargados`);
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error al cargar usuarios:', error);
            mostrarMensaje('Error al cargar usuarios', 'error');
        }
    }

    async function cargarSugerencias(articuloNumero) {
        try {
            const response = await fetch(`/api/produccion/abrir-caja/sugerencias?articulo_unidad=${articuloNumero}`);
            if (!response.ok) return;

            const data = await response.json();
            if (data.success && data.sugerencias && data.sugerencias.length > 0) {
                mostrarSugerencias(data.sugerencias);
            } else {
                // Si no hay sugerencias, ocultar contenedor
                const container = document.getElementById('sugerencias-container-caja');
                if (container) container.style.display = 'none';
            }
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error al cargar sugerencias:', error);
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
                padding: 12px;
                background: ${idx === 0 ? '#e8f5e9' : '#f5f5f5'};
                border: 2px solid ${idx === 0 ? '#4caf50' : '#e0e0e0'};
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.3s ease;
            `;
            div.setAttribute('title', 'Clic para usar esta caja');

            div.innerHTML = `
                <div style="font-weight: 600; color: #212121;">${sug.descripcion_caja}</div>
                <div style="font-size: 12px; color: #757575; margin-top: 4px;">
                    Código: <span style="font-family: monospace;">${sug.codigo_caja}</span> | 
                    Stock: <strong>${parseFloat(sug.stock_actual).toFixed(2)}</strong>
                    ${idx === 0 ? ' <span style="color: #4caf50; font-weight: bold;">⭐ Sugerido</span>' : ''}
                </div>
            `;

            div.addEventListener('click', () => seleccionarCaja({
                articulo_numero: sug.codigo_caja,
                descripcion: sug.descripcion_caja,
                codigo_barras: sug.codigo_barras,
                stock_actual: sug.stock_actual
            }));

            div.addEventListener('mouseenter', () => {
                div.style.background = idx === 0 ? '#c8e6c9' : '#eeeeee';
                div.style.transform = 'translateX(5px)';
            });

            div.addEventListener('mouseleave', () => {
                div.style.background = idx === 0 ? '#e8f5e9' : '#f5f5f5';
                div.style.transform = 'translateX(0)';
            });

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
            if (!response.ok) throw new Error('Error en búsqueda');

            const data = await response.json();

            if (data.success && data.resultados && data.resultados.length > 0) {
                seleccionarCaja(data.resultados[0]);
            } else {
                mostrarMensaje('No se encontró caja con ese código (verifique que sea una caja válida)', 'warning');
            }
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error búsqueda código:', error);
            mostrarMensaje('Error al buscar caja', 'error');
        }
    }

    async function buscarPorDescripcion() {
        const input = document.getElementById('input-descripcion-caja');
        const desc = input?.value.trim();

        if (!desc || desc.length < 3) {
            ocultarResultadosCaja();
            return;
        }

        try {
            const response = await fetch(`/api/produccion/abrir-caja/buscar?descripcion=${encodeURIComponent(desc)}`);
            if (!response.ok) throw new Error('Error en búsqueda');

            const data = await response.json();

            if (data.success && data.resultados && data.resultados.length > 0) {
                mostrarResultadosCaja(data.resultados);
            } else {
                mostrarMensaje('No se encontraron cajas con esa descripción', 'warning');
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
            div.style.cssText = 'padding: 10px; border-bottom: 1px solid #e0e0e0; cursor: pointer; transition: background 0.2s;';

            div.innerHTML = `
                <div style="font-weight: 600; color: #212121;">${res.descripcion}</div>
                <div style="font-size: 12px; color: #757575; margin-top: 4px;">
                    Código: <span style="font-family: monospace;">${res.articulo_numero}</span> | 
                    Stock: <strong style="color: ${res.stock_actual >= 1 ? '#4caf50' : '#f44336'};">${parseFloat(res.stock_actual).toFixed(2)}</strong>
                </div>
            `;

            div.addEventListener('click', () => seleccionarCaja(res));
            div.addEventListener('mouseenter', () => div.style.background = '#f5f5f5');
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
        document.getElementById('caja-stock').textContent = `${parseFloat(caja.stock_actual).toFixed(2)} cajas`;
        document.getElementById('caja-seleccionada-display').style.display = 'block';

        ocultarResultadosCaja();

        // Limpiar inputs caja
        const inputCodigo = document.getElementById('input-codigo-caja');
        const inputDesc = document.getElementById('input-descripcion-caja');
        if (inputCodigo) inputCodigo.value = '';
        if (inputDesc) inputDesc.value = '';

        validarFormulario();
        mostrarMensaje('Caja seleccionada correctamente', 'success');

        console.log('✅ [ABRIR-CAJA] Caja seleccionada:', caja.articulo_numero);
    }

    async function imprimirEtiquetas() {
        const cantidad = parseInt(document.getElementById('abrir-caja-cantidad')?.value);

        if (!cantidad || cantidad < 1) {
            mostrarMensaje('Ingrese la cantidad de unidades', 'warning');
            return;
        }

        if (!datosArticuloUnidad) {
            mostrarMensaje('Error: datos del artículo no disponibles', 'error');
            return;
        }

        try {
            mostrarMensaje('Imprimiendo etiquetas...', 'info');

            const response = await fetch('http://localhost:3000/api/imprimir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    articulo: {
                        nombre: datosArticuloUnidad.descripcion || datosArticuloUnidad.nombre,
                        numero: datosArticuloUnidad.articulo_numero || datosArticuloUnidad.codigo,
                        codigo_barras: datosArticuloUnidad.codigo_barras || datosArticuloUnidad.articulo_numero
                    },
                    cantidad: cantidad
                })
            });

            if (!response.ok) throw new Error('Error al imprimir');

            etiquetasImpresas = true;
            mostrarMensaje(`✅ ${cantidad} etiquetas enviadas a impresión`, 'success');
            validarFormulario();

            console.log('✅ [ABRIR-CAJA] Etiquetas impresas');
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error impresión:', error);
            mostrarMensaje(`Error al imprimir: ${error.message}`, 'error');
        }
    }

    async function confirmarApertura() {
        if (!validarFormulario()) {
            mostrarMensaje('Complete todos los campos requeridos', 'warning');
            return;
        }

        if (!etiquetasImpresas) {
            const confirmar = confirm('⚠️ No se detectó impresión de etiquetas.\n\n¿Desea imprimir antes de confirmar?');
            if (confirmar) {
                await imprimirEtiquetas();
                return;
            }
        }

        const usuarioId = parseInt(document.getElementById('abrir-caja-usuario').value);
        const cantidad = parseInt(document.getElementById('abrir-caja-cantidad').value);

        try {
            document.getElementById('btn-confirmar-caja').disabled = true;
            document.getElementById('btn-imprimir-caja').disabled = true;

            mostrarMensaje('Procesando apertura...', 'info');

            const response = await fetch('/api/produccion/abrir-caja', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    codigo_caja: cajaSeleccionada.articulo_numero,
                    codigo_unidad: datosArticuloUnidad.articulo_numero || datosArticuloUnidad.codigo,
                    cantidad_unidades: cantidad,
                    usuario_id: usuarioId,
                    kilos_caja: 0,
                    kilos_unidad: datosArticuloUnidad.kilos_unidad || 0
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detalle || errorData.error || 'Error al abrir caja');
            }

            const result = await response.json();

            mostrarMensaje(`✅ Caja abierta: ${cantidad} unidades agregadas al stock`, 'success');

            setTimeout(() => {
                cerrarModal();
                if (typeof window.actualizarResumenFaltantes === 'function') {
                    window.actualizarResumenFaltantes();
                }
                // Si es manual, recargar podría ser molesto si quiere abrir otra, 
                // pero por consistencia de stock mejor recargamos o actualizamos UI
                setTimeout(() => location.reload(), 500);
            }, 2000);

            console.log('✅ [ABRIR-CAJA] Apertura exitosa:', result);
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error apertura:', error);
            mostrarMensaje(`Error: ${error.message}`, 'error');
            document.getElementById('btn-confirmar-caja').disabled = false;
            document.getElementById('btn-imprimir-caja').disabled = false;
        }
    }

    function validarFormulario() {
        const usuario = document.getElementById('abrir-caja-usuario')?.value;
        const cantidad = document.getElementById('abrir-caja-cantidad')?.value;
        const btnImprimir = document.getElementById('btn-imprimir-caja');
        const btnConfirmar = document.getElementById('btn-confirmar-caja');

        const completo = usuario && cantidad && parseInt(cantidad) > 0 && cajaSeleccionada && datosArticuloUnidad;

        if (btnImprimir) btnImprimir.disabled = !cajaSeleccionada || !datosArticuloUnidad || !cantidad || parseInt(cantidad) < 1;
        if (btnConfirmar) btnConfirmar.disabled = !completo;

        return completo;
    }

    function mostrarMensaje(texto, tipo) {
        const el = document.getElementById('mensaje-abrir-caja');
        if (!el) return;

        el.textContent = texto;
        el.className = tipo === 'success' ? 'mensaje-exito' :
            tipo === 'error' ? 'mensaje-error' : 'mensaje-info';
        el.style.display = 'block';

        if (tipo === 'success') {
            setTimeout(() => el.style.display = 'none', 5000);
        }
    }

    function resetearModal() {
        datosArticuloUnidad = null;
        cajaSeleccionada = null;
        etiquetasImpresas = false;
        modoManual = false;

        const select = document.getElementById('abrir-caja-usuario');
        const inputCant = document.getElementById('abrir-caja-cantidad');
        const inputCod = document.getElementById('input-codigo-caja');
        const inputDesc = document.getElementById('input-descripcion-caja');
        const inputBusquedaUnidad = document.getElementById('input-busqueda-unidad');

        if (select) select.value = '';
        if (inputCant) inputCant.value = '';
        if (inputCod) inputCod.value = '';
        if (inputDesc) inputDesc.value = '';
        if (inputBusquedaUnidad) inputBusquedaUnidad.value = ''; // Resetear búsqueda unidad

        // Ocultar resultados
        ocultarResultadosCaja();
        const resultadosUnidad = document.getElementById('resultados-unidad');
        if (resultadosUnidad) resultadosUnidad.style.display = 'none';

        // Ocultar contenedores
        const sugerenciasContainer = document.getElementById('sugerencias-container-caja');
        if (sugerenciasContainer) sugerenciasContainer.style.display = 'none';

        document.getElementById('caja-seleccionada-display').style.display = 'none';
        document.getElementById('mensaje-abrir-caja').style.display = 'none';

        // Reset tabs
        cambiarModoBusquedaCaja('codigo');

        document.getElementById('btn-imprimir-caja').disabled = true;
        document.getElementById('btn-confirmar-caja').disabled = true;
    }

    function cerrarModal() {
        if (modalElement) modalElement.style.display = 'none';
        // resetearModal(); // Opcional: limpiar al cerrar
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
    // API PÚBLICA (ABRIR)
    // ==========================================

    function abrir(articuloNumero = null, datosArticulo = null) {
        console.log(`🔓 [ABRIR-CAJA] Solicitud de apertura. Arg:`, articuloNumero);

        if (!modalElement) {
            if (!inicializarModal()) {
                alert('Error: Modal Abrir Caja no inicializado.');
                return;
            }
        }

        resetearModal();
        modalElement.style.display = 'flex';

        if (articuloNumero) {
            // MODO CONTEXTUAL (Viene con artículo definido)
            modoManual = false;
            configurarModoContextual(articuloNumero, datosArticulo);
        } else {
            // MODO MANUAL (Sin artículo definido)
            configurarModoManual();
        }
    }

    return {
        abrir: abrir,
        cerrar: cerrarModal
    };
})();

// ==========================================
// INTEGRACIÓN CON MENÚ CONTEXTUAL
// ==========================================

window.agregarOpcionAbrirCajaAlMenu = function (menuContextual, articuloNumero, datosArticulo) {
    if (!menuContextual) return;

    const opcion = document.createElement('div');
    opcion.className = 'context-menu-item';
    opcion.innerHTML = '🔓 Abrir Caja';
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

        console.log('🔓 [ABRIR-CAJA] Click en opción del menú');

        // Cerrar menú primero
        const menuElement = document.getElementById('context-menu-articulo');
        if (menuElement) {
            menuElement.remove();
        }

        // Abrir modal
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

// ==========================================
// INICIALIZACIÓN AUTOMÁTICA AL CARGAR
// ==========================================
document.addEventListener('DOMContentLoaded', function () {
    console.log('✅ [ABRIR-CAJA] DOM listo, inicializando listeners globales...');

    // Vincular botón global inmediatamente para evitar problemas de orden de carga
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
        console.log('✅ [ABRIR-CAJA] Listener global vinculado correctamente');
    } else {
        console.warn('⚠️ [ABRIR-CAJA] Botón global no encontrado al cargar DOM');
    }
});
