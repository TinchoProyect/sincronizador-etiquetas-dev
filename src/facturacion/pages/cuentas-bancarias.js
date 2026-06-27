const API_BASE_URL = 'http://localhost:3004/facturacion/cuentas-bancarias';
let currentAccountId = null;
let debounceTimer = null;
let debounceChequeTimer = null;
let clientesBunker = [];
let rawMovements = [];
let rawCheques = [];
let currentChequesEstado = 'EN_CARTERA';
let rawTotalCount = 0;
let filtroSentido = 'TODOS'; // 'TODOS', 'DEBITO', 'CREDITO'
let sortField = 'none'; // 'fecha', 'debito', 'credito', 'none'
let sortOrder = 'none'; // 'asc', 'desc', 'none'

// Formateador de moneda argentina
const currencyFormatter = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

// Formateador de fecha
function formatFecha(fechaStr) {
    if (!fechaStr) return '';
    const date = new Date(fechaStr);
    if (isNaN(date.getTime())) return fechaStr;
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
}

// Cargar datos al iniciar
document.addEventListener('DOMContentLoaded', () => {
    inicializarDashboard();
    configurarDragAndDrop();
    configurarFiltros();
    configurarSidebarToggle();
    inicializarResizableColumns();
    cargarClientesBunker();
    configurarSolapas();
});

/**
 * Configura los eventos del sistema de solapas (Tabs)
 */
function configurarSolapas() {
    const tabMovimientos = document.getElementById('tab-movimientos');
    const tabCheques = document.getElementById('tab-cheques');
    
    const viewBancario = document.getElementById('bancario-view-container');
    const viewCheques = document.getElementById('cheques-view-container');
    
    const sidebarBancario = document.getElementById('sidebar-seccion-bancaria');
    const sidebarCheques = document.getElementById('sidebar-seccion-cheques');
    
    if (!tabMovimientos || !tabCheques) return;
    
    tabMovimientos.addEventListener('click', () => {
        tabMovimientos.classList.add('active');
        tabCheques.classList.remove('active');
        
        viewBancario.style.display = 'flex';
        viewCheques.style.display = 'none';
        
        sidebarBancario.style.display = 'flex';
        sidebarCheques.style.display = 'none';
    });
    
    tabCheques.addEventListener('click', () => {
        tabCheques.classList.add('active');
        tabMovimientos.classList.remove('active');
        
        viewBancario.style.display = 'none';
        viewCheques.style.display = 'flex';
        
        sidebarBancario.style.display = 'none';
        sidebarCheques.style.display = 'flex';
        
        cargarCheques();
    });

    // Configurar Sub-Solapas de Cheques
    const subTabCartera = document.getElementById('sub-tab-cartera');
    const subTabEndosados = document.getElementById('sub-tab-endosados');
    const subTabHistorico = document.getElementById('sub-tab-historico');
    const subTabs = [subTabCartera, subTabEndosados, subTabHistorico];

    subTabs.forEach(tab => {
        if (!tab) return;
        tab.addEventListener('click', () => {
            subTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentChequesEstado = tab.getAttribute('data-estado');
            cargarCheques();
        });
    });
}


/**
 * Inicializa el panel cargando las cuentas de base de datos
 */
async function inicializarDashboard() {
    try {
        mostrarLoading(true, 'Cargando datos de la cuenta...');
        const response = await fetch(API_BASE_URL);
        if (!response.ok) {
            throw new Error(`Error ${response.status} al obtener cuentas`);
        }
        
        const result = await response.json();
        
        if (result.success && result.data && result.data.length > 0) {
            const account = result.data[0]; // Tomamos la cuenta Galicia por defecto
            currentAccountId = account.id;
            
            // Rellenar ficha detallada de cuenta
            document.getElementById('card-banco-nombre').textContent = account.banco;
            document.getElementById('card-titular-nombre').textContent = `Titular: ${account.titular}`;
            document.getElementById('card-tipo-cuenta').textContent = account.tipo_cuenta;
            document.getElementById('card-nro-cuenta').textContent = formatNroCuenta(account.numero_cuenta);
            document.getElementById('card-cbu').textContent = account.cbu;
            document.getElementById('card-alias').textContent = account.alias;
            
            // Actualizar Saldo Consolidado
            actualizarSaldoUI(account.saldo, account.actualizado_en);
            
            // Cargar movimientos
            await cargarMovimientos();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'No se encontró ninguna cuenta bancaria inicializada.'
            });
        }
    } catch (error) {
        console.error('Error al inicializar dashboard:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error de Conexión',
            text: 'No se pudo establecer conexión con el backend de facturación.'
        });
    } finally {
        mostrarLoading(false);
    }
}

/**
 * Formatea el número de cuenta para visualización prolija
 */
function formatNroCuenta(nro) {
    if (!nro) return '';
    // Formatear 400784413734 a 4007844-1 373-4 si es Galicia
    const s = String(nro);
    if (s.length === 12) {
        return `${s.substring(0, 7)}-${s.substring(7, 8)} ${s.substring(8, 11)}-${s.substring(11)}`;
    }
    return nro;
}

/**
 * Actualiza el bloque de saldo en la UI
 */
function actualizarSaldoUI(saldo, actualizadoEn) {
    const balanceElem = document.getElementById('balance-amount');
    balanceElem.textContent = currencyFormatter.format(saldo);
    
    const dateText = actualizadoEn 
        ? `Actualizado: ${new Date(actualizadoEn).toLocaleString('es-AR')}`
        : 'Actualizado: --/--/---- --:--';
    document.getElementById('balance-updated-at').textContent = dateText;
}

/**
 * Obtiene y renderiza los movimientos de la cuenta según filtros aplicados
 */
async function cargarMovimientos() {
    if (!currentAccountId) return;
    
    try {
        const busqueda = document.getElementById('filtro-busqueda').value;
        const tipo = document.getElementById('filtro-tipo').value;
        
        const params = new URLSearchParams();
        if (busqueda) params.append('busqueda', busqueda);
        if (tipo) params.append('tipo', tipo);
        
        const url = `${API_BASE_URL}/${currentAccountId}/movimientos?${params.toString()}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Error ${response.status} al cargar movimientos`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            rawMovements = result.data;
            rawTotalCount = result.totalCount;
            aplicarFiltrosYRenderizar();
        }
    } catch (error) {
        console.error('Error cargando movimientos:', error);
    }
}

/**
 * Aplica los filtros de sentido en el cliente y renderiza los datos
 */
