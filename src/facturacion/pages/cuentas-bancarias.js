const API_BASE_URL = 'http://localhost:3004/facturacion/cuentas-bancarias';
let currentAccountId = null;
let debounceTimer = null;
let clientesBunker = [];
let rawMovements = [];
let rawTotalCount = 0;
let filtroSentido = 'TODOS'; // 'TODOS', 'DEBITO', 'CREDITO'

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
});

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
    
    if (filtroSentido === 'DEBITO') {
        movimientosFiltrados = movimientosFiltrados.filter(m => parseFloat(m.debito) > 0);
    } else if (filtroSentido === 'CREDITO') {
        movimientosFiltrados = movimientosFiltrados.filter(m => parseFloat(m.credito) > 0);
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
    
    busquedaInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            cargarMovimientos();
        }, 300);
    });
    
    tipoSelect.addEventListener('change', () => {
        cargarMovimientos();
    });
    
    resetBtn.addEventListener('click', () => {
        busquedaInput.value = '';
        tipoSelect.value = 'TODOS';
        actualizarSegmentedControlUI('TODOS');
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

    // Eventos de click en las cabeceras de columna (Interactivo y Bidireccional)
    const thDebito = document.getElementById('th-debito');
    const thCredito = document.getElementById('th-credito');
    
    if (thDebito) {
        thDebito.addEventListener('click', () => {
            const nextValue = filtroSentido === 'DEBITO' ? 'TODOS' : 'DEBITO';
            actualizarSegmentedControlUI(nextValue);
            aplicarFiltrosYRenderizar();
        });
    }
    
    if (thCredito) {
        thCredito.addEventListener('click', () => {
            const nextValue = filtroSentido === 'CREDITO' ? 'TODOS' : 'CREDITO';
            actualizarSegmentedControlUI(nextValue);
            aplicarFiltrosYRenderizar();
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
    
    // Table headers highlighting
    const thDebito = document.getElementById('th-debito');
    const thCredito = document.getElementById('th-credito');
    
    if (thDebito) {
        if (value === 'DEBITO') {
            thDebito.classList.add('active-debito');
        } else {
            thDebito.classList.remove('active-debito');
        }
    }
    if (thCredito) {
        if (value === 'CREDITO') {
            thCredito.classList.add('active-credito');
        } else {
            thCredito.classList.remove('active-credito');
        }
    }
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
        } catch (e) {
            console.error('Error al parsear anchos guardados:', e);
        }
    } else {
        // Inicializar todas las columnas con su ancho offsetWidth en píxeles
        // para garantizar que la grilla tenga anchos fijos y se comporte de forma predecible
        ths.forEach((th) => {
            th.style.width = `${th.offsetWidth}px`;
        });
    }

    // 2. Configurar eventos de mouse para cada resizer
    ths.forEach((th, idx) => {
        const resizer = th.querySelector('.resizer');
        if (!resizer) return;

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = th.offsetWidth;
            
            // Obtener la columna de la derecha (N+1) si existe
            const nextTh = ths[idx + 1];
            const startWidthNext = nextTh ? nextTh.offsetWidth : null;
            
            resizer.classList.add('resizing');
            
            const onMouseMove = (moveEvent) => {
                const dX = moveEvent.clientX - startX;
                
                if (nextTh && startWidthNext !== null) {
                    // Limitar dX de forma que ninguna columna encoja por debajo del mínimo de 60px
                    const minDx = 60 - startWidth;
                    const maxDx = startWidthNext - 60;
                    
                    const constrainedDx = Math.max(minDx, Math.min(maxDx, dX));
                    
                    th.style.width = `${startWidth + constrainedDx}px`;
                    nextTh.style.width = `${startWidthNext - constrainedDx}px`;
                } else {
                    // Si es la última columna (no hay siguiente), solo modificamos su propio ancho
                    th.style.width = `${Math.max(60, startWidth + dX)}px`;
                }
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
 * Muestra el diálogo modal para confirmar la vinculación sugerida
 */
async function vincularClienteConfirmado(movimientoId, clienteId, razonSocial) {
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
