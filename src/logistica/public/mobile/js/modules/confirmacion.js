/**
 * Módulo de Confirmación de Entregas
 * Maneja toda la lógica de confirmación rápida y detallada
 */

import { obtenerDetallesPedido, confirmarEntrega } from './api.js';

// Estado del módulo
let estadoConfirmacion = {
    presupuestoId: null,
    tipo: null, // 'rapida' o 'detallada'
    detalles: [],
    fotos: {
        remito: null,
        bulto: null
    },
    firma: null,
    receptor: {
        nombre: '',
        dni: ''
    },
    coordenadas: null
};

/**
 * Mostrar modal de opciones de confirmación
 */
export function mostrarModalOpciones(presupuestoId) {
    estadoConfirmacion.presupuestoId = presupuestoId;
    
    const modal = document.createElement('div');
    modal.id = 'modal-opciones-confirmacion';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-header">
                <h2>Confirmar Entrega</h2>
                <button class="btn-close" onclick="window.cerrarModalOpciones()">×</button>
            </div>
            
            <div class="modal-body" style="padding: 1.5rem;">
                <p style="margin-bottom: 1.5rem; color: #64748b;">
                    Seleccione el tipo de confirmación:
                </p>
                
                <button class="btn-opcion-confirmacion btn-rapida" onclick="window.iniciarConfirmacionRapida()">
                    <div class="icono">⚡</div>
                    <div class="texto">
                        <strong>Confirmación Rápida</strong>
                        <small>Solo marcar como entregado</small>
                    </div>
                </button>
                
                <button class="btn-opcion-confirmacion btn-detallada" onclick="window.iniciarConfirmacionDetallada()">
                    <div class="icono">📋</div>
                    <div class="texto">
                        <strong>Confirmación Detallada</strong>
                        <small>Con checklist, fotos y firma</small>
                    </div>
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    agregarEstilosModal();
}

/**
 * Cerrar modal de opciones
 */
export function cerrarModalOpciones() {
    const modal = document.getElementById('modal-opciones-confirmacion');
    if (modal) {
        modal.remove();
    }
}

/**
 * Iniciar confirmación rápida
 */
export async function iniciarConfirmacionRapida() {
    cerrarModalOpciones();
    
    if (!confirm('¿Confirmar que el pedido fue entregado?')) {
        return;
    }
    
    try {
        // Obtener coordenadas actuales
        const coords = await obtenerCoordenadas();
        
        // Enviar confirmación
        const resultado = await confirmarEntrega({
            id_presupuesto: estadoConfirmacion.presupuestoId,
            tipo_confirmacion: 'rapida',
            latitud: coords?.latitude || null,
            longitud: coords?.longitude || null
        });
        
        if (resultado.success) {
            alert('✅ Entrega confirmada correctamente');
            
            // Recargar ruta
            if (window.cargarRutaActiva) {
                window.cargarRutaActiva();
            }
        } else {
            throw new Error(resultado.error || 'Error al confirmar');
        }
        
    } catch (error) {
        console.error('[CONFIRMACION] Error:', error);
        alert('❌ Error al confirmar entrega: ' + error.message);
    }
}

/**
 * Iniciar confirmación detallada
 */
export async function iniciarConfirmacionDetallada() {
    cerrarModalOpciones();
    
    try {
        // Obtener detalles del pedido
        const resultado = await obtenerDetallesPedido(estadoConfirmacion.presupuestoId);
        
        if (resultado.success && resultado.data) {
            estadoConfirmacion.detalles = resultado.data;
            estadoConfirmacion.tipo = 'detallada';
            
            // Mostrar modal detallado
            mostrarModalDetallado();
        } else {
            throw new Error('No se pudieron obtener los detalles del pedido');
        }
        
    } catch (error) {
        console.error('[CONFIRMACION] Error:', error);
        alert('❌ Error: ' + error.message);
    }
}

/**
 * Mostrar modal de confirmación detallada
 */