function aplicarFiltrosYRenderizar() {
    let movimientosFiltrados = [...rawMovements];
    
    // 1. Filtrar por Sentido Financiero
    if (filtroSentido === 'DEBITO') {
        movimientosFiltrados = movimientosFiltrados.filter(m => parseFloat(m.debito) > 0);
    } else if (filtroSentido === 'CREDITO') {
        movimientosFiltrados = movimientosFiltrados.filter(m => parseFloat(m.credito) > 0);
    }
    
    // 2. Filtrar por Monto Específico
    const filtroMontoStr = document.getElementById('filtro-monto')?.value.trim();
    if (filtroMontoStr) {
        const targetMonto = parseFloat(filtroMontoStr);
        if (!isNaN(targetMonto)) {
            movimientosFiltrados = movimientosFiltrados.filter(m => {
                const debitoVal = parseFloat(m.debito) || 0;
                const creditoVal = parseFloat(m.credito) || 0;
                return Math.abs(debitoVal - targetMonto) < 0.01 || Math.abs(creditoVal - targetMonto) < 0.01;
            });
        }
    }
    
    // 3. Filtrar por Cliente
    const filtroCliente = document.getElementById('filtro-cliente')?.value.toLowerCase().trim();
    if (filtroCliente) {
        movimientosFiltrados = movimientosFiltrados.filter(m => {
            const razonSocial = (m.cliente_razon_social || '').toLowerCase();
            const sugRazonSocial = (m.sugerencia_cliente?.razon_social || '').toLowerCase();
            const cuitExtraido = (m.cuit_extraido || '').replace(/\D/g, '');
            const sugCuit = (m.sugerencia_cliente?.cuit || '').replace(/\D/g, '');
            const searchDigits = filtroCliente.replace(/\D/g, '');
            
            // Si el término de búsqueda parece un CUIT (dígitos), buscar en CUITs
            if (searchDigits && /^\d+$/.test(filtroCliente.replace(/[-\s]/g, ''))) {
                const searchDigitsClean = filtroCliente.replace(/[-\s]/g, '');
                return cuitExtraido.includes(searchDigitsClean) || sugCuit.includes(searchDigitsClean);
            }
            
            // De lo contrario, buscar por texto
            return razonSocial.includes(filtroCliente) || 
                   sugRazonSocial.includes(filtroCliente) ||
                   cuitExtraido.includes(filtroCliente) ||
                   sugCuit.includes(filtroCliente);
        });
    }
    
    // 4. Aplicar Ordenamiento Dinámico
    if (sortField && sortField !== 'none' && sortOrder && sortOrder !== 'none') {
        movimientosFiltrados.sort((a, b) => {
            let valA, valB;
            if (sortField === 'fecha') {
                valA = new Date(a.fecha_movimiento).getTime();
                valB = new Date(b.fecha_movimiento).getTime();
            } else if (sortField === 'debito') {
                valA = parseFloat(a.debito) || 0;
                valB = parseFloat(b.debito) || 0;
            } else if (sortField === 'credito') {
                valA = parseFloat(a.credito) || 0;
                valB = parseFloat(b.credito) || 0;
            }
            
            if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
            // Fallback estable por ID descendiente (orden cronológico por defecto en base de datos)
            return b.id - a.id;
        });
    }
    
    renderMovimientos(movimientosFiltrados, rawTotalCount);
}

/**
 * Renderiza la grilla de movimientos bancarios
 */
function renderMovimientos(movimientos, totalCount) {
    const tbody = document.getElementById('movements-tbody');
    const emptyState = document.getElementById('empty-state');
    const countElem = document.getElementById('movements-count');
    
    tbody.innerHTML = '';
    
    // Check if filters are active
    const busqueda = document.getElementById('filtro-busqueda').value;
    const tipo = document.getElementById('filtro-tipo').value;
    const tieneFiltros = (busqueda && busqueda.trim() !== '') || (tipo && tipo !== 'TODOS') || (filtroSentido !== 'TODOS');
    
    const total = typeof totalCount === 'number' ? totalCount : movimientos.length;
    
    if (tieneFiltros) {
        countElem.textContent = `Mostrando ${movimientos.length} de ${total} registro${total === 1 ? '' : 's'}`;
    } else {
        countElem.textContent = `${total} registro${total === 1 ? '' : 's'}`;
    }
    
    if (movimientos.length === 0) {
        emptyState.style.display = 'flex';
        return;
    }
    
    emptyState.style.display = 'none';
    
    movimientos.forEach(mov => {
        const tr = document.createElement('tr');
        
        // Formatear columnas
        const fechaStr = formatFecha(mov.fecha_movimiento);
        
        // Badge de tipo
        let badgeClass = 'badge-otros';
        if (mov.tipo_operacion === 'Transferencia') badgeClass = 'badge-transferencia';
        else if (mov.tipo_operacion === 'Depósito') badgeClass = 'badge-deposito';
        else if (mov.tipo_operacion === 'Impuestos') badgeClass = 'badge-impuestos';
        else if (mov.tipo_operacion === 'Gasto Comisión') badgeClass = 'badge-comision';
        else if (mov.tipo_operacion === 'Pago Cliente') badgeClass = 'badge-deposito';
        else if (mov.tipo_operacion === 'Pago Proveedor') badgeClass = 'badge-transferencia';
        else if (mov.tipo_operacion === 'Rendimiento') badgeClass = 'badge-transferencia';
        
        const badgeHtml = `<span class="badge ${badgeClass}">${getIconoTipo(mov.tipo_operacion)} ${mov.tipo_operacion}</span>`;
        
        // Badge de IA
        let iaBadgeClass = 'ia-auto';
        let iaBadgeText = 'AUTO';
        if (mov.estado_clasificacion === 'IA_COMPLETO') {
            iaBadgeClass = 'ia-complete';
            iaBadgeText = 'IA OK';
        } else if (mov.estado_clasificacion === 'IA_DUDOSO') {
            iaBadgeClass = 'ia-dudoso';
            iaBadgeText = 'IA ?';
        }
        const iaBadgeHtml = `<span class="ia-status-badge ${iaBadgeClass}" title="Clasificación IA: ${mov.estado_clasificacion}">${iaBadgeText}</span>`;
        
        // Columna de vinculación de cliente (Human-in-the-Loop)
        let clientHtml = '';
        if (mov.cliente_id) {
            // Ya está vinculado - Mostrar badge verde y botón rojo de desvinculación
            clientHtml = `
                <div style="display: inline-flex; align-items: center; gap: 8px;">
                    <span class="btn-link-action linked" title="Cliente vinculado"><i class="fa-solid fa-circle-check"></i> ${mov.cliente_razon_social}</span>
                    <button class="btn-link-action" onclick="desvincularClienteConfirmado(${mov.id}, '${mov.cliente_razon_social}')" title="Desvincular Movimiento" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 5px 8px;"><i class="fa-solid fa-unlink"></i> Desvincular</button>
                </div>
            `;
        } else if (mov.sugerencia_cliente) {
            // Sugerencia disponible
            const sug = mov.sugerencia_cliente;
            const sugClass = sug.tipo === 'cuit' ? 'sug-cuit' : 'sug-nombre';
            const icon = sug.tipo === 'cuit' ? 'fa-magic' : 'fa-lightbulb';
            clientHtml = `
                <button class="btn-link-action sug-badge ${sugClass}" onclick="vincularClienteConfirmado(${mov.id}, ${sug.id}, '${sug.razon_social}')" title="Haga clic para validar y vincular">
                    <i class="fa-solid ${icon}"></i> Sugerido: ${sug.razon_social}
                </button>
                <button class="btn-link-action" onclick="abrirBuscadorClientes(${mov.id})" title="Buscar otro cliente"><i class="fa-solid fa-search"></i></button>
            `;
        } else {
            // Sin vinculación ni sugerencia
            clientHtml = `<button class="btn-link-action" onclick="abrirBuscadorClientes(${mov.id})"><i class="fa-solid fa-link"></i> Vincular Cliente</button>`;
        }

        // Importes
        const debitoVal = parseFloat(mov.debito);
        const creditoVal = parseFloat(mov.credito);
        
        const debitoHtml = debitoVal > 0 
            ? `<span class="debit-value">- ${currencyFormatter.format(debitoVal)}</span>`
            : '';
            
        const creditoHtml = creditoVal > 0 
            ? `<span class="credit-value">+ ${currencyFormatter.format(creditoVal)}</span>`
            : '';
            
        const refHtml = mov.referencia 
            ? `<span style="font-family: monospace; font-size: 13px;">${mov.referencia}</span>`
            : '<span style="color: var(--text-muted); opacity: 0.5;">-</span>';
            
        const conceptoLimpio = mov.concepto.replace(/\r?\n/g, ' ');
        tr.innerHTML = `
            <td style="white-space: nowrap; font-weight: 500;">${fechaStr}</td>
            <td style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${mov.concepto}">${conceptoLimpio}</td>
            <td>${badgeHtml}${iaBadgeHtml}</td>
            <td style="text-align: right;">${debitoHtml}</td>
            <td style="text-align: right;">${creditoHtml}</td>
            <td>${refHtml}</td>
            <td>${clientHtml}</td>
            <td style="text-align: right;" class="balance-value">${currencyFormatter.format(mov.saldo_resultante)}</td>
        `;
        
        tbody.appendChild(tr);
    });
}

