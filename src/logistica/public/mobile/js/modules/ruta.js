/**
 * Módulo de Gestión de Ruta
 * Maneja la carga y finalización de rutas
 */

import { obtenerRutaActiva, finalizarRuta } from './api.js';

/**
 * Finalizar ruta del día
 */
export async function finalizarRutaDelDia() {
    console.log('[RUTA] Iniciando finalización de ruta...');
    
    // Confirmar acción
    if (!confirm('¿Está seguro de finalizar el reparto del día?\n\nEsta acción cerrará la ruta actual.')) {
        return;
    }
    
    try {
        const resultado = await finalizarRuta();
        
        if (resultado.success) {
            const { pedidos_pendientes } = resultado.data || {};
            
            let mensaje = '✅ Ruta finalizada correctamente';
            
            if (pedidos_pendientes > 0) {
                mensaje += `\n\n⚠️ Atención: Quedan ${pedidos_pendientes} pedido(s) sin entregar.`;
            }
            
            alert(mensaje);
            
            // Redirigir a login
            setTimeout(() => {
                localStorage.removeItem('sesion_chofer');
                window.location.href = 'index.html';
            }, 1000);
            
        } else {
            throw new Error(resultado.error || 'Error al finalizar ruta');
        }
        
    } catch (error) {
        console.error('[RUTA] Error al finalizar:', error);
        alert('❌ Error al finalizar ruta: ' + error.message);
    }
}

/**
 * Refrescar ruta actual
 */
export async function refrescarRuta() {
    const btn = event?.target;
    if (btn) {
        btn.textContent = '⏳';
        btn.disabled = true;
    }
    
    try {
        if (window.cargarRutaActiva) {
            await window.cargarRutaActiva();
        }
    } finally {
        if (btn) {
            btn.textContent = '🔄';
            btn.disabled = false;
        }
    }
}

// Exponer funciones globalmente
window.finalizarRutaDelDia = finalizarRutaDelDia;
window.refrescarRuta = refrescarRuta;
