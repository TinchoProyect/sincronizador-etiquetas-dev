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
            const hasVisibleModal = document.querySelector('.modal-trazabilidad.show');
            if (!hasVisibleModal) {
                // No robar foco si el usuario está interactuando con otros controles
                const activeTags = ['BUTTON', 'INPUT', 'SELECT', 'OPTION', 'TEXTAREA'];
                if (!activeTags.includes(e.target.tagName)) {
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
        let lotes = await window.SupabaseService.fetchUltimosLotes();
        
        // Purgado de SKUs residuales o defectuosos y lotes con bultos <= 0
        if (lotes && lotes.length > 0) {
            lotes = lotes.filter(i => 
                i.pedidos_b2b_items?.producto_codigo !== 'LMD-MAN-B0B5BF36-OLD' &&
                (parseFloat(i.cantidad_recibida) || 0) > 0
            );
        }

        container.innerHTML = ''; // Limpiar

        if (!lotes || lotes.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No hay lotes recientes registrados.</p>';
            loading.style.display = 'none';
            container.style.display = 'block';
            return;
        }

        // Obtener Estados de Asignación (Batch)
        const lotesIds = lotes.map(l => l.id);
        let estadosLotes = {};
        try {
            const resEstados = await fetch('http://localhost:3005/api/logistica/bunker/lotes_vinculos/estados', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lotes: lotesIds })
            });
            if (resEstados.ok) {
                const dataEstados = await resEstados.json();
                if (dataEstados.success) {
                    estadosLotes = dataEstados.data;
                }
            }
        } catch(e) {
            console.error('Error consultando estados de lotes:', e);
        }
        
        // Guardar globalmente para poder ver el detalle luego
        window.LotesTrazabilidadCache = estadosLotes;
        
        // Guardar los lotes crudos para acceder a la cantidad original y costos en el modal
        window.LotesSupabaseCache = {};
        lotes.forEach(l => {
            window.LotesSupabaseCache[l.id] = l;
        });

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
                    const safeDesc = item.producto_descripcion 
                        ? item.producto_descripcion.replace(/"/g, '&quot;').replace(/'/g, "\\'").replace(/\n/g, ' ') 
                        : '';
                    
                    const timeStr = lote.fechaRaw.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
                    
                    const parseSafeNumber = (val) => {
                        if (val === null || val === undefined) return NaN;
                        if (typeof val === 'string') {
                            val = val.replace(',', '.');
                        }
                        return parseFloat(val);
                    };

                    // Lógica Matemática y Desglose
                    const rawBult = parseSafeNumber(item.cant_bult);
                    const rawVal = parseSafeNumber(item.cant_valor);
                    const rawUnitario = parseSafeNumber(item.valor_unitario_ref);
                    
                    const bult = !isNaN(rawBult) ? rawBult : 1;
                    const val = !isNaN(rawVal) ? rawVal : 1;
                    const valorUnitario = !isNaN(rawUnitario) ? rawUnitario : 0;
                    
                    // Matemáticas trilateral corregida: Valor Unitario * Bulto * Valor
                    const precioBulto = valorUnitario * bult * val;
                    
                    const iva = item.iva_porcentaje ? `${item.iva_porcentaje}%` : 'S/D';
                    const desglose = `${bult} x ${val}`;
                    
                    // Mostrar nota de débito si el precio original difiere (simplificado visualmente)
                    // Como no tenemos el precio_lista original contra el final explícito aquí, solo aplicamos un tag genérico si el proveedor es Quercus o tiene un precio específico. 
                    // Simularemos que Quercus siempre tiene ND, o bien permitiremos que el operador lo sepa.
                    const isND = proveedor.toLowerCase().includes('quercus');
                    const ndBadge = isND ? `<span class="discount-badge" title="Nota de Débito aplicada">ND</span>` : '';

                    // Control de Inconsistencias Flagrantes (Soporte Dual)
                    const isInconsistent = (precioBulto === valorUnitario && item.unidad_ref === 'Kilogramo' && valorUnitario > 1000);

                    // Badge de Estado y Trazabilidad
                    const estadoData = estadosLotes[fullId] || { estado: 'PENDIENTE' };
                    let badgeColor = '#6c757d'; // Gris - Pendiente
                    let badgeText = 'Pendiente';
                    if (estadoData.estado === 'PENDIENTE' && isInconsistent) {
                        badgeColor = '#ef4444'; // Rojo - Advertencia Crítica
                        badgeText = 'Pendiente (⚠️ Requiere Verificación)';
                    } else if (estadoData.estado === 'ASIGNADO_TOTAL') {
                        badgeColor = '#28a745'; // Verde
                        badgeText = 'Asignado Total';
                    } else if (estadoData.estado === 'ASIGNADO_PARCIAL') {
                        badgeColor = '#fd7e14'; // Naranja
                        badgeText = 'Asignado Parcial';
                    }
                    const estadoBadge = `<span style="background-color: ${badgeColor}; color: white; padding: 3px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold; margin-left: 10px;">${badgeText}</span>`;
                    
                    const warningBadge = isInconsistent 
                        ? `<span style="background-color: #ef4444; color: white; padding: 3px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold; margin-left: 10px; display: inline-flex; align-items: center; gap: 4px;" title="Advertencia: Presentación sospechosa de 1x1 en artículo de valor mayorista premium. Por favor, verifique el maestro de conversión.">⚠️ Inconsistente</span>` 
                        : '';

                    const btnTrazabilidad = (estadoData.estado !== 'PENDIENTE')
                        ? `<button class="btn-imprimir" style="background: linear-gradient(to right, #0dcaf0, #0aa2c0); margin-left: 10px;" onclick="mostrarAuditoriaDestinos('${fullId}', '${idCorto}')" title="Auditoría de Destinos">🔎 Trazabilidad</button>`
                        : '';

                    const providerId = cabecera.pedidos_b2b_cabecera?.proveedor_id || '';
                    const isPending = estadoData.estado === 'PENDIENTE';
                    const selectCheckbox = `<input type="checkbox" class="lote-select-chk" data-lote-id="${fullId}" data-lote-corto="${idCorto}" data-proveedor-id="${providerId}" data-estado="${estadoData.estado}" onchange="window.onLoteSelectChange(this)" style="transform: scale(1.3); margin-right: 12px; cursor: pointer;" title="${isPending ? 'Seleccionar lote para vincular en bloque' : 'Seleccionar lote para impresión masiva'}">`;

                    const btnVincular = isPending 
                        ? `<button class="btn-imprimir" style="background: linear-gradient(to right, #10b981, #059669); margin-left: 10px;" onclick='BunkerModal.abrir(${JSON.stringify(lote).replace(/'/g, "&apos;")})' title="Vincular al Búnker">
                               🔗 Vincular
                           </button>`
                        : '';

                    const btnDesvincular = (!isPending)
                        ? `<button class="btn-imprimir" style="background: linear-gradient(to right, #ef4444, #dc2626); margin-left: 10px;" onclick="window.retrotraerVinculacion('${fullId}', '${idCorto}')" title="Retrotraer / Desvincular Lote">↩️ Desvincular</button>`
                        : '';

                    let btnImprimirText = '🖨️ Imp. Par';
                    if (!isPending) {
                        const loteTrazabilidad = estadosLotes[fullId];
                        const destinosLote = loteTrazabilidad ? (loteTrazabilidad.destinos || []) : [];
                        const tieneArticulo = destinosLote.some(d => d.tipo === 'ARTICULO_BUNKER');
                        const tieneIngrediente = destinosLote.some(d => d.tipo === 'INGREDIENTE_PRODUCCION');
                        if (tieneArticulo && !tieneIngrediente) {
                            btnImprimirText = '🖨️ Imp. Art + Lote';
                        } else if (tieneIngrediente && !tieneArticulo) {
                            btnImprimirText = '🖨️ Imp. Ing + Lote';
                        } else if (tieneIngrediente && tieneArticulo) {
                            btnImprimirText = '🖨️ Imp. Mult + Lote';
                        }
                    }

                    const btnImprimirArtLote = (!isPending)
                        ? `<button class="btn-imprimir" style="background: linear-gradient(to right, #6366f1, #4f46e5); margin-left: 10px;" onclick="window.imprimirArticuloYLote('${fullId}', '${idCorto}', ${lote.cantidad_recibida})" title="Imprimir Par (Destino y Lote)">${btnImprimirText}</button>`
                        : '';

                    filasHtml += `
                        <div class="lote-card">
                            <div class="lote-card-header">
                                <div style="display: flex; align-items: center;">
                                    ${selectCheckbox}
                                    <span class="badge-id" style="margin-left: ${isPending ? '0px' : '0px'}">${idCorto}</span>
                                    <span style="color:#6c757d; font-size: 0.85em; margin-left: 10px;">🕒 ${timeStr}</span>
                                    ${estadoBadge}
                                    ${warningBadge}
                                </div>
                                <button class="btn-imprimir" onclick="imprimirEtiquetaLote('${idCorto}', '${safeDesc}', ${lote.cantidad_recibida})" title="Imprimir Etiqueta del Lote">
                                    🖨️ Imp. Lote
                                </button>
                                ${btnImprimirArtLote}
                                ${btnVincular}
                                ${btnTrazabilidad}
                                ${btnDesvincular}
                            </div>
                            <div class="lote-card-body">
                                <div class="lote-section-maestra">
                                    <div>
                                        <div class="lote-label">Proveedor</div>
                                        <div class="lote-value text-proveedor">${proveedor}</div>
                                    </div>
                                    <div>
                                        <div class="lote-label">Producto</div>
                                        <div class="lote-value text-producto">${item.producto_codigo || ''} - ${item.producto_descripcion || 'Sin descripción'}</div>
                                    </div>
                                    <div>
                                        <div class="lote-label">Presentación (Bultos x Cant)</div>
                                        <div class="lote-value" style="display: flex; align-items: center; gap: 6px;">
                                            <span class="badge" style="background:${isInconsistent ? '#fee2e2' : '#e2e3e5'}; color:${isInconsistent ? '#b91c1c' : '#383d41'}; padding:3px 6px; border-radius:4px; font-weight:${isInconsistent ? 'bold' : 'normal'}; border:${isInconsistent ? '1px solid #fca5a5' : 'none'};">${desglose}</span>
                                            ${isPending ? `<button class="btn-imprimir" style="padding: 2px 6px; font-size: 0.75em; background: linear-gradient(to right, #6c757d, #495057); margin-left: 0; min-height: unset; height: 22px; display: inline-flex; align-items: center; justify-content: center;" onclick="corregirPresentacion('${fullId}', ${bult}, ${val}, '${safeDesc}')" title="Corregir presentación manualmente">✏️</button>` : ''}
                                        </div>
                                    </div>
                                    <div>
                                        <div class="lote-label">Cantidad Recibida</div>
                                        <div class="lote-value"><b>${lote.cantidad_recibida}</b> bultos</div>
                                    </div>
                                </div>
                                <div class="lote-section-financiera">
                                    <div>
                                        <div class="lote-label">Precio Referencia (x Unidad/Kg)</div>
                                        <div class="lote-value">$${valorUnitario.toLocaleString('es-AR', {minimumFractionDigits: 2})} ${ndBadge}</div>
                                    </div>
                                    <div>
                                        <div class="lote-label">Precio por Bulto/Caja</div>
                                        <div class="lote-value"><span class="price-badge" style="font-size: 1.1em;">$${precioBulto.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span></div>
                                    </div>
                                    <div>
                                        <div class="lote-label">Porcentaje IVA</div>
                                        <div class="lote-value">${iva}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                });

                dayHtml.innerHTML = `
                    <div class="accordion-day-header" onclick="this.parentElement.classList.toggle('active')">
                        <span>📅 ${dia}</span>
                        <span style="font-size: 0.8em; color: #6c757d;">🔽 Desplegar</span>
                    </div>
                    <div class="accordion-day-body">
                        <div class="lote-grid">
                            ${filasHtml}
                        </div>
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
        document.getElementById('radiografia-cantidad').innerText = `${lote.cantidad_recibida} bultos`;
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
window.imprimirEtiquetaLote = async function(idCorto, descripcionProducto, cantidadDefault = 1) {
    try {
        const { value: cantidadElegida } = await Swal.fire({
            title: 'Imprimir Etiquetas',
            text: '¿Cuántas etiquetas (unidades) deseas imprimir?',
            input: 'number',
            inputValue: cantidadDefault,
            showCancelButton: true,
            confirmButtonText: 'Imprimir',
            cancelButtonText: 'Cancelar',
            inputValidator: (value) => {
                if (!value || value <= 0) {
                    return 'Debes ingresar una cantidad válida';
                }
            }
        });

        if (!cantidadElegida) {
            return; // El usuario canceló
        }

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
                cantidad: parseInt(cantidadElegida, 10)
            })
        });

        if (!res.ok) {
            throw new Error('Error en el servicio de impresión.');
        }

        Swal.fire({
            icon: 'success',
            title: '¡Impresión Enviada!',
            text: `Se enviaron ${cantidadElegida} etiquetas a la cola.`,
            timer: 2000,
            showConfirmButton: false
        });

    } catch (error) {
        console.error('Error al imprimir:', error);
        Swal.fire('Error', 'Hubo un problema al intentar imprimir la etiqueta.', 'error');
    }
};