function getIconoTipo(tipo) {
    switch (tipo) {
        case 'Transferencia': return '<i class="fa-solid fa-arrow-right-arrow-left"></i>';
        case 'Depósito': return '<i class="fa-solid fa-money-bill-trend-up"></i>';
        case 'Impuestos': return '<i class="fa-solid fa-percent"></i>';
        case 'Gasto Comisión': return '<i class="fa-solid fa-hand-holding-dollar"></i>';
        default: return '<i class="fa-solid fa-circle-question"></i>';
    }
}

/**
 * Configura los eventos del componente Drag & Drop
 */
function configurarDragAndDrop() {
    const zone = document.getElementById('drag-drop-zone');
    const fileInput = document.getElementById('file-input');
    
    // Al hacer clic, simular clic en input file
    zone.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            subirArchivo(e.target.files[0]);
        }
    });
    
    // Eventos drag
    ['dragenter', 'dragover'].forEach(eventName => {
        zone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.add('dragover');
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        zone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.remove('dragover');
        }, false);
    });
    
    zone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            subirArchivo(files[0]);
        }
    }, false);
}

/**
 * Sube el archivo Excel al backend
 */
async function subirArchivo(file) {
    if (!currentAccountId) {
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No hay ninguna cuenta bancaria activa seleccionada.'
        });
        return;
    }
    
    // Validar extensión
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension !== 'xlsx' && extension !== 'xls') {
        Swal.fire({
            icon: 'error',
            title: 'Formato Inválido',
            text: 'Únicamente se soportan archivos Excel (.xlsx, .xls).'
        });
        return;
    }
    
    const formData = new FormData();
    formData.append('archivo', file);
    
    try {
        Swal.fire({
            title: 'Procesando extracto',
            html: '<p style="margin-bottom: 15px;">Analizando estructura y clasificando movimientos mediante Inteligencia Artificial (Gemini). Por favor, espere...</p><i class="fa-solid fa-circle-notch fa-spin fa-3x" style="color: #8b5cf6;"></i>',
            allowOutsideClick: false,
            allowEscapeKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
        
        const response = await fetch(`${API_BASE_URL}/${currentAccountId}/ingesta`, {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        Swal.close();
        
        if (result.success) {
            // Mostrar éxito interactivo
            Swal.fire({
                icon: 'success',
                title: 'Ingesta Procesada',
                html: `
                    <div style="text-align: left; padding: 10px;">
                        <p style="margin-bottom: 8px;"><strong>Detalle de la importación:</strong></p>
                        <ul>
                            <li>Total leídos: <strong>${result.data.total}</strong></li>
                            <li style="color: var(--success);">Nuevos insertados: <strong>${result.data.insertados}</strong></li>
                            <li style="color: var(--warning);">Duplicados omitidos: <strong>${result.data.duplicados}</strong></li>
                        </ul>
                    </div>
                `,
                confirmButtonColor: '#8b5cf6'
            });
            
            // Recargar datos para refrescar grilla e inicializar saldo consolidado
            inicializarDashboard();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error en Ingesta',
                text: result.message || 'Ocurrió un error al procesar el extracto.'
            });
        }
    } catch (error) {
        console.error('Error al subir archivo:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error del Servidor',
            text: 'Hubo una falla al conectar con el servidor para procesar el archivo.'
        });
    } finally {
        // Limpiar input file para permitir volver a cargar el mismo archivo
        document.getElementById('file-input').value = '';
    }
}

/**
 * Configura los filtros de búsqueda y de sentido transaccional
 */
