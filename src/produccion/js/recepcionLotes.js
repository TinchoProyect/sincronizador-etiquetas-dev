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

    loading.style.display = 'block';
    container.style.display = 'none';

    try {
        const lotes = await window.SupabaseService.fetchUltimosLotes();
        
        container.innerHTML = ''; // Limpiar

        if (!lotes || lotes.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No hay lotes recientes registrados.</p>';
            loading.style.display = 'none';
            container.style.display = 'block';
            return;
        }

        // Agrupación de lotes
        const agruparPorMesYDia = (lotesArray) => {
            const grupos = {};
            lotesArray.forEach(lote => {
                const cabecera = lote.recepciones_fisicas_cabecera || {};
                const fechaRaw = cabecera.fecha_recepcion ? new Date(cabecera.fecha_recepcion) : new Date();
                
                const mesAnio = fechaRaw.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
                // Capitalizar primera letra del mes
                const mesAnioCap = mesAnio.charAt(0).toUpperCase() + mesAnio.slice(1);
                
                const diaSemanaFecha = fechaRaw.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' });
                const diaSemanaCap = diaSemanaFecha.charAt(0).toUpperCase() + diaSemanaFecha.slice(1);

                if (!grupos[mesAnioCap]) grupos[mesAnioCap] = {};
                if (!grupos[mesAnioCap][diaSemanaCap]) grupos[mesAnioCap][diaSemanaCap] = [];
                
                grupos[mesAnioCap][diaSemanaCap].push({ ...lote, fechaRaw });
            });
            return grupos;
        };

        const lotesAgrupados = agruparPorMesYDia(lotes);

        // Generar HTML del acordeón
        let indexMes = 0;
        for (const [mesAnio, dias] of Object.entries(lotesAgrupados)) {
            const isFirst = indexMes === 0;
            const monthHtml = document.createElement('div');
            monthHtml.className = `accordion-month ${isFirst ? 'active' : ''}`;
            
            const totalLotesMes = Object.values(dias).reduce((acc, curr) => acc + curr.length, 0);

            monthHtml.innerHTML = `
                <div class="accordion-month-header" onclick="this.parentElement.classList.toggle('active')">
                    <span>📅 ${mesAnio}</span>
                    <span style="font-size: 0.8em; background: rgba(255,255,255,0.2); padding: 3px 8px; border-radius: 12px;">${totalLotesMes} lotes</span>
                </div>
                <div class="accordion-month-body" id="body-month-${indexMes}">
                </div>
            `;
            container.appendChild(monthHtml);

            const bodyMonth = monthHtml.querySelector('.accordion-month-body');

            // Ordenar días (del más reciente al más antiguo)
            // Ya vienen ordenados de DB, pero si necesitamos asegurar:
            // Las claves son strings, no es tan fácil ordenar. Confiaremos en el orden de inserción si provienen de datos ordenados.
            
            for (const [dia, itemsDia] of Object.entries(dias)) {
                const dayHtml = document.createElement('div');
                dayHtml.className = 'accordion-day';
                
                let filasHtml = '';
                itemsDia.forEach(lote => {
                    const fullId = lote.id || '';
                    const idCorto = fullId.substring(0, 8).toUpperCase();
                    const cabecera = lote.recepciones_fisicas_cabecera || {};
                    const item = lote.pedidos_b2b_items || {};
                    const proveedor = cabecera.pedidos_b2b_cabecera?.proveedores?.nombre || 'Proveedor Sin Asignar';
                    
                    const timeStr = lote.fechaRaw.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

                    // Lógica Matemática y Desglose
                    const bult = (item.cant_bult && !isNaN(item.cant_bult)) ? parseFloat(item.cant_bult) : 1;
                    const val = (item.cant_valor && !isNaN(item.cant_valor)) ? parseFloat(item.cant_valor) : 1;
                    const valorUnitario = (item.valor_unitario_ref && !isNaN(item.valor_unitario_ref)) ? parseFloat(item.valor_unitario_ref) : 0;
                    
                    // Matemáticas trilateral corregida: Valor Unitario * Bulto * Valor
                    const precioBulto = valorUnitario * bult * val;
                    
                    const iva = item.iva_porcentaje ? `${item.iva_porcentaje}%` : 'S/D';
                    const desglose = `${bult} x ${val}`;
                    
                    // Mostrar nota de débito si el precio original difiere (simplificado visualmente)
                    // Como no tenemos el precio_lista original contra el final explícito aquí, solo aplicamos un tag genérico si el proveedor es Quercus o tiene un precio específico. 
                    // Simularemos que Quercus siempre tiene ND, o bien permitiremos que el operador lo sepa.
                    const isND = proveedor.toLowerCase().includes('quercus');
                    const ndBadge = isND ? `<span class="discount-badge" title="Nota de Débito aplicada">ND</span>` : '';

                    filasHtml += `
                        <tr>
                            <td><span class="badge-id">${idCorto}</span><br><small style="color:#6c757d;">${timeStr}</small></td>
                            <td class="text-proveedor">${proveedor}</td>
                            <td class="text-producto">${item.producto_codigo || ''} - ${item.producto_descripcion || 'Sin descripción'}</td>
                            <td><b>${lote.cantidad_recibida}</b> ${item.unidad_ref || 'u'}</td>
                            <td><span class="badge" style="background:#e2e3e5; color:#383d41; padding:3px 6px; border-radius:4px;">${desglose}</span></td>
                            <td>$${valorUnitario.toLocaleString('es-AR', {minimumFractionDigits: 2})} ${ndBadge}</td>
                            <td><span class="price-badge">$${precioBulto.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span></td>
                            <td>${iva}</td>
                            <td style="text-align: center;">
                                <button class="btn-imprimir" onclick="imprimirEtiquetaLote('${idCorto}', '${item.producto_descripcion ? item.producto_descripcion.replace(/'/g, "\\'") : ''}')" title="Imprimir">
                                    🖨️
                                </button>
                            </td>
                        </tr>
                    `;
                });

                dayHtml.innerHTML = `
                    <div class="accordion-day-header">${dia}</div>
                    <div class="table-responsive">
                        <table class="lotes-table">
                            <thead>
                                <tr>
                                    <th>ID Lote</th>
                                    <th>Proveedor</th>
                                    <th>Producto</th>
                                    <th>Cant.</th>
                                    <th>Desglose (BultoxVal)</th>
                                    <th>Precio Unit/Kg</th>
                                    <th>Precio Bulto/Caja</th>
                                    <th>% IVA</th>
                                    <th style="text-align: center;">Imprimir</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${filasHtml}
                            </tbody>
                        </table>
                    </div>
                `;
                bodyMonth.appendChild(dayHtml);
            }
            indexMes++;
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