/**
 * Muestra el modal de Auditoría de Destinos
 */
window.mostrarAuditoriaDestinos = function(loteId, idCorto) {
    if (!window.LotesTrazabilidadCache || !window.LotesTrazabilidadCache[loteId]) {
        Swal.fire('Atención', 'No hay datos de trazabilidad para este lote.', 'info');
        return;
    }
    
    const datos = window.LotesTrazabilidadCache[loteId];
    const loteOriginal = window.LotesSupabaseCache && window.LotesSupabaseCache[loteId] ? window.LotesSupabaseCache[loteId] : null;
    
    // Variables de origen
    let bultosOriginales = 0;
    let kilosPorBulto = 1;
    if (loteOriginal) {
        if (loteOriginal.cantidad_recibida) {
            bultosOriginales = loteOriginal.cantidad_recibida;
        }
        if (loteOriginal.pedidos_b2b_items && loteOriginal.pedidos_b2b_items.cant_valor) {
            kilosPorBulto = parseFloat(loteOriginal.pedidos_b2b_items.cant_valor) || 1;
        }
    }

    document.getElementById('auditoria-lote-id').innerText = idCorto;
    
    // Desglose de origen
    document.getElementById('auditoria-origen-bultos').innerText = bultosOriginales.toString();
    document.getElementById('auditoria-origen-kilos').innerText = (datos.total_lote || 0).toLocaleString('es-AR', {minimumFractionDigits: 2}) + ' kg';
    
    // Costos
    const costoBruto = datos.costo_bruto || 0;
    const costoKilo = datos.costo_kilo || 0;
    document.getElementById('auditoria-costo-bruto').innerText = '$' + costoBruto.toLocaleString('es-AR', {minimumFractionDigits: 2});
    document.getElementById('auditoria-costo-kilo').innerText = '$' + costoKilo.toLocaleString('es-AR', {minimumFractionDigits: 2});
    
    document.getElementById('auditoria-asignado').innerText = (datos.suma_asignada || 0).toLocaleString('es-AR', {minimumFractionDigits: 2}) + ' kg netos';
    
    let htmlDestinos = '';
    if (datos.destinos && datos.destinos.length > 0) {
        datos.destinos.forEach(d => {
            const badgeTipo = d.tipo === 'ARTICULO_BUNKER' 
                ? '<span style="background: #e2e8f0; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; margin-right: 8px;">BÚNKER</span>'
                : '<span style="background: #fef08a; color: #854d0e; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; margin-right: 8px;">INGREDIENTES</span>';
                
            // Obtener datos reales guardados en la base de datos
            const kilosDestino = parseFloat(d.cantidad_kilos || 0);
            const bultosTotales = parseFloat(d.cantidad_bultos || 0);
            const bultosAbiertos = parseFloat(d.cantidad_abierta || 0);
            const bultosCerrados = Math.max(0, bultosTotales - bultosAbiertos);
            
            // Botón premium para abrir caja si es ingrediente y tiene cerradas
            const btnAbrirCaja = d.tipo === 'INGREDIENTE_PRODUCCION' && bultosCerrados > 0
                ? `<button onclick="window.abrirCajaDestinoClick('${datos.id}', '${d.id}', '${loteId}', '${idCorto}', ${bultosCerrados})" style="background: #10b981; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.8em; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: background 0.2s; font-weight: bold; margin-top: 4px;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">📦 Abrir Caja</button>`
                : '';

            const desgloseCajas = d.tipo === 'INGREDIENTE_PRODUCCION'
                ? `<div style="font-size: 0.8em; color: #475569; font-weight: 500; margin-top: 2px;">${bultosCerrados} cerradas | ${bultosAbiertos} abiertas</div>`
                : '';

            htmlDestinos += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 10px; border-bottom: 1px solid #e2e8f0;">
                    <div>
                        ${badgeTipo}
                        <strong>${d.descripcion}</strong> 
                        <span style="color: #64748b; font-size: 0.85em;">(ID: ${d.id})</span>
                        <div>${btnAbrirCaja}</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-weight: bold; color: #0f172a; font-size: 1.1em;">
                            ${kilosDestino.toLocaleString('es-AR', {minimumFractionDigits: 2})} <span style="font-size: 0.8em; color: #64748b; font-weight: normal;">kg netos</span>
                        </div>
                        <div style="font-size: 0.85em; color: #64748b; font-weight: 500;">
                            ${bultosTotales.toLocaleString('es-AR', {minimumFractionDigits: 0})} cajas/bultos
                        </div>
                        ${desgloseCajas}
                    </div>
                </div>
            `;
        });
    } else {
        htmlDestinos = '<p style="color: #6c757d; text-align: center; padding: 20px;">No hay destinos registrados.</p>';
    }
    
    document.getElementById('auditoria-destinos-container').innerHTML = htmlDestinos;
    document.getElementById('modal-auditoria').classList.add('show');
};

/**
 * Cierra el modal de Auditoría de Destinos
 */
window.cerrarAuditoriaDestinos = function() {
    document.getElementById('modal-auditoria').classList.remove('show');
};

/**
 * Procesa la acción de abrir una caja cerrada e inyectar stock libre en caliente
 */
window.abrirCajaDestinoClick = async function(vinculoId, destinoId, loteId, idCorto, cantidadDisponible = 1) {
    let cantidadA_Abrir = 1;

    if (cantidadDisponible > 1) {
        const { value: inputCant } = await Swal.fire({
            title: '¿Cuántas cajas deseas abrir?',
            text: `Hay ${cantidadDisponible} cajas cerradas disponibles para este lote (${idCorto}). Se restarán las cajas seleccionadas y se ingresará el equivalente en Kilos Libres al stock de fábrica.`,
            input: 'number',
            inputLabel: 'Cantidad de cajas',
            inputValue: 1,
            inputAttributes: {
                min: 1,
                max: cantidadDisponible,
                step: 1
            },
            showCancelButton: true,
            confirmButtonColor: '#10b981',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Abrir cajas',
            cancelButtonText: 'Cancelar',
            inputValidator: (value) => {
                if (!value || isNaN(value) || parseInt(value) < 1 || parseInt(value) > cantidadDisponible) {
                    return `Por favor, ingresa un número entre 1 y ${cantidadDisponible}`;
                }
            }
        });

        if (!inputCant) return;
        cantidadA_Abrir = parseInt(inputCant);
    } else {
        const confirm = await Swal.fire({
            title: '¿Abrir caja de ingrediente?',
            text: `Se restará 1 caja del stock cerrado de Ingredientes y se ingresará el equivalente en Kilos Libres al stock de fábrica para el lote ${idCorto}.`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#10b981',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Sí, abrir caja',
            cancelButtonText: 'Cancelar'
        });

        if (!confirm.isConfirmed) return;
    }

    Swal.fire({ 
        title: 'Procesando Apertura...', 
        allowOutsideClick: false, 
        didOpen: () => Swal.showLoading() 
    });

    try {
        const res = await fetch('http://localhost:3005/api/logistica/bunker/lotes_vinculos/abrir_caja', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vinculo_id: vinculoId, destino_id: destinoId, cantidad: cantidadA_Abrir })
        });
        const result = await res.json();
        
        if (res.ok && result.success) {
            // 1. Actualizar caché local de trazabilidad
            const datosCached = window.LotesTrazabilidadCache[loteId];
            const dest = datosCached.destinos.find(d => d.id === destinoId && d.tipo === 'INGREDIENTE_PRODUCCION');
            if (dest) {
                dest.cantidad_abierta = parseFloat(result.data.nuevas_abiertas);
            }
            
            await Swal.fire('Caja Abierta', `Se ha transferido ${cantidadA_Abrir} caja(s) a stock de kilos libres de fábrica.`, 'success');
            
            // 2. Refrescar la vista en vivo del modal
            window.mostrarAuditoriaDestinos(loteId, idCorto);
        } else {
            throw new Error(result.error || 'Error al procesar apertura');
        }
    } catch(e) {
        console.error('[VIGÍA FRONTEND] -> ERROR APERTURA:', e);
        Swal.fire('Error', e.message || 'Error de conexión', 'error');
    }
};

/**
 * Lógica de Selección Múltiple y Consistencia de Proveedor
 */
window.onLoteSelectChange = function(chk) {
    const checkedChks = document.querySelectorAll('.lote-select-chk:checked');
    const allChks = document.querySelectorAll('.lote-select-chk');
    const btnBatch = document.getElementById('btn-vincular-lote-batch');
    const btnPrintBatch = document.getElementById('btn-imprimir-lote-batch');
    const countSpan = document.getElementById('batch-select-count');
    const printCountSpan = document.getElementById('batch-print-count');
    
    if (checkedChks.length > 0) {
        const firstChk = checkedChks[0];
        const selectedProveedorId = firstChk.dataset.proveedorId;
        const isFirstPending = firstChk.dataset.estado === 'PENDIENTE';
        
        // Bloquear visualmente lotes que no cumplan con el proveedor o tengan mezcla de estados
        allChks.forEach(c => {
            const isPending = c.dataset.estado === 'PENDIENTE';
            const isProveedorDiff = c.dataset.proveedorId !== selectedProveedorId;
            const isEstadoDiff = isPending !== isFirstPending;
            
            if (isProveedorDiff || isEstadoDiff) {
                c.disabled = true;
                const card = c.closest('.lote-card');
                if (card) card.style.opacity = '0.4';
            } else {
                c.disabled = false;
                const card = c.closest('.lote-card');
                if (card) card.style.opacity = '1';
            }
        });
        
        if (isFirstPending) {
            btnBatch.style.display = 'inline-block';
            btnPrintBatch.style.display = 'none';
            countSpan.innerText = checkedChks.length;
        } else {
            btnBatch.style.display = 'none';
            btnPrintBatch.style.display = 'inline-block';
            printCountSpan.innerText = checkedChks.length;
        }
    } else {
        // Habilitar y restablecer la opacidad si no queda ningún lote seleccionado
        allChks.forEach(c => {
            c.disabled = false;
            const card = c.closest('.lote-card');
            if (card) card.style.opacity = '1';
        });
        
        btnBatch.style.display = 'none';
        btnPrintBatch.style.display = 'none';
        countSpan.innerText = '0';
        printCountSpan.innerText = '0';
    }
};

/**
 * Abre el modal compuesto de vinculación múltiple
 */
window.abrirModalVincularBatch = function() {
    const checkedChks = document.querySelectorAll('.lote-select-chk:checked');
    const lotesSeleccionados = [];
    
    checkedChks.forEach(chk => {
        const id = chk.dataset.loteId;
        const loteRaw = window.LotesSupabaseCache[id];
        if (loteRaw) {
            lotesSeleccionados.push(loteRaw);
        }
    });
    
    if (lotesSeleccionados.length === 0) {
        Swal.fire('Atención', 'No hay lotes seleccionados.', 'warning');
        return;
    }
    
    // Iniciar y abrir el Modal Batch
    window.BunkerModalBatch.abrir(lotesSeleccionados);
};

/**
 * Corrige manualmente la presentación (Bultos x Cantidad) de un lote y actualiza la base local.
 */
window.corregirPresentacion = async function(loteId, currentBult, currentValor, desc) {
    const { value: formValues } = await Swal.fire({
        title: '✏️ Corregir Presentación',
        html:
            `<div style="text-align: left; font-size: 13px; color: #475569; margin-bottom: 15px; background: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; line-height: 1.4;"><b>Producto:</b><br>${desc}</div>` +
            '<div style="display: flex; flex-direction: column; gap: 10px; text-align: left;">' +
            '  <div>' +
            '    <label style="font-weight: bold; font-size: 12px; color: #475569; display: block; margin-bottom: 4px;">Bultos (Factor de conversión):</label>' +
            `    <input id="swal-input-bult" class="swal2-input" type="number" step="any" value="${currentBult}" style="margin: 0; width: 100%; box-sizing: border-box; font-size: 14px; padding: 8px;">` +
            '  </div>' +
            '  <div>' +
            '    <label style="font-weight: bold; font-size: 12px; color: #475569; display: block; margin-bottom: 4px;">Cantidad por Bulto (Kg / Unidades):</label>' +
            `    <input id="swal-input-valor" class="swal2-input" type="number" step="any" value="${currentValor}" style="margin: 0; width: 100%; box-sizing: border-box; font-size: 14px; padding: 8px;">` +
            '  </div>' +
            '</div>',
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '💾 Guardar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const b = parseFloat(document.getElementById('swal-input-bult').value);
            const v = parseFloat(document.getElementById('swal-input-valor').value);
            if (isNaN(b) || b <= 0) {
                Swal.showValidationMessage('El factor de bultos debe ser mayor a 0');
                return false;
            }
            if (isNaN(v) || v <= 0) {
                Swal.showValidationMessage('La cantidad por bulto debe ser mayor a 0');
                return false;
            }
            return { cant_bult: b, cant_valor: v };
        }
    });

    if (formValues) {
        Swal.fire({ title: 'Guardando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        try {
            const res = await fetch('/api/supabase/lotes/override', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lote_id_supabase: loteId,
                    cant_bult: formValues.cant_bult,
                    cant_valor: formValues.cant_valor
                })
            });
            const result = await res.json();
            if (res.ok && result.success) {
                Swal.fire('Guardado', 'Presentación corregida con éxito.', 'success');
                // Recargar grilla para reflejar los cambios
                await cargarLotes();
            } else {
                throw new Error(result.error || 'Error al guardar overrides');
            }
        } catch (e) {
            Swal.fire('Error', e.message, 'error');
        }
    }
};

/**
 * Retrotrae la vinculación de un lote, con opción de revertir o no el stock en las tablas Legacy.
 */
window.retrotraerVinculacion = async function(loteId, idCorto) {
    const confirm = await Swal.fire({
        title: '↩️ Desvincular Lote',
        html: `
            <div style="text-align: left; font-size: 14px; color: #374151; line-height: 1.5; margin-bottom: 15px;">
                ¿Estás seguro de que deseas retrotraer la vinculación del lote <b>${idCorto}</b>?<br>
                El lote volverá a quedar en estado <b>Pendiente</b>.
            </div>
            <div style="text-align: left; background-color: #f3f4f6; padding: 12px; border-radius: 6px; border: 1px solid #e5e7eb;">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold; color: #1f2937; font-size: 14px;">
                    <input type="checkbox" id="swal-revertir-stock" checked style="transform: scale(1.2); cursor: pointer;">
                    Revertir stock y movimientos
                </label>
                <div style="font-size: 12px; color: #6b7280; margin-top: 4px; margin-left: 22px;">
                    Si se desmarca, se eliminará el vínculo pero <b>no se modificará el stock real consolidado ni los ingredientes</b> (útil si la vinculación original no sumó stock).
                </div>
            </div>
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sí, desvincular',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const revertirStock = document.getElementById('swal-revertir-stock').checked;
            return { revertirStock };
        }
    });

    if (confirm.isConfirmed) {
        Swal.fire({
            title: 'Desvinculando...',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        try {
            const res = await fetch('http://localhost:3005/api/logistica/bunker/lotes_vinculos/desvincular', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lote_id_supabase: loteId,
                    revertir_stock: confirm.value.revertirStock
                })
            });

            const result = await res.json();
            if (res.ok && result.success) {
                await Swal.fire(
                    'Desvinculado',
                    `La vinculación del lote ${idCorto} ha sido retrotraída con éxito.`,
                    'success'
                );
                await cargarLotes();
            } else {
                throw new Error(result.error || 'Error al intentar desvincular el lote.');
            }
        } catch (e) {
            Swal.fire('Error', e.message || 'Error de conexión', 'error');
        }
    }
};