function configurarFiltros() {
    const busquedaInput = document.getElementById('filtro-busqueda');
    const tipoSelect = document.getElementById('filtro-tipo');
    const resetBtn = document.getElementById('btn-limpiar-filtros');
    const clienteInput = document.getElementById('filtro-cliente');
    const montoInput = document.getElementById('filtro-monto');
    
    busquedaInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            cargarMovimientos();
        }, 300);
    });
    
    tipoSelect.addEventListener('change', () => {
        cargarMovimientos();
    });
    
    if (clienteInput) {
        clienteInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                aplicarFiltrosYRenderizar();
            }, 300);
        });
    }
    
    if (montoInput) {
        montoInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                aplicarFiltrosYRenderizar();
            }, 300);
        });
    }
    
    resetBtn.addEventListener('click', () => {
        busquedaInput.value = '';
        tipoSelect.value = 'TODOS';
        if (clienteInput) clienteInput.value = '';
        if (montoInput) montoInput.value = '';
        actualizarSegmentedControlUI('TODOS');
        sortField = 'none';
        sortOrder = 'none';
        actualizarSortUI();
        cargarMovimientos();
    });

    // Eventos del Segmented Control
    const segmentButtons = document.querySelectorAll('#control-sentido .btn-segment');
    segmentButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const value = btn.getAttribute('data-value');
            actualizarSegmentedControlUI(value);
            aplicarFiltrosYRenderizar();
        });
    });

    // Eventos de click en las cabeceras de columna (Ordenamiento dinámico)
    const thFecha = document.getElementById('th-fecha');
    const thDebito = document.getElementById('th-debito');
    const thCredito = document.getElementById('th-credito');
    
    if (thFecha) {
        thFecha.addEventListener('click', (e) => {
            if (e.target.classList.contains('resizer')) return;
            toggleSort('fecha');
        });
    }
    
    if (thDebito) {
        thDebito.addEventListener('click', (e) => {
            if (e.target.classList.contains('resizer')) return;
            toggleSort('debito');
        });
    }
    
    if (thCredito) {
        thCredito.addEventListener('click', (e) => {
            if (e.target.classList.contains('resizer')) return;
            toggleSort('credito');
        });
    }

    // Filtros de Cheques
    const chequeBusquedaInput = document.getElementById('filtro-cheque-busqueda');
    const chequeEstadoSelect = document.getElementById('filtro-cheque-estado');
    const chequeResetBtn = document.getElementById('btn-limpiar-filtros-cheques');
    
    if (chequeBusquedaInput) {
        chequeBusquedaInput.addEventListener('input', () => {
            clearTimeout(debounceChequeTimer);
            debounceChequeTimer = setTimeout(() => {
                aplicarFiltrosYRenderizarCheques();
            }, 300);
        });
    }
    
    if (chequeEstadoSelect) {
        chequeEstadoSelect.addEventListener('change', () => {
            aplicarFiltrosYRenderizarCheques();
        });
    }
    
    if (chequeResetBtn) {
        chequeResetBtn.addEventListener('click', () => {
            chequeBusquedaInput.value = '';
            chequeEstadoSelect.value = 'TODOS';
            aplicarFiltrosYRenderizarCheques();
        });
    }
}

/**
 * Actualiza visualmente el estado activo del control segmentado y cabeceras
 */