function mostrarModalDetallado() {
    const modal = document.createElement('div');
    modal.id = 'modal-confirmacion-detallada';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content modal-full">
            <div class="modal-header">
                <h2>Confirmación Detallada</h2>
                <button class="btn-close" onclick="window.cerrarModalDetallado()">×</button>
            </div>
            
            <div class="modal-body" style="padding: 1rem; overflow-y: auto; max-height: 70vh;">
                
                <!-- Checklist de Mercadería -->
                <div class="seccion-modal">
                    <h3>📦 Checklist de Mercadería</h3>
                    <div id="checklist-articulos">
                        ${estadoConfirmacion.detalles.map((art, idx) => `
                            <label class="checklist-item">
                                <input type="checkbox" id="check-${idx}" data-codigo="${art.codigo_barras}">
                                <span class="check-label">
                                    <strong>${art.codigo_barras}</strong> - ${art.descripcion}
                                    <small>Cantidad: ${art.cantidad}</small>
                                </span>
                            </label>
                        `).join('')}
                    </div>
                </div>
                
                <!-- Datos del Receptor -->
                <div class="seccion-modal">
                    <h3>👤 Datos del Receptor</h3>
                    <input type="text" id="receptor-nombre" placeholder="Nombre completo" class="input-modal">
                    <input type="text" id="receptor-dni" placeholder="DNI (opcional)" class="input-modal">
                </div>
                
                <!-- Evidencia Fotográfica -->
                <div class="seccion-modal">
                    <h3>📸 Evidencia Fotográfica</h3>
                    
                    <div class="foto-container">
                        <label for="foto-remito" class="btn-foto">
                            📄 Foto del Remito
                            <input type="file" id="foto-remito" accept="image/*" capture="environment" style="display: none;" onchange="window.previsualizarFoto(this, 'preview-remito')">
                        </label>
                        <div id="preview-remito" class="foto-preview"></div>
                    </div>
                    
                    <div class="foto-container">
                        <label for="foto-bulto" class="btn-foto">
                            📦 Foto del Bulto
                            <input type="file" id="foto-bulto" accept="image/*" capture="environment" style="display: none;" onchange="window.previsualizarFoto(this, 'preview-bulto')">
                        </label>
                        <div id="preview-bulto" class="foto-preview"></div>
                    </div>
                </div>
                
                <!-- Firma Digital -->
                <div class="seccion-modal">
                    <h3>✍️ Firma del Receptor</h3>
                    <canvas id="canvas-firma" width="300" height="150" style="border: 1px solid #ccc; border-radius: 0.5rem; touch-action: none; width: 100%; max-width: 300px;"></canvas>
                    <button class="btn-secondary" onclick="window.limpiarFirma()" style="margin-top: 0.5rem;">🗑️ Limpiar Firma</button>
                </div>
                
            </div>
            
            <div class="modal-footer">
                <button class="btn-secondary" onclick="window.cerrarModalDetallado()">Cancelar</button>
                <button class="btn-primary" onclick="window.enviarConfirmacionDetallada()">✅ Confirmar Entrega</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Inicializar canvas de firma
    setTimeout(() => inicializarCanvasFirma(), 100);
}

/**
 * Cerrar modal detallado
 */
export function cerrarModalDetallado() {
    const modal = document.getElementById('modal-confirmacion-detallada');
    if (modal) {
        modal.remove();
    }
    
    // Limpiar estado
    estadoConfirmacion.fotos = { remito: null, bulto: null };
    estadoConfirmacion.firma = null;
    estadoConfirmacion.receptor = { nombre: '', dni: '' };
}

/**
 * Previsualizar foto
 */
export function previsualizarFoto(input, previewId) {
    const preview = document.getElementById(previewId);
    
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            preview.innerHTML = `
                <img src="${e.target.result}" style="max-width: 100%; border-radius: 0.5rem;">
                <button class="btn-eliminar-foto" onclick="window.eliminarFoto('${input.id}', '${previewId}')">🗑️</button>
            `;
            
            // Guardar en estado
            const tipo = input.id.includes('remito') ? 'remito' : 'bulto';
            estadoConfirmacion.fotos[tipo] = e.target.result;
        };
        
        reader.readAsDataURL(input.files[0]);
    }
}

/**
 * Eliminar foto
 */
export function eliminarFoto(inputId, previewId) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    
    if (input) input.value = '';
    if (preview) preview.innerHTML = '';
    
    // Limpiar del estado
    const tipo = inputId.includes('remito') ? 'remito' : 'bulto';
    estadoConfirmacion.fotos[tipo] = null;
}

/**
 * Inicializar canvas de firma
 */
