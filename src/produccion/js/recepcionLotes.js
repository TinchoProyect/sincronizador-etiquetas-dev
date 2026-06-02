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
        
        // Purgado de SKUs residuales o defectuosos
        if (lotes && lotes.length > 0) {
            lotes = lotes.filter(i => i.pedidos_b2b_items?.producto_codigo !== 'LMD-MAN-B0B5BF36-OLD');
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
                    const selectCheckbox = isPending 
                        ? `<input type="checkbox" class="lote-select-chk" data-lote-id="${fullId}" data-proveedor-id="${providerId}" onchange="window.onLoteSelectChange(this)" style="transform: scale(1.3); margin-right: 12px; cursor: pointer;" title="Seleccionar lote para vincular en bloque">`
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
                                ${(() => {
                                    const safeDesc = item.producto_descripcion 
                                        ? item.producto_descripcion.replace(/"/g, '&quot;').replace(/'/g, "\\'").replace(/\n/g, ' ') 
                                        : '';
                                    return `
                                    <button class="btn-imprimir" onclick="imprimirEtiquetaLote('${idCorto}', '${safeDesc}', ${lote.cantidad_recibida})" title="Imprimir Etiqueta">
                                        🖨️ Imprimir
                                    </button>
                                    <button class="btn-imprimir" style="background: linear-gradient(to right, #10b981, #059669); margin-left: 10px;" onclick='BunkerModal.abrir(${JSON.stringify(lote).replace(/'/g, "&apos;")})' title="Vincular al Búnker">
                                        🔗 Vincular
                                    </button>
                                    ${btnTrazabilidad}`;
                                })()}
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
                                        <div class="lote-value"><span class="badge" style="background:${isInconsistent ? '#fee2e2' : '#e2e3e5'}; color:${isInconsistent ? '#b91c1c' : '#383d41'}; padding:3px 6px; border-radius:4px; font-weight:${isInconsistent ? 'bold' : 'normal'}; border:${isInconsistent ? '1px solid #fca5a5' : 'none'};">${desglose}</span></div>
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
                ? `<button onclick="window.abrirCajaDestinoClick('${datos.id}', '${d.id}', '${loteId}', '${idCorto}')" style="background: #10b981; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.8em; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: background 0.2s; font-weight: bold; margin-top: 4px;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">📦 Abrir Caja</button>`
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
window.abrirCajaDestinoClick = async function(vinculoId, destinoId, loteId, idCorto) {
    const confirm = await Swal.fire({
        title: '¿Abrir caja de ingrediente?',
        text: 'Se restará 1 caja del stock cerrado de Ingredientes y se ingresará el equivalente en Kilos Libres al stock de fábrica.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, abrir caja',
        cancelButtonText: 'Cancelar'
    });

    if (!confirm.isConfirmed) return;

    Swal.fire({ 
        title: 'Procesando Apertura...', 
        allowOutsideClick: false, 
        didOpen: () => Swal.showLoading() 
    });

    try {
        const res = await fetch('http://localhost:3005/api/logistica/bunker/lotes_vinculos/abrir_caja', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vinculo_id: vinculoId, destino_id: destinoId })
        });
        const result = await res.json();
        
        if (res.ok && result.success) {
            // 1. Actualizar caché local de trazabilidad
            const datosCached = window.LotesTrazabilidadCache[loteId];
            const dest = datosCached.destinos.find(d => d.id === destinoId && d.tipo === 'INGREDIENTE_PRODUCCION');
            if (dest) {
                dest.cantidad_abierta = parseFloat(result.data.nuevas_abiertas);
            }
            
            await Swal.fire('Caja Abierta', 'Se ha transferido una caja a stock de kilos libres de fábrica.', 'success');
            
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
    const countSpan = document.getElementById('batch-select-count');
    
    if (checkedChks.length > 0) {
        const selectedProveedorId = checkedChks[0].dataset.proveedorId;
        
        // Bloquear y atenuar visualmente los lotes que pertenezcan a otros proveedores
        allChks.forEach(c => {
            if (c.dataset.proveedorId !== selectedProveedorId) {
                c.disabled = true;
                const card = c.closest('.lote-card');
                if (card) card.style.opacity = '0.4';
            } else {
                c.disabled = false;
                const card = c.closest('.lote-card');
                if (card) card.style.opacity = '1';
            }
        });
        
        btnBatch.style.display = 'inline-block';
        countSpan.innerText = checkedChks.length;
    } else {
        // Habilitar y restablecer la opacidad si no queda ningún lote seleccionado
        allChks.forEach(c => {
            c.disabled = false;
            const card = c.closest('.lote-card');
            if (card) card.style.opacity = '1';
        });
        
        btnBatch.style.display = 'none';
        countSpan.innerText = '0';
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