function actualizarSegmentedControlUI(value) {
    filtroSentido = value;
    
    // Segmented buttons
    const buttons = document.querySelectorAll('#control-sentido .btn-segment');
    buttons.forEach(btn => {
        if (btn.getAttribute('data-value') === value) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

/**
 * Alterna el estado de ordenamiento para un campo dado
 */
function toggleSort(field) {
    if (sortField !== field) {
        sortField = field;
        sortOrder = 'asc';
    } else {
        if (sortOrder === 'asc') {
            sortOrder = 'desc';
        } else if (sortOrder === 'desc') {
            sortOrder = 'none';
            sortField = 'none';
        } else {
            sortOrder = 'asc';
        }
    }
    
    actualizarSortUI();
    aplicarFiltrosYRenderizar();
}

/**
 * Actualiza visualmente los indicadores de ordenamiento en los encabezados
 */
function actualizarSortUI() {
    const headers = {
        'fecha': document.getElementById('th-fecha'),
        'debito': document.getElementById('th-debito'),
        'credito': document.getElementById('th-credito')
    };
    
    Object.keys(headers).forEach(field => {
        const th = headers[field];
        if (!th) return;
        
        const indicator = th.querySelector('.sort-indicator');
        if (!indicator) return;
        
        if (sortField === field && sortOrder !== 'none') {
            th.classList.add('sorted');
            indicator.style.opacity = '1';
            if (sortOrder === 'asc') {
                indicator.innerHTML = '<i class="fa-solid fa-sort-up"></i>';
            } else {
                indicator.innerHTML = '<i class="fa-solid fa-sort-down"></i>';
            }
        } else {
            th.classList.remove('sorted');
            indicator.style.opacity = '0.3';
            indicator.innerHTML = '<i class="fa-solid fa-sort"></i>';
        }
    });
}

/**
 * Controla la visualización del overlay de carga
 */
function mostrarLoading(show, text = 'Procesando...') {
    const overlay = document.getElementById('loader-overlay');
    const textElem = document.getElementById('loader-text');
    
    if (show) {
        textElem.textContent = text;
        overlay.style.display = 'flex';
    } else {
        overlay.style.display = 'none';
    }
}

/**
 * Configura la acción para colapsar y expandir el panel lateral
 */
function configurarSidebarToggle() {
    const toggleBtn = document.getElementById('btn-toggle-sidebar');
    const container = document.querySelector('main.container');
    
    if (!toggleBtn || !container) return;
    
    // Sincronizar el estado inicial al cargar
    if (container.classList.contains('sidebar-collapsed')) {
        toggleBtn.innerHTML = '<i class="fa-solid fa-columns"></i> <span>Mostrar Panel Lateral</span>';
    } else {
        toggleBtn.innerHTML = '<i class="fa-solid fa-columns"></i> <span>Ocultar Panel Lateral</span>';
    }
    
    toggleBtn.addEventListener('click', () => {
        container.classList.toggle('sidebar-collapsed');
        
        if (container.classList.contains('sidebar-collapsed')) {
            toggleBtn.innerHTML = '<i class="fa-solid fa-columns"></i> <span>Mostrar Panel Lateral</span>';
        } else {
            toggleBtn.innerHTML = '<i class="fa-solid fa-columns"></i> <span>Ocultar Panel Lateral</span>';
        }
    });
}

/**
 * Inicializa el redimensionamiento manual de las columnas de la tabla de movimientos
 * con lógica tipo Excel (anclaje izquierdo y absorción de la columna de la derecha)
 */
function inicializarResizableColumns() {
    const table = document.getElementById('movements-table');
    if (!table) return;

    const ths = table.querySelectorAll('th');
    
    // Función para calcular y aplicar el ancho total de la tabla en base a sus columnas
    const ajustarAnchoTabla = () => {
        let totalWidth = 0;
        ths.forEach(th => {
            const wStr = th.style.width;
            let w = th.offsetWidth;
            if (wStr && wStr.endsWith('px')) {
                w = parseFloat(wStr);
            }
            totalWidth += w;
        });
        table.style.width = `${totalWidth}px`;
    };

    // 1. Cargar anchos desde localStorage si existen o inicializar todos en píxeles
    const storedWidths = localStorage.getItem('lamda_banco_column_widths');
    if (storedWidths) {
        try {
            const widths = JSON.parse(storedWidths);
            ths.forEach((th, idx) => {
                if (widths[idx]) {
                    th.style.width = widths[idx];
                }
            });
            ajustarAnchoTabla();
        } catch (e) {
            console.error('Error al parsear anchos guardados:', e);
        }
    } else {
        // Inicializar todas las columnas con su ancho offsetWidth en píxeles
        // para garantizar que la grilla tenga anchos fijos y se comporte de forma predecible
        ths.forEach((th) => {
            th.style.width = `${th.offsetWidth}px`;
        });
        ajustarAnchoTabla();
    }

    // 2. Configurar eventos de mouse para cada resizer
    ths.forEach((th, idx) => {
        const resizer = th.querySelector('.resizer');
        if (!resizer) return;

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = th.offsetWidth;
            
            resizer.classList.add('resizing');
            
            const onMouseMove = (moveEvent) => {
                const dX = moveEvent.clientX - startX;
                // Solo modificamos el ancho de la columna actual, previniendo que encoja por debajo de 60px
                th.style.width = `${Math.max(60, startWidth + dX)}px`;
                // Ajustar dinámicamente el ancho de la tabla para acompañar el arrastre
                ajustarAnchoTabla();
            };
            
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                resizer.classList.remove('resizing');
                
                // Guardar los nuevos anchos en localStorage
                const currentWidths = Array.from(ths).map(t => `${t.offsetWidth}px`);
                localStorage.setItem('lamda_banco_column_widths', JSON.stringify(currentWidths));
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}

/**
 * Obtiene y cachea el listado completo de clientes en Búnker
 */
async function cargarClientesBunker() {
    try {
        const response = await fetch('/facturacion/cuentas-bancarias/bunker-clientes');
        if (!response.ok) {
            throw new Error(`Error ${response.status} al cargar clientes`);
        }
        const result = await response.json();
        if (result.success) {
            clientesBunker = result.data || [];
            console.log(`✅ [BANCARIO-FRONT] Se cargaron ${clientesBunker.length} clientes de Búnker.`);
        }
    } catch (e) {
        console.error('❌ [BANCARIO-FRONT] Error cargando clientes de Búnker:', e);
    }
}

/**
 * Muestra el diálogo modal para confirmar la vinculación sugerida.
 * Si el cliente posee un CUIT compartido con otros perfiles, le permite al usuario
 * seleccionar manualmente a cuál de las cuentas corrientes asociar el movimiento.
 */
async function vincularClienteConfirmado(movimientoId, clienteId, razonSocial) {
    if (clientesBunker.length === 0) {
        await cargarClientesBunker();
    }

    const clientObj = clientesBunker.find(c => c.id == clienteId);
    const cleanCuit = (clientObj && clientObj.cuit) ? String(clientObj.cuit).replace(/\D/g, '') : null;
    const duplicateCuitClients = cleanCuit 
        ? clientesBunker.filter(c => c.cuit && String(c.cuit).replace(/\D/g, '') === cleanCuit) 
        : [];

    if (duplicateCuitClients.length > 1) {
        // Generar opciones del selector para CUITs compartidos
        let optionsHtml = '';
        duplicateCuitClients.forEach(c => {
            const bunkerCode = c.codigo_bunker || 'Sin Cód.';
            const oldCode = c.lomas_soft_id || 'Sin Cód. Viejo';
            const name = c.cliente_nombre ? `${c.razon_social} (${c.cliente_nombre})` : c.razon_social;
            const selectedAttr = c.id == clienteId ? 'selected' : '';
            optionsHtml += `<option value="${c.id}" ${selectedAttr}>${name} [Búnker: ${bunkerCode}] [Histórico: ${oldCode}]</option>`;
        });

        const { value: selectedId } = await Swal.fire({
            title: 'CUIT Duplicado - Seleccionar Cuenta',
            html: `
                <p style="text-align: left; margin-bottom: 12px; font-size: 14px; color: #cbd5e1;">
                    El CUIT <strong>${clientObj.cuit}</strong> está registrado para múltiples clientes. Por favor, seleccione la cuenta corriente de destino:
                </p>
                <div style="text-align: left;">
                    <select id="swal-cc-select" class="swal2-select" style="width: 100%; background: #1e293b; color: #f8fafc; border: 1px solid #475569; border-radius: 8px; padding: 10px; height: 45px; display: block; box-sizing: border-box;">
                        ${optionsHtml}
                    </select>
                </div>
            `,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#8b5cf6',
            cancelButtonColor: '#475569',
            confirmButtonText: 'Sí, Vincular',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                return document.getElementById('swal-cc-select').value;
            }
        });

        if (selectedId) {
            ejecutarVinculacion(movimientoId, parseInt(selectedId, 10));
        }
    } else {
        // Flujo tradicional de confirmación simple
        const result = await Swal.fire({
            title: '¿Vincular Cliente?',
            html: `<p>¿Desea vincular formalmente este movimiento con el cliente:</p><p style="margin-top: 8px; font-weight: 700; color: #a78bfa; font-size: 16px;">${razonSocial}</p>`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#8b5cf6',
            cancelButtonColor: '#475569',
            confirmButtonText: 'Sí, Vincular',
            cancelButtonText: 'Cancelar'
        });
        
        if (result.isConfirmed) {
            ejecutarVinculacion(movimientoId, clienteId);
        }
    }
}

/**
 * Muestra el diálogo modal para desvincular un cliente previamente asociado
 */
async function desvincularClienteConfirmado(movimientoId, razonSocial) {
    const result = await Swal.fire({
        title: '¿Desvincular Cliente?',
        html: `<p>¿Desea remover la vinculación con el cliente:</p><p style="margin-top: 8px; font-weight: 700; color: #ef4444; font-size: 16px;">${razonSocial}</p>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#475569',
        confirmButtonText: 'Sí, Desvincular',
        cancelButtonText: 'Cancelar'
    });
    
    if (result.isConfirmed) {
        ejecutarVinculacion(movimientoId, null);
    }
}

async function abrirBuscadorClientes(movimientoId) {
    if (clientesBunker.length === 0) {
        mostrarLoading(true, 'Cargando listado de clientes...');
        await cargarClientesBunker();
        mostrarLoading(false);
    }
    
    if (clientesBunker.length === 0) {
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No se pudo obtener el catálogo de clientes de Búnker.'
        });
        return;
    }
    
    let filteredClients = [...clientesBunker];

    const { value: clienteId } = await Swal.fire({
        title: 'Vincular Cliente Manualmente',
        html: `
            <div style="text-align: left; margin-bottom: 10px;">
                <label for="swal-search-input" style="font-weight: 600; font-size: 13px; color: #94a3b8; text-transform: uppercase;">Buscar por Razón Social / Nombre Comercial / Cód. Búnker / Cód. Viejo</label>
                <input type="text" id="swal-search-input" class="swal2-input" placeholder="Ingrese nombre, código CB-0000 o código viejo..." style="width: 100%; margin: 8px 0 15px 0; background: #0f172a; color: #f8fafc; border: 1px solid #475569; border-radius: 8px; padding: 10px; box-sizing: border-box;">
                
                <label for="swal-client-select" style="font-weight: 600; font-size: 13px; color: #94a3b8; text-transform: uppercase;">Seleccione el Cliente</label>
                <select id="swal-client-select" class="swal2-select" style="width: 100%; margin: 8px 0 0 0; background: #1e293b; color: #f8fafc; border: 1px solid #475569; border-radius: 8px; padding: 10px; height: 45px; display: block; box-sizing: border-box;">
                </select>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonColor: '#8b5cf6',
        cancelButtonColor: '#475569',
        confirmButtonText: 'Vincular',
        cancelButtonText: 'Cancelar',
        didOpen: () => {
            const searchInput = document.getElementById('swal-search-input');
            const clientSelect = document.getElementById('swal-client-select');
            
            function populateSelect(list) {
                clientSelect.innerHTML = '';
                if (list.length === 0) {
                    const opt = document.createElement('option');
                    opt.value = '';
                    opt.textContent = 'No se encontraron clientes';
                    clientSelect.appendChild(opt);
                    return;
                }
                list.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    
                    const cbCode = c.codigo_bunker || 'Sin Cód.';
                    const oldCode = c.lomas_soft_id || 'Sin Cód. Viejo';
                    const cuit = c.cuit ? `CUIT: ${c.cuit}` : 'Sin CUIT';
                    const name = c.cliente_nombre ? `${c.razon_social} (${c.cliente_nombre})` : c.razon_social;
                    
                    opt.textContent = `${name} [Búnker: ${cbCode}] [Histórico: ${oldCode}] - ${cuit}`;
                    clientSelect.appendChild(opt);
                });
            }
            
            populateSelect(filteredClients);
            searchInput.focus();
            
            searchInput.addEventListener('input', () => {
                const term = searchInput.value.toLowerCase().trim();
                if (!term) {
                    populateSelect(clientesBunker);
                    return;
                }
                
                const filtered = clientesBunker.filter(c => {
                    const rs = String(c.razon_social || '').toLowerCase();
                    const cn = String(c.cliente_nombre || '').toLowerCase();
                    const oldId = String(c.lomas_soft_id || '').toLowerCase();
                    const bunkerId = String(c.codigo_bunker || '').toLowerCase();
                    const cuitStr = String(c.cuit || '').toLowerCase();
                    
                    return rs.includes(term) || 
                           cn.includes(term) || 
                           oldId.includes(term) || 
                           bunkerId.includes(term) ||
                           cuitStr.includes(term);
                });
                
                populateSelect(filtered);
            });
        },
        preConfirm: () => {
            const selectVal = document.getElementById('swal-client-select').value;
            if (!selectVal) {
                Swal.showValidationMessage('Debe seleccionar un cliente.');
                return false;
            }
            return selectVal;
        }
    });
    
    if (clienteId) {
        ejecutarVinculacion(movimientoId, parseInt(clienteId, 10));
    }
}

/**
 * Ejecuta la llamada API de vinculación/desvinculación y actualiza la grilla
 */
async function ejecutarVinculacion(movimientoId, clienteId) {
    try {
        mostrarLoading(true, clienteId ? 'Guardando vinculación...' : 'Removiendo vinculación...');
        const response = await fetch(`${API_BASE_URL}/movimientos/${movimientoId}/vincular-cliente`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ clienteId })
        });
        
        const result = await response.json();
        if (result.success) {
            Swal.fire({
                icon: 'success',
                title: clienteId ? 'Vinculación Exitosa' : 'Desvinculación Exitosa',
                text: result.message,
                confirmButtonColor: '#8b5cf6',
                timer: 1500
            });
            // Recargar movimientos de forma dinámica
            await cargarMovimientos();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error de Servidor',
                text: result.error || 'Ocurrió un fallo al actualizar el movimiento.'
            });
        }
    } catch (e) {
        console.error('❌ [BANCARIO-FRONT] Error al vincular/desvincular cliente:', e);
        Swal.fire({
            icon: 'error',
            title: 'Error de Red',
            text: 'No se pudo establecer conexión con el servidor.'
        });
    } finally {
        mostrarLoading(false);
    }
}