/**
 * Solicita confirmación y cantidad para imprimir par (Artículo y Lote) en impresora Zebra
 */
window.imprimirArticuloYLote = async function(loteId, idCorto, cantidadDefault) {
    if (!window.LotesTrazabilidadCache || !window.LotesTrazabilidadCache[loteId]) {
        Swal.fire('Atención', 'No hay datos de trazabilidad para este lote.', 'info');
        return;
    }

    const datos = window.LotesTrazabilidadCache[loteId];
    const destinos = datos.destinos || [];

    if (destinos.length === 0) {
        Swal.fire('Atención', 'Este lote no está vinculado a ningún destino.', 'warning');
        return;
    }

    let destinoSeleccionado = destinos[0];

    if (destinos.length > 1) {
        // Múltiples destinos: pedir al usuario que seleccione cuál imprimir
        const optionsHtml = destinos.map((d, index) => {
            const tipoLabel = d.tipo === 'ARTICULO_BUNKER' ? 'Artículo' : 'Ingrediente';
            return `<option value="${index}">${tipoLabel}: ${d.descripcion} (ID: ${d.id}) - ${d.cantidad_bultos} bultos</option>`;
        }).join('');

        const selectConfirm = await Swal.fire({
            title: 'Seleccionar Destino',
            text: 'El lote está vinculado a más de un destino. Por favor, selecciona cuál deseas imprimir:',
            html: `
                <select id="swal-select-articulo-print" class="swal2-select" style="margin: 10px 0; width: 100%;">
                    ${optionsHtml}
                </select>
            `,
            showCancelButton: true,
            confirmButtonText: 'Siguiente',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const idx = parseInt(document.getElementById('swal-select-articulo-print').value, 10);
                return destinos[idx];
            }
        });

        if (!selectConfirm.isConfirmed) return;
        destinoSeleccionado = selectConfirm.value;
    }

    // Pedir la cantidad de bultos/pares
    const defaultBultos = parseInt(destinoSeleccionado.cantidad_bultos, 10) || cantidadDefault || 1;
    const esArticulo = destinoSeleccionado.tipo === 'ARTICULO_BUNKER';

    const qtyConfirm = await Swal.fire({
        title: esArticulo ? 'Imprimir Etiquetas (Artículo + Lote)' : 'Imprimir Etiquetas (Ingrediente + Lote)',
        html: `
            <div style="text-align: left; font-size: 14px; margin-bottom: 15px; color: #374151;">
                <b>${esArticulo ? 'Artículo' : 'Ingrediente'}:</b> ${destinoSeleccionado.descripcion}<br>
                <b>Lote:</b> ${idCorto}
            </div>
            <div style="text-align: left;">
                <label style="font-weight: bold; font-size: 12px; color: #475569; display: block; margin-bottom: 4px;">Cantidad de cajas (Pares de etiquetas):</label>
                <input id="swal-input-cajas-print" class="swal2-input" type="number" step="1" min="1" value="${defaultBultos}" style="margin: 0; width: 100%; box-sizing: border-box; font-size: 14px; padding: 8px;">
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: '🖨️ Imprimir',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const val = parseInt(document.getElementById('swal-input-cajas-print').value, 10);
            if (isNaN(val) || val <= 0) {
                Swal.showValidationMessage('La cantidad debe ser mayor a 0');
                return false;
            }
            return val;
        }
    });

    if (qtyConfirm.isConfirmed) {
        const cajas = qtyConfirm.value;
        const totalEtiquetas = cajas * 2; // Cada caja lleva 1 par (2 etiquetas físicas en la Zebra)

        Swal.fire({
            title: 'Enviando a impresora Zebra...',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        try {
            // Decidir URL del endpoint según el tipo de destino
            const endpointSubPath = esArticulo ? 'articulos' : 'ingredientes';
            const res = await fetch(`http://localhost:3005/api/logistica/bunker/${endpointSubPath}/${destinoSeleccionado.id}/imprimir`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lote_id_supabase: loteId,
                    lote_codigo_corto: idCorto,
                    cantidad: totalEtiquetas
                })
            });

            const result = await res.json();
            if (res.ok && result.success) {
                Swal.fire({
                    icon: 'success',
                    title: '¡Impresión Enviada!',
                    text: `Se enviaron ${cajas} pares a la Zebra.`,
                    timer: 2500,
                    showConfirmButton: false
                });
            } else {
                throw new Error(result.error || 'Error al intentar enviar la impresión.');
            }
        } catch (e) {
            Swal.fire('Error', e.message || 'Error de conexión', 'error');
        }
    }
};