function inicializarCanvasFirma() {
    const canvas = document.getElementById('canvas-firma');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    let dibujando = false;
    let ultimoX = 0;
    let ultimoY = 0;
    
    // Configurar canvas
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    
    // Eventos táctiles
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        dibujando = true;
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        ultimoX = touch.clientX - rect.left;
        ultimoY = touch.clientY - rect.top;
    });
    
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!dibujando) return;
        
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        
        ctx.beginPath();
        ctx.moveTo(ultimoX, ultimoY);
        ctx.lineTo(x, y);
        ctx.stroke();
        
        ultimoX = x;
        ultimoY = y;
    });
    
    canvas.addEventListener('touchend', () => {
        dibujando = false;
        // Guardar firma en estado
        estadoConfirmacion.firma = canvas.toDataURL();
    });
    
    // Eventos de mouse (para testing en desktop)
    canvas.addEventListener('mousedown', (e) => {
        dibujando = true;
        const rect = canvas.getBoundingClientRect();
        ultimoX = e.clientX - rect.left;
        ultimoY = e.clientY - rect.top;
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (!dibujando) return;
        
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        ctx.beginPath();
        ctx.moveTo(ultimoX, ultimoY);
        ctx.lineTo(x, y);
        ctx.stroke();
        
        ultimoX = x;
        ultimoY = y;
    });
    
    canvas.addEventListener('mouseup', () => {
        dibujando = false;
        estadoConfirmacion.firma = canvas.toDataURL();
    });
    
    canvas.addEventListener('mouseleave', () => {
        dibujando = false;
    });
}

/**
 * Limpiar firma
 */
export function limpiarFirma() {
    const canvas = document.getElementById('canvas-firma');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        estadoConfirmacion.firma = null;
    }
}

/**
 * Enviar confirmación detallada
 */
export async function enviarConfirmacionDetallada() {
    try {
        // Validar datos mínimos
        const receptorNombre = document.getElementById('receptor-nombre')?.value.trim();
        
        if (!receptorNombre) {
            alert('⚠️ Por favor ingrese el nombre de quien recibe');
            return;
        }
        
        // Obtener coordenadas
        const coords = await obtenerCoordenadas();
        
        // Preparar datos
        const datos = {
            id_presupuesto: estadoConfirmacion.presupuestoId,
            tipo_confirmacion: 'detallada',
            receptor_nombre: receptorNombre,
            receptor_dni: document.getElementById('receptor-dni')?.value.trim() || null,
            foto_remito_url: estadoConfirmacion.fotos.remito,
            foto_bulto_url: estadoConfirmacion.fotos.bulto,
            firma_digital: estadoConfirmacion.firma,
            latitud: coords?.latitude || null,
            longitud: coords?.longitude || null
        };
        
        console.log('[CONFIRMACION] Enviando confirmación detallada...');
        
        // Enviar al servidor
        const resultado = await confirmarEntrega(datos);
        
        if (resultado.success) {
            cerrarModalDetallado();
            alert('✅ Entrega confirmada correctamente');
            
            // Recargar ruta
            if (window.cargarRutaActiva) {
                window.cargarRutaActiva();
            }
        } else {
            throw new Error(resultado.error || 'Error al confirmar');
        }
        
    } catch (error) {
        console.error('[CONFIRMACION] Error:', error);
        alert('❌ Error al confirmar entrega: ' + error.message);
    }
}

/**
 * Obtener coordenadas GPS actuales
 */
function obtenerCoordenadas() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            console.warn('[GPS] Geolocalización no disponible');
            resolve(null);
            return;
        }
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log('[GPS] Coordenadas obtenidas:', position.coords);
                resolve(position.coords);
            },
            (error) => {
                console.warn('[GPS] Error al obtener coordenadas:', error);
                resolve(null);
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0
            }
        );
    });
}

/**
 * Agregar estilos del modal
 */
