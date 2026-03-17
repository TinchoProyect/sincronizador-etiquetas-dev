                // Detalles
                detalles: detalles
            };

            console.log(`[PRESUPUESTO] Guardando presupuesto editado, forzando secuencia = 'Imprimir', id_presupuesto: ${presupuestoId}`);

            // Enviar PUT para actualizar presupuesto
            const response = await fetch(`/api/presupuestos/${presupuestoId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateData)
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || result.message || 'Error al actualizar presupuesto');
            }

            // Restaurar descripciones visibles en los inputs de artÄÂculos
            rows.forEach(row => {
                const artInput = row.querySelector('input[name*="[articulo]"]');
                if (artInput && artInput.dataset.descripcionVisible) {
                    artInput.value = artInput.dataset.descripcionVisible;
                }
            });

            // Manejo de Bloqueo Fiscal Parcial Parcial
            if (result.fiscalLock) {
                console.warn('🔒 [PRESUPUESTOS-EDIT] Bloqueo Fiscal Activo');
                mostrarMensaje(`⚠️ ${result.message}`, 'error'); // Usamos 'error' (rojo) para mayor visibilidad a pesar de ser success true.

                // Redirigir después de 4 segundos para que lean que los detalles no se guardaron
                setTimeout(() => {
                    window.location.href = '/pages/presupuestos.html';
                }, 4000);
                return;
            }

            mostrarMensaje('Ã¢ÂœÂ… Presupuesto actualizado exitosamente', 'success');

            console.log('Ã¢ÂœÂ… [PRESUPUESTOS-EDIT] Presupuesto actualizado correctamente');

            // Redirigir despuÄÅs de 2 segundos
            setTimeout(() => {
                window.location.href = '/pages/presupuestos.html';
            }, 2000);

        } catch (error) {
            console.error('Ã¢ÂÂŒ [PRESUPUESTOS-EDIT] Error al actualizar presupuesto:', error);
            mostrarMensaje(`Ã¢ÂÂŒ Error al actualizar presupuesto: ${error.message}`, 'error');
        } finally {
            // Ocultar loading
            btnGuardar.disabled = false;
            spinner.style.display = 'none';
        }
    }

    /**
     * Mostrar mensaje al usuario
     */
    function mostrarMensaje(texto, tipo = 'info') {
        console.log(`Ä‘ÂŸÂ’Å¹ [PRESUPUESTOS-EDIT] Mostrando mensaje: ${texto}`);

        const container = document.getElementById('message-container');

        // Limpiar mensajes anteriores
        container.innerHTML = '';

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${tipo}`;
        messageDiv.textContent = texto;
        messageDiv.style.display = 'block';

        container.appendChild(messageDiv);

        // Auto-ocultar despuÄ‚Å s de 5 segundos (excepto errores)
        if (tipo !== 'error') {
            setTimeout(() => {
                messageDiv.style.display = 'none';
            }, 5000);
        }
    }

    console.log('Ã¢ÂœÂ… [PRESUPUESTOS-EDIT] MÄ‚Å‚dulo de ediciÄ‚Å‚n cargado correctamente');

})(); // Cerrar IIFE
/**
 * Actualizar estado del botÃ³n Facturar/Ver factura segÃºn estado de facturaciÃ³n
 */
function actualizarBotonFacturacion(estaFacturado, facturaId) {
    const btn = document.getElementById("btn-facturar");
    if (!btn) return;

    console.log(`[FACTURAR] Actualizando botÃ³n: estaFacturado=${estaFacturado}, facturaId=${facturaId}`);

    if (estaFacturado && facturaId) {
        // Presupuesto ya facturado - mostrar "Ver factura"
        btn.textContent = "ðŸ‘ï¸ Ver Factura";
        btn.className = "btn btn-secondary";
        btn.onclick = () => {
            window.location.href = `http://localhost:3004/pages/ver-factura.html?id=${facturaId}`;
        };
        console.log(`[FACTURAR] âœ… BotÃ³n configurado como "Ver Factura" (ID: ${facturaId})`);
    } else {
        // Presupuesto no facturado - mostrar "Facturar"
        btn.textContent = "ðŸ’³ Facturar";
        btn.className = "btn btn-primary";
        btn.onclick = () => manejarFacturacion();
        console.log('[FACTURAR] âœ… BotÃ³n configurado como "Facturar"');
    }
}

/**
 * Manejar proceso de facturaciÃ³n
 */
async function manejarFacturacion() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get("id");

    if (!id) {
        alert("âš ï¸ No se encontrÃ³ el ID de presupuesto.");
        return;
    }

    const btn = document.getElementById("btn-facturar");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "â³ Facturando...";

    try {
        const resp = await fetch(`http://localhost:3004/facturacion/presupuestos/${id}/facturar`, {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
            const msg = (data && (data.message || data.error)) || `Error HTTP ${resp.status}`;
            throw new Error(msg);
        }

        console.log('[FACTURAR] âœ… FacturaciÃ³n exitosa:', data);
        alert("âœ… Presupuesto facturado correctamente.");

        // IMPORTANTE: Actualizar botÃ³n con el factura_id recibido
        if (data.factura_id) {
            actualizarBotonFacturacion(true, data.factura_id);
        } else {
            // Fallback: recargar pÃ¡gina completa para obtener factura_id actualizado
            console.log('[FACTURAR] âš ï¸ factura_id no recibido, recargando pÃ¡gina...');
            window.location.reload();
        }

    } catch (e) {
        console.error('[FACTURAR] âŒ Error al facturar:', e);
        alert("âŒ Error al facturar: " + (e?.message || e));

        // Restaurar botÃ³n en caso de error
        btn.disabled = false;
        btn.textContent = originalText;
    }
}


/**
 * Activar Modo Retiro en Edición (Cambios Visuales)
 */
function activarModoRetiroEdicion() {
    console.log('📦 [EDIT] Aplicando overrides visuales para Modo Retiro...');

    // 1. Título de la página
    document.title = 'Editar Orden de Retiro';
    const header = document.querySelector('header h1');
    if (header) header.textContent = '📦 Editar Orden de Retiro';

    // 2. Título de la sección de artículos
    const allH3 = document.querySelectorAll('h3');
    allH3.forEach(h => {
        if (h.textContent.includes('Artículos')) {
            h.textContent = '📦 Artículos de la Orden de Retiro';
        }
    });

    // 3. Título de la tabla
    const tableHeader = document.querySelector('table thead th:first-child');
    if (tableHeader) {
        tableHeader.textContent = 'Artículos de la orden de retiro';
    }

    // 4. Botón de Guardar
    const btnGuardar = document.getElementById('btn-guardar') || document.querySelector('button[type="submit"]');
    if (btnGuardar) {
        btnGuardar.textContent = 'Confirmar Orden de Retiro';
        btnGuardar.classList.remove('btn-primary');
        btnGuardar.classList.add('btn-warning');
        btnGuardar.style.backgroundColor = '#f39c12';
        btnGuardar.style.color = '#fff';
    }
}

// Exponer globalmente
window.activarModoRetiroEdicion = activarModoRetiroEdicion;

// Configurar botÃ³n al cargar pÃ¡gina
document.addEventListener("DOMContentLoaded", () => {
    // El botÃ³n se configurarÃ¡ automÃ¡ticamente al cargar el presupuesto
    console.log('[FACTURAR] InicializaciÃ³n del botÃ³n de facturaciÃ³n lista');
});