// Exponer funciones al contexto global de window para eventos inline HTML (onclick)
window.vincularClienteConfirmado = vincularClienteConfirmado;
window.desvincularClienteConfirmado = desvincularClienteConfirmado;
window.abrirBuscadorClientes = abrirBuscadorClientes;

/**
 * Obtiene el listado de cheques desde el backend
 */
async function cargarCheques() {
    try {
        mostrarLoading(true, 'Sincronizando cartera con Supabase...');
        const response = await fetch(`${API_BASE_URL}/cheques?estado=${currentChequesEstado}`);
        if (!response.ok) {
            throw new Error(`Error ${response.status} al cargar cheques`);
        }
        
        const result = await response.json();
        if (result.success) {
            rawCheques = result.data || [];
            aplicarFiltrosYRenderizarCheques();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error al Sincronizar',
                text: result.error || 'No se pudieron recuperar los cheques.'
            });
        }
    } catch (error) {
        console.error('Error cargando cheques:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error de Red',
            text: 'No se pudo conectar con el backend para sincronizar cheques.'
        });
    } finally {
        mostrarLoading(false);
    }
}

/**
 * Filtra los cheques en base a la búsqueda y el estado, y actualiza la UI
 */
function aplicarFiltrosYRenderizarCheques() {
    const busqueda = document.getElementById('filtro-cheque-busqueda').value.toLowerCase().trim();
    const estado = document.getElementById('filtro-cheque-estado').value;
    
    let filtered = [...rawCheques];
    
    // 1. Filtrar por búsqueda
    if (busqueda) {
        filtered = filtered.filter(ch => {
            const num = String(ch.numero_cheque || '').toLowerCase();
            const banco = String(ch.banco_emisor || '').toLowerCase();
            const librador = String(ch.librador_razon_social || '').toLowerCase();
            return num.includes(busqueda) || banco.includes(busqueda) || librador.includes(busqueda);
        });
    }
    
    // 2. Filtrar por estado de vinculación
    if (estado === 'DISPONIBLES') {
        filtered = filtered.filter(ch => !ch.cliente_id);
    } else if (estado === 'VINCULADOS') {
        filtered = filtered.filter(ch => ch.cliente_id);
    }
    
    // 3. Calcular sumas para el Sidebar de Cheques
    const totalAmount = rawCheques.reduce((sum, ch) => sum + (parseFloat(ch.importe) || 0), 0);
    const totalCount = rawCheques.length;
    
    const labelTotal = currentChequesEstado === 'ENDOSADO' ? 'Total Endosado' : (currentChequesEstado === 'TODOS' ? 'Total Histórico' : 'Total en Cartera');
    const labelCount = currentChequesEstado === 'ENDOSADO' ? 'endosados' : (currentChequesEstado === 'TODOS' ? 'totales' : 'activos');
    
    const sidebarTitle = document.querySelector('#sidebar-seccion-cheques .balance-card h4');
    if (sidebarTitle) sidebarTitle.textContent = labelTotal;
    
    document.getElementById('cheques-total-amount').textContent = currencyFormatter.format(totalAmount);
    document.getElementById('cheques-total-count').textContent = `${totalCount} cheque${totalCount === 1 ? '' : 's'} ${labelCount}`;
    
    renderCheques(filtered);
}