function agregarEstilosModal() {
    if (document.getElementById('estilos-modal-confirmacion')) return;
    
    const style = document.createElement('style');
    style.id = 'estilos-modal-confirmacion';
    style.textContent = `
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            padding: 1rem;
        }
        
        .modal-content {
            background: white;
            border-radius: 1rem;
            max-width: 500px;
            width: 100%;
            max-height: 90vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        
        .modal-full {
            max-width: 600px;
        }
        
        .modal-header {
            padding: 1rem 1.5rem;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .modal-header h2 {
            margin: 0;
            font-size: 1.25rem;
            color: #1e293b;
        }
        
        .btn-close {
            background: none;
            border: none;
            font-size: 2rem;
            color: #64748b;
            cursor: pointer;
            padding: 0;
            width: 2rem;
            height: 2rem;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .modal-body {
            flex: 1;
            overflow-y: auto;
        }
        
        .modal-footer {
            padding: 1rem 1.5rem;
            border-top: 1px solid #e2e8f0;
            display: flex;
            gap: 0.75rem;
            justify-content: flex-end;
        }
        
        .btn-opcion-confirmacion {
            width: 100%;
            padding: 1rem;
            margin-bottom: 1rem;
            border: 2px solid #e2e8f0;
            border-radius: 0.5rem;
            background: white;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 1rem;
            transition: all 0.2s;
        }
        
        .btn-opcion-confirmacion:hover {
            border-color: #3b82f6;
            background: #eff6ff;
            transform: translateY(-2px);
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        
        .btn-opcion-confirmacion .icono {
            font-size: 2rem;
        }
        
        .btn-opcion-confirmacion .texto {
            text-align: left;
            flex: 1;
        }
        
        .btn-opcion-confirmacion strong {
            display: block;
            font-size: 1rem;
            color: #1e293b;
            margin-bottom: 0.25rem;
        }
        
        .btn-opcion-confirmacion small {
            display: block;
            font-size: 0.875rem;
            color: #64748b;
        }
        
        .seccion-modal {
            margin-bottom: 1.5rem;
        }
        
        .seccion-modal h3 {
            font-size: 1rem;
            color: #1e293b;
            margin-bottom: 0.75rem;
            padding-bottom: 0.5rem;
            border-bottom: 2px solid #e2e8f0;
        }
        
        .checklist-item {
            display: flex;
            align-items: flex-start;
            gap: 0.75rem;
            padding: 0.75rem;
            border: 1px solid #e2e8f0;
            border-radius: 0.5rem;
            margin-bottom: 0.5rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .checklist-item:hover {
            background: #f8fafc;
            border-color: #cbd5e1;
        }
        
        .checklist-item input[type="checkbox"] {
            width: 1.25rem;
            height: 1.25rem;
            cursor: pointer;
        }
        
        .check-label {
            flex: 1;
        }
        
        .check-label strong {
            display: block;
            color: #1e293b;
            margin-bottom: 0.25rem;
        }
        
        .check-label small {
            display: block;
            color: #64748b;
            font-size: 0.875rem;
        }
        
        .input-modal {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #e2e8f0;
            border-radius: 0.5rem;
            font-size: 1rem;
            margin-bottom: 0.75rem;
        }
        
        .input-modal:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        
        .btn-foto {
            display: block;
            width: 100%;
            padding: 1rem;
            border: 2px dashed #cbd5e1;
            border-radius: 0.5rem;
            background: #f8fafc;
            cursor: pointer;
            text-align: center;
            font-size: 1rem;
            color: #475569;
            transition: all 0.2s;
        }
        
        .btn-foto:hover {
            border-color: #3b82f6;
            background: #eff6ff;
            color: #1e40af;
        }
        
        .foto-container {
            margin-bottom: 1rem;
        }
        
        .foto-preview {
            margin-top: 0.5rem;
            position: relative;
        }
        
        .btn-eliminar-foto {
            position: absolute;
            top: 0.5rem;
            right: 0.5rem;
            background: rgba(220, 38, 38, 0.9);
            color: white;
            border: none;
            border-radius: 0.375rem;
            padding: 0.5rem 0.75rem;
            cursor: pointer;
            font-size: 0.875rem;
        }
        
        .btn-primary {
            background: #3b82f6;
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
        }
        
        .btn-primary:hover {
            background: #2563eb;
        }
        
        .btn-secondary {
            background: #e2e8f0;
            color: #475569;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            font-size: 1rem;
            cursor: pointer;
        }
        
        .btn-secondary:hover {
            background: #cbd5e1;
        }
    `;
    
    document.head.appendChild(style);
}

// Exponer funciones globalmente para onclick
window.cerrarModalOpciones = cerrarModalOpciones;
window.cerrarModalDetallado = cerrarModalDetallado;
window.iniciarConfirmacionRapida = iniciarConfirmacionRapida;
window.iniciarConfirmacionDetallada = iniciarConfirmacionDetallada;
window.previsualizarFoto = previsualizarFoto;
window.eliminarFoto = eliminarFoto;
window.limpiarFirma = limpiarFirma;
window.enviarConfirmacionDetallada = enviarConfirmacionDetallada;

export { estadoConfirmacion };