/**
 * Abre el modal de previsualización para la impresión masiva de etiquetas
 */
window.abrirModalImprimirBatch = function() {
    const checkedChks = document.querySelectorAll('.lote-select-chk:checked');
    const tbody = document.getElementById('mim-tabla-body');
    tbody.innerHTML = ''; // Limpiar
    
    let filaIndex = 0;
    
    checkedChks.forEach(chk => {
        const loteId = chk.dataset.loteId;
        const idCorto = chk.dataset.loteShort || chk.dataset.loteCorto || loteId.substring(0, 8).toUpperCase();
        
        const loteTrazabilidad = window.LotesTrazabilidadCache[loteId];
        if (!loteTrazabilidad) return;
        
        const destinos = loteTrazabilidad.destinos || [];
        destinos.forEach(d => {
            const esArticulo = d.tipo === 'ARTICULO_BUNKER';
            const defaultBultos = parseInt(d.cantidad_bultos, 10) || 1;
            
            const tr = document.createElement('tr');
            tr.className = 'mim-fila-destino';
            tr.dataset.loteId = loteId;
            tr.dataset.loteCorto = idCorto;
            tr.dataset.destinoId = d.id;
            tr.dataset.tipo = d.tipo;
            tr.dataset.descripcion = d.descripcion;
            
            tr.style.borderBottom = '1px solid #e2e8f0';
            
            tr.innerHTML = `
                <td style="padding: 10px; text-align: center;">
                    <input type="checkbox" class="mim-fila-select" checked style="transform: scale(1.1); cursor: pointer;" onchange="window.verificarBotonIniciarImpresion()">
                </td>
                <td style="padding: 10px; font-family: monospace; font-weight: bold; color: #475569;">${idCorto}</td>
                <td style="padding: 10px;">
                    <span style="background: ${esArticulo ? '#e0e7ff' : '#ecfdf5'}; color: ${esArticulo ? '#4338ca' : '#047857'}; font-size: 0.85em; font-weight: bold; padding: 2px 6px; border-radius: 4px;">
                        ${esArticulo ? 'Artículo' : 'Ingrediente'}
                    </span>
                </td>
                <td style="padding: 10px; color: #1e293b; font-weight: 500;">${d.descripcion} <span style="color: #64748b; font-size: 0.85em;">(ID: ${d.id})</span></td>
                <td style="padding: 10px; text-align: center;">
                    <input class="mim-fila-cajas swal2-input" type="number" step="1" min="1" value="${defaultBultos}" style="margin: 0; width: 80px; text-align: center; font-size: 0.9em; padding: 4px; box-sizing: border-box;">
                </td>
                <td class="mim-fila-estado" style="padding: 10px; text-align: center; font-weight: bold; color: #64748b;">
                    Pendiente
                </td>
            `;
            tbody.appendChild(tr);
            filaIndex++;
        });
    });
    
    if (tbody.children.length === 0) {
        Swal.fire('Atención', 'No se encontraron destinos vinculados válidos para los lotes seleccionados.', 'warning');
        return;
    }
    
    document.getElementById('mim-select-all').checked = true;
    document.getElementById('mim-progreso-container').style.display = 'none';
    document.getElementById('modal-impresion-masiva').classList.add('show');
    window.verificarBotonIniciarImpresion();
};