/**
 * Renderiza la grilla de cheques en el DOM
 */
function renderCheques(cheques) {
    const tbody = document.getElementById('cheques-tbody');
    const emptyState = document.getElementById('empty-state-cheques');
    const countElem = document.getElementById('cheques-count');
    
    tbody.innerHTML = '';
    
    const countText = `${cheques.length} cheque${cheques.length === 1 ? '' : 's'} encontrado${cheques.length === 1 ? '' : 's'}`;
    countElem.textContent = countText;
    
    if (cheques.length === 0) {
        emptyState.style.display = 'flex';
        return;
    }
    
    emptyState.style.display = 'none';
    
    cheques.forEach(ch => {
        const tr = document.createElement('tr');
        
        // Coalescencia y fallbacks explícitos para registros históricos con valores nulos
        const bancoStr = ch.banco_emisor || "Histórico / No Registrado";
        const libradorStr = ch.librador_razon_social || "Librador Desconocido";
        const fechaPagoStr = ch.fecha_pago ? formatFecha(ch.fecha_pago) : "N/A (Histórico)";
        const importeStr = currencyFormatter.format(ch.importe);
        
        // Renderizar badge de estado
        let estadoHtml = '';
        const est = String(ch.estado_interno || '').toUpperCase();
        if (est === 'EN_CARTERA') {
            estadoHtml = `<span class="badge badge-estado-cartera">En Cartera</span>`;
        } else if (est === 'ENDOSADO') {
            estadoHtml = `<span class="badge badge-estado-endosado">Endosado</span>`;
        } else if (est === 'ACREDITADO') {
            estadoHtml = `<span class="badge badge-estado-acreditado">Acreditado</span>`;
        } else if (est === 'DEVUELTO') {
            estadoHtml = `<span class="badge badge-estado-devuelto">Devuelto</span>`;
        } else {
            estadoHtml = `<span class="badge badge-otros">${ch.estado_interno || 'N/A'}</span>`;
        }
        
        // Columna de destino / endosado
        let destinoHtml = '-';
        if (ch.proveedor_nombre_comercial) {
            destinoHtml = `<span class="badge badge-proveedor"><i class="fa-solid fa-truck-ramp-box"></i> ${ch.proveedor_nombre_comercial}</span>`;
        }
        
        let clientHtml = '';
        if (ch.cliente_id) {
            clientHtml = `
                <div style="display: inline-flex; align-items: center; gap: 8px;">
                    <span class="btn-link-action linked" title="Cliente vinculado"><i class="fa-solid fa-circle-check"></i> ${ch.cliente_razon_social}</span>
                    <button class="btn-link-action" onclick="desvincularChequeConfirmado('${ch.id}', '${ch.numero_cheque}', '${ch.cliente_razon_social}')" title="Desvincular Cheque" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 5px 8px;"><i class="fa-solid fa-unlink"></i> Desvincular</button>
                </div>
            `;
        } else if (ch.estado_interno === 'EN_CARTERA' || ch.estado_interno === 'ENDOSADO') {
            clientHtml = `<button class="btn-link-action" onclick="abrirBuscadorClientesParaCheque('${ch.id}', '${ch.numero_cheque}')"><i class="fa-solid fa-link"></i> Vincular Cliente</button>`;
        } else {
            clientHtml = `<span style="font-size: 0.85em; color: var(--text-muted); font-style: italic; padding-left: 10px;">No vinculable (${ch.estado_interno || 'N/A'})</span>`;
        }
        
        tr.innerHTML = `
            <td style="white-space: nowrap; font-weight: 500;">${fechaPagoStr}</td>
            <td style="font-family: monospace; font-weight: 600;">${ch.numero_cheque}</td>
            <td>${estadoHtml}</td>
            <td>${bancoStr}</td>
            <td style="text-align: right; font-weight: 600;" class="credit-value">${importeStr}</td>
            <td style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${libradorStr}">${libradorStr}</td>
            <td>${destinoHtml}</td>
            <td>${clientHtml}</td>
        `;
        
        tbody.appendChild(tr);
    });
}

/**
 * Abre el buscador de clientes para vincular un cheque
 */
