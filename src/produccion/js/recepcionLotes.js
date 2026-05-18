/**
 * Lógica Frontend para Recepción de Lotes y Trazabilidad
 */

document.addEventListener('DOMContentLoaded', () => {
    // Mantener el foco en el escáner al iniciar
    const scannerInput = document.getElementById('scanner-input');
    if (scannerInput) {
        scannerInput.focus();
        
        // Listener para el escáner (dispara con Enter)
        scannerInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const scannedId = scannerInput.value.trim();
                if (scannedId) {
                    await consultarTrazabilidad(scannedId);
                    scannerInput.value = ''; // Limpiar para el siguiente escaneo
                }
            }
        });

        // Asegurar que el foco vuelva al input si se hace clic fuera de modales
        document.addEventListener('click', (e) => {
            const modal = document.getElementById('modal-trazabilidad');
            if (modal && !modal.classList.contains('show')) {
                // No robar foco si el usuario está interactuando con la grilla u otros inputs
                if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
                    scannerInput.focus();
                }
            }
        });
    }

    // Cargar la grilla inicial
    cargarLotes();
});

/**
 * Carga los últimos lotes desde Supabase y los pinta en la grilla
 */
window.cargarLotes = async function() {
    const loading = document.getElementById('loading-grid');
    const container = document.getElementById('grid-container');
    const tbody = document.getElementById('lotes-tbody');

    loading.style.display = 'block';
    container.style.display = 'none';

    try {
        const lotes = await window.SupabaseService.fetchUltimosLotes();
        
        tbody.innerHTML = ''; // Limpiar

        if (!lotes || lotes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No hay lotes recientes registrados.</td></tr>';
        } else {
            lotes.forEach(lote => {
                const fullId = lote.id || '';
                const idCorto = fullId.substring(0, 8).toUpperCase();
                const cabecera = lote.recepciones_fisicas_cabecera || {};
                const item = lote.pedidos_b2b_items || {};
                const proveedor = cabecera.pedidos_b2b_cabecera?.proveedores?.nombre || 'Proveedor Sin Asignar';
                
                // Formateo de fecha
                const fechaRaw = cabecera.fecha_recepcion ? new Date(cabecera.fecha_recepcion) : new Date();
                const fechaFormateada = fechaRaw.toLocaleDateString('es-AR', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><span class="badge-id">${idCorto}</span></td>
                    <td>${fechaFormateada}</td>
                    <td class="text-proveedor">${proveedor}</td>
                    <td class="text-producto">${item.producto_codigo || ''} - ${item.producto_descripcion || 'Sin descripción'}</td>
                    <td><b>${lote.cantidad_recibida}</b> ${item.unidad_ref || 'u'}</td>
                    <td style="text-align: center;">
                        <button class="btn-imprimir" onclick="imprimirEtiquetaLote('${idCorto}', '${item.producto_descripcion ? item.producto_descripcion.replace(/'/g, "\\'") : ''}')">
                            🖨️ Imprimir
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        loading.style.display = 'none';
        container.style.display = 'block';

    } catch (error) {
        console.error(error);
        Swal.fire('Error', 'No se pudieron cargar los lotes desde la nube.', 'error');
        loading.innerHTML = '<p style="color: red;">Error de conexión con Supabase.</p>';
    }
};

/**
 * Consulta y muestra la radiografía del lote
 */
async function consultarTrazabilidad(idCorto) {
    Swal.fire({
        title: 'Buscando...',
        text: 'Consultando nube de trazabilidad',
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    try {
        const lote = await window.SupabaseService.fetchTrazabilidadLote(idCorto);
        
        if (!lote) {
            throw new Error("Lote no encontrado");
        }

        Swal.close();

        // Extraer datos
        const fullId = lote.id || '';
        const idMostrar = fullId.substring(0, 8).toUpperCase();
        const cabecera = lote.recepciones_fisicas_cabecera || {};
        const item = lote.pedidos_b2b_items || {};
        const proveedor = cabecera.pedidos_b2b_cabecera?.proveedores?.nombre || 'Proveedor No Registrado';
        const producto = `${item.producto_codigo || ''} - ${item.producto_descripcion || 'Sin descripción'}`;
        const fechaRaw = cabecera.fecha_recepcion ? new Date(cabecera.fecha_recepcion) : new Date();
        const remito = cabecera.numero_remito || 'Sin Remito';

        // Llenar Modal
        document.getElementById('radiografia-id').innerText = idMostrar;
        document.getElementById('radiografia-proveedor').innerText = proveedor;
        document.getElementById('radiografia-producto').innerText = producto;
        document.getElementById('radiografia-cantidad').innerText = `${lote.cantidad_recibida} ${item.unidad_ref || ''}`;
        document.getElementById('radiografia-remito').innerText = remito;
        document.getElementById('radiografia-unidad').innerText = item.unidad_ref || 'Unidades';
        
        const fechaFormat = fechaRaw.toLocaleDateString('es-AR', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        document.getElementById('radiografia-fecha').innerText = fechaFormat;

        // Calcular tiempo en depósito
        const ahora = new Date();
        const diffMs = ahora - fechaRaw;
        const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHoras = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        
        let textoTiempo = '';
        if (diffDias > 0) {
            textoTiempo = `⏱️ Tiempo en depósito: ${diffDias} días y ${diffHoras} horas.`;
            if (diffDias > 30) {
                document.getElementById('radiografia-tiempo').style.background = '#f8d7da';
                document.getElementById('radiografia-tiempo').style.color = '#721c24';
                document.getElementById('radiografia-tiempo').style.borderColor = '#f5c6cb';
            } else {
                document.getElementById('radiografia-tiempo').style.background = '#fff3cd';
                document.getElementById('radiografia-tiempo').style.color = '#856404';
                document.getElementById('radiografia-tiempo').style.borderColor = '#ffeeba';
            }
        } else {
            textoTiempo = `⏱️ Ingreso reciente: Hace ${diffHoras} horas.`;
            document.getElementById('radiografia-tiempo').style.background = '#d4edda';
            document.getElementById('radiografia-tiempo').style.color = '#155724';
            document.getElementById('radiografia-tiempo').style.borderColor = '#c3e6cb';
        }

        document.getElementById('radiografia-tiempo').innerText = textoTiempo;

        // Mostrar Modal
        document.getElementById('modal-trazabilidad').classList.add('show');

    } catch (error) {
        console.error(error);
        Swal.fire('No encontrado', `No se encontró trazabilidad para el lote escaneado: ${idCorto}`, 'warning');
    }
}

/**
 * Cierra el modal de trazabilidad
 */
window.cerrarTrazabilidad = function() {
    document.getElementById('modal-trazabilidad').classList.remove('show');
    // Devolver el foco al escáner
    setTimeout(() => {
        const scannerInput = document.getElementById('scanner-input');
        if (scannerInput) scannerInput.focus();
    }, 300);
};

/**
 * Dispara la impresión Zebra manteniendo el SECRETO COMERCIAL (Sin proveedor)
 */
window.imprimirEtiquetaLote = async function(idCorto, descripcionProducto) {
    try {
        // Mostrar alerta de progreso
        Swal.fire({
            title: 'Imprimiendo...',
            text: 'Enviando comando a la impresora térmica.',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        // Realizar la petición POST al nuevo endpoint en server.js
        const res = await fetch('http://localhost:3000/api/etiquetas/lote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_corto: idCorto,
                descripcion: descripcionProducto,
                cantidad: 1 // Imprimimos 1 etiqueta térmica
            })
        });

        if (!res.ok) {
            throw new Error('Error en el servicio de impresión.');
        }

        Swal.fire({
            icon: 'success',
            title: '¡Impresión Enviada!',
            text: 'La etiqueta se está imprimiendo correctamente.',
            timer: 2000,
            showConfirmButton: false
        });

    } catch (error) {
        console.error('Error al imprimir:', error);
        Swal.fire('Error', 'Hubo un problema al intentar imprimir la etiqueta.', 'error');
    }
};