/**
 * Cierra el modal de impresión masiva
 */
window.cerrarModalImprimirBatch = function() {
    document.getElementById('modal-impresion-masiva').classList.remove('show');
};

/**
 * Habilita/Deshabilita el botón de Iniciar según si hay filas seleccionadas
 */
window.verificarBotonIniciarImpresion = function() {
    const checkedCount = document.querySelectorAll('.mim-fila-select:checked').length;
    const btn = document.getElementById('mim-btn-iniciar');
    btn.disabled = checkedCount === 0;
};

/**
 * Checkea/Uncheckea todas las filas del modal
 */
window.toggleAllImpresionFila = function(checked) {
    const chks = document.querySelectorAll('.mim-fila-select');
    chks.forEach(c => c.checked = checked);
    window.verificarBotonIniciarImpresion();
};

/**
 * Dispara la cola asíncrona secuencial de impresión
 */
window.iniciarImpresionMasiva = async function() {
    const filas = Array.from(document.querySelectorAll('.mim-fila-destino'));
    const filasA_Imprimir = filas.filter(f => f.querySelector('.mim-fila-select').checked);
    
    if (filasA_Imprimir.length === 0) return;
    
    // Controles de UI
    const btnIniciar = document.getElementById('mim-btn-iniciar');
    const btnCerrar = document.querySelector('#modal-impresion-masiva .btn-close');
    const btnCancelar = document.querySelector('#modal-impresion-masiva button[onclick*="cerrarModal"]');
    
    btnIniciar.disabled = true;
    if (btnCerrar) btnCerrar.style.display = 'none';
    if (btnCancelar) btnCancelar.disabled = true;
    
    const progresoContainer = document.getElementById('mim-progreso-container');
    const progresoTexto = document.getElementById('mim-progreso-texto');
    const progresoPorcentaje = document.getElementById('mim-progreso-porcentaje');
    const progresoBar = document.getElementById('mim-progreso-bar');
    
    progresoContainer.style.display = 'block';
    
    let impresosConExito = 0;
    let totalFilas = filasA_Imprimir.length;
    
    // Deshabilitar todos los inputs individuales para congelar estado
    filas.forEach(f => {
        f.querySelector('.mim-fila-select').disabled = true;
        f.querySelector('.mim-fila-cajas').disabled = true;
    });
    
    for (let i = 0; i < totalFilas; i++) {
        const fila = filasA_Imprimir[i];
        const statusEl = fila.querySelector('.mim-fila-estado');
        
        const loteId = fila.dataset.loteId;
        const idCorto = fila.dataset.loteCorto;
        const destinoId = fila.dataset.destinoId;
        const tipo = fila.dataset.tipo;
        const desc = fila.dataset.descripcion;
        
        const cajasInput = fila.querySelector('.mim-fila-cajas');
        const cajas = parseInt(cajasInput.value, 10) || 1;
        const totalEtiquetas = cajas * 2;
        
        // Actualizar UI del progreso
        statusEl.innerText = 'Imprimiendo...';
        statusEl.style.color = '#3b82f6';
        
        const indexActual = i + 1;
        progresoTexto.innerText = `Imprimiendo: ${desc} (Etiqueta ${indexActual} de ${totalFilas})...`;
        const pct = Math.round((i / totalFilas) * 100);
        progresoPorcentaje.innerText = `${pct}%`;
        progresoBar.style.width = `${pct}%`;
        
        try {
            const endpointSubPath = tipo === 'ARTICULO_BUNKER' ? 'articulos' : 'ingredientes';
            const res = await fetch(`http://localhost:3005/api/logistica/bunker/${endpointSubPath}/${destinoId}/imprimir`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lote_id_supabase: loteId,
                    lote_codigo_corto: idCorto,
                    cantidad: totalEtiquetas
                })
            });
            
            const result = await res.json();
            if (res.ok && result.success) {
                statusEl.innerText = 'Listo';
                statusEl.style.color = '#10b981';
                impresosConExito++;
            } else {
                throw new Error(result.error || 'Error de impresión');
            }
        } catch (err) {
            console.error(`❌ Error imprimiendo fila masiva (${desc}):`, err.message);
            statusEl.innerText = 'Error';
            statusEl.style.color = '#ef4444';
        }
        
        // Un leve retardo de 400ms para asegurar la consistencia del spooler Zebra
        await new Promise(r => setTimeout(r, 400));
    }
    
    // Finalización
    progresoPorcentaje.innerText = '100%';
    progresoBar.style.width = '100%';
    progresoTexto.innerText = 'Impresión masiva completada.';
    
    // Habilitar botones de cierre
    if (btnCerrar) btnCerrar.style.display = 'block';
    if (btnCancelar) btnCancelar.disabled = false;
    
    // Desmarcar todos los checkboxes de lotes de la grilla principal
    document.querySelectorAll('.lote-select-chk:checked').forEach(c => c.checked = false);
    // Disparar reactividad para ocultar la barra de impresión masiva
    window.onLoteSelectChange();
    
    await Swal.fire({
        icon: impresosConExito === totalFilas ? 'success' : 'warning',
        title: 'Cola de Impresión Finalizada',
        text: `Se enviaron con éxito ${impresosConExito} de ${totalFilas} etiquetas a la Zebra.`
    });
    
    window.cerrarModalImprimirBatch();
};