async function abrirBuscadorClientesParaCheque(chequeId, numeroCheque) {
    if (clientesBunker.length === 0) {
        mostrarLoading(true, 'Cargando listado de clientes...');
        await cargarClientesBunker();
        mostrarLoading(false);
    }
    
    if (clientesBunker.length === 0) {
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No se pudo obtener el catálogo de clientes de Búnker.'
        });
        return;
    }
    
    let filteredClients = [...clientesBunker];

    const { value: clienteId } = await Swal.fire({
        title: 'Vincular Cheque a Cliente',
        html: `
            <div style="text-align: left; margin-bottom: 10px;">
                <p style="font-size: 13px; color: #94a3b8; margin-bottom: 15px;">Vinculando Cheque Nro: <strong>${numeroCheque}</strong></p>
                <label for="swal-search-input" style="font-weight: 600; font-size: 13px; color: #94a3b8; text-transform: uppercase;">Buscar por Razón Social / Nombre Comercial / Cód. Búnker</label>
                <input type="text" id="swal-search-input" class="swal2-input" placeholder="Ingrese nombre o código..." style="width: 100%; margin: 8px 0 15px 0; background: #0f172a; color: #f8fafc; border: 1px solid #475569; border-radius: 8px; padding: 10px; box-sizing: border-box;">
                
                <label for="swal-client-select" style="font-weight: 600; font-size: 13px; color: #94a3b8; text-transform: uppercase;">Seleccione el Cliente</label>
                <select id="swal-client-select" class="swal2-select" style="width: 100%; margin: 8px 0 0 0; background: #1e293b; color: #f8fafc; border: 1px solid #475569; border-radius: 8px; padding: 10px; height: 45px; display: block; box-sizing: border-box;">
                </select>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonColor: '#8b5cf6',
        cancelButtonColor: '#475569',
        confirmButtonText: 'Vincular',
        cancelButtonText: 'Cancelar',
        didOpen: () => {
            const searchInput = document.getElementById('swal-search-input');
            const clientSelect = document.getElementById('swal-client-select');
            
            function populateSelect(list) {
                clientSelect.innerHTML = '';
                if (list.length === 0) {
                    const opt = document.createElement('option');
                    opt.value = '';
                    opt.textContent = 'No se encontraron clientes';
                    clientSelect.appendChild(opt);
                    return;
                }
                list.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    
                    const cbCode = c.codigo_bunker || 'Sin Cód.';
                    const oldCode = c.lomas_soft_id || 'Sin Cód. Viejo';
                    const cuit = c.cuit ? `CUIT: ${c.cuit}` : 'Sin CUIT';
                    const name = c.cliente_nombre ? `${c.razon_social} (${c.cliente_nombre})` : c.razon_social;
                    
                    opt.textContent = `${name} [Búnker: ${cbCode}] [Histórico: ${oldCode}] - ${cuit}`;
                    clientSelect.appendChild(opt);
                });
            }
            
            populateSelect(filteredClients);
            searchInput.focus();
            
            searchInput.addEventListener('input', () => {
                const term = searchInput.value.toLowerCase().trim();
                if (!term) {
                    populateSelect(clientesBunker);
                    return;
                }
                
                const filtered = clientesBunker.filter(c => {
                    const rs = String(c.razon_social || '').toLowerCase();
                    const cn = String(c.cliente_nombre || '').toLowerCase();
                    const oldId = String(c.lomas_soft_id || '').toLowerCase();
                    const bunkerId = String(c.codigo_bunker || '').toLowerCase();
                    const cuitStr = String(c.cuit || '').toLowerCase();
                    
                    return rs.includes(term) || 
                           cn.includes(term) || 
                           oldId.includes(term) || 
                           bunkerId.includes(term) ||
                           cuitStr.includes(term);
                });
                
                populateSelect(filtered);
            });
        },
        preConfirm: () => {
            const selectVal = document.getElementById('swal-client-select').value;
            if (!selectVal) {
                Swal.showValidationMessage('Debe seleccionar un cliente.');
                return false;
            }
            return selectVal;
        }
    });
    
    if (clienteId) {
        vincularChequeConfirmado(chequeId, parseInt(clienteId, 10));
    }
}

/**
 * Realiza la llamada de vinculación de cheque en el backend
 */
async function vincularChequeConfirmado(chequeId, clienteId) {
    try {
        mostrarLoading(true, 'Guardando vinculación contable...');
        const response = await fetch(`${API_BASE_URL}/cheques/${chequeId}/vincular`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ clienteId })
        });
        
        const result = await response.json();
        if (result.success) {
            Swal.fire({
                icon: 'success',
                title: 'Vínculo Registrado',
                text: result.message,
                confirmButtonColor: '#8b5cf6',
                timer: 2000
            });
            await cargarCheques();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error de Servidor',
                text: result.error || 'Ocurrió un fallo al vincular el cheque.'
            });
        }
    } catch (e) {
        console.error('Error al vincular cheque:', e);
        Swal.fire({
            icon: 'error',
            title: 'Error de Conexión',
            text: 'No se pudo comunicar con el servidor.'
        });
    } finally {
        mostrarLoading(false);
    }
}

/**
 * Muestra el diálogo modal para desvincular un cheque
 */
async function desvincularChequeConfirmado(chequeId, numeroCheque, razonSocial) {
    const result = await Swal.fire({
        title: '¿Desvincular Cheque?',
        html: `<p>¿Desea remover la asignación del cheque Nro <strong>${numeroCheque}</strong> asociado al cliente:</p><p style="margin-top: 8px; font-weight: 700; color: #ef4444; font-size: 16px;">${razonSocial}</p><p style="margin-top: 8px; font-size: 12px; color: var(--text-muted);">Esta acción eliminará el crédito de la cuenta corriente del cliente.</p>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#475569',
        confirmButtonText: 'Sí, Desvincular',
        cancelButtonText: 'Cancelar'
    });
    
    if (result.isConfirmed) {
        try {
            mostrarLoading(true, 'Removiendo crédito contable...');
            const response = await fetch(`${API_BASE_URL}/cheques/${chequeId}/desvincular`, {
                method: 'PUT'
            });
            
            const result = await response.json();
            if (result.success) {
                Swal.fire({
                    icon: 'success',
                    title: 'Desvinculación Completa',
                    text: result.message,
                    confirmButtonColor: '#8b5cf6',
                    timer: 2000
                });
                await cargarCheques();
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Error al Desvincular',
                    text: result.error || 'Ocurrió un fallo al desasociar el cheque.'
                });
            }
        } catch (e) {
            console.error('Error al desvincular cheque:', e);
            Swal.fire({
                icon: 'error',
                title: 'Error de Red',
                text: 'No se pudo establecer conexión con el servidor.'
            });
        } finally {
            mostrarLoading(false);
        }
    }
}

// Exponer funciones al contexto global de window para eventos inline HTML (onclick)
window.vincularClienteConfirmado = vincularClienteConfirmado;
window.desvincularClienteConfirmado = desvincularClienteConfirmado;
window.abrirBuscadorClientes = abrirBuscadorClientes;
window.vincularChequeConfirmado = vincularChequeConfirmado;
window.desvincularChequeConfirmado = desvincularChequeConfirmado;
window.abrirBuscadorClientesParaCheque = abrirBuscadorClientesParaCheque;
