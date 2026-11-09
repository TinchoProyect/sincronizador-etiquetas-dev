/**
 * Módulo de Gestión de Ruta
 * Maneja la carga y finalización de rutas
 */

import { obtenerRutaActiva, finalizarRuta, API_BASE_URL } from './api.js?v=2';

/**
 * Finalizar ruta del día
 */
export async function finalizarRutaDelDia() {
    console.log('[RUTA] Iniciando finalización de ruta...');

    if (typeof Swal !== 'undefined') {
        const resConfirm = await Swal.fire({
            title: '🏁 Finalizar y Asentar Hoja de Ruta',
            text: '¿Confirma que desea finalizar y asentar la hoja de ruta actual?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: '🏁 Sí, Asentar Hoja de Ruta',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b'
        });
        if (!resConfirm.isConfirmed) return;
    } else if (!confirm('¿Está seguro de finalizar el reparto del día?\n\nEsta acción cerrará la ruta actual.')) {
        return;
    }

    try {
        // Capturar sobres retirados en la ruta activa antes de finalizar
        const sobresRetiradosEnRuta = (window.state?.entregas || []).filter(e =>
            (e.es_sobre_efectivo === true || String(e.id_presupuesto).startsWith('SOB-') || e.estado === 'Sobre de Efectivo')
            && e.estado_logistico === 'RETIRADO'
        );

        const idRutaActiva = window.state?.ruta?.id || sessionStorage.getItem('activeRouteId') || null;
        const resultado = await finalizarRuta(idRutaActiva);

        if (resultado.success) {
            let { pedidos_pendientes, sobres_recibidos_local, nombre_ruta } = resultado.data || {};
            sessionStorage.removeItem('activeRouteId');

            // Asegurar transición determinista de los sobres retirados a RECIBIDO_LOCAL (Local + Supabase)
            if (!Array.isArray(sobres_recibidos_local) && sobresRetiradosEnRuta.length > 0) {
                sobres_recibidos_local = [];
                for (const s of sobresRetiradosEnRuta) {
                    const cod = s.codigo_sobre || String(s.id_presupuesto).replace('SOB-', '');
                    try {
                        await fetch(`${API_BASE_URL}/api/logistica/pagos-efectivo/${encodeURIComponent(cod)}/estado`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                estado: 'RECIBIDO_LOCAL',
                                operador: 'Cierre Hoja de Ruta (Móvil)'
                            })
                        });
                        sobres_recibidos_local.push({ codigo_sobre: cod });
                    } catch (errS) {
                        console.warn('[RUTA] Advertencia actualizando sobre a RECIBIDO_LOCAL:', errS);
                    }
                }
            }

            if (typeof Swal !== 'undefined') {
                let htmlDetalle = `<div style="text-align: left; font-size: 0.9rem; color: #334155;">`;
                htmlDetalle += `<p style="margin: 0 0 8px 0;">La ruta <strong>${nombre_ruta || ''}</strong> quedó asentada como <strong>FINALIZADA</strong>.</p>`;

                if (Array.isArray(sobres_recibidos_local) && sobres_recibidos_local.length > 0) {
                    const listaSobres = sobres_recibidos_local.map(s => `#${s.codigo_sobre}`).join(', ');
                    htmlDetalle += `
                        <div style="background: #faf5ff; border: 1px solid #d8b4fe; border-radius: 6px; padding: 10px; margin-top: 8px; color: #5b21b6;">
                            💵 <strong>Sobres ingresados al Depósito / Local:</strong><br>
                            <strong>${listaSobres}</strong> pasó a estado <b>RECIBIDO LOCAL</b> (listo en <i>Recepción de Efectivo</i> para auditar billetes y acreditar en Cuenta Corriente).
                        </div>
                    `;
                }

                if (pedidos_pendientes > 0) {
                    htmlDetalle += `<p style="color: #d97706; font-weight: bold; margin-top: 8px;">⚠️ Quedaron ${pedidos_pendientes} pedido(s) sin entregar.</p>`;
                }
                htmlDetalle += `</div>`;

                await Swal.fire({
                    icon: 'success',
                    title: '✅ Hoja de Ruta Asentada',
                    html: htmlDetalle,
                    confirmButtonText: 'Continuar',
                    confirmButtonColor: '#059669'
                });
            } else {
                alert('✅ Ruta finalizada correctamente');
            }

            if (typeof window.cargarRutaActiva === 'function') {
                await window.cargarRutaActiva();
            } else {
                window.location.reload();
            }
        } else {
            throw new Error(resultado.error || 'Error al finalizar ruta');
        }
    } catch (error) {
        console.error('[RUTA] Error al finalizar:', error);
        if (typeof Swal !== 'undefined') {
            Swal.fire('Error', 'No se pudo finalizar la ruta: ' + error.message, 'error');
        } else {
            alert('❌ Error al finalizar ruta: ' + error.message);
        }
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
