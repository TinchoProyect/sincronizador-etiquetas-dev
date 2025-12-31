/**
 * Modal "Abrir Caja" - Transformar stock de cajas a unidades
 * Versión: 2.4 - Simplificado sin wrappers
 * 
 * @module modal-abrir-caja
 */

// ==========================================
// NAMESPACE AISLADO
// ==========================================

const ModalAbrirCaja = (function() {
    'use strict';
    
    // Variables privadas del módulo
    let modalElement = null;
    let datosArticuloUnidad = null;
    let cajaSeleccionada = null;
    let etiquetasImpresas = false;
    
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
        // Tabs
        document.getElementById('btn-codigo-caja')?.addEventListener('click', () => cambiarModo('codigo'));
        document.getElementById('btn-descripcion-caja')?.addEventListener('click', () => cambiarModo('descripcion'));
        
        // Búsqueda código
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
        
        // Búsqueda descripción
        const inputDesc = document.getElementById('input-descripcion-caja');
        if (inputDesc) {
            inputDesc.addEventListener('input', debounce(buscarPorDescripcion, 500));
        }
        
        // Botones
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
    // LÓGICA DE NEGOCIO
    // ==========================================
    
    function cambiarModo(modo) {
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
        
        ocultarResultados();
    }
    
    async function cargarUsuarios() {
        try {
            const response = await fetch('/api/usuarios/con-permiso/Produccion');
            if (!response.ok) throw new Error('Error al cargar usuarios');
            
            const usuarios = await response.json();
            const select = document.getElementById('abrir-caja-usuario');
            
            if (select) {
                select.innerHTML = '<option value="">-- Seleccionar usuario --</option>';
                usuarios.forEach(u => {
                    const opt = document.createElement('option');
                    opt.value = u.id;
                    opt.textContent = u.nombre_completo;
                    select.appendChild(opt);
                });
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
            
            div.innerHTML = `
                <div style="font-weight: 600; color: #212121;">${sug.descripcion_caja}</div>
                <div style="font-size: 12px; color: #757575; margin-top: 4px;">
                    Código: <span style="font-family: monospace;">${sug.codigo_caja}</span> | 
                    Stock: <strong>${parseFloat(sug.stock_actual).toFixed(2)}</strong>
                    ${idx === 0 ? ' <span style="color: #4caf50; font-weight: bold;">⭐ Más reciente</span>' : ''}
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
        console.log(`✅ [ABRIR-CAJA] ${sugerencias.length} sugerencias mostradas`);
    }
    
    async function buscarPorCodigo() {
        const input = document.getElementById('input-codigo-caja');
        const codigo = input?.value.trim();
        
        if (!codigo) {
            ocultarResultados();
            return;
        }
        
        try {
            const response = await fetch(`/api/produccion/abrir-caja/buscar?codigo_barras=${encodeURIComponent(codigo)}`);
            if (!response.ok) throw new Error('Error en búsqueda');
            
            const data = await response.json();
            
            if (data.success && data.resultados && data.resultados.length > 0) {
                seleccionarCaja(data.resultados[0]);
            } else {
                mostrarMensaje('No se encontró caja con ese código', 'warning');
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
            ocultarResultados();
            return;
        }
        
        try {
            const response = await fetch(`/api/produccion/abrir-caja/buscar?descripcion=${encodeURIComponent(desc)}`);
            if (!response.ok) throw new Error('Error en búsqueda');
            
            const data = await response.json();
            
            if (data.success && data.resultados && data.resultados.length > 0) {
                mostrarResultados(data.resultados);
            } else {
                mostrarMensaje('No se encontraron cajas', 'warning');
            }
        } catch (error) {
            console.error('❌ [ABRIR-CAJA] Error búsqueda descripción:', error);
            mostrarMensaje('Error al buscar cajas', 'error');
        }
    }
    
    function mostrarResultados(resultados) {
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
    
    function ocultarResultados() {
        const container = document.getElementById('resultados-caja');
        if (container) container.style.display = 'none';
    }
    
    function seleccionarCaja(caja) {
        cajaSeleccionada = caja;
        
        document.getElementById('caja-nombre').textContent = caja.descripcion;
        document.getElementById('caja-codigo').textContent = caja.articulo_numero;
        document.getElementById('caja-stock').textContent = `${parseFloat(caja.stock_actual).toFixed(2)} cajas`;
        document.getElementById('caja-seleccionada-display').style.display = 'block';
        
        ocultarResultados();
        
        // Limpiar inputs
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
            
            const response = await fetch('/api/imprimir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    articulo: {
                        nombre: datosArticuloUnidad.descripcion,
                        numero: datosArticuloUnidad.articulo_numero,
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
                    codigo_unidad: datosArticuloUnidad.articulo_numero,
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
        
        const completo = usuario && cantidad && parseInt(cantidad) > 0 && cajaSeleccionada;
        
        if (btnImprimir) btnImprimir.disabled = !cajaSeleccionada || !cantidad || parseInt(cantidad) < 1;
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
        
        const select = document.getElementById('abrir-caja-usuario');
        const inputCant = document.getElementById('abrir-caja-cantidad');
        const inputCod = document.getElementById('input-codigo-caja');
        const inputDesc = document.getElementById('input-descripcion-caja');
        
        if (select) select.value = '';
        if (inputCant) inputCant.value = '';
        if (inputCod) inputCod.value = '';
        if (inputDesc) inputDesc.value = '';
        
        document.getElementById('sugerencias-container-caja').style.display = 'none';
        document.getElementById('caja-seleccionada-display').style.display = 'none';
        document.getElementById('mensaje-abrir-caja').style.display = 'none';
        
        ocultarResultados();
        cambiarModo('codigo');
        
        document.getElementById('btn-imprimir-caja').disabled = true;
        document.getElementById('btn-confirmar-caja').disabled = true;
    }
    
    function cerrarModal() {
        if (modalElement) modalElement.style.display = 'none';
        resetearModal();
    }
    
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }
    
    // ==========================================
    // API PÚBLICA
    // ==========================================
    
    return {
        abrir: async function(articuloNumero, datosArticulo = null) {
            console.log(`🔓 [ABRIR-CAJA] Abriendo modal para: ${articuloNumero}`);
            
            // Inicializar si es necesario
            if (!modalElement) {
                if (!inicializarModal()) {
                    alert('Error: Modal no encontrado. Recarga la página.');
                    return;
                }
            }
            
            resetearModal();
            
            datosArticuloUnidad = datosArticulo || { articulo_numero: articuloNumero };
            
            // Mostrar info artículo
            if (datosArticulo) {
                document.getElementById('unidad-descripcion-caja').textContent = datosArticulo.descripcion || '-';
                document.getElementById('unidad-codigo-caja').textContent = articuloNumero;
                document.getElementById('unidad-stock-caja').textContent = 
                    datosArticulo.stock_disponible !== undefined 
                        ? `${parseFloat(datosArticulo.stock_disponible).toFixed(2)} unidades`
                        : '-';
            }
            
            await cargarUsuarios();
            await cargarSugerencias(articuloNumero);
            
            modalElement.style.display = 'flex';
            
            setTimeout(() => document.getElementById('abrir-caja-usuario')?.focus(), 100);
        },
        
        cerrar: function() {
            cerrarModal();
        }
    };
})();

// ==========================================
// INTEGRACIÓN CON MENÚ CONTEXTUAL
// ==========================================

window.agregarOpcionAbrirCajaAlMenu = function(menuContextual, articuloNumero, datosArticulo) {
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
    
    opcion.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        console.log('🔓 [ABRIR-CAJA] Click en opción del menú');
        console.log('🔓 [ABRIR-CAJA] Artículo:', articuloNumero);
        console.log('🔓 [ABRIR-CAJA] Datos:', datosArticulo);
        
        // Cerrar menú primero
        const menuElement = document.getElementById('context-menu-articulo');
        if (menuElement) {
            menuElement.remove();
        }
        
        // Abrir modal directamente (sin setTimeout)
        if (window.ModalAbrirCaja && typeof window.ModalAbrirCaja.abrir === 'function') {
            console.log('🔓 [ABRIR-CAJA] Llamando a ModalAbrirCaja.abrir()');
            window.ModalAbrirCaja.abrir(articuloNumero, datosArticulo);
        } else {
            console.error('❌ [ABRIR-CAJA] ModalAbrirCaja.abrir no disponible');
            alert('Error: Modal no disponible. Recarga la página.');
        }
        
        return false;
    }, true);
    
    opcion.addEventListener('mouseenter', () => opcion.style.background = '#f5f5f5');
    opcion.addEventListener('mouseleave', () => opcion.style.background = 'white');
    
    menuContextual.insertBefore(opcion, menuContextual.firstChild);
    
    console.log('✅ [ABRIR-CAJA] Opción agregada al menú contextual');
};

// Exponer módulo globalmente
window.ModalAbrirCaja = ModalAbrirCaja;

// ==========================================
// INICIALIZACIÓN AUTOMÁTICA AL CARGAR
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ [ABRIR-CAJA] DOM listo, módulo inicializado v2.4');
});
