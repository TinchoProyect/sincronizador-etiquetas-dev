const API_BASE_URL = (typeof window !== 'undefined' && window.LAMDA_RESOLVE_URL) ? window.LAMDA_RESOLVE_URL('http://localhost:3004/facturacion/cuentas-bancarias') : 'http://localhost:3004/facturacion/cuentas-bancarias';
const LOGISTICA_API_BASE = (typeof window !== 'undefined' && window.location && window.location.port === '3004') ? 'http://localhost:3005' : '';
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
    verificarSaludIAFrontend();
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
 * Consulta y actualiza el semáforo visual de salud de IA
 */
async function verificarSaludIAFrontend() {
    const pill = document.getElementById('ia-status-indicator');
    const txt = document.getElementById('ia-status-text');
    if (!pill || !txt) return;

    try {
        const res = await fetch(`${API_BASE_URL}/ia-status`);
        const json = await res.json();
        if (json.success && json.data && json.data.activa) {
            pill.className = 'ia-health-pill online';
            txt.innerHTML = `<i class="fa-solid fa-brain" style="margin-right: 4px;"></i> IA Online (${json.data.modelo})`;
            pill.title = 'Servicio Gemini activo y en línea';
        } else {
            pill.className = 'ia-health-pill offline';
            pill.style.background = 'rgba(239, 68, 68, 0.18)';
            pill.style.borderColor = '#ef4444';
            pill.style.color = '#fca5a5';
            txt.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="margin-right: 4px; color: #ef4444;"></i> 🚨 IA Gemini Sin Servicio`;
            pill.title = `Error crítico de IA (${json.data?.razon || 'Sin conexión'}). El servicio Gemini no está respondiendo.`;
        }
    } catch (e) {
        pill.className = 'ia-health-pill offline';
        pill.style.background = 'rgba(239, 68, 68, 0.18)';
        pill.style.borderColor = '#ef4444';
        pill.style.color = '#fca5a5';
        txt.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="margin-right: 4px; color: #ef4444;"></i> 🚨 Error Conexión IA`;
    }
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
        
        // Badge de IA / Regla
        let iaBadgeClass = 'ia-auto';
        let iaBadgeText = 'REGLA';
        let iaTitle = 'Clasificado determinísticamente por regla directa blindada';
        if (mov.estado_clasificacion === 'IA_COMPLETO') {
            iaBadgeClass = 'ia-complete';
            iaBadgeText = 'IA OK';
            iaTitle = 'Clasificado y enriquecido por IA Gemini';
        } else if (mov.estado_clasificacion === 'IA_DUDOSO') {
            iaBadgeClass = 'ia-dudoso';
            iaBadgeText = 'IA ?';
            iaTitle = 'Clasificación IA con baja confianza';
        }
        const iaBadgeHtml = `<span class="ia-status-badge ${iaBadgeClass}" title="${iaTitle}">${iaBadgeText}</span>`;
        
        // Columna de vinculación de cliente (Human-in-the-Loop)
        let clientHtml = '';
        if (mov.cliente_id) {
            // Ya está vinculado - Mostrar badge verde, botón de reenvío de Recibo/Políticas y botón de desvinculación
            const safeRazonLink = (mov.cliente_razon_social || '').replace(/'/g, "\\'");
            clientHtml = `
                <div style="display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <span class="btn-link-action linked" title="Cliente vinculado"><i class="fa-solid fa-circle-check"></i> ${mov.cliente_razon_social}</span>
                    <button class="btn-link-action" onclick="reenviarComprobanteBancario(${mov.id})" title="Enviar o Reenviar Recibo y PDF de Políticas por WhatsApp / Email" style="background: rgba(34, 197, 94, 0.16); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4); padding: 5px 8px; font-weight: 700;"><i class="fa-brands fa-whatsapp"></i> Recibo</button>
                    <button class="btn-link-action" onclick="desvincularClienteConfirmado(${mov.id}, '${safeRazonLink}')" title="Desvincular Movimiento" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 5px 8px;"><i class="fa-solid fa-unlink"></i> Desvincular</button>
                </div>
            `;
        } else if (mov.sugerencia_cliente) {
            // Sugerencia disponible
            const sug = mov.sugerencia_cliente;
            const sugClass = sug.tipo === 'cuit' ? 'sug-cuit' : (sug.tipo === 'aprendido' ? 'sug-aprendido' : 'sug-nombre');
            const icon = sug.tipo === 'aprendido' ? 'fa-brain' : (sug.tipo === 'cuit' ? 'fa-magic' : 'fa-lightbulb');
            const displayMotivo = sug.motivo || 'Haga clic para validar y vincular';
            const displayTitle = `${displayMotivo}. Haga clic para validar y vincular.`;
            const nombreMostrar = sug.cliente_nombre ? `${sug.razon_social} (${sug.cliente_nombre})` : sug.razon_social;
            const prefix = sug.tipo === 'aprendido' ? '🧠 Sugerido' : '✨ Sugerido';
            const safeRazonSocial = (sug.razon_social || '').replace(/'/g, "\\'");
            clientHtml = `
                <button class="btn-link-action sug-badge ${sugClass}" onclick="vincularClienteConfirmado(${mov.id}, ${sug.id}, '${safeRazonSocial}')" title="${displayTitle}">
                    <i class="fa-solid ${icon}"></i> ${prefix}: ${nombreMostrar}
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
            html: '<p style="margin-bottom: 10px;">Filtrando duplicados, cruzando CUIT/CBU de clientes y clasificando movimientos nuevos...</p>',
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
            const iaConecto = result.data.estadoIA === 'ONLINE';
            let iaStatusHtml = '';
            if (iaConecto) {
                iaStatusHtml = `
                    <li style="color: #38bdf8;"><i class="fa-solid fa-bolt"></i> Resueltos por Reglas / CUIT directo: <strong>${result.data.clasificadosRegla || 0}</strong></li>
                    <li style="color: #a78bfa;"><i class="fa-solid fa-brain"></i> Clasificados por IA (Gemini): <strong>${result.data.clasificadosIA || 0}</strong></li>
                `;
            } else {
                iaStatusHtml = `
                    <li style="color: #ef4444; font-weight: 700;">
                        <i class="fa-solid fa-triangle-exclamation"></i> 🚨 <strong>ALERTA CRÍTICA: El servicio Gemini NO se conectó (${result.data.estadoIA || 'SIN_SERVICIO'}).</strong>
                        Los movimientos se importaron solo con reglas fijas de contingencia (0 clasificados por IA).
                    </li>
                `;
            }

            Swal.fire({
                icon: iaConecto ? 'success' : 'warning',
                title: iaConecto ? 'Ingesta Procesada con Éxito' : '⚠️ Atención: Ingesta sin Servicio de IA (Gemini Falló)',
                html: `
                    <div style="text-align: left; padding: 10px;">
                        <p style="margin-bottom: 8px;"><strong>Detalle de la importación:</strong></p>
                        <ul style="line-height: 1.6;">
                            <li>Total leídos en Excel: <strong>${result.data.total}</strong></li>
                            <li style="color: var(--success);">Nuevos insertados: <strong>${result.data.insertados}</strong></li>
                            <li style="color: var(--warning);">Duplicados omitidos instantáneamente: <strong>${result.data.duplicados}</strong></li>
                            ${iaStatusHtml}
                        </ul>
                    </div>
                `,
                confirmButtonColor: iaConecto ? '#8b5cf6' : '#dc2626'
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
 * Consulta en tiempo real la simulación de financiación y composición de saldo de una cuenta corriente
 */
async function consultarSimulacionFinanciacionBancaria(codigoBunker, cuentaIdHint, montoMov) {
    if (!codigoBunker && !cuentaIdHint) return null;
    try {
        let ccId = cuentaIdHint || null;
        if (!ccId && codigoBunker) {
            const rCtas = await fetch(`${LOGISTICA_API_BASE}/api/logistica/bunker/cuentas-corrientes?cliente=${encodeURIComponent(codigoBunker)}`).then(r => r.json()).catch(() => null);
            const listaCtas = Array.isArray(rCtas?.data) ? rCtas.data : (rCtas?.data?.id ? [rCtas.data] : []);
            const ctaPrincipal = listaCtas.find(x => x.nombre_cuenta === 'Cuenta Principal') || listaCtas[0];
            if (ctaPrincipal && (ctaPrincipal.cuenta_corriente_id || ctaPrincipal.id)) {
                ccId = ctaPrincipal.cuenta_corriente_id || ctaPrincipal.id;
            }
        }
        if (!ccId) return null;

        const [rComp, rSalv] = await Promise.all([
            fetch(`${LOGISTICA_API_BASE}/api/logistica/bunker/cuentas-corrientes/${ccId}/composicion-saldo?simular_monto=${encodeURIComponent(montoMov || 0)}`).then(r => r.json()).catch(() => null),
            fetch(`${LOGISTICA_API_BASE}/api/logistica/bunker/cuentas-corrientes/${ccId}/salvavidas-simulacion`).then(r => r.json()).catch(() => null)
        ]);
        const comp = rComp?.data || null;
        const salv = rSalv?.data || null;
        const sim = comp?.simulacion_pago || null;
        return { ccId, comp, salv, sim };
    } catch (err) {
        console.warn('⚠️ [BANCARIO-FRONT] No se pudo consultar simulación de financiación:', err);
        return null;
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
    const movObj = (typeof rawMovements !== 'undefined' && Array.isArray(rawMovements))
        ? rawMovements.find(m => m.id == movimientoId)
        : null;
    
    // Extracción precisa de importes evitando que '0.00' actúe como truthy en JS
    const creditoVal = movObj ? (parseFloat(movObj.credito) || 0) : 0;
    const debitoVal = movObj ? (parseFloat(movObj.debito) || 0) : 0;
    const esDebito = debitoVal > 0 && creditoVal === 0;
    const montoMov = creditoVal > 0 ? creditoVal : debitoVal;

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

        const { value: selectedId, isDenied } = await Swal.fire({
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
                <div style="margin-top: 14px; text-align: center;">
                    <button type="button" id="btn-swal-buscar-otro-cuit" style="background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; font-weight: 600; font-size: 12px; padding: 8px 14px; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; display: inline-flex; align-items: center; gap: 6px;">
                        <i class="fa-solid fa-magnifying-glass"></i> Buscar cliente con otro CUIT...
                    </button>
                </div>
            `,
            icon: 'question',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonColor: '#8b5cf6',
            denyButtonColor: '#0284c7',
            cancelButtonColor: '#475569',
            confirmButtonText: 'Sí, Vincular',
            denyButtonText: '🔍 Seleccionar Otro Cliente',
            cancelButtonText: 'Cancelar',
            didOpen: () => {
                const btnOtro = document.getElementById('btn-swal-buscar-otro-cuit');
                if (btnOtro) {
                    btnOtro.addEventListener('click', () => {
                        Swal.close();
                        abrirBuscadorClientes(movimientoId);
                    });
                }
            },
            preConfirm: () => {
                return document.getElementById('swal-cc-select').value;
            }
        });

        if (isDenied) {
            abrirBuscadorClientes(movimientoId);
        } else if (selectedId) {
            ejecutarVinculacion(movimientoId, parseInt(selectedId, 10));
        }
    } else {
        // Consultar en tiempo real si el cliente tiene Servicio de Financiación activo (> 14 días)
        let infoFin = null;
        if (!esDebito && montoMov > 0 && clientObj) {
            infoFin = await consultarSimulacionFinanciacionBancaria(clientObj.codigo_bunker, clientObj.cuenta_corriente_id, montoMov);
        }

        const sim = infoFin?.sim || null;
        const salv = infoFin?.salv || null;
        const comp = infoFin?.comp || null;
        const finActivaConIva = parseFloat(sim?.financiacion_activa_con_iva ?? comp?.financiacion_activa_con_iva ?? comp?.totales?.financiacion_activa_con_iva ?? salv?.financiacion_total_con_iva ?? 0) || 0;
        const finActivaNeta = parseFloat(sim?.financiacion_activa_neta ?? comp?.financiacion_activa_neta ?? comp?.totales?.financiacion_activa_neta ?? salv?.financiacion_total ?? 0) || 0;
        const finActivaIva = parseFloat(sim?.financiacion_activa_iva ?? comp?.financiacion_activa_iva ?? comp?.totales?.financiacion_activa_iva ?? salv?.financiacion_iva ?? 0) || 0;
        const finHistBonif = parseFloat(sim?.financiacion_historica_bonificada_total ?? comp?.financiacion_historica_bonificada_total ?? comp?.totales?.financiacion_historica_bonificada_total ?? 0) || 0;
        const listaCompAbiertos = Array.isArray(comp?.comprobantes) ? comp.comprobantes : (comp?.movimientos || []);
        const diasMaxMora = Math.max(
            parseInt(comp?.antiguedad_maxima_dias || 0, 10),
            ...listaCompAbiertos.filter(m => Number(m.pendiente_actual ?? m.pendiente ?? 1) > 0.01).map(m => parseInt(m.antiguedad_dias ?? m.dias_antiguedad ?? 0, 10))
        );

        // Flujo de confirmación con Desglose Financiero, Servicio de Financiación y Ajuste Automático opcional
        const saldo = parseFloat(sim?.saldo_capital_actual ?? (clientObj ? clientObj.saldo_cuenta_corriente : 0)) || 0;
        const saldoTotalConFin = (!esDebito && finActivaConIva > 0) ? parseFloat((saldo + finActivaConIva).toFixed(2)) : saldo;
        const saldoFmt = currencyFormatter.format(Math.abs(saldo));
        const saldoTotalConFinFmt = currencyFormatter.format(Math.abs(saldoTotalConFin));
        
        // En Cuenta Corriente:
        // - CRÉDITO bancario (cobro a cliente) RESTA saldo deudor: saldo - montoMov
        // - DÉBITO bancario (pago emitido a cliente/colaborador) SUMA al saldo (cancela saldo a favor o suma deuda): saldo + montoMov
        const saldoEst = esDebito ? (saldo + montoMov) : (saldo - montoMov);
        const diferenciaAbs = parseFloat(Math.abs(saldoEst).toFixed(2));

        let saldoBg = 'rgba(148, 163, 184, 0.15)';
        let saldoBorder = 'rgba(148, 163, 184, 0.3)';
        let saldoColor = '#cbd5e1';
        let statusBadge = '<span style="font-size: 11px; background: #64748b; color: #ffffff; padding: 2px 8px; border-radius: 4px; font-weight: 600;">CUENTA AL DÍA</span>';
        let saldoLabel = '$0.00';

        if (saldo > 0) {
            saldoBg = 'rgba(239, 68, 68, 0.15)';
            saldoBorder = 'rgba(239, 68, 68, 0.4)';
            saldoColor = '#fca5a5';
            statusBadge = finActivaConIva > 0
                ? `<span style="font-size: 11px; background: #d97706; color: #ffffff; padding: 2px 8px; border-radius: 4px; font-weight: 700;">FINANCIACIÓN ACTIVA (${diasMaxMora}d)</span>`
                : '<span style="font-size: 11px; background: #ef4444; color: #ffffff; padding: 2px 8px; border-radius: 4px; font-weight: 700;">DEUDA PENDIENTE</span>';
            saldoLabel = finActivaConIva > 0
                ? `TOTAL ${saldoTotalConFinFmt}`
                : `DEBE ${saldoFmt}`;
        } else if (saldo < 0) {
            saldoBg = 'rgba(34, 197, 94, 0.15)';
            saldoBorder = 'rgba(34, 197, 94, 0.4)';
            saldoColor = '#86efac';
            statusBadge = '<span style="font-size: 11px; background: #22c55e; color: #ffffff; padding: 2px 8px; border-radius: 4px; font-weight: 700;">SALDO A FAVOR</span>';
            saldoLabel = `A FAVOR ${saldoFmt}`;
        }

        // Saldo proyectado tras imputar el movimiento
        const saldoEstFmt = currencyFormatter.format(Math.abs(saldoEst));
        let saldoEstLabel = '$0.00 (Al Día)';
        let saldoEstColor = '#4ade80';
        if (saldoEst > 0.001) {
            saldoEstLabel = `DEBE ${saldoEstFmt}`;
            saldoEstColor = '#fca5a5';
        } else if (saldoEst < -0.001) {
            saldoEstLabel = `A FAVOR ${saldoEstFmt}`;
            saldoEstColor = '#86efac';
        }

        const cbCode = clientObj ? (clientObj.codigo_bunker || 'Sin Cód.') : 'Sin Cód.';
        const oldCode = clientObj ? (clientObj.lomas_soft_id || 'Sin Cód.') : 'Sin Cód.';
        const cuitStr = clientObj ? (clientObj.cuit || 'Sin CUIT') : 'Sin CUIT';

        const modalTitle = esDebito ? '¿Vincular Pago Emitido a Cliente?' : '¿Vincular Cobro a Cliente?';
        const modalSub = esDebito 
            ? '¿Desea registrar esta transferencia enviada (débito bancario) como pago en la Cuenta Corriente de este cliente/colaborador?'
            : '¿Desea vincular formalmente este cobro recibido con la Cuenta Corriente del siguiente cliente?';

        const badgeSentido = esDebito 
            ? `<span style="font-size: 10px; background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); padding: 2px 8px; border-radius: 4px; font-weight: 700;"><i class="fa-solid fa-arrow-up-right-from-square"></i> PAGO EMITIDO (DÉBITO BANCARIO)</span>`
            : `<span style="font-size: 10px; background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4); padding: 2px 8px; border-radius: 4px; font-weight: 700;"><i class="fa-solid fa-arrow-down-left-and-up-right-to-ceiling"></i> COBRO RECIBIDO (CRÉDITO)</span>`;

        const explicacionImpacto = esDebito
            ? (saldo < 0
                ? `<div style="font-size: 11px; color: #86efac; margin-top: 6px;"><i class="fa-solid fa-circle-info"></i> Esta transferencia cancelará/reducirá el saldo a favor acumulado por trabajo/producción.</div>`
                : `<div style="font-size: 11px; color: #cbd5e1; margin-top: 6px;"><i class="fa-solid fa-circle-info"></i> Esta salida bancaria sumará un débito a cargo del cliente en su cuenta corriente.</div>`)
            : (saldo > 0
                ? `<div style="font-size: 11px; color: #86efac; margin-top: 6px;"><i class="fa-solid fa-circle-info"></i> Este cobro cancelará o reducirá la deuda pendiente del cliente.</div>`
                : `<div style="font-size: 11px; color: #cbd5e1; margin-top: 6px;"><i class="fa-solid fa-circle-info"></i> El cobro ingresará como saldo a favor en la cuenta del cliente.</div>`);

        const sugInfoHtml = (movObj && movObj.sugerencia_cliente && movObj.sugerencia_cliente.tipo === 'aprendido')
            ? `<div style="margin-bottom: 10px; padding: 7px 10px; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 6px; font-size: 11px; color: #38bdf8; display: flex; align-items: center; gap: 7px;">
                <i class="fa-solid fa-brain" style="font-size: 13px;"></i>
                <span><strong>Vínculo Aprendido:</strong> ${movObj.sugerencia_cliente.motivo} ${movObj.sugerencia_cliente.titular_detectado ? `· Titular detectado: <strong>${movObj.sugerencia_cliente.titular_detectado}</strong>` : ''}</span>
               </div>`
            : '';

        // Bloque interactivo cuando el cliente tiene Servicio de Financiación activo (> 14 días)
        let bloqueFinanciacionHtml = '';
        if (!esDebito && finActivaConIva > 0 && sim) {
            const capSplit = currencyFormatter.format(sim.capital_cancelado_total || 0);
            const intSplit = currencyFormatter.format(sim.financiacion_con_iva_cancelada || 0);
            const remSplit = currencyFormatter.format(Math.max(0, saldo - (sim.capital_cancelado_total || 0)));
            const urlPreviewPol = infoFin?.ccId
                ? `${LOGISTICA_API_BASE}/api/logistica/bunker/cuentas-corrientes/${infoFin.ccId}/reporte-pdf?tipo_doc=politicas_financiacion&inline=1`
                : '';

            bloqueFinanciacionHtml = `
                <div style="margin-top: 10px; padding: 11px 12px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.45); border-radius: 8px; text-align: left;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px;">
                        <div style="font-size: 12px; font-weight: 800; color: #fbbf24;">
                            ⏳ Servicio de Financiación Devengado (${diasMaxMora} días): ${currencyFormatter.format(finActivaConIva)}
                        </div>
                        ${urlPreviewPol ? `<a href="${urlPreviewPol}" target="_blank" style="font-size: 10.5px; background: #1e293b; color: #38bdf8; border: 1px solid #0284c7; padding: 3px 8px; border-radius: 5px; text-decoration: none; font-weight: 700;">👁️ Ver PDF Políticas</a>` : ''}
                    </div>
                    <div style="font-size: 11px; color: #e2e8f0; margin-bottom: 8px; line-height: 1.35;">
                        Capital comprobante: <strong>${saldoFmt}</strong> + Financiación (${currencyFormatter.format(finActivaNeta)} neto + ${currencyFormatter.format(finActivaIva)} IVA): <strong>${currencyFormatter.format(finActivaConIva)}</strong> = Total exigible: <strong style="color:#fbbf24;">${saldoTotalConFinFmt}</strong>.
                        ${finHistBonif > 0 ? `<br><span style="color:#94a3b8;">📊 Historial previo >14d absorbido por LAMDA: <strong>${currencyFormatter.format(finHistBonif)}</strong> (Total acumulado: <strong>${currencyFormatter.format(finHistBonif + finActivaConIva)}</strong>).</span>` : ''}
                    </div>
                    <div style="font-size: 11px; font-weight: 700; color: #cbd5e1; margin-bottom: 6px;">¿Cómo desea imputar esta transferencia de ${currencyFormatter.format(montoMov)}?</div>
                    <label style="display: flex; align-items: flex-start; gap: 8px; padding: 7px 9px; background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.4); border-radius: 6px; cursor: pointer; margin-bottom: 6px;">
                        <input type="radio" name="swal-modo-fin-banco" value="BONIFICAR" checked style="margin-top: 3px; accent-color: #22c55e;">
                        <div style="font-size: 11.2px; color: #f8fafc; line-height: 1.3;">
                            <strong style="color: #4ade80;">🎁 Bonificar 100% la Financiación (${currencyFormatter.format(finActivaConIva)}) en este pago → Dejar Cuenta en ${saldoEstLabel}</strong><br>
                            <span style="color: #cbd5e1; font-size: 10.5px;">Imputa el 100% al capital y en el próximo paso adjunta el PDF de Políticas y Beneficio de Financiación con el caso práctico de su cuenta para las próximas órdenes.</span>
                        </div>
                    </label>
                    <label style="display: flex; align-items: flex-start; gap: 8px; padding: 7px 9px; background: rgba(15, 23, 42, 0.75); border: 1px solid #475569; border-radius: 6px; cursor: pointer; margin-bottom: 4px;">
                        <input type="radio" name="swal-modo-fin-banco" value="DESGLOSAR_INTERNA" style="margin-top: 3px; accent-color: #f59e0b;">
                        <div style="font-size: 11.2px; color: #f8fafc; line-height: 1.3;">
                            <strong style="color: #fbbf24;">📋 Cobrar Financiación y Enviar a Aprobación Interna (Pto. Vta. 0090 — Sin ARCA)</strong><br>
                            <span style="color: #cbd5e1; font-size: 10.5px;">Cancela ${capSplit} de capital + ${intSplit} de interés (queda saldo de capital pendiente de ${remSplit}).</span>
                        </div>
                    </label>
                    <label style="display: flex; align-items: flex-start; gap: 8px; padding: 7px 9px; background: rgba(15, 23, 42, 0.75); border: 1px solid #475569; border-radius: 6px; cursor: pointer;">
                        <input type="radio" name="swal-modo-fin-banco" value="DESGLOSAR_ARCA" style="margin-top: 3px; accent-color: #38bdf8;">
                        <div style="font-size: 11.2px; color: #f8fafc; line-height: 1.3;">
                            <strong style="color: #38bdf8;">🏛️ Cobrar Financiación y Emitir Factura Oficial ARCA / AFIP (Pto. Vta. 0032 con CAE)</strong><br>
                            <span style="color: #cbd5e1; font-size: 10.5px;">Cancela ${capSplit} de capital + ${intSplit} de interés emitiendo Factura Electrónica ARCA.</span>
                        </div>
                    </label>
                </div>
            `;
        }

        const result = await Swal.fire({
            title: modalTitle,
            width: (!esDebito && finActivaConIva > 0) ? 620 : 520,
            html: `
                <p style="font-size: 13px; color: #94a3b8; margin-bottom: 10px;">${modalSub}</p>
                ${sugInfoHtml}
                <div style="text-align: left; padding: 14px 16px; background: #0f172a; border: 1px solid #334155; border-radius: 10px; margin-top: 4px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                        <div>
                            <div style="font-size: 15px; font-weight: 700; color: #a78bfa;">${clientObj ? clientObj.razon_social : razonSocial}</div>
                            ${clientObj && clientObj.cliente_nombre ? `<div style="font-size: 12px; color: #cbd5e1;">Fantasía: ${clientObj.cliente_nombre}</div>` : ''}
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                            ${statusBadge}
                            ${badgeSentido}
                        </div>
                    </div>
                    <div style="font-size: 11px; color: #94a3b8; margin-bottom: 12px;">
                        <span>Cód. Búnker: <strong style="color: #c084fc;">${cbCode}</strong></span> | 
                        <span>Histórico: <strong style="color: #38bdf8;">${oldCode}</strong></span> | 
                        <span>CUIT: <strong>${cuitStr}</strong></span>
                    </div>

                    <!-- Desglose Financiero -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; font-size: 12px;">
                        <div style="padding: 8px 10px; background: #1e293b; border: 1px solid #334155; border-radius: 6px;">
                            <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase;">${(!esDebito && finActivaConIva > 0) ? 'Saldo Total CC (c/Financiación)' : 'Saldo Actual CC'}</div>
                            <div style="font-size: 14px; font-weight: 700; color: ${saldoColor};">${saldoLabel}</div>
                            ${(!esDebito && finActivaConIva > 0) ? `<div style="font-size: 10.5px; color: #cbd5e1; margin-top: 2px;">Capital: ${saldoFmt} + Fin.: ${currencyFormatter.format(finActivaConIva)}</div>` : ''}
                        </div>
                        <div style="padding: 8px 10px; background: #1e293b; border: 1px solid #334155; border-radius: 6px;">
                            <div style="color: ${esDebito ? '#f87171' : '#94a3b8'}; font-size: 10px; text-transform: uppercase;">${esDebito ? 'Monto Pago Enviado' : 'Monto Cobro Recibido'}</div>
                            <div style="font-size: 14px; font-weight: 700; color: ${esDebito ? '#f87171' : '#38bdf8'};">${esDebito ? '- ' : '+ '}${currencyFormatter.format(montoMov)}</div>
                        </div>
                    </div>

                    <!-- Proyección de Saldo Resultante -->
                    <div style="margin-top: 4px; padding: 8px 10px; background: rgba(15, 23, 42, 0.7); border: 1px solid #334155; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
                        <span style="color: #94a3b8;">Saldo de Capital Resultante:</span>
                        <strong style="color: ${saldoEstColor}; font-size: 13px;">${saldoEstLabel}</strong>
                    </div>
                    ${explicacionImpacto}
                    ${bloqueFinanciacionHtml}

                    <!-- Ajuste Automático Opcional -->
                    ${diferenciaAbs > 0.001 ? `
                    <div style="margin-top: 10px; padding: 10px 12px; background: rgba(139, 92, 246, 0.12); border: 1px solid rgba(139, 92, 246, 0.35); border-radius: 8px;">
                        <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; margin: 0;">
                            <input type="checkbox" id="swal-chk-ajuste-auto" style="width: 18px; height: 18px; margin-top: 2px; accent-color: #8b5cf6; cursor: pointer;">
                            <div style="flex: 1;">
                                <div style="font-size: 12px; font-weight: 700; color: #c084fc;">⚡ Aplicar Ajuste Automático de Saldo</div>
                                <div style="font-size: 11px; color: #cbd5e1; line-height: 1.3; margin-top: 2px;">
                                    Generar un ajuste contable por <strong style="color: #f8fafc;">${currencyFormatter.format(diferenciaAbs)}</strong> para netear la cuenta corriente en <strong style="color: #4ade80;">$0.00 (en cero definitivo)</strong>.
                                </div>
                            </div>
                        </label>
                    </div>
                    ` : `
                    <div style="margin-top: 8px; padding: 8px 12px; background: rgba(34, 197, 94, 0.12); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 8px; font-size: 12px; color: #4ade80; text-align: center;">
                        <i class="fa-solid fa-circle-check"></i> Con este movimiento, el capital de la cuenta corriente quedará exactamente en <strong>$0.00 (Al Día)</strong>.
                    </div>
                    `}
                </div>

                <!-- Botón secundario en el cuerpo del modal para seleccionar otro cliente -->
                <div style="margin-top: 14px; text-align: center;">
                    <button type="button" id="btn-swal-buscar-otro" style="background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.35); color: #38bdf8; font-weight: 600; font-size: 12px; padding: 8px 16px; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; display: inline-flex; align-items: center; gap: 6px;">
                        <i class="fa-solid fa-magnifying-glass"></i> ¿No es este cliente? Seleccionar otro cliente...
                    </button>
                </div>
            `,
            icon: 'question',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonColor: '#8b5cf6',
            denyButtonColor: '#0284c7',
            cancelButtonColor: '#475569',
            confirmButtonText: 'Sí, Vincular',
            denyButtonText: '🔍 Seleccionar Otro Cliente',
            cancelButtonText: 'Cancelar',
            didOpen: () => {
                const btnOtro = document.getElementById('btn-swal-buscar-otro');
                if (btnOtro) {
                    btnOtro.addEventListener('click', () => {
                        Swal.close();
                        abrirBuscadorClientes(movimientoId);
                    });
                }
            },
            preConfirm: () => {
                const chk = document.getElementById('swal-chk-ajuste-auto');
                const radioFin = document.querySelector('input[name="swal-modo-fin-banco"]:checked');
                const modoFin = radioFin ? radioFin.value : 'BONIFICAR';
                return {
                    aplicarAjuste: chk ? chk.checked : false,
                    montoAjuste: diferenciaAbs,
                    modoFinanciacion: modoFin,
                    ccId: infoFin?.ccId || null,
                    finActivaConIva,
                    finHistBonif,
                    diasMaxMora,
                    bonificado: Boolean(finActivaConIva > 0 && modoFin === 'BONIFICAR')
                };
            }
        });
        
        if (result.isConfirmed) {
            ejecutarVinculacion(movimientoId, clienteId, result.value);
        } else if (result.isDenied) {
            abrirBuscadorClientes(movimientoId);
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

/**
 * Buscador Universal de Clientes LAMDA (Regla #3) con Visualización de Saldo y Ajuste Automático en Tiempo Real
 */
async function abrirBuscadorClientesUniversal({ titulo, subtitulo, montoPago = 0, esDebito = false, onConfirm }) {
    if (clientesBunker.length === 0) {
        mostrarLoading(true, 'Cargando listado de clientes y saldos...');
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

    const { value: resObj } = await Swal.fire({
        title: titulo || (esDebito ? 'Vincular Pago Emitido a Cliente' : 'Vincular Cobro a Cliente'),
        html: `
            <div style="text-align: left; margin-bottom: 10px;">
                ${subtitulo ? `<p style="font-size: 13px; color: #94a3b8; margin-bottom: 12px;">${subtitulo}</p>` : ''}
                <label for="swal-search-input" style="font-weight: 600; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px;">🔍 Buscador Universal LAMDA (Razón Social / Comercial / CUIT / Cód. Búnker)</label>
                <input type="text" id="swal-search-input" class="swal2-input" placeholder="Escriba términos separados por espacios..." style="width: 100%; margin: 6px 0 14px 0; background: #0f172a; color: #f8fafc; border: 1px solid #475569; border-radius: 8px; padding: 10px; box-sizing: border-box; font-size: 13px;">
                
                <label for="swal-client-select" style="font-weight: 600; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px;">Seleccione el Cliente</label>
                <select id="swal-client-select" class="swal2-select" style="width: 100%; margin: 6px 0 0 0; background: #1e293b; color: #f8fafc; border: 1px solid #475569; border-radius: 8px; padding: 10px; height: 45px; display: block; box-sizing: border-box; font-size: 13px;">
                </select>

                <!-- Panel de Detalles y Saldo de Cuenta Corriente en Tiempo Real -->
                <div id="swal-client-details-card" style="margin-top: 15px; padding: 12px 16px; background: #0f172a; border: 1px solid #334155; border-radius: 10px; display: none;">
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonColor: '#8b5cf6',
        cancelButtonColor: '#475569',
        confirmButtonText: 'Vincular Cliente',
        cancelButtonText: 'Cancelar',
        didOpen: () => {
            const searchInput = document.getElementById('swal-search-input');
            const clientSelect = document.getElementById('swal-client-select');
            const detailsCard = document.getElementById('swal-client-details-card');

            function updateDetailsCard(clientId) {
                if (!clientId) {
                    detailsCard.style.display = 'none';
                    return;
                }
                const client = clientesBunker.find(c => String(c.id) === String(clientId));
                if (!client) {
                    detailsCard.style.display = 'none';
                    return;
                }

                const saldo = parseFloat(client.saldo_cuenta_corriente) || 0;
                const saldoFmt = currencyFormatter.format(Math.abs(saldo));
                const montoP = parseFloat(montoPago) || 0;
                // En CC: Débito suma al saldo (cancela saldo a favor o suma deuda), Crédito resta
                const saldoEst = esDebito ? (saldo + montoP) : (saldo - montoP);
                const diferenciaAbs = parseFloat(Math.abs(saldoEst).toFixed(2));
                
                let saldoBg = '#1e293b';
                let saldoBorder = '#475569';
                let saldoColor = '#f8fafc';
                let statusBadge = '';

                if (saldo > 0) {
                    saldoBg = 'rgba(239, 68, 68, 0.15)';
                    saldoBorder = 'rgba(239, 68, 68, 0.4)';
                    saldoColor = '#fca5a5';
                    statusBadge = `<span style="font-size: 11px; background: #ef4444; color: #ffffff; padding: 2px 8px; border-radius: 4px; font-weight: 700;">DEUDA PENDIENTE</span>`;
                } else if (saldo < 0) {
                    saldoBg = 'rgba(34, 197, 94, 0.15)';
                    saldoBorder = 'rgba(34, 197, 94, 0.4)';
                    saldoColor = '#86efac';
                    statusBadge = `<span style="font-size: 11px; background: #22c55e; color: #ffffff; padding: 2px 8px; border-radius: 4px; font-weight: 700;">SALDO A FAVOR</span>`;
                } else {
                    saldoBg = 'rgba(148, 163, 184, 0.15)';
                    saldoBorder = 'rgba(148, 163, 184, 0.3)';
                    saldoColor = '#cbd5e1';
                    statusBadge = `<span style="font-size: 11px; background: #64748b; color: #ffffff; padding: 2px 8px; border-radius: 4px; font-weight: 600;">CUENTA AL DÍA</span>`;
                }

                // Saldo proyectado
                const saldoEstFmt = currencyFormatter.format(Math.abs(saldoEst));
                let saldoEstLabel = '$0.00 (Al Día)';
                let saldoEstColor = '#4ade80';
                if (saldoEst > 0.001) {
                    saldoEstLabel = `DEBE ${saldoEstFmt}`;
                    saldoEstColor = '#fca5a5';
                } else if (saldoEst < -0.001) {
                    saldoEstLabel = `A FAVOR ${saldoEstFmt}`;
                    saldoEstColor = '#86efac';
                }

                const cbCode = client.codigo_bunker || 'Sin Cód.';
                const oldCode = client.lomas_soft_id || 'Sin Cód.';
                const cuitStr = client.cuit || 'Sin CUIT';

                const badgeSentido = esDebito 
                    ? `<span style="font-size: 10px; background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); padding: 2px 8px; border-radius: 4px; font-weight: 700;"><i class="fa-solid fa-arrow-up-right-from-square"></i> PAGO EMITIDO (DÉBITO)</span>`
                    : `<span style="font-size: 10px; background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4); padding: 2px 8px; border-radius: 4px; font-weight: 700;"><i class="fa-solid fa-arrow-down-left-and-up-right-to-ceiling"></i> COBRO RECIBIDO</span>`;

                detailsCard.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                        <div>
                            <div style="font-size: 14px; font-weight: 700; color: #f8fafc;">${client.razon_social}</div>
                            ${client.cliente_nombre ? `<div style="font-size: 12px; color: #cbd5e1;">Fantasía: ${client.cliente_nombre}</div>` : ''}
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                            ${statusBadge}
                            ${badgeSentido}
                        </div>
                    </div>
                    <div style="font-size: 11px; color: #94a3b8; margin-bottom: 10px;">
                        <span>Cód. Búnker: <strong style="color: #c084fc;">${cbCode}</strong></span> | 
                        <span>Histórico: <strong style="color: #38bdf8;">${oldCode}</strong></span> | 
                        <span>CUIT: <strong>${cuitStr}</strong></span>
                    </div>

                    <!-- Desglose de Montos en Modal -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; font-size: 12px;">
                        <div style="padding: 8px 10px; background: #1e293b; border: 1px solid #334155; border-radius: 6px;">
                            <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase;">Saldo Actual CC</div>
                            <div style="font-size: 14px; font-weight: 700; color: ${saldoColor};">${saldo > 0 ? `DEBE ${saldoFmt}` : (saldo < 0 ? `A FAVOR ${saldoFmt}` : '$0.00')}</div>
                        </div>
                        <div style="padding: 8px 10px; background: #1e293b; border: 1px solid #334155; border-radius: 6px;">
                            <div style="color: ${esDebito ? '#f87171' : '#94a3b8'}; font-size: 10px; text-transform: uppercase;">${esDebito ? 'Monto Pago Enviado' : 'Monto Cobro Recibido'}</div>
                            <div style="font-size: 14px; font-weight: 700; color: ${esDebito ? '#f87171' : '#38bdf8'};">${esDebito ? '- ' : '+ '}${currencyFormatter.format(montoP)}</div>
                        </div>
                    </div>

                    <!-- Proyección de Saldo Resultante -->
                    <div style="margin-top: 4px; padding: 8px 10px; background: rgba(15, 23, 42, 0.7); border: 1px solid #334155; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
                        <span style="color: #94a3b8;">Saldo Resultante Proyectado:</span>
                        <strong style="color: ${saldoEstColor}; font-size: 13px;">${saldoEstLabel}</strong>
                    </div>

                    <!-- Opción de Ajuste Automático -->
                    ${diferenciaAbs > 0.001 ? `
                    <div style="margin-top: 10px; padding: 10px 12px; background: rgba(139, 92, 246, 0.12); border: 1px solid rgba(139, 92, 246, 0.35); border-radius: 8px;">
                        <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; margin: 0;">
                            <input type="checkbox" id="swal-chk-ajuste-auto-univ" style="width: 18px; height: 18px; margin-top: 2px; accent-color: #8b5cf6; cursor: pointer;">
                            <div style="flex: 1;">
                                <div style="font-size: 12px; font-weight: 700; color: #c084fc;">⚡ Aplicar Ajuste Automático de Saldo</div>
                                <div style="font-size: 11px; color: #cbd5e1; line-height: 1.3; margin-top: 2px;">
                                    Generar un ajuste contable por <strong style="color: #f8fafc;">${currencyFormatter.format(diferenciaAbs)}</strong> para netear la cuenta corriente en <strong style="color: #4ade80;">$0.00 (en cero definitivo)</strong>.
                                </div>
                            </div>
                        </label>
                    </div>
                    ` : `
                    <div style="margin-top: 8px; padding: 8px 12px; background: rgba(34, 197, 94, 0.12); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 8px; font-size: 12px; color: #4ade80; text-align: center;">
                        <i class="fa-solid fa-circle-check"></i> Con este movimiento, el capital en cuenta corriente quedará exactamente en <strong>$0.00 (Al Día)</strong>.
                    </div>
                    `}
                    <div id="swal-univ-financiacion-slot"></div>
                `;
                detailsCard.style.display = 'block';

                window.__lastUnivInfoFin = null;
                if (!esDebito && client.codigo_bunker && montoP > 0) {
                    const slotEl = document.getElementById('swal-univ-financiacion-slot');
                    if (slotEl) {
                        slotEl.innerHTML = `<div style="margin-top:8px; font-size:11px; color:#94a3b8; text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Verificando estado de financiación de la cuenta...</div>`;
                    }
                    consultarSimulacionFinanciacionBancaria(client.codigo_bunker, client.cuenta_corriente_id, montoP).then(infoFin => {
                        window.__lastUnivInfoFin = infoFin;
                        const currentSlot = document.getElementById('swal-univ-financiacion-slot');
                        if (!currentSlot) return;
                        const compU = infoFin?.comp || null;
                        const simFin = infoFin?.sim || null;
                        const salvU = infoFin?.salv || null;
                        const finActivaConIva = Number(simFin?.financiacion_activa_con_iva ?? compU?.financiacion_activa_con_iva ?? compU?.totales?.financiacion_activa_con_iva ?? salvU?.financiacion_total_con_iva ?? 0);
                        const finHistBonif = Number(simFin?.financiacion_historica_bonificada_total ?? compU?.financiacion_historica_bonificada_total ?? compU?.totales?.financiacion_historica_bonificada_total ?? 0);
                        const listaCompU = Array.isArray(compU?.comprobantes) ? compU.comprobantes : (compU?.movimientos || []);
                        const diasMaxMora = Math.max(
                            parseInt(compU?.antiguedad_maxima_dias || 0, 10),
                            ...listaCompU.filter(m => Number(m.pendiente_actual ?? m.pendiente ?? 1) > 0.01).map(m => parseInt(m.antiguedad_dias ?? m.dias_antiguedad ?? 0, 10))
                        );
                        if (finActivaConIva > 0 || finHistBonif > 0) {
                            const interesPorEstePago = Number(simFin?.financiacion_con_iva_cancelada || finActivaConIva);
                            const capitalConInteres = Number(simFin?.capital_cancelado_total || Math.max(0, montoP - interesPorEstePago));
                            const saldoRestanteSiCobraFin = Math.max(0, saldo - capitalConInteres);
                            currentSlot.innerHTML = `
                                <div style="margin-top: 10px; padding: 12px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.45); border-radius: 8px; text-align: left;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                        <span style="font-size: 11.5px; font-weight: 800; color: #fbbf24; text-transform: uppercase;">
                                            ⏱️ Servicio de Financiación Detectado (${diasMaxMora > 0 ? `${diasMaxMora} días` : '>14 días'})
                                        </span>
                                        <a href="${LOGISTICA_API_BASE}/api/logistica/bunker/cuentas-corrientes/${infoFin.ccId}/reporte-pdf?tipo_doc=politicas_financiacion&inline=1" target="_blank"
                                           style="font-size: 10.5px; background: #1e293b; color: #38bdf8; border: 1px solid #0284c7; padding: 3px 8px; border-radius: 5px; text-decoration: none; font-weight: 700;">
                                           👁️ Ver PDF Políticas
                                        </a>
                                    </div>
                                    <div style="font-size: 11px; color: #e2e8f0; margin-bottom: 8px;">
                                        Financiación devengada s/saldo actual (c/IVA): <strong style="color:#fbbf24;">${currencyFormatter.format(finActivaConIva)}</strong>
                                        ${finHistBonif > 0 ? ` · Histórica bonificada: <strong style="color:#cbd5e1;">${currencyFormatter.format(finHistBonif)}</strong>` : ''}
                                    </div>
                                    ${finActivaConIva > 0 ? `
                                    <div style="display: flex; flex-direction: column; gap: 6px;">
                                        <label style="display: flex; align-items: flex-start; gap: 8px; padding: 7px 9px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.45); border-radius: 6px; cursor: pointer; margin: 0;">
                                            <input type="radio" name="swal-modo-fin-banco-univ" value="BONIFICAR" checked style="margin-top: 2px; accent-color: #10b981;">
                                            <div style="font-size: 11px; color: #ecfdf5;">
                                                <strong style="color: #34d399;">🎁 Bonificar 100% la financiación hoy (${currencyFormatter.format(finActivaConIva)}) e imputar todo a Capital</strong><br>
                                                <span style="color: #a7f3d0;">Cuenta en ${saldoEst <= 0.01 ? '$0,00' : currencyFormatter.format(saldoEst)} y adjunta PDF de Políticas de Financiación.</span>
                                            </div>
                                        </label>
                                        <label style="display: flex; align-items: flex-start; gap: 8px; padding: 7px 9px; background: rgba(30, 41, 59, 0.85); border: 1px solid #475569; border-radius: 6px; cursor: pointer; margin: 0;">
                                            <input type="radio" name="swal-modo-fin-banco-univ" value="DESGLOSAR_INTERNA" style="margin-top: 2px; accent-color: #f59e0b;">
                                            <div style="font-size: 11px; color: #f8fafc;">
                                                <strong style="color: #fbbf24;">📋 Cobrar Financiación (${currencyFormatter.format(interesPorEstePago)}) → Aprobación Interna (Pto. Vta. 90)</strong><br>
                                                <span style="color: #cbd5e1;">Cancela capital (${currencyFormatter.format(capitalConInteres)}) y queda saldo de ${currencyFormatter.format(saldoRestanteSiCobraFin)}.</span>
                                            </div>
                                        </label>
                                        <label style="display: flex; align-items: flex-start; gap: 8px; padding: 7px 9px; background: rgba(30, 41, 59, 0.85); border: 1px solid #475569; border-radius: 6px; cursor: pointer; margin: 0;">
                                            <input type="radio" name="swal-modo-fin-banco-univ" value="DESGLOSAR_ARCA" style="margin-top: 2px; accent-color: #38bdf8;">
                                            <div style="font-size: 11px; color: #f8fafc;">
                                                <strong style="color: #38bdf8;">🏛️ Cobrar Financiación (${currencyFormatter.format(interesPorEstePago)}) → Facturación ARCA (Pto. Vta. 32)</strong>
                                            </div>
                                        </label>
                                    </div>
                                    ` : ''}
                                </div>
                            `;
                        } else {
                            currentSlot.innerHTML = '';
                        }
                    });
                }
            }

            function populateSelect(list) {
                clientSelect.innerHTML = '';
                if (list.length === 0) {
                    const opt = document.createElement('option');
                    opt.value = '';
                    opt.textContent = 'No se encontraron clientes coincidentes';
                    clientSelect.appendChild(opt);
                    updateDetailsCard(null);
                    return;
                }
                list.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    
                    const cbCode = c.codigo_bunker || 'Sin Cód.';
                    const cuit = c.cuit ? `CUIT: ${c.cuit}` : 'Sin CUIT';
                    const name = c.cliente_nombre ? `${c.razon_social} (${c.cliente_nombre})` : c.razon_social;
                    const saldoVal = parseFloat(c.saldo_cuenta_corriente) || 0;
                    const saldoFmt = currencyFormatter.format(Math.abs(saldoVal));
                    let saldoStr = '';
                    if (saldoVal > 0) saldoStr = ` | 🔴 DEBE: ${saldoFmt}`;
                    else if (saldoVal < 0) saldoStr = ` | 🟢 A FAVOR: ${saldoFmt}`;
                    else saldoStr = ` | ⚪ AL DÍA ($0.00)`;

                    opt.textContent = `${name} [Búnker: ${cbCode}] - ${cuit}${saldoStr}`;
                    clientSelect.appendChild(opt);
                });

                if (list.length > 0) {
                    updateDetailsCard(list[0].id);
                }
            }
            
            populateSelect(clientesBunker);
            searchInput.focus();

            clientSelect.addEventListener('change', () => {
                updateDetailsCard(clientSelect.value);
            });
            
            searchInput.addEventListener('input', () => {
                const terms = searchInput.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
                if (terms.length === 0) {
                    populateSelect(clientesBunker);
                    return;
                }
                
                // Regla #3: Filtrado acumulativo (Espacios = AND) sobre Single Source of Truth
                const filtered = clientesBunker.filter(c => {
                    const searchableText = [
                        c.razon_social,
                        c.cliente_nombre,
                        c.lomas_soft_id,
                        c.codigo_bunker,
                        c.cuit
                    ].filter(Boolean).join(' ').toLowerCase();

                    return terms.every(term => searchableText.includes(term));
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
            const client = clientesBunker.find(c => String(c.id) === String(selectVal));
            const saldo = parseFloat(client ? client.saldo_cuenta_corriente : 0) || 0;
            const montoP = parseFloat(montoPago) || 0;
            const saldoEst = esDebito ? (saldo + montoP) : (saldo - montoP);
            const difAbs = parseFloat(Math.abs(saldoEst).toFixed(2));
            const chk = document.getElementById('swal-chk-ajuste-auto-univ');
            const radioFin = document.querySelector('input[name="swal-modo-fin-banco-univ"]:checked');
            const modoFin = radioFin ? radioFin.value : 'BONIFICAR';
            const infoFin = window.__lastUnivInfoFin || null;
            const compU = infoFin?.comp || null;
            const simFin = infoFin?.sim || null;
            const salvU = infoFin?.salv || null;
            const finActivaConIva = Number(simFin?.financiacion_activa_con_iva ?? compU?.financiacion_activa_con_iva ?? compU?.totales?.financiacion_activa_con_iva ?? salvU?.financiacion_total_con_iva ?? 0);
            const finHistBonif = Number(simFin?.financiacion_historica_bonificada_total ?? compU?.financiacion_historica_bonificada_total ?? compU?.totales?.financiacion_historica_bonificada_total ?? 0);
            const listaCompU = Array.isArray(compU?.comprobantes) ? compU.comprobantes : (compU?.movimientos || []);
            const diasMaxMora = Math.max(
                parseInt(compU?.antiguedad_maxima_dias || 0, 10),
                ...listaCompU.filter(m => Number(m.pendiente_actual ?? m.pendiente ?? 1) > 0.01).map(m => parseInt(m.antiguedad_dias ?? m.dias_antiguedad ?? 0, 10))
            );

            return {
                clienteId: selectVal,
                aplicarAjuste: chk ? chk.checked : false,
                montoAjuste: difAbs,
                modoFinanciacion: modoFin,
                ccId: infoFin?.ccId || client?.cuenta_corriente_id || null,
                finActivaConIva,
                finHistBonif,
                diasMaxMora,
                bonificado: Boolean(finActivaConIva > 0 && modoFin === 'BONIFICAR')
            };
        }
    });

    if (resObj && resObj.clienteId && onConfirm) {
        onConfirm(parseInt(resObj.clienteId, 10), resObj);
    }
}

async function abrirBuscadorClientes(movimientoId) {
    const movObj = (typeof rawMovements !== 'undefined' && Array.isArray(rawMovements))
        ? rawMovements.find(m => m.id == movimientoId)
        : null;
    const creditoVal = movObj ? (parseFloat(movObj.credito) || 0) : 0;
    const debitoVal = movObj ? (parseFloat(movObj.debito) || 0) : 0;
    const esDebito = debitoVal > 0 && creditoVal === 0;
    const montoMov = creditoVal > 0 ? creditoVal : debitoVal;

    await abrirBuscadorClientesUniversal({
        titulo: esDebito ? 'Vincular Pago Emitido a Cliente' : 'Vincular Cobro a Cliente',
        subtitulo: esDebito 
            ? 'Seleccione el cliente/colaborador para imputar esta transferencia enviada (débito bancario) en su Cuenta Corriente.'
            : 'Seleccione el cliente comercial para imputar este cobro bancario en su Cuenta Corriente.',
        montoPago: montoMov,
        esDebito: esDebito,
        onConfirm: (clienteId, opcionesAjuste) => {
            ejecutarVinculacion(movimientoId, clienteId, opcionesAjuste);
        }
    });
}

/**
 * Ejecuta la llamada API de vinculación/desvinculación y actualiza la grilla
 */
async function ejecutarVinculacion(movimientoId, clienteId, opcionesAjuste = {}) {
    try {
        mostrarLoading(true, clienteId ? 'Guardando vinculación...' : 'Removiendo vinculación...');
        const response = await fetch(`${API_BASE_URL}/movimientos/${movimientoId}/vincular-cliente`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                clienteId,
                aplicarAjuste: opcionesAjuste.aplicarAjuste || false,
                montoAjuste: opcionesAjuste.montoAjuste || 0,
                modoFinanciacion: opcionesAjuste.modoFinanciacion || 'BONIFICAR'
            })
        });
        
        const result = await response.json();
        if (result.success) {
            if (result.data && result.data.desglose_financiacion) {
                opcionesAjuste.desgloseFacturado = result.data.desglose_financiacion;
            } else if (
                clienteId &&
                result.data &&
                result.data.movimiento_cc &&
                (opcionesAjuste.modoFinanciacion === 'DESGLOSAR_INTERNA' || opcionesAjuste.modoFinanciacion === 'DESGLOSAR_ARCA')
            ) {
                const ccIdTarget = opcionesAjuste.ccId || result.data.movimiento_cc.cuenta_corriente_id;
                if (ccIdTarget) {
                    try {
                        const modoFact = opcionesAjuste.modoFinanciacion === 'DESGLOSAR_ARCA' ? 'APROBACION_ARCA' : 'APROBACION_INTERNA';
                        const respFin = await fetch(`${LOGISTICA_API_BASE}/api/logistica/bunker/cuentas-corrientes/${ccIdTarget}/facturar-interes-pago`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                pago_mov_id: result.data.movimiento_cc.id,
                                modo_facturacion: modoFact
                            })
                        });
                        const dataFin = await respFin.json();
                        if (dataFin && dataFin.success && dataFin.saldo_capital_actual !== undefined) {
                            result.data.saldo_cuenta_corriente = dataFin.saldo_capital_actual;
                            opcionesAjuste.desgloseFacturado = dataFin.data || dataFin;
                        }
                    } catch (errFin) {
                        console.warn('⚠️ [BANCARIO-FRONT] Error aplicando desglose de financiación:', errFin);
                    }
                }
            }

            // 1. Actualizar inmediatamente en memoria y re-renderizar la fila sin esperar el recálculo pesado
            if (Array.isArray(rawMovements)) {
                const idx = rawMovements.findIndex(m => m.id == movimientoId);
                if (idx !== -1) {
                    if (clienteId && result.data && result.data.cliente) {
                        rawMovements[idx].cliente_id = clienteId;
                        rawMovements[idx].cliente_razon_social = result.data.cliente.razon_social;
                        rawMovements[idx].cliente_nombre = result.data.cliente.cliente_nombre;
                        rawMovements[idx].cliente_codigo_bunker = result.data.cliente.codigo_bunker_cliente;
                    } else if (!clienteId) {
                        rawMovements[idx].cliente_id = null;
                        rawMovements[idx].cliente_razon_social = null;
                        rawMovements[idx].cliente_nombre = null;
                        rawMovements[idx].cliente_codigo_bunker = null;
                    }
                }
                aplicarFiltrosYRenderizar();
            }

            mostrarLoading(false);

            // Recargar movimientos completos en segundo plano sin bloquear la apertura de la ventana de WhatsApp
            cargarMovimientos().catch(err => console.warn('⚠️ [BANCARIO-FRONT] Error refrescando movimientos en 2do plano:', err));

            // 2. Si se vinculó a un cliente y se generó un comprobante en Cuenta Corriente,
            // abrir en el acto el modal oficial de despacho por WhatsApp
            if (clienteId && result.data && result.data.movimiento_cc) {
                await abrirModalEnvioComprobanteBancario({
                    movCC: result.data.movimiento_cc,
                    cliente: result.data.cliente,
                    saldoActual: result.data.saldo_cuenta_corriente,
                    esDebito: !result.data.es_cobro,
                    opcionesFinanciacion: opcionesAjuste
                });
            } else {
                Swal.fire({
                    icon: 'success',
                    title: clienteId ? 'Vinculación Exitosa' : 'Desvinculación Exitosa',
                    text: result.message,
                    confirmButtonColor: '#8b5cf6',
                    timer: 1500
                });
            }
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

/**
 * Permite abrir el modal de envío de Recibo + PDF de Políticas para un movimiento bancario ya vinculado
 */
async function reenviarComprobanteBancario(movimientoId) {
    try {
        if (clientesBunker.length === 0) {
            await cargarClientesBunker();
        }
        const movObj = (Array.isArray(rawMovements) ? rawMovements.find(m => m.id == movimientoId) : null);
        if (!movObj || !movObj.cliente_id) {
            Swal.fire({ icon: 'warning', title: 'Sin cliente vinculado', text: 'Este movimiento aún no tiene un cliente vinculado.' });
            return;
        }
        const clientObj = clientesBunker.find(c => String(c.id) === String(movObj.cliente_id));
        const codigoBunker = movObj.cliente_codigo_bunker || clientObj?.codigo_bunker;
        if (!codigoBunker) {
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se encontró el código Búnker del cliente.' });
            return;
        }

        mostrarLoading(true, 'Cargando comprobante y datos de la cuenta...');
        const respCtas = await fetch(`${LOGISTICA_API_BASE}/api/logistica/bunker/cuentas-corrientes?cliente=${encodeURIComponent(codigoBunker)}`).then(r => r.json());
        const cuentas = Array.isArray(respCtas?.data) ? respCtas.data : [];
        const ctaPrincipal = cuentas.find(c => c.nombre_cuenta === 'Cuenta Principal') || cuentas[0];
        const clienteFull = respCtas?.cliente || {
            id: movObj.cliente_id,
            razon_social: movObj.cliente_razon_social || clientObj?.razon_social,
            cliente_nombre: movObj.cliente_nombre || clientObj?.cliente_nombre,
            codigo_bunker_cliente: codigoBunker
        };

        if (!ctaPrincipal || !ctaPrincipal.id) {
            mostrarLoading(false);
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se encontró la Cuenta Corriente del cliente.' });
            return;
        }

        const respMovs = await fetch(`${LOGISTICA_API_BASE}/api/logistica/bunker/cuentas-corrientes/${ctaPrincipal.id}/movimientos`).then(r => r.json());
        const listaMovs = Array.isArray(respMovs?.data) ? respMovs.data : [];
        const tagMov = `[Mov: ${movimientoId}]`;
        let movCC = listaMovs.find(m => (m.descripcion || '').includes(tagMov));
        if (!movCC) {
            const montoBuscado = parseFloat(movObj.credito) > 0 ? parseFloat(movObj.credito) : parseFloat(movObj.debito);
            movCC = listaMovs.find(m => Math.abs((parseFloat(m.monto) || 0) - montoBuscado) < 0.01);
        }
        mostrarLoading(false);

        if (!movCC) {
            Swal.fire({ icon: 'warning', title: 'Comprobante no hallado', text: 'No se encontró el asiento correspondiente en la Cuenta Corriente.' });
            return;
        }

        const esDebito = (parseFloat(movObj.debito) || 0) > 0 && (parseFloat(movObj.credito) || 0) === 0;
        await abrirModalEnvioComprobanteBancario({
            movCC: { ...movCC, cuenta_corriente_id: ctaPrincipal.id },
            cliente: clienteFull,
            saldoActual: parseFloat(ctaPrincipal.saldo) || 0,
            esDebito
        });
    } catch (err) {
        mostrarLoading(false);
        console.error('❌ [BANCARIO-FRONT] Error abriendo modal de reenvío:', err);
        Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar el comprobante de la cuenta corriente.' });
    }
}

/**
 * Abre el modal interactivo de envío de comprobante por WhatsApp/Email
 * idéntico al de la Cuenta Corriente pero integrado fluidamente tras vincular en Cuentas Bancarias.
 */
async function abrirModalEnvioComprobanteBancario({ movCC, cliente, saldoActual, esDebito = false, opcionesFinanciacion = null }) {
    if (!cliente || !movCC) return;

    const configKey = `cc_envio_comprobante_config_${cliente.codigo_bunker_cliente}`;
    let savedConfig = null;
    try {
        const raw = localStorage.getItem(configKey);
        if (raw) savedConfig = JSON.parse(raw);
    } catch(e) {}

    // Resolver ID de cuenta corriente y composición post-pago para informar saldo consolidado real y políticas de financiación
    let ccId = opcionesFinanciacion?.ccId || movCC.cuenta_corriente_id || null;
    let compPost = null;
    try {
        if (!ccId && cliente.codigo_bunker_cliente) {
            const respBuscar = await fetch(`${LOGISTICA_API_BASE}/api/logistica/bunker/cuentas-corrientes?cliente=${encodeURIComponent(cliente.codigo_bunker_cliente)}`);
            const dataBuscar = await respBuscar.json();
            const match = (dataBuscar.data || []).find(item => item.codigo_bunker_cliente === cliente.codigo_bunker_cliente);
            if (match && (match.cuenta_corriente_id || match.id)) ccId = match.cuenta_corriente_id || match.id;
        }
        if (ccId) {
            const respComp = await fetch(`${LOGISTICA_API_BASE}/api/logistica/bunker/cuentas-corrientes/${ccId}/composicion-saldo`);
            const dataComp = await respComp.json();
            if (dataComp && dataComp.success) {
                compPost = dataComp.data;
            }
        }
    } catch (errComp) {
        console.warn('⚠️ [BANCARIO-FRONT] No se pudo consultar composición post-pago:', errComp);
    }

    // Recuperar y parsear contactos de WhatsApp
    let contacts = [];
    const rawWp = (cliente.whatsapp_facturas || '').trim();
    if (rawWp.startsWith('[')) {
        try {
            contacts = JSON.parse(rawWp);
        } catch(e) {}
    }
    if (!Array.isArray(contacts) || contacts.length === 0) {
        const rawPhone = (!rawWp.startsWith('[') ? rawWp : '') || cliente.celular || cliente.telefono || '';
        contacts = rawPhone.split(',').map(num => ({
            numero: num.trim(),
            nombre: '',
            cargo: '',
            default_resumen: true
        })).filter(c => c.numero);
    }
    contacts = contacts.map(c => ({
        numero: c.numero ? c.numero.replace(/\D/g, '') : '',
        nombre: c.nombre || '',
        cargo: c.cargo || '',
        default_resumen: c.default_resumen === true || c.default === true
    })).filter(c => c.numero.length > 0);

    // Recuperar y parsear contactos de Email
    let emails = [];
    const rawEmail = (cliente.email_facturas || '').trim();
    if (rawEmail.startsWith('[')) {
        try {
            emails = JSON.parse(rawEmail);
        } catch(e) {}
    }
    if (!Array.isArray(emails) || emails.length === 0) {
        const rawEmailVal = (!rawEmail.startsWith('[') ? rawEmail : '');
        if (rawEmailVal) {
            emails = rawEmailVal.split(',').map(e => ({
                email: e.trim(),
                nombre: '',
                cargo: '',
                default_factura: true
            })).filter(e => e.email);
        }
    }
    emails = emails.map(e => ({
        email: e.email ? e.email.trim() : '',
        nombre: e.nombre || '',
        cargo: e.cargo || '',
        default_factura: e.default_factura !== false
    })).filter(e => e.email.length > 0);

    // Saldo consolidado (incluyendo financiación activa si quedara saldo pendiente)
    const currentAccountBalance = compPost?.saldo_actual !== undefined
        ? parseFloat(compPost.saldo_actual)
        : (compPost?.totales?.saldo_actual !== undefined
            ? parseFloat(compPost.totales.saldo_actual)
            : (saldoActual !== undefined ? parseFloat(saldoActual) : (parseFloat(movCC.saldo_resultante) || 0)));
    const finActivaPost = Number(compPost?.financiacion_activa_con_iva ?? compPost?.totales?.financiacion_activa_con_iva ?? 0);
    const totalProyectadoPost = Number(compPost?.total_proyectado_con_iva ?? compPost?.totales?.total_proyectado_con_iva ?? (currentAccountBalance + finActivaPost));
    const impMovActual = (compPost?.imputaciones_por_movimiento && movCC?.id)
        ? compPost.imputaciones_por_movimiento[String(movCC.id)]
        : null;
    const finBonificadaReciente = Number(
        opcionesFinanciacion?.finActivaConIva ||
        impMovActual?.financiacion_bonificada_con_iva ||
        compPost?.financiacion_bonificada_con_iva ||
        compPost?.totales?.financiacion_bonificada_con_iva ||
        0
    );
    const autoCheckPoliticas = Boolean(opcionesFinanciacion?.bonificado || (finBonificadaReciente > 0 && Math.abs(currentAccountBalance) <= 0.01));

    let saldoStatusText = '';
    if (currentAccountBalance >= -0.01 && currentAccountBalance <= 0.01) {
        saldoStatusText = 'Su cuenta corriente se encuentra al día ($0,00).';
    } else if (currentAccountBalance < -0.01) {
        const absSaldo = Math.abs(currentAccountBalance);
        const formattedSaldo = currencyFormatter.format(absSaldo);
        saldoStatusText = `Ha quedado un saldo a favor de ${formattedSaldo}`;
    } else {
        const formattedCap = currencyFormatter.format(currentAccountBalance);
        if (finActivaPost > 0) {
            const formattedTot = currencyFormatter.format(totalProyectadoPost);
            const formattedFin = currencyFormatter.format(finActivaPost);
            saldoStatusText = `Saldo total pendiente en cuenta corriente: ${formattedTot} (Capital: ${formattedCap} + Servicio de Financiación c/IVA: ${formattedFin}).`;
        } else {
            saldoStatusText = `Saldo pendiente en cuenta corriente: ${formattedCap}`;
        }
    }

    const nroCompStr = movCC.numero_comprobante || (esDebito ? `PAGO-TRANSF-${String(movCC.id).padStart(8, '0')}` : `REC-PAGO-${String(movCC.id).padStart(8, '0')}`);

    const construirMensajeDinamico = (incluirPoliticas = false) => {
        if (esDebito) {
            return `Hola! Te enviamos el comprobante de la transferencia realizada por LAMDA (${nroCompStr}) por ${currencyFormatter.format(parseFloat(movCC.monto))}.\n\n${saldoStatusText}`;
        }
        if (incluirPoliticas) {
            if (currentAccountBalance >= -0.01 && currentAccountBalance <= 0.01 && finBonificadaReciente > 0) {
                return `Hola! Te enviamos el comprobante de pago recibido (${nroCompStr}). ${saldoStatusText}\n\nAdemás, te adjuntamos en PDF las Políticas y Beneficios de Financiación de tu cuenta LAMDA (con el detalle del cargo de financiación bonificado al 100% en esta operación y su vigencia para próximas órdenes). ¡Muchas gracias!`;
            }
            return `Hola! Te enviamos el comprobante de pago recibido (${nroCompStr}). ${saldoStatusText}\n\nAdemás, te adjuntamos en PDF las Políticas y Beneficios de Financiación de tu cuenta LAMDA. ¡Muchas gracias!`;
        }
        return `Comprobante de pago recibido (${nroCompStr}). Muchas gracias.\n\n${saldoStatusText}`;
    };

    const defaultMessage = construirMensajeDinamico(autoCheckPoliticas);
    const desgFin = opcionesFinanciacion?.desgloseFacturado || null;
    const bloqueDesgloseAplicadoHtml = desgFin ? `
            <div style="padding: 10px 12px; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                <div style="font-size: 11.5px; color: #78350f; line-height: 1.35;">
                    <div style="font-weight: 800; color: #b45309; margin-bottom: 2px;">🏛️ Desglose Capital + Interés Aplicado y Enviado a Facturación</div>
                    <div>Capital cancelado: <strong>${currencyFormatter.format(desgFin.capital_cancelado || 0)}</strong> · Interés Financiación c/IVA: <strong>${currencyFormatter.format(desgFin.financiacion_con_iva || 0)}</strong></div>
                    <div style="font-size: 11px; color: #92400e; margin-top: 2px;">Comprobante en Facturación: <strong>${desgFin.etiqueta_comprobante || `Factura #${desgFin.factura_id}`}</strong></div>
                </div>
                <a href="index.html" target="_blank" style="font-size: 11px; background: #0284c7; color: #ffffff; padding: 6px 10px; border-radius: 6px; text-decoration: none; font-weight: 700; white-space: nowrap;">
                    🧾 Ir a Facturación
                </a>
            </div>
    ` : '';

    // Armar HTML del modal con estilos limpios
    let htmlContent = `
        <div style="text-align: left; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; flex-direction: column; gap: 12px;">
            <div style="padding: 10px 12px; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-size: 13px; font-weight: 700; color: #16a34a;"><i class="fa-solid fa-circle-check"></i> Vinculación Registrada en Cuenta Corriente</div>
                    <div style="font-size: 12px; color: #475569; margin-top: 2px;">${cliente.razon_social} ${cliente.cliente_nombre ? `(${cliente.cliente_nombre})` : ''} · <strong>${nroCompStr}</strong></div>
                </div>
                <a href="${LOGISTICA_API_BASE}/api/logistica/bunker/cuentas-corrientes/movimientos/${movCC.id}/pdf" target="_blank" style="font-size: 11px; background: #ffffff; color: #dc2626; border: 1px solid #fca5a5; padding: 5px 9px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);" title="Ver comprobante generado en PDF">
                    <i class="fa-solid fa-file-pdf"></i> Ver Recibo PDF
                </a>
            </div>
            ${bloqueDesgloseAplicadoHtml}

            ${!esDebito && ccId ? `
            <!-- Documentos PDF Adjuntos (Recibo + Políticas y Beneficio de Financiación LAMDA) -->
            <div style="border: 1px solid #bae6fd; border-radius: 8px; padding: 10px 12px; background: #f0f9ff;">
                <div style="font-size: 12px; font-weight: 700; color: #0369a1; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                    <span>📎 Documentos PDF a Enviar al Cliente</span>
                    <a href="${LOGISTICA_API_BASE}/api/logistica/bunker/cuentas-corrientes/${ccId}/reporte-pdf?tipo_doc=politicas_financiacion&movimiento_id=${movCC.id}&inline=1" target="_blank"
                       style="font-size: 10.5px; background: #ffffff; color: #0284c7; border: 1px solid #7dd3fc; padding: 3px 8px; border-radius: 5px; text-decoration: none; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                       👁️ Ver PDF Políticas
                    </a>
                </div>
                <label style="display: flex; align-items: flex-start; gap: 8px; padding: 7px 8px; background: #ffffff; border: 1px solid ${autoCheckPoliticas ? '#34d399' : '#bae6fd'}; border-radius: 6px; cursor: pointer; margin: 0;">
                    <input type="checkbox" id="swal-chk-adjuntar-politicas-pdf" ${autoCheckPoliticas ? 'checked' : ''} style="margin-top: 2px; width: 15px; height: 15px; accent-color: #0284c7; cursor: pointer;">
                    <div style="flex: 1; font-size: 11px; line-height: 1.35;">
                        <div style="font-weight: 700; color: #0f172a;">
                            📘 Adjuntar PDF: "Políticas y Beneficio de Financiación LAMDA" (con ejemplo práctico de su cuenta)
                        </div>
                        <div style="color: #475569; margin-top: 2px;">
                            ${finBonificadaReciente > 0
                                ? `Explica las 4 etapas (0% hasta 7 días, +3 días gracia, comodines hasta 14 días, eCheq sin costo) e informa que hoy se bonificó el 100% (${currencyFormatter.format(finBonificadaReciente)}) dejando la cuenta en $0,00 para aplicarse desde próximas órdenes.`
                                : `Explica las 4 etapas de financiación (0% hasta 7 días, +3 días gracia, comodines hasta 14 días, eCheq sin costo) y el ejemplo práctico de la cuenta.`}
                        </div>
                    </div>
                </label>
            </div>
            ` : ''}

            <!-- Sección WhatsApp -->
            <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #f9fafb;">
                <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #16a34a; display: flex; align-items: center; gap: 6px; font-weight: 600;">
                    📱 Enviar por WhatsApp
                </h4>
    `;

    if (contacts.length === 0) {
        htmlContent += `
            <p style="font-size: 11px; color: #94a3b8; margin: 0 0 6px 0;">No hay contactos de WhatsApp preconfigurados en la ficha.</p>
        `;
    } else {
        htmlContent += `
            <div style="display: flex; flex-direction: column; gap: 6px; max-height: 110px; overflow-y: auto; padding: 2px; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 8px; background: white;">
        `;

        contacts.forEach((c, index) => {
            let isChecked = false;
            if (savedConfig && savedConfig.selectedWps) {
                isChecked = savedConfig.selectedWps.includes(c.numero);
            } else {
                isChecked = c.default_resumen === true;
            }

            const formattedNum = c.numero.replace(/\D/g, '');
            let displayNum = c.numero;
            if (formattedNum.length === 10) {
                displayNum = `(${formattedNum.substring(0,3)}) ${formattedNum.substring(3,6)}-${formattedNum.substring(6,10)}`;
            } else if (formattedNum.length === 13 && formattedNum.startsWith('549')) {
                displayNum = `+54 9 (${formattedNum.substring(3,6)}) ${formattedNum.substring(6,9)}-${formattedNum.substring(9,13)}`;
            } else if (formattedNum.length === 11 && formattedNum.startsWith('54')) {
                displayNum = `+54 (${formattedNum.substring(2,5)}) ${formattedNum.substring(5,8)}-${formattedNum.substring(8,11)}`;
            }

            const labelText = c.nombre 
                ? `<strong>${c.nombre}</strong>${c.cargo ? ` <span style="font-size: 9px; background: #e0f2fe; color: #0369a1; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${c.cargo}</span>` : ''}`
                : `Contacto #${index + 1}`;

            htmlContent += `
                <label style="display: flex; align-items: flex-start; gap: 8px; padding: 6px; border: 1px solid #f1f5f9; border-radius: 4px; background: #fafafa; cursor: pointer; transition: background 0.2s; margin-bottom: 0;">
                    <input type="checkbox" class="swal-comp-contacto-wp-chk" value="${c.numero}" ${isChecked ? 'checked' : ''} style="margin-top: 2px; cursor: pointer; width: 14px; height: 14px; accent-color: #25d366;">
                    <div style="flex: 1; font-size: 11px;">
                        <div style="color: #1f2937; margin-bottom: 1px;">${labelText}</div>
                        <div style="color: #6b7280;">📞 ${displayNum}</div>
                    </div>
                </label>
            `;
        });

        htmlContent += `</div>`;
    }

    const savedCustomPhone = (savedConfig && savedConfig.customPhone) ? savedConfig.customPhone : '';

    htmlContent += `
                <div>
                    <label style="display: block; font-size: 11px; font-weight: 600; color: #6b7280; margin-bottom: 3px;">Otro número de WhatsApp:</label>
                    <input type="text" id="swal-comp-custom-phone" placeholder="Ej: 2216615746" value="${savedCustomPhone}" style="width: 100%; padding: 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 11px; box-sizing: border-box;">
                </div>
            </div>

            <!-- Sección Correo Electrónico (Opcional) -->
            ${emails.length > 0 ? `
            <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #f9fafb;">
                <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #2563eb; display: flex; align-items: center; gap: 6px; font-weight: 600;">
                    ✉️ Enviar por Correo Electrónico (Opcional)
                </h4>
                <div style="display: flex; flex-direction: column; gap: 6px; max-height: 90px; overflow-y: auto; padding: 2px; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 8px; background: white;">
                    ${emails.map((e, index) => {
                        let isChecked = false;
                        if (savedConfig && savedConfig.selectedEmails) {
                            isChecked = savedConfig.selectedEmails.includes(e.email);
                        } else {
                            isChecked = false;
                        }
                        const labelText = e.nombre ? `<strong>${e.nombre}</strong>` : `Email #${index + 1}`;
                        return `
                            <label style="display: flex; align-items: flex-start; gap: 8px; padding: 6px; border: 1px solid #f1f5f9; border-radius: 4px; background: #fafafa; cursor: pointer; margin-bottom: 0;">
                                <input type="checkbox" class="swal-comp-contacto-email-chk" value="${e.email}" ${isChecked ? 'checked' : ''} style="margin-top: 2px; cursor: pointer; width: 14px; height: 14px; accent-color: #2563eb;">
                                <div style="flex: 1; font-size: 11px;">
                                    <div style="color: #1f2937; margin-bottom: 1px;">${labelText}</div>
                                    <div style="color: #6b7280; word-break: break-all;">@ ${e.email}</div>
                                </div>
                            </label>
                        `;
                    }).join('')}
                </div>
            </div>
            ` : ''}

            <!-- Cuerpo del mensaje -->
            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <label style="font-size: 11.5px; font-weight: 600; color: #374151;">Cuerpo del Mensaje (Editable):</label>
                    <button type="button" id="btn-reset-cc-mensaje" style="background: none; border: none; color: #4f46e5; font-size: 10.5px; font-weight: 600; cursor: pointer; text-decoration: underline;">
                        🔄 Regenerar Mensaje Dinámico
                    </button>
                </div>
                <textarea id="swal-comp-mensaje" style="width: 100%; height: 85px; padding: 6px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 11.5px; box-sizing: border-box; resize: vertical; font-family: inherit; line-height: 1.4;"></textarea>
            </div>

            <!-- Botón de guardar configuración -->
            <button type="button" id="btn-save-cc-config" style="width: 100%; background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; border-radius: 6px; padding: 7px 12px; font-size: 11.5px; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 5px;">
                💾 Guardar Preferencias de Contacto
            </button>
        </div>
    `;

    const { value: modalResult } = await Swal.fire({
        title: 'Enviar Comprobante',
        html: htmlContent,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: '📤 Enviar por WhatsApp',
        cancelButtonText: 'Omitir / Listo',
        confirmButtonColor: '#16a34a',
        cancelButtonColor: '#6b7280',
        didOpen: () => {
            const textarea = document.getElementById('swal-comp-mensaje');
            const chkPoliticas = document.getElementById('swal-chk-adjuntar-politicas-pdf');
            if (textarea) textarea.value = defaultMessage;

            if (chkPoliticas && textarea) {
                chkPoliticas.addEventListener('change', () => {
                    textarea.value = construirMensajeDinamico(chkPoliticas.checked);
                });
            }

            const btnReset = document.getElementById('btn-reset-cc-mensaje');
            if (btnReset && textarea) {
                btnReset.addEventListener('click', () => {
                    const incPol = chkPoliticas ? chkPoliticas.checked : false;
                    textarea.value = construirMensajeDinamico(incPol);
                });
            }

            const btnSave = document.getElementById('btn-save-cc-config');
            if (btnSave) {
                btnSave.addEventListener('click', () => {
                    const selectedWps = Array.from(document.querySelectorAll('.swal-comp-contacto-wp-chk:checked')).map(el => el.value);
                    const selectedEmails = Array.from(document.querySelectorAll('.swal-comp-contacto-email-chk:checked')).map(el => el.value);
                    const customPhone = document.getElementById('swal-comp-custom-phone').value.trim();

                    const config = {
                        selectedWps,
                        selectedEmails,
                        customPhone
                    };

                    localStorage.setItem(configKey, JSON.stringify(config));

                    const originalText = btnSave.innerHTML;
                    btnSave.innerHTML = '✓ ¡Preferencias guardadas!';
                    btnSave.style.backgroundColor = '#dcfce7';
                    btnSave.style.color = '#15803d';
                    btnSave.style.borderColor = '#86efac';

                    setTimeout(() => {
                        btnSave.innerHTML = originalText;
                        btnSave.style.backgroundColor = '';
                        btnSave.style.color = '';
                        btnSave.style.borderColor = '';
                    }, 2500);
                });
            }
        },
        preConfirm: () => {
            const selectedWps = Array.from(document.querySelectorAll('.swal-comp-contacto-wp-chk:checked')).map(el => el.value);
            const selectedEmails = Array.from(document.querySelectorAll('.swal-comp-contacto-email-chk:checked')).map(el => el.value);
            const customPhone = document.getElementById('swal-comp-custom-phone').value.trim();
            const mensajeTexto = document.getElementById('swal-comp-mensaje').value;
            const chkPoliticas = document.getElementById('swal-chk-adjuntar-politicas-pdf');
            const adjuntarPoliticas = chkPoliticas ? chkPoliticas.checked : false;

            const wps = [...selectedWps];
            if (customPhone) {
                customPhone.split(',').forEach(p => {
                    const clean = p.replace(/[^\d]/g, '');
                    if (clean) wps.push(clean);
                });
            }

            const mails = [...selectedEmails];

            if (wps.length === 0 && mails.length === 0) {
                Swal.showValidationMessage('Debe seleccionar o ingresar al menos un número de WhatsApp o Email.');
                return false;
            }

            return { wps, mails, mensajeTexto, adjuntarPoliticas };
        }
    });

    if (modalResult) {
        const { wps, mails, mensajeTexto, adjuntarPoliticas } = modalResult;
        const documentosAdjuntos = adjuntarPoliticas ? ['recibo', 'politicas_financiacion'] : ['recibo'];
        const promises = [];

        if (wps.length > 0) {
            promises.push(
                fetch(`${LOGISTICA_API_BASE}/api/logistica/bunker/cuentas-corrientes/movimientos/${movCC.id}/whatsapp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        destinatarios: wps.join(', '),
                        mensajeTexto: mensajeTexto,
                        documentos_adjuntos: documentosAdjuntos,
                        adjuntarPoliticasPdf: adjuntarPoliticas
                    })
                }).then(async r => {
                    const data = await r.json();
                    if (!r.ok || !data.success) {
                        throw new Error(data.message || data.error || 'Error al enviar por WhatsApp');
                    }
                    return data;
                })
            );
        }

        if (mails.length > 0) {
            promises.push(
                fetch(`${LOGISTICA_API_BASE}/api/logistica/bunker/cuentas-corrientes/movimientos/${movCC.id}/email`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        destinatarios: mails.join(', '),
                        mensajeTexto: mensajeTexto,
                        documentos_adjuntos: documentosAdjuntos,
                        adjuntarPoliticasPdf: adjuntarPoliticas
                    })
                }).then(async r => {
                    const data = await r.json();
                    if (!r.ok || !data.success) {
                        throw new Error(data.message || data.error || 'Error al enviar por Email');
                    }
                    return data;
                })
            );
        }

        if (promises.length > 0) {
            Swal.fire({
                title: 'Enviando Comprobante...',
                text: 'Por favor, espere mientras se despacha el documento.',
                allowOutsideClick: false,
                allowEscapeKey: false,
                showConfirmButton: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            try {
                await Promise.all(promises);
                Swal.fire({
                    icon: 'success',
                    title: '¡Enviado con Éxito!',
                    text: adjuntarPoliticas
                        ? 'El comprobante y el PDF de Políticas y Beneficios de Financiación han sido enviados correctamente.'
                        : 'El comprobante ha sido enviado correctamente.',
                    confirmButtonColor: '#16a34a'
                });
            } catch (err) {
                console.error('❌ [BANCARIO-FRONT] Error al despachar comprobante:', err);
                Swal.fire({
                    icon: 'error',
                    title: 'Fallo al Enviar',
                    text: err.message || 'No se pudo enviar el comprobante.',
                    confirmButtonColor: '#ef4444'
                });
            }
        }
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

    // 2.5 Ordenar siempre por fecha del cheque (fecha_pago) descendente: más recientes arriba y más antiguos al final
    filtered.sort((a, b) => {
        const timeA = a.fecha_pago ? new Date(a.fecha_pago).getTime() : -Infinity;
        const timeB = b.fecha_pago ? new Date(b.fecha_pago).getTime() : -Infinity;
        const validA = Number.isFinite(timeA) ? timeA : -Infinity;
        const validB = Number.isFinite(timeB) ? timeB : -Infinity;
        if (validB !== validA) return validB - validA;
        return String(b.numero_cheque || '').localeCompare(String(a.numero_cheque || ''));
    });
    
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
            const shieldBadge = ch.reconciliado_por_numero 
                ? `<span class="badge" style="background: rgba(139, 92, 246, 0.2); color: #c084fc; border: 1px solid rgba(139, 92, 246, 0.4); font-size: 10px;" title="Conciliación automática granítica por Nro de Cheque único (${ch.numero_cheque})"><i class="fa-solid fa-shield-halved"></i> Conciliado Único</span>`
                : '';

            clientHtml = `
                <div style="display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span class="btn-link-action linked" title="Cliente vinculado"><i class="fa-solid fa-circle-check"></i> ${ch.cliente_razon_social}</span>
                    ${shieldBadge}
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
    const ch = (typeof rawCheques !== 'undefined' && Array.isArray(rawCheques))
        ? rawCheques.find(c => String(c.id) === String(chequeId))
        : null;
    const montoCheque = ch ? parseFloat(ch.importe || 0) : 0;

    await abrirBuscadorClientesUniversal({
        titulo: 'Vincular Cheque a Cliente',
        subtitulo: `Vinculando Cheque Nro: <strong>${numeroCheque}</strong>. Se generará de forma automática un crédito a favor en su Cuenta Corriente.`,
        montoPago: montoCheque,
        onConfirm: (clienteId, opcionesAjuste) => {
            vincularChequeConfirmado(chequeId, clienteId, opcionesAjuste);
        }
    });
}

/**
 * Realiza la llamada de vinculación de cheque en el backend
 */
async function vincularChequeConfirmado(chequeId, clienteId, opcionesAjuste = {}) {
    try {
        mostrarLoading(true, 'Guardando vinculación contable...');
        const response = await fetch(`${API_BASE_URL}/cheques/${chequeId}/vincular`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                clienteId,
                aplicarAjuste: opcionesAjuste.aplicarAjuste || false,
                montoAjuste: opcionesAjuste.montoAjuste || 0
            })
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
