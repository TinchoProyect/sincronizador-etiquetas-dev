/**
 * Front-end de Recepción, Auditoría y Acreditación de Efectivo Ensobrado (LAMDA)
 */

let todosLosSobres = [];
let clienteActivo = null;

document.addEventListener('DOMContentLoaded', () => {
    inicializarNavegacionCliente();
    cargarSobres();
    configurarEventos();
});

function inicializarNavegacionCliente() {
    const urlParams = new URLSearchParams(window.location.search);
    const clienteUrl = urlParams.get('cliente');

    if (clienteUrl) {
        clienteActivo = clienteUrl;
        sessionStorage.setItem('ultimo_cliente_bunker_cc', clienteUrl);
        // Pre-cargar filtro de búsqueda con el cliente
        const inputFiltro = document.getElementById('filtro-busqueda');
        if (inputFiltro) {
            inputFiltro.value = clienteUrl;
        }
    } else {
        clienteActivo = sessionStorage.getItem('ultimo_cliente_bunker_cc') || localStorage.getItem('ultimo_cliente_bunker_cc');
    }

    actualizarBotonVolverCC();
}

function actualizarBotonVolverCC(codigoClienteNuevo) {
    if (codigoClienteNuevo) {
        clienteActivo = codigoClienteNuevo;
        sessionStorage.setItem('ultimo_cliente_bunker_cc', codigoClienteNuevo);
    }

    const btnVolver = document.getElementById('btn-volver-cc');
    if (!btnVolver) return;

    if (clienteActivo) {
        btnVolver.innerHTML = `← Volver a CC (<strong>${clienteActivo}</strong>)`;
        btnVolver.onclick = () => {
            window.location.href = `cuenta-corriente.html?cliente=${encodeURIComponent(clienteActivo)}`;
        };
    } else {
        btnVolver.innerHTML = `← Volver a Cuentas Corrientes`;
        btnVolver.onclick = () => {
            window.location.href = `listado-clientes.html`;
        };
    }
}

function configurarEventos() {
    document.getElementById('btn-refrescar').addEventListener('click', cargarSobres);
    document.getElementById('filtro-busqueda').addEventListener('input', filtrarSobres);
    document.getElementById('filtro-estado').addEventListener('change', filtrarSobres);
    document.getElementById('filtro-modalidad').addEventListener('change', filtrarSobres);
}

// Cargar sobres desde el backend
async function cargarSobres() {
    const tbody = document.getElementById('tabla-sobres-body');
    tbody.innerHTML = `
        <tr>
            <td colspan="8" style="text-align: center; padding: 30px; color: #64748b;">
                🔄 Cargando sobres de efectivo...
            </td>
        </tr>
    `;

    try {
        const res = await fetch('/api/logistica/pagos-efectivo');
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.error || 'Error al obtener sobres');
        }

        todosLosSobres = data.sobres || [];
        actualizarKPIs(todosLosSobres);
        filtrarSobres();

    } catch (err) {
        console.error('Error al cargar sobres:', err);
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 30px; color: #ef4444;">
                    ❌ Error al cargar sobres: ${err.message}
                </td>
            </tr>
        `;
    }
}

// Actualizar tarjetas de KPI
function actualizarKPIs(sobres) {
    const pendientes = sobres.filter(s => ['PREPARADO', 'EN_TRANSITO', 'RECIBIDO_LOCAL'].includes(s.estado));
    const montoPendiente = pendientes.reduce((acc, s) => acc + parseFloat(s.monto_declarado || 0), 0);
    
    const acreditados = sobres.filter(s => s.estado === 'ACREDITADO');
    const montoAcreditado = acreditados.reduce((acc, s) => acc + parseFloat(s.monto_auditado || s.monto_declarado || 0), 0);

    document.getElementById('kpi-pendientes').textContent = pendientes.length;
    document.getElementById('kpi-monto-pendiente').textContent = formatCurrency(montoPendiente);
    document.getElementById('kpi-acreditados').textContent = acreditados.length;
    document.getElementById('kpi-monto-acreditado').textContent = formatCurrency(montoAcreditado);
}

// Filtrar sobres según inputs
function filtrarSobres() {
    const query = document.getElementById('filtro-busqueda').value.toLowerCase().trim();
    const estadoFiltro = document.getElementById('filtro-estado').value;
    const modalidadFiltro = document.getElementById('filtro-modalidad').value;

    const terminos = query ? query.split(/\s+/) : [];

    const filtrados = todosLosSobres.filter(s => {
        // Filtro por Estado
        if (estadoFiltro === 'PENDIENTES_ACREDITAR') {
            if (!['PREPARADO', 'EN_TRANSITO', 'RECIBIDO_LOCAL'].includes(s.estado)) return false;
        } else if (estadoFiltro !== 'TODOS' && s.estado !== estadoFiltro) {
            return false;
        }

        // Filtro por Modalidad
        if (modalidadFiltro && s.modalidad_entrega !== modalidadFiltro) {
            return false;
        }

        // Filtro de Búsqueda Acumulativa (Espacios = AND)
        if (terminos.length > 0) {
            const bolsaTexto = `
                ${s.codigo_sobre || ''} 
                ${s.cliente_id || ''} 
                ${s.cliente_razon_social || ''} 
                ${s.cliente_nombre_fantasia || ''} 
                ${s.cliente_cuit || ''}
            `.toLowerCase();

            const coincideTodos = terminos.every(term => bolsaTexto.includes(term));
            if (!coincideTodos) return false;
        }

        return true;
    });

    renderizarTabla(filtrados);
}

// Renderizar tabla de resultados
function renderizarTabla(sobres) {
    const tbody = document.getElementById('tabla-sobres-body');

    if (sobres.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 30px; color: #64748b;">
                    No se encontraron sobres con los filtros seleccionados.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = sobres.map(s => {
        const badgeClass = `badge-${(s.estado || '').toLowerCase()}`;
        const fechaObj = s.fecha_creacion ? new Date(s.fecha_creacion) : null;
        const fechaStr = fechaObj ? fechaObj.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
        
        // Calcular antigüedad relativa para detectar de inmediato sobres viejos colgados
        let etiquetaAntiguedad = '';
        if (fechaObj) {
            const ahora = new Date();
            const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
            const inicioFecha = new Date(fechaObj.getFullYear(), fechaObj.getMonth(), fechaObj.getDate());
            const diasDiff = Math.round((inicioHoy - inicioFecha) / (1000 * 60 * 60 * 24));
            const esPendiente = ['PREPARADO', 'PENDIENTE_ENSOBRADO', 'EN_TRANSITO', 'RECIBIDO_LOCAL'].includes(s.estado);

            if (diasDiff <= 0) {
                etiquetaAntiguedad = `<span style="display:inline-block; margin-top:2px; font-size:0.7rem; font-weight:700; color:#15803d; background:#dcfce7; padding:1px 6px; border-radius:4px;">Hoy</span>`;
            } else if (diasDiff === 1) {
                etiquetaAntiguedad = `<span style="display:inline-block; margin-top:2px; font-size:0.7rem; font-weight:700; color:#0369a1; background:#e0f2fe; padding:1px 6px; border-radius:4px;">Ayer</span>`;
            } else if (esPendiente && diasDiff >= 3) {
                etiquetaAntiguedad = `<span style="display:inline-block; margin-top:2px; font-size:0.7rem; font-weight:700; color:#b45309; background:#fef3c7; border:1px solid #fde68a; padding:1px 6px; border-radius:4px;" title="Este sobre fue creado hace ${diasDiff} días">⚠️ Hace ${diasDiff} días</span>`;
            } else {
                etiquetaAntiguedad = `<span style="display:inline-block; margin-top:2px; font-size:0.7rem; color:#64748b;">Hace ${diasDiff} días</span>`;
            }
        }

        const clienteNombre = s.cliente_razon_social || s.cliente_nombre_fantasia || 'Sin Razón Social';
        const saldoCC = parseFloat(s.saldo_cuenta_corriente) || 0;
        const puedeAnular = !['ACREDITADO', 'CANCELADO'].includes(s.estado);

        return `
            <tr>
                <td>
                    <strong style="color: var(--purple-primary); font-family: monospace; font-size: 0.98rem;">${s.codigo_sobre}</strong>
                </td>
                <td style="color: #334155; font-size: 0.82rem;">
                    <div>${fechaStr}</div>
                    ${etiquetaAntiguedad}
                </td>
                <td>
                    <a href="cuenta-corriente.html?cliente=${encodeURIComponent(s.cliente_id)}" style="color: #1e293b; text-decoration: none; font-weight: 700;" title="Abrir Ficha de Cuenta Corriente de ${clienteNombre}">
                        ${clienteNombre}
                    </a>
                    <div style="font-size: 0.75rem; color: #64748b;">
                        Cód: <a href="cuenta-corriente.html?cliente=${encodeURIComponent(s.cliente_id)}" style="color: #8e4785; font-weight: 700; text-decoration: underline;" title="Ver Cuenta Corriente">${s.cliente_id}</a> ${s.cliente_cuit ? `| CUIT: ${s.cliente_cuit}` : ''}
                        ${s.colaborador_nombre ? `<span style="color: #8e4785; font-weight: 600; display: block; margin-top: 2px;">👤 Encargado: ${s.colaborador_nombre}</span>` : ''}
                    </div>
                </td>
                <td>
                    <span style="font-size: 0.8rem; display: flex; align-items: center; gap: 4px; font-weight: 600;">
                        ${s.modalidad_entrega === 'CHOFER' ? '🚚 Chofer' : '🏬 Local'}
                    </span>
                </td>
                <td style="text-align: right;">
                    <div style="display: inline-block; background: ${s.estado === 'ACREDITADO' && s.monto_auditado && Math.abs(parseFloat(s.monto_auditado) - parseFloat(s.monto_declarado)) >= 0.01 ? '#fffbeb' : '#ecfdf5'}; border: 1px solid ${s.estado === 'ACREDITADO' && s.monto_auditado && Math.abs(parseFloat(s.monto_auditado) - parseFloat(s.monto_declarado)) >= 0.01 ? '#fde68a' : '#a7f3d0'}; border-radius: 6px; padding: 4px 10px; text-align: right;">
                        <strong style="font-weight: 800; font-size: 0.98rem; color: #15803d; display: block;">
                            ${formatCurrency(s.estado === 'ACREDITADO' && s.monto_auditado ? s.monto_auditado : s.monto_declarado)}
                        </strong>
                        ${s.estado === 'ACREDITADO' && s.monto_auditado && Math.abs(parseFloat(s.monto_auditado) - parseFloat(s.monto_declarado)) >= 0.01 ? `
                            <span style="font-size: 0.68rem; color: #b45309; font-weight: 700; display: block;">Decl: ${formatCurrency(s.monto_declarado)}</span>
                        ` : `
                            <span style="font-size: 0.68rem; color: #047857; font-weight: 600; text-transform: uppercase;">Efectivo en sobre</span>
                        `}
                    </div>
                </td>
                <td style="text-align: right;">
                    <span style="font-weight: 600; font-size: 0.88rem; color: ${saldoCC > 0 ? '#64748b' : '#16a34a'}; display: block;">
                        ${formatCurrency(saldoCC)}
                    </span>
                    <span style="font-size: 0.68rem; color: ${saldoCC > 0 ? '#e11d48' : '#16a34a'}; font-weight: 600;">
                        ${saldoCC > 0 ? 'Deuda total en CC' : (saldoCC < 0 ? 'Saldo a favor en CC' : 'Cuenta al día')}
                    </span>
                </td>
                <td style="text-align: center;">
                    <span class="badge-status ${badgeClass}">
                        ${s.estado.replace('_', ' ')}
                    </span>
                </td>
                <td style="text-align: center;">
                    <div style="display: inline-flex; gap: 6px; align-items: center;">
                        <button class="btn-action btn-audit" onclick="abrirModalAuditoria('${s.codigo_sobre}')">
                            🔍 ${s.estado === 'ACREDITADO' ? 'Ver Arqueo' : 'Auditar'}
                        </button>
                        ${s.estado === 'ACREDITADO' ? `
                            <button class="btn-action" style="background: #dcfce7; color: #15803d; border: 1px solid #86efac; padding: 6px 10px; font-weight: 700;" title="Enviar informe y recibo de acreditación por WhatsApp / Email" onclick="abrirModalNotificacionSobre('${s.codigo_sobre}')">
                                📲 WhatsApp / Email
                            </button>
                        ` : ''}
                        ${puedeAnular ? `
                            <button class="btn-action" style="background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; padding: 6px 9px;" title="Anular / Cancelar sobre duplicado o erróneo" onclick="confirmarYCancelarSobre('${s.codigo_sobre}')">
                                🗑️
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Formateador de moneda
function formatCurrency(val) {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS'
    }).format(val || 0);
}

// Recuperar arqueo guardado localmente para un sobre (respaldo de detalle por denominación)
function obtenerArqueoGuardadoLocal(codigoSobre) {
    try {
        const raw = localStorage.getItem(`arqueo_sobre_${codigoSobre}`);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

// Modal de Auditoría y Arqueo Físico con Conteo Interactivo por Denominación
async function abrirModalAuditoria(codigoSobre) {
    const sobre = todosLosSobres.find(s => s.codigo_sobre === codigoSobre);
    if (!sobre) return;

    const esAcreditado = sobre.estado === 'ACREDITADO';
    const esCancelado = sobre.estado === 'CANCELADO';
    const editable = !esAcreditado && !esCancelado;

    if (editable) {
        try {
            localStorage.removeItem(`arqueo_sobre_${sobre.codigo_sobre}`);
        } catch (e) {}
    }

    // Si está pendiente de auditar, consultar la simulación Salvavidas de la Cuenta Corriente del cliente
    // para calcular en vivo cuánto del sobre cancela Capital (ya facturado) y cuánto cancela Interés (sin facturar)
    let salvavidasSimCliente = null;
    if (editable && sobre.cliente_id) {
        try {
            const resCC = await fetch(`/api/logistica/bunker/cuentas-corrientes?cliente=${encodeURIComponent(sobre.cliente_id)}`);
            const jsonCC = await resCC.json();
            if (jsonCC.success && Array.isArray(jsonCC.data) && jsonCC.data.length > 0) {
                const ccId = jsonCC.data[0].id;
                const resSim = await fetch(`/api/logistica/bunker/cuentas-corrientes/${ccId}/salvavidas-simulacion`);
                const jsonSim = await resSim.json();
                if (jsonSim.success && jsonSim.data) {
                    salvavidasSimCliente = jsonSim.data;
                }
            }
        } catch (errSim) {
            console.warn('No se pudo pre-cargar simulación Salvavidas en auditoría de sobre:', errSim);
        }
    }

    const desgloseDeclarado = (sobre.desglose_billetes && typeof sobre.desglose_billetes === 'object')
        ? sobre.desglose_billetes
        : {};
    const arqueoPrevio = editable ? null : obtenerArqueoGuardadoLocal(sobre.codigo_sobre);
    const desgloseContadoInicial = (!editable && arqueoPrevio && arqueoPrevio.desglose_auditado)
        ? arqueoPrevio.desglose_auditado
        : { ...desgloseDeclarado };

    // Unificar denominaciones presentes ordenadas de menor a mayor o mayor a menor
    const denomsSet = new Set([
        ...Object.keys(desgloseDeclarado).filter(d => parseInt(desgloseDeclarado[d], 10) > 0),
        ...Object.keys(desgloseContadoInicial).filter(d => parseInt(desgloseContadoInicial[d], 10) > 0)
    ]);
    const denomsOrdenadas = Array.from(denomsSet).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    const construirFilasBilletesHtml = () => {
        if (denomsOrdenadas.length === 0) {
            return `<tr id="fila-sin-desglose"><td colspan="5" style="text-align: center; padding: 10px; color: #64748b;">Sin desglose declarado. Puede agregar denominaciones debajo.</td></tr>`;
        }
        return denomsOrdenadas.map(den => {
            const denNum = parseInt(den, 10);
            const cantDecl = parseInt(desgloseDeclarado[den] || 0, 10);
            const cantCont = editable
                ? (desgloseContadoInicial[den] !== undefined ? parseInt(desgloseContadoInicial[den], 10) : cantDecl)
                : (arqueoPrevio && arqueoPrevio.desglose_auditado && arqueoPrevio.desglose_auditado[den] !== undefined
                    ? parseInt(arqueoPrevio.desglose_auditado[den], 10)
                    : cantDecl);
            const subCont = denNum * cantCont;
            const difU = cantCont - cantDecl;

            let badgeDifHtml = `<span style="color: #16a34a; font-weight: 700; font-size: 0.75rem;">✓ OK</span>`;
            if (difU !== 0) {
                const signo = difU > 0 ? '+' : '';
                const color = difU < 0 ? '#dc2626' : '#d97706';
                badgeDifHtml = `<span style="color: ${color}; font-weight: 800; font-size: 0.75rem;">${signo}${difU} u.</span>`;
            }

            return `
                <tr class="fila-arqueo-billete" data-denom="${denNum}" data-declarado="${cantDecl}" style="border-bottom: 1px solid #e2e8f0; background: ${difU !== 0 ? '#fffbeb' : '#ffffff'};">
                    <td style="padding: 6px; font-weight: 700; color: #1e293b;">$ ${denNum.toLocaleString('es-AR')}</td>
                    <td style="padding: 6px; text-align: center; color: #475569; font-weight: 600;">${cantDecl} u.</td>
                    <td style="padding: 5px 6px; text-align: center;">
                        ${editable ? `
                            <input type="number" class="input-billete-contado" data-denom="${denNum}" data-declarado="${cantDecl}" value="${cantCont}" min="0" step="1"
                                style="width: 68px; padding: 4px 6px; border: 2px solid #8e4785; border-radius: 6px; text-align: center; font-weight: 800; font-size: 0.9rem; color: #0f172a; background: #faf5ff;" />
                        ` : `
                            <strong style="color: ${difU !== 0 ? '#b45309' : '#0f172a'};">${cantCont} u.</strong>
                        `}
                    </td>
                    <td class="celda-subtotal-billete" style="padding: 6px; text-align: right; font-weight: 700; color: #16a34a;">
                        $ ${subCont.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </td>
                    <td class="celda-dif-billete" style="padding: 6px; text-align: center;">
                        ${badgeDifHtml}
                    </td>
                </tr>
            `;
        }).join('');
    };

    Swal.fire({
        title: `<span style="color: #8e4785; font-size: 1.3rem; font-weight: 800;">Auditoría y Arqueo de Sobre ${sobre.codigo_sobre}</span>`,
        width: '900px',
        html: `
            <div style="text-align: left; font-size: 0.88rem; color: #1e293b; font-family: sans-serif;">
                
                <!-- Encabezado Cliente y Monto -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                    <div>
                        <span style="font-size: 0.72rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Cliente</span>
                        <strong style="display: block; font-size: 1rem; color: #1e293b;">${sobre.cliente_razon_social || sobre.cliente_nombre_fantasia || 'Cliente'}</strong>
                        <span style="font-size: 0.8rem; color: #64748b;">Cód: ${sobre.cliente_id} | Saldo CC: <strong style="color: ${parseFloat(sobre.saldo_cuenta_corriente) > 0 ? '#e11d48' : '#16a34a'}">${formatCurrency(sobre.saldo_cuenta_corriente)}</strong></span>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-size: 0.72rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Monto Declarado en Sobre</span>
                        <span style="display: block; font-size: 1.4rem; font-weight: 800; color: #16a34a;">${formatCurrency(sobre.monto_declarado)}</span>
                        <span style="font-size: 0.75rem; color: #64748b;">Modalidad: <strong>${sobre.modalidad_entrega === 'CHOFER' ? '🚚 Chofer' : '🏬 Local'}</strong></span>
                    </div>
                </div>

                <!-- Layout 2 Columnas: Fotos y Desglose Editable -->
                <div style="display: grid; grid-template-columns: 1fr 1.25fr; gap: 16px; margin-bottom: 16px;">
                    
                    <!-- Columna Fotos -->
                    <div>
                        <div style="font-weight: 700; color: #8e4785; font-size: 0.75rem; text-transform: uppercase; margin-bottom: 6px;">
                            📸 Fotos de Seguridad del Paquete
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                            <div>
                                <span style="font-size: 0.7rem; color: #64748b; font-weight: 600; display: block; margin-bottom: 2px;">FRENTE (CÓDIGO)</span>
                                <a href="${sobre.foto_frente_url}" target="_blank" title="Clic para ampliar foto">
                                    <img src="${sobre.foto_frente_url}" style="width: 100%; height: 135px; object-fit: cover; border-radius: 6px; border: 1px solid #cbd5e1;" />
                                </a>
                            </div>
                            <div>
                                <span style="font-size: 0.7rem; color: #64748b; font-weight: 600; display: block; margin-bottom: 2px;">DORSO (SELLADO)</span>
                                <a href="${sobre.foto_dorso_url}" target="_blank" title="Clic para ampliar foto">
                                    <img src="${sobre.foto_dorso_url}" style="width: 100%; height: 135px; object-fit: cover; border-radius: 6px; border: 1px solid #cbd5e1;" />
                                </a>
                            </div>
                        </div>
                        <div style="font-size: 0.72rem; color: #64748b; margin-top: 4px; text-align: center;">
                            🔍 Clic en la foto para abrirla en tamaño completo.
                        </div>
                    </div>

                    <!-- Columna Billetes Interactiva -->
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <span style="font-weight: 700; color: #8e4785; font-size: 0.75rem; text-transform: uppercase;">
                                💵 Desglose de Billetes (Declarado vs. Contado)
                            </span>
                            ${editable ? `<span style="font-size: 0.7rem; color: #6b21a8; background: #f3e8ff; padding: 2px 6px; border-radius: 4px; font-weight: 700;">✏️ Edite la cant. contada</span>` : ''}
                        </div>
                        <div style="max-height: 175px; overflow-y: auto; border: 1px solid #cbd5e1; border-radius: 6px;">
                            <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; background: #ffffff;">
                                <thead style="background: #f1f5f9; position: sticky; top: 0; z-index: 1;">
                                    <tr>
                                        <th style="padding: 5px 6px; text-align: left;">Denom.</th>
                                        <th style="padding: 5px 6px; text-align: center;">Declarado</th>
                                        <th style="padding: 5px 6px; text-align: center;">Contado Real</th>
                                        <th style="padding: 5px 6px; text-align: right;">Subtotal Contado</th>
                                        <th style="padding: 5px 6px; text-align: center;">Dif.</th>
                                    </tr>
                                </thead>
                                <tbody id="swal-tbody-billetes-arqueo">
                                    ${construirFilasBilletesHtml()}
                                </tbody>
                            </table>
                        </div>
                        ${editable ? `
                            <div style="display: flex; align-items: center; gap: 6px; margin-top: 6px; justify-content: flex-end;">
                                <span style="font-size: 0.72rem; color: #64748b; font-weight: 600;">+ Agregar otra denom.:</span>
                                <select id="swal-add-denom-select" style="padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.75rem;">
                                    <option value="20000">$ 20.000</option>
                                    <option value="10000">$ 10.000</option>
                                    <option value="2000">$ 2.000</option>
                                    <option value="1000">$ 1.000</option>
                                    <option value="500">$ 500</option>
                                    <option value="200">$ 200</option>
                                    <option value="100">$ 100</option>
                                </select>
                                <button type="button" id="swal-btn-add-denom" style="padding: 3px 8px; font-size: 0.74rem; background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; border-radius: 4px; font-weight: 700; cursor: pointer;">
                                    + Fila
                                </button>
                            </div>
                        ` : ''}
                    </div>

                </div>

                <!-- Banner Dinámico de Diferencia de Arqueo -->
                <div id="swal-resumen-arqueo-diferencia" style="margin-bottom: 12px;"></div>

                <!-- Formulario de Acreditación / Auditoría -->
                ${editable ? `
                    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
                        <div style="font-weight: 700; color: #166534; font-size: 0.82rem; margin-bottom: 8px;">
                            ⚖️ Conteo Físico Real y Acreditación (Calculado automáticamente desde la tabla de billetes):
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px;">
                            <div>
                                <label style="display: block; font-size: 0.75rem; color: #374151; font-weight: 600; margin-bottom: 2px;">Monto Real Contado ($):</label>
                                <input type="number" id="swal-monto-auditado" value="${sobre.monto_declarado}" step="0.01" style="width: 100%; padding: 6px; border: 2px solid #16a34a; border-radius: 6px; font-size: 1.05rem; font-weight: 800; color: #166534; background: #ffffff;" />
                            </div>
                            <div>
                                <label style="display: block; font-size: 0.75rem; color: #374151; font-weight: 600; margin-bottom: 2px;">Operador / Auditor:</label>
                                <input type="text" id="swal-operador" value="Administración" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.9rem;" />
                            </div>
                        </div>
                        <div>
                            <label style="display: block; font-size: 0.75rem; color: #374151; font-weight: 600; margin-bottom: 2px;">Observaciones / Detalle de Diferencia de Arqueo:</label>
                            <input type="text" id="swal-observaciones" data-auto="true" placeholder="Ej: Billetes auditados y verificados en mostrador..." style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.85rem;" />
                        </div>
                    </div>

                    <!-- Desglose en Vivo: Capital vs. Interés de Financiación y Destino de Facturación -->
                    <div id="swal-desglose-imputacion-cc" style="margin-bottom: 12px;"></div>
                ` : ''}

                ${esAcreditado ? `
                    <div style="background: #dcfce7; border-left: 4px solid #16a34a; padding: 12px; border-radius: 6px; margin-bottom: 12px; font-size: 0.85rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                        <div>
                            <strong>✅ Sobre Acreditado en Cuenta Corriente</strong>
                            <div style="color: #166534; margin-top: 3px;">
                                Monto Real Acreditado: <strong>${formatCurrency(sobre.monto_auditado || sobre.monto_declarado)}</strong>
                                ${Math.abs(parseFloat(sobre.monto_auditado || sobre.monto_declarado) - parseFloat(sobre.monto_declarado)) >= 0.01 ? `<span style="color:#b45309; font-weight:700;"> (Declarado: ${formatCurrency(sobre.monto_declarado)})</span>` : ''}
                                | Movimiento ID: <strong>#${sobre.local_movimiento_id}</strong>
                            </div>
                            ${sobre.observaciones_admin ? `<div style="font-size: 0.78rem; color: #92400e; margin-top: 3px; font-weight: 600;">📝 Nota de Arqueo: ${sobre.observaciones_admin}</div>` : ''}
                            ${sobre.auditado_por ? `<div style="font-size: 0.75rem; color: #166534; margin-top: 2px;">Auditado por: ${sobre.auditado_por} el ${new Date(sobre.fecha_auditoria).toLocaleString('es-AR')}</div>` : ''}
                        </div>
                        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                            ${sobre.local_movimiento_id ? `
                                <button type="button" onclick="window.open('/api/logistica/bunker/cuentas-corrientes/movimientos/${sobre.local_movimiento_id}/pdf?tipo_doc=recibo&inline=1', '_blank')" style="background: #ffffff; color: #0284c7; border: 1px solid #7dd3fc; border-radius: 6px; padding: 6px 10px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">
                                    📄 Recibo PDF
                                </button>
                                <button type="button" onclick="window.open('/api/logistica/bunker/cuentas-corrientes/movimientos/${sobre.local_movimiento_id}/pdf?tipo_doc=trazabilidad&codigo_sobre=${encodeURIComponent(sobre.codigo_sobre)}&inline=1', '_blank')" style="background: #ffffff; color: #7c3aed; border: 1px solid #d8b4fe; border-radius: 6px; padding: 6px 10px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">
                                    📋 Trazabilidad y Arqueo PDF
                                </button>
                            ` : ''}
                            <button type="button" onclick="abrirModalNotificacionSobre('${sobre.codigo_sobre}')" style="background: #16a34a; color: #ffffff; border: none; border-radius: 6px; padding: 7px 14px; font-size: 0.8rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;">
                                📲 Enviar por WhatsApp / Email
                            </button>
                        </div>
                    </div>
                ` : ''}

                ${esCancelado ? `
                    <div style="background: #f1f5f9; border-left: 4px solid #64748b; padding: 10px; border-radius: 4px; margin-bottom: 12px; font-size: 0.85rem; color: #334155;">
                        <strong>⚪ Sobre Cancelado / Anulado</strong>
                        ${sobre.observaciones_admin ? `<div style="margin-top: 4px; color: #475569;">Motivo: <em>${sobre.observaciones_admin}</em></div>` : ''}
                    </div>
                ` : ''}

            </div>
        `,
        showCancelButton: true,
        showConfirmButton: editable,
        showDenyButton: editable,
        confirmButtonText: '✅ Aprobar y Acreditar en Cuenta Corriente',
        denyButtonText: '🗑️ Anular / Cancelar Sobre',
        cancelButtonText: 'Cerrar',
        confirmButtonColor: '#16a34a',
        denyButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        focusConfirm: false,
        didOpen: () => {
            if (!editable) return;

            const montoDeclaradoNum = parseFloat(sobre.monto_declarado) || 0;
            const inputMontoAuditado = document.getElementById('swal-monto-auditado');
            const inputObs = document.getElementById('swal-observaciones');
            const bannerDif = document.getElementById('swal-resumen-arqueo-diferencia');
            const tbodyBilletes = document.getElementById('swal-tbody-billetes-arqueo');

            if (inputObs) {
                inputObs.addEventListener('input', () => {
                    inputObs.dataset.auto = 'false';
                });
            }

            const recalcularArqueoEnVivo = () => {
                const filas = Array.from(document.querySelectorAll('.fila-arqueo-billete'));
                if (filas.length === 0) return;

                let sumaContada = 0;
                const diferencias = [];

                filas.forEach(tr => {
                    const den = parseInt(tr.getAttribute('data-denom'), 10) || 0;
                    const decl = parseInt(tr.getAttribute('data-declarado'), 10) || 0;
                    const inp = tr.querySelector('.input-billete-contado');
                    const cont = inp ? Math.max(0, parseInt(inp.value, 10) || 0) : decl;
                    const sub = den * cont;
                    const difU = cont - decl;
                    const difPesos = difU * den;

                    sumaContada += sub;

                    const celdaSub = tr.querySelector('.celda-subtotal-billete');
                    const celdaDif = tr.querySelector('.celda-dif-billete');

                    if (celdaSub) {
                        celdaSub.textContent = `$ ${sub.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
                        celdaSub.style.color = difU === 0 ? '#16a34a' : (difU < 0 ? '#dc2626' : '#d97706');
                    }

                    if (celdaDif) {
                        if (difU === 0) {
                            celdaDif.innerHTML = `<span style="color: #16a34a; font-weight: 700; font-size: 0.75rem;">✓ OK</span>`;
                            tr.style.background = '#ffffff';
                        } else {
                            const signo = difU > 0 ? '+' : '';
                            const color = difU < 0 ? '#dc2626' : '#d97706';
                            celdaDif.innerHTML = `<span style="color: ${color}; font-weight: 800; font-size: 0.75rem;">${signo}${difU} u. (${signo}$${Math.abs(difPesos).toLocaleString('es-AR')})</span>`;
                            tr.style.background = '#fffbeb';
                            diferencias.push({
                                denom: den,
                                declarado: decl,
                                contado: cont,
                                difUnidades: difU,
                                difPesos: difPesos
                            });
                        }
                    }
                });

                if (inputMontoAuditado) {
                    inputMontoAuditado.value = sumaContada;
                    inputMontoAuditado.style.borderColor = Math.abs(sumaContada - montoDeclaradoNum) >= 0.01 ? '#d97706' : '#16a34a';
                    inputMontoAuditado.style.color = Math.abs(sumaContada - montoDeclaradoNum) >= 0.01 ? '#b45309' : '#166534';
                }

                const difTotalPesos = sumaContada - montoDeclaradoNum;

                if (bannerDif) {
                    if (diferencias.length === 0 && Math.abs(difTotalPesos) < 0.01) {
                        bannerDif.innerHTML = `
                            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 8px 12px; font-size: 0.8rem; color: #065f46; font-weight: 600;">
                                ✅ <strong>Arqueo Exacto:</strong> El conteo de billetes coincide 100% con el monto declarado (${formatCurrency(montoDeclaradoNum)}).
                            </div>
                        `;
                    } else {
                        const signoTotal = difTotalPesos > 0 ? '+' : '-';
                        const itemsDifHtml = diferencias.map(d => {
                            const s = d.difUnidades > 0 ? '+' : '';
                            return `<li style="margin-top: 3px;">Denominación <strong>$ ${d.denom.toLocaleString('es-AR')}</strong>: se contaron <strong>${d.contado} unidades</strong> (${formatCurrency(d.contado * d.denom)}) vs. <strong>${d.declarado} unidades</strong> declaradas (${formatCurrency(d.declarado * d.denom)}) → <strong style="color:#b91c1c;">${s}${d.difUnidades} u. (${s}${formatCurrency(d.difPesos)})</strong></li>`;
                        }).join('');

                        bannerDif.innerHTML = `
                            <div style="background: #fffbeb; border: 1px solid #fcd34d; border-left: 4px solid #f59e0b; border-radius: 6px; padding: 10px 12px; font-size: 0.8rem; color: #78350f;">
                                <div style="font-weight: 800; color: #b45309; font-size: 0.84rem;">
                                    ⚠️ Diferencia en Arqueo de Billetes: ${signoTotal}${formatCurrency(Math.abs(difTotalPesos))} (Declarado: ${formatCurrency(montoDeclaradoNum)} → Contado Real: ${formatCurrency(sumaContada)})
                                </div>
                                <ul style="margin: 4px 0 0 0; padding-left: 18px;">
                                    ${itemsDifHtml}
                                </ul>
                            </div>
                        `;
                    }
                }

                if (inputObs && inputObs.dataset.auto === 'true') {
                    if (diferencias.length > 0) {
                        const resumenDifs = diferencias.map(d =>
                            `en denom. $${d.denom.toLocaleString('es-AR')} se contaron ${d.contado} u. (declaradas: ${d.declarado} u.)`
                        ).join('; ');
                        const signoTotal = difTotalPesos > 0 ? '+' : '-';
                        inputObs.value = `Diferencia de arqueo (${signoTotal}${formatCurrency(Math.abs(difTotalPesos))}): ${resumenDifs}. Total acreditado: ${formatCurrency(sumaContada)}.`;
                    } else {
                        inputObs.value = '';
                    }
                }

                const boxImputacion = document.getElementById('swal-desglose-imputacion-cc');
                if (boxImputacion && salvavidasSimCliente) {
                    const prevSelect = document.getElementById('swal-modo-facturacion-interes');
                    const modoElegidoPrevio = prevSelect ? prevSelect.value : 'APROBACION_INTERNA';

                    const montoSim = (inputMontoAuditado ? parseFloat(inputMontoAuditado.value) : sumaContada) || 0;
                    const reglas = salvavidasSimCliente.reglas_aplicadas || {};
                    const tasaMensual = parseFloat(reglas.tasa_servicio_financiero ?? reglas.tasa_tem ?? 3.0);
                    const tasaDiariaDef = parseFloat(reglas.tasa_diaria ?? ((tasaMensual / 30) / 100));
                    const ivaPctDef = parseFloat(reglas.iva_porcentaje ?? 21);
                    const capas = Array.isArray(salvavidasSimCliente.capas_simuladas) ? salvavidasSimCliente.capas_simuladas : [];

                    let disponible = montoSim;
                    let totalCapitalCancelado = 0;
                    let totalInteresCancelado = 0;
                    let totalInteresNeto = 0;
                    let totalInteresIva = 0;
                    const detallesComp = [];

                    for (const c of capas) {
                        if (disponible <= 0.009) break;
                        const capRem = parseFloat(c.capital_pendiente ?? c.monto_pendiente ?? c.saldo_restante) || 0;
                        if (capRem <= 0.009) continue;

                        const aplicaFin = c.ventana_codigo === 'ASISTENCIA_FORMALIZADA' && (parseInt(c.dias_asistencia_efectiva || 0, 10) > 0);
                        const diasMora = aplicaFin ? Math.max(1, parseInt(c.dias_asistencia_efectiva || c.antiguedad_dias || 0, 10)) : 0;
                        const tasaDiaria = parseFloat(c.tasa_diaria ?? tasaDiariaDef);
                        const factorIva = 1 + ((parseFloat(c.iva_porcentaje ?? ivaPctDef)) / 100);
                        const tasaNeta = aplicaFin ? (diasMora * tasaDiaria) : 0;
                        const tasaConIva = tasaNeta * factorIva;

                        const intNetoTotalCapa = Math.round(capRem * tasaNeta * 100) / 100;
                        const ivaIntTotalCapa = Math.round(intNetoTotalCapa * 0.21 * 100) / 100;
                        const intDeCapaTotal = Math.round((intNetoTotalCapa + ivaIntTotalCapa) * 100) / 100;
                        const deudaTotalCapa = Math.round((capRem + intDeCapaTotal) * 100) / 100;

                        let capCancel = 0;
                        let intCancel = 0;
                        let intNeto = 0;
                        let intIva = 0;
                        if (!aplicaFin) {
                            capCancel = Math.min(capRem, disponible);
                            disponible = Math.max(0, Math.round((disponible - capCancel) * 100) / 100);
                        } else if (disponible >= deudaTotalCapa - 0.01) {
                            capCancel = capRem;
                            intCancel = intDeCapaTotal;
                            intNeto = intNetoTotalCapa;
                            intIva = ivaIntTotalCapa;
                            disponible = Math.max(0, Math.round((disponible - deudaTotalCapa) * 100) / 100);
                        } else {
                            const montoAplicado = Math.round(disponible * 100) / 100;
                            capCancel = Math.round((montoAplicado / (1 + tasaConIva)) * 100) / 100;
                            intCancel = Math.round((montoAplicado - capCancel) * 100) / 100;
                            intNeto = Math.round(capCancel * tasaNeta * 100) / 100;
                            intIva = Math.round((intCancel - intNeto) * 100) / 100;
                            disponible = 0;
                        }
                        totalCapitalCancelado = Math.round((totalCapitalCancelado + capCancel) * 100) / 100;
                        totalInteresCancelado = Math.round((totalInteresCancelado + intCancel) * 100) / 100;
                        totalInteresNeto = Math.round((totalInteresNeto + intNeto) * 100) / 100;
                        totalInteresIva = Math.round((totalInteresIva + intIva) * 100) / 100;
                        detallesComp.push({
                            comprobante: c.descripcion || c.comprobante || 'Comprobante',
                            dias_mora: diasMora,
                            pct_mora: (tasaNeta * 100).toFixed(2).replace('.', ','),
                            capCancel,
                            intCancel,
                            intNeto,
                            intIva,
                            capRemRestante: Math.max(0, Math.round((capRem - capCancel) * 100) / 100)
                        });
                    }

                    if (disponible > 0.009) {
                        totalCapitalCancelado = Math.round((totalCapitalCancelado + disponible) * 100) / 100;
                    }

                    if (totalInteresCancelado > 0.01) {
                        const d0 = detallesComp[0] || {};
                        boxImputacion.innerHTML = `
                            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-left: 4px solid #7c3aed; border-radius: 8px; padding: 10px 12px; font-size: 0.81rem;">
                                <div style="font-weight: 800; color: #4c1d95; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                                    <span>⚖️ Desglose de Imputación en Cuenta Corriente (Capital vs. Interés)</span>
                                    <span style="background: #ede9fe; color: #5b21b6; padding: 2px 7px; border-radius: 4px; font-size: 0.72rem;">Total Sobre: ${formatCurrency(montoSim)}</span>
                                </div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                                    <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 7px 9px;">
                                        <div style="font-size: 0.71rem; font-weight: 700; color: #475569; text-transform: uppercase;">1. Parte Capital (Ya Facturado)</div>
                                        <div style="font-size: 0.98rem; font-weight: 800; color: #0f172a; margin-top: 2px;">${formatCurrency(totalCapitalCancelado)}</div>
                                        <div style="font-size: 0.71rem; color: #64748b; margin-top: 2px;">Cancela ${d0.comprobante || 'Factura'} (resta capital: ${formatCurrency(d0.capRemRestante || 0)})</div>
                                    </div>
                                    <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 7px 9px;">
                                        <div style="font-size: 0.71rem; font-weight: 700; color: #b45309; text-transform: uppercase;">2. Parte Interés (${d0.dias_mora || 0}d · ${d0.pct_mora || '0'}% + IVA)</div>
                                        <div style="font-size: 0.98rem; font-weight: 800; color: #b45309; margin-top: 2px;">${formatCurrency(totalInteresCancelado)}</div>
                                        <div style="font-size: 0.71rem; color: #92400e; margin-top: 2px;">Neto: ${formatCurrency(totalInteresNeto)} + IVA 21%: ${formatCurrency(totalInteresIva)} <strong style="color:#b91c1c;">(Sin Facturar)</strong></div>
                                    </div>
                                </div>
                                <div style="background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 6px; padding: 8px 10px;">
                                    <label style="display: block; font-size: 0.77rem; font-weight: 800; color: #4c1d95; margin-bottom: 5px;">
                                        🧾 ¿Cómo aplicar / facturar el Interés de Financiación (${formatCurrency(totalInteresCancelado)})?
                                    </label>
                                    <select id="swal-modo-facturacion-interes" style="width: 100%; padding: 6px 8px; border: 1px solid #8b5cf6; border-radius: 6px; font-size: 0.8rem; font-weight: 700; color: #1e293b; background: #ffffff;">
                                        <option value="APROBACION_INTERNA" ${modoElegidoPrevio === 'APROBACION_INTERNA' ? 'selected' : ''}>🏢 Enviar a Aprobación de Comprobantes (Circuito Interno — Pto. Vta. 90 sin ARCA)</option>
                                        <option value="APROBACION_ARCA" ${modoElegidoPrevio === 'APROBACION_ARCA' ? 'selected' : ''}>🏛️ Enviar a Bandeja de Facturación Oficial ARCA (Pto. Vta. 32 — Pendiente de CAE)</option>
                                        <option value="INTERNA" ${modoElegidoPrevio === 'INTERNA' ? 'selected' : ''}>⚡ Aprobar Comprobante Interno Directo (Emitir Fac X0090 ahora sin ARCA)</option>
                                        <option value="ARCA" ${modoElegidoPrevio === 'ARCA' ? 'selected' : ''}>🚀 Emitir Factura Oficial en ARCA Directo (Obtener CAE ahora)</option>
                                        <option value="BONIFICAR" ${modoElegidoPrevio === 'BONIFICAR' ? 'selected' : ''}>🎁 Bonificar 100% la financiación hoy e imputar todo a Capital (Adjunta PDF de Políticas)</option>
                                    </select>
                                    <div style="font-size: 0.71rem; color: #5b21b6; margin-top: 4px;">
                                        📌 Si cobra la financiación, en la Cuenta Corriente se asentarán por separado el <strong>Crédito de Capital (-${formatCurrency(totalCapitalCancelado)})</strong>, el <strong>Débito de Interés (+${formatCurrency(totalInteresCancelado)})</strong> y el <strong>Crédito de Interés (-${formatCurrency(totalInteresCancelado)})</strong>. Si la bonifica, el 100% (${formatCurrency(montoSim)}) cancela capital.
                                    </div>
                                </div>
                            </div>
                        `;
                    } else if (montoSim > 0) {
                        boxImputacion.innerHTML = `
                            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 8px 12px; font-size: 0.79rem; color: #166534;">
                                ✅ <strong>Imputación 100% a Capital Facturado (${formatCurrency(montoSim)}):</strong> El cliente no registra cargos de financiación devengados sobre este pago.
                            </div>
                        `;
                    } else {
                        boxImputacion.innerHTML = '';
                    }
                }
            };

            const bindInputListeners = () => {
                document.querySelectorAll('.input-billete-contado').forEach(inp => {
                    inp.oninput = recalcularArqueoEnVivo;
                    inp.onchange = recalcularArqueoEnVivo;
                });
                if (inputMontoAuditado) {
                    inputMontoAuditado.oninput = () => {
                        const boxImp = document.getElementById('swal-desglose-imputacion-cc');
                        if (boxImp) recalcularArqueoEnVivo();
                    };
                }
            };

            bindInputListeners();
            recalcularArqueoEnVivo();

            const btnAddDenom = document.getElementById('swal-btn-add-denom');
            const selectAddDenom = document.getElementById('swal-add-denom-select');
            if (btnAddDenom && selectAddDenom && tbodyBilletes) {
                btnAddDenom.addEventListener('click', () => {
                    const denVal = parseInt(selectAddDenom.value, 10);
                    if (!denVal) return;

                    const existente = tbodyBilletes.querySelector(`.fila-arqueo-billete[data-denom="${denVal}"]`);
                    if (existente) {
                        const inp = existente.querySelector('.input-billete-contado');
                        if (inp) {
                            inp.focus();
                            inp.select();
                        }
                        return;
                    }

                    const sinDesglose = document.getElementById('fila-sin-desglose');
                    if (sinDesglose) sinDesglose.remove();

                    const tr = document.createElement('tr');
                    tr.className = 'fila-arqueo-billete';
                    tr.setAttribute('data-denom', String(denVal));
                    tr.setAttribute('data-declarado', '0');
                    tr.style.cssText = 'border-bottom: 1px solid #e2e8f0; background: #fffbeb;';
                    tr.innerHTML = `
                        <td style="padding: 6px; font-weight: 700; color: #1e293b;">$ ${denVal.toLocaleString('es-AR')}</td>
                        <td style="padding: 6px; text-align: center; color: #475569; font-weight: 600;">0 u.</td>
                        <td style="padding: 5px 6px; text-align: center;">
                            <input type="number" class="input-billete-contado" data-denom="${denVal}" data-declarado="0" value="1" min="0" step="1"
                                style="width: 68px; padding: 4px 6px; border: 2px solid #8e4785; border-radius: 6px; text-align: center; font-weight: 800; font-size: 0.9rem; color: #0f172a; background: #faf5ff;" />
                        </td>
                        <td class="celda-subtotal-billete" style="padding: 6px; text-align: right; font-weight: 700; color: #16a34a;">
                            $ ${denVal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                        </td>
                        <td class="celda-dif-billete" style="padding: 6px; text-align: center;"></td>
                    `;
                    tbodyBilletes.appendChild(tr);
                    bindInputListeners();
                    recalcularArqueoEnVivo();
                });
            }
        },
        preConfirm: () => {
            const monto = parseFloat(document.getElementById('swal-monto-auditado').value);
            const operador = document.getElementById('swal-operador').value.trim();
            const observaciones = document.getElementById('swal-observaciones').value.trim();

            if (isNaN(monto) || monto <= 0) {
                Swal.showValidationMessage('El monto real contado debe ser un número mayor que cero.');
                return false;
            }

            const desglose_auditado = {};
            const diferencias_arqueo = [];
            document.querySelectorAll('.fila-arqueo-billete').forEach(tr => {
                const den = parseInt(tr.getAttribute('data-denom'), 10) || 0;
                const decl = parseInt(tr.getAttribute('data-declarado'), 10) || 0;
                const inp = tr.querySelector('.input-billete-contado');
                const cont = inp ? Math.max(0, parseInt(inp.value, 10) || 0) : decl;
                if (cont > 0 || decl > 0) {
                    desglose_auditado[String(den)] = cont;
                }
                if (cont !== decl) {
                    diferencias_arqueo.push({
                        denom: den,
                        declarado: decl,
                        contado: cont,
                        difUnidades: cont - decl,
                        difPesos: (cont - decl) * den
                    });
                }
            });

            const selectModoInteres = document.getElementById('swal-modo-facturacion-interes');
            const modo_facturacion_interes = selectModoInteres ? selectModoInteres.value : 'APROBACION_INTERNA';
            desglose_auditado.__modo_facturacion_interes = modo_facturacion_interes;

            return {
                monto_auditado: monto,
                operador,
                observaciones_admin: observaciones,
                desglose_auditado,
                modo_facturacion_interes,
                diferencias_arqueo,
                desglose_declarado: desgloseDeclarado,
                monto_declarado: parseFloat(sobre.monto_declarado) || 0
            };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            await ejecutarAcreditacion(sobre.id, result.value, sobre);
        } else if (result.isDenied) {
            await confirmarYCancelarSobre(sobre.codigo_sobre);
        }
    });
}

// Confirmar y ejecutar anulación/cancelación de un sobre duplicado o erróneo
async function confirmarYCancelarSobre(codigoSobre) {
    const sobre = todosLosSobres.find(s => s.codigo_sobre === codigoSobre);
    if (!sobre) return;

    const { value: motivo, isConfirmed } = await Swal.fire({
        title: `🗑️ ¿Anular Sobre ${sobre.codigo_sobre}?`,
        html: `
            <div style="text-align: left; font-size: 0.9rem; color: #334155;">
                <p style="margin-bottom: 10px;">
                    El sobre <strong>${sobre.codigo_sobre}</strong> (${sobre.cliente_razon_social || sobre.cliente_id}) por <strong>${formatCurrency(sobre.monto_declarado)}</strong> pasará a estado <strong>CANCELADO</strong> y dejará de figurar como pendiente.
                </p>
                <label style="display: block; font-size: 0.8rem; font-weight: 700; margin-bottom: 4px;">Motivo de anulación:</label>
            </div>
        `,
        input: 'text',
        inputValue: 'Sobre duplicado / descartado en recepción',
        inputPlaceholder: 'Ej: Sobre duplicado por el cliente...',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, Anular Sobre',
        cancelButtonText: 'Volver'
    });

    if (!isConfirmed) return;

    Swal.fire({
        title: 'Anulando Sobre...',
        text: 'Actualizando estado local y sincronizando con el portal...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const res = await fetch(`/api/logistica/pagos-efectivo/${sobre.id}/estado`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                estado: 'CANCELADO',
                observaciones: (motivo || '').trim() || 'Anulado desde Recepción',
                operador: 'Administración'
            })
        });

        const data = await res.json();
        if (!data.success) {
            throw new Error(data.error || 'No se pudo anular el sobre.');
        }

        await Swal.fire({
            title: 'Sobre Anulado',
            text: `El sobre ${sobre.codigo_sobre} fue cancelado correctamente.`,
            icon: 'success',
            timer: 1800,
            showConfirmButton: false
        });

        cargarSobres();
    } catch (err) {
        console.error('Error al anular sobre:', err);
        Swal.fire('Error', err.message, 'error');
    }
}

// Llamada a la API para acreditar el sobre y abrir automáticamente el modal de notificación por WhatsApp/Email
async function ejecutarAcreditacion(sobreId, datos, sobreOriginal = null) {
    Swal.fire({
        title: 'Acreditando Pago...',
        text: 'Impactando en la cuenta corriente y generando recibo oficial...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const res = await fetch(`/api/logistica/pagos-efectivo/${sobreId}/acreditar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos)
        });

        const resp = await res.json();
        if (!resp.success) {
            throw new Error(resp.error || 'No se pudo acreditar el sobre.');
        }

        if (datos && datos.desglose_auditado && datos.desglose_auditado.__modo_facturacion_interes) {
            delete datos.desglose_auditado.__modo_facturacion_interes;
        }

        const codigoSobre = resp.sobre ? resp.sobre.codigo_sobre : (sobreOriginal ? sobreOriginal.codigo_sobre : '');
        const clienteAcreditado = resp.sobre ? resp.sobre.cliente_id : (sobreOriginal ? sobreOriginal.cliente_id : null);

        // Guardar detalle de arqueo por denominación en localStorage y sincronizar con los metadatos del movimiento en PostgreSQL
        if (codigoSobre && datos) {
            try {
                localStorage.setItem(`arqueo_sobre_${codigoSobre}`, JSON.stringify({
                    desglose_auditado: datos.desglose_auditado || {},
                    diferencias_arqueo: datos.diferencias_arqueo || [],
                    monto_declarado: datos.monto_declarado,
                    monto_auditado: datos.monto_auditado,
                    observaciones_admin: datos.observaciones_admin
                }));
            } catch (e) {}
        }

        if (resp.movimiento && resp.movimiento.id && datos && datos.desglose_auditado) {
            try {
                const syncQuery = encodeURIComponent(JSON.stringify({
                    desglose_auditado: datos.desglose_auditado,
                    diferencias_arqueo: datos.diferencias_arqueo || []
                }));
                await fetch(`/api/logistica/bunker/cuentas-corrientes/movimientos/${resp.movimiento.id}/pdf?json=1&sync_arqueo=${syncQuery}`);
            } catch (e) {
                console.warn('No se pudo sincronizar desglose_auditado en metadatos:', e);
            }
        }

        if (clienteAcreditado) {
            actualizarBotonVolverCC(clienteAcreditado);
        }

        await cargarSobres();

        // Abrir inmediatamente el modal estándar de LAMDA para notificar por WhatsApp y/o Email
        await abrirModalNotificacionSobre(codigoSobre, {
            sobre: resp.sobre,
            movimiento: resp.movimiento,
            arqueo: datos
        });

    } catch (err) {
        console.error('Error al acreditar sobre:', err);
        Swal.fire('Error de Acreditación', err.message, 'error');
    }
}

// Modal Estándar LAMDA de Notificación por WhatsApp y Correo Electrónico (con contactos predeterminados persistentes y mensaje pre-redactado)
window.abrirModalNotificacionSobre = async function(codigoSobre, contextoReciente = null) {
    const sobreEnLista = todosLosSobres.find(s => s.codigo_sobre === codigoSobre);
    const sobre = (contextoReciente && contextoReciente.sobre)
        ? { ...(sobreEnLista || {}), ...contextoReciente.sobre }
        : sobreEnLista;

    if (!sobre) {
        Swal.fire('Error', 'No se encontró la información del sobre para notificar.', 'error');
        return;
    }

    Swal.fire({
        title: 'Preparando Notificación...',
        text: 'Cargando contactos y estado de cuenta del cliente...',
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: () => Swal.showLoading()
    });

    const codigoBunker = sobre.cliente_id;
    let cliente = null;
    let saldoActualCC = parseFloat(sobre.saldo_cuenta_corriente) || 0;

    try {
        const resCC = await fetch(`/api/logistica/bunker/cuentas-corrientes?cliente=${encodeURIComponent(codigoBunker)}`);
        const dataCC = await resCC.json();
        if (dataCC && dataCC.success) {
            cliente = dataCC.cliente || null;
            if (Array.isArray(dataCC.data) && dataCC.data.length > 0) {
                saldoActualCC = parseFloat(dataCC.data[0].saldo) || 0;
            }
        }
    } catch (e) {
        console.warn('Error consultando cuenta corriente del cliente para notificación:', e);
    }

    const configKey = `recepcion_efectivo_envio_config_${codigoBunker}`;
    let savedConfig = null;
    try {
        const rawCfg = localStorage.getItem(configKey);
        if (rawCfg) savedConfig = JSON.parse(rawCfg);
    } catch (e) {}

    // 1. Recuperar y parsear contactos de WhatsApp del cliente
    let contacts = [];
    const rawWp = ((cliente && cliente.whatsapp_facturas) || sobre.cliente_telefono || '').trim();
    if (rawWp.startsWith('[')) {
        try {
            contacts = JSON.parse(rawWp);
        } catch (e) {}
    }
    if (!Array.isArray(contacts) || contacts.length === 0) {
        const rawPhone = (!rawWp.startsWith('[') ? rawWp : '') || (cliente && (cliente.celular || cliente.telefono)) || '';
        contacts = rawPhone.split(',').map(num => ({
            numero: num.trim(),
            nombre: '',
            cargo: '',
            default_efectivo: true,
            default_resumen: true,
            default: true
        })).filter(c => c.numero);
    }
    contacts = contacts.map((c, idx) => ({
        ...c,
        id: c.id || `wp_${idx}`,
        numero: c.numero ? String(c.numero).replace(/\D/g, '') : '',
        nombre: c.nombre || '',
        cargo: c.cargo || '',
        enviar_alerta: c.enviar_alerta !== false,
        default_efectivo: c.default_efectivo !== undefined ? Boolean(c.default_efectivo) : (c.default_resumen === true || c.default === true),
        default_resumen: c.default_resumen === true || c.default === true,
        default: c.default_resumen === true || c.default === true
    })).filter(c => c.numero.length > 0);

    // 2. Recuperar y parsear contactos de Email del cliente
    let emails = [];
    const rawEmail = ((cliente && cliente.email_facturas) || '').trim();
    if (rawEmail.startsWith('[')) {
        try {
            emails = JSON.parse(rawEmail);
        } catch (e) {}
    }
    if (!Array.isArray(emails) || emails.length === 0) {
        const rawEmailVal = !rawEmail.startsWith('[') ? rawEmail : '';
        if (rawEmailVal) {
            emails = rawEmailVal.split(',').map(e => ({
                email: e.trim(),
                nombre: '',
                cargo: '',
                default_efectivo: false,
                default_factura: true
            })).filter(e => e.email);
        }
    }
    emails = emails.map((e, idx) => ({
        ...e,
        id: e.id || `em_${idx}`,
        email: e.email ? String(e.email).trim() : '',
        nombre: e.nombre || '',
        cargo: e.cargo || '',
        default_efectivo: e.default_efectivo !== undefined ? Boolean(e.default_efectivo) : (e.default_factura === true),
        default_factura: e.default_factura !== false
    })).filter(e => e.email.length > 0);

    // 3. Reconstruir información del arqueo (declarado vs contado)
    const arqueoLocal = (contextoReciente && contextoReciente.arqueo) || obtenerArqueoGuardadoLocal(sobre.codigo_sobre) || {};
    const montoDeclarado = parseFloat(sobre.monto_declarado) || 0;
    const montoAuditado = parseFloat(sobre.monto_auditado || arqueoLocal.monto_auditado || sobre.monto_declarado) || 0;
    const difTotal = montoAuditado - montoDeclarado;
    const hayDiferenciaMonto = Math.abs(difTotal) >= 0.01;

    const desgloseDeclarado = (sobre.desglose_billetes && typeof sobre.desglose_billetes === 'object') ? sobre.desglose_billetes : {};
    const desgloseAuditado = (arqueoLocal.desglose_auditado && typeof arqueoLocal.desglose_auditado === 'object' && Object.keys(arqueoLocal.desglose_auditado).length > 0)
        ? arqueoLocal.desglose_auditado
        : desgloseDeclarado;

    // Construir lista de diferencias por denominación
    let diferenciasArqueo = Array.isArray(arqueoLocal.diferencias_arqueo) ? arqueoLocal.diferencias_arqueo : [];
    if (diferenciasArqueo.length === 0 && hayDiferenciaMonto) {
        const denomsUnificadas = new Set([...Object.keys(desgloseDeclarado), ...Object.keys(desgloseAuditado)]);
        denomsUnificadas.forEach(den => {
            const dNum = parseInt(den, 10) || 0;
            const cDecl = parseInt(desgloseDeclarado[den] || 0, 10);
            const cCont = parseInt(desgloseAuditado[den] !== undefined ? desgloseAuditado[den] : cDecl, 10);
            if (cDecl !== cCont) {
                diferenciasArqueo.push({
                    denom: dNum,
                    declarado: cDecl,
                    contado: cCont,
                    difUnidades: cCont - cDecl,
                    difPesos: (cCont - cDecl) * dNum
                });
            }
        });
    }

    const movId = (contextoReciente && contextoReciente.movimiento && contextoReciente.movimiento.id) || sobre.local_movimiento_id || 0;
    const autoCheckPoliticasSobre = Boolean(arqueoLocal && arqueoLocal.modo_facturacion_interes === 'BONIFICAR');

    // Función generadora del cuerpo del mensaje de WhatsApp (corto y directo; toda la información detallada va en los PDFs adjuntos)
    const construirMensajeDinamicoArqueo = (docsActivos = ['recibo', 'trazabilidad']) => {
        const tieneDiferencia = diferenciasArqueo.length > 0 || hayDiferenciaMonto;
        const lineas = [];

        if (tieneDiferencia) {
            lineas.push(`Hola! Te informamos que recibimos y asentamos el sobre *#${sobre.codigo_sobre}* en tu cuenta corriente (*${formatCurrency(montoAuditado)}*), registrándose una *diferencia en el arqueo* respecto a lo declarado (*${formatCurrency(montoDeclarado)}*).`);
        } else {
            lineas.push(`Hola! Te informamos que recibimos y asentamos el sobre *#${sobre.codigo_sobre}* en tu cuenta corriente (*${formatCurrency(montoAuditado)}*) sin diferencias en el arqueo.`);
        }

        const nombresAdjuntos = [];
        if (docsActivos.includes('recibo')) nombresAdjuntos.push('el recibo oficial');
        if (docsActivos.includes('trazabilidad')) nombresAdjuntos.push('el informe detallado de trazabilidad y arqueo');
        if (docsActivos.includes('recomendaciones')) nombresAdjuntos.push('las recomendaciones para el ensobrado');
        if (docsActivos.includes('politicas_financiacion')) nombresAdjuntos.push('las políticas y beneficios de financiación de tu cuenta LAMDA');

        if (nombresAdjuntos.length === 1) {
            lineas.push(`Te adjuntamos en PDF ${nombresAdjuntos[0]}.`);
        } else if (nombresAdjuntos.length === 2) {
            lineas.push(`Te adjuntamos en PDF ${nombresAdjuntos[0]} y ${nombresAdjuntos[1]}.`);
        } else if (nombresAdjuntos.length >= 3) {
            const ult = nombresAdjuntos[nombresAdjuntos.length - 1];
            const prevs = nombresAdjuntos.slice(0, -1).join(', ');
            lineas.push(`Te adjuntamos en PDF ${prevs} y ${ult}.`);
        }

        lineas.push(`Cualquier duda avisame. Muchas gracias!`);
        return lineas.join('\n');
    };

    const docsInicialesSobre = autoCheckPoliticasSobre ? ['recibo', 'trazabilidad', 'politicas_financiacion'] : ['recibo', 'trazabilidad'];
    const defaultMessage = construirMensajeDinamicoArqueo(docsInicialesSobre);

    // Función para persistir preferencias de contactos tanto en localStorage como en la ficha del cliente en PostgreSQL
    const guardarPreferenciasContactosCliente = async (selectedWpsList, selectedEmailsList, customPhoneVal, customEmailVal) => {
        const cfgLocal = {
            selectedWps: selectedWpsList,
            selectedEmails: selectedEmailsList,
            customPhone: customPhoneVal || '',
            customEmail: customEmailVal || ''
        };
        try {
            localStorage.setItem(configKey, JSON.stringify(cfgLocal));
        } catch (e) {}

        if (!cliente || !cliente.id) return;

        const updatedWps = contacts.map((c, idx) => {
            const isSel = selectedWpsList.includes(c.numero);
            return {
                ...c,
                id: c.id || `cont_${Date.now().toString(36)}_${idx}`,
                enviar_alerta: c.enviar_alerta !== false,
                default_efectivo: isSel,
                default_resumen: isSel,
                default: isSel
            };
        });

        const existingNums = new Set(updatedWps.map(c => c.numero));
        selectedWpsList.forEach(num => {
            const clean = String(num || '').replace(/\D/g, '');
            if (clean && !existingNums.has(clean)) {
                updatedWps.push({
                    id: `cont_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
                    numero: clean,
                    nombre: 'Contacto Adicional',
                    cargo: '',
                    enviar_alerta: true,
                    default_efectivo: true,
                    default_resumen: true,
                    default: true
                });
                existingNums.add(clean);
            }
        });

        const updatedEmails = emails.map(e => {
            const isSel = selectedEmailsList.includes(e.email);
            return {
                ...e,
                default_efectivo: isSel,
                default_factura: isSel
            };
        });

        const existingEmails = new Set(updatedEmails.map(e => e.email.toLowerCase()));
        selectedEmailsList.forEach(em => {
            const cleanEm = String(em || '').trim();
            if (cleanEm && cleanEm.includes('@') && !existingEmails.has(cleanEm.toLowerCase())) {
                updatedEmails.push({
                    id: `email_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
                    email: cleanEm,
                    nombre: 'Contacto Adicional',
                    cargo: '',
                    default_efectivo: true,
                    default_factura: true
                });
                existingEmails.add(cleanEm.toLowerCase());
            }
        });

        contacts = updatedWps;
        emails = updatedEmails;
        cliente.whatsapp_facturas = JSON.stringify(updatedWps);
        cliente.email_facturas = JSON.stringify(updatedEmails);

        await fetch(`/api/logistica/bunker/clientes/${cliente.id}/whatsapp-contacts`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                whatsapp_facturas: cliente.whatsapp_facturas,
                email_facturas: cliente.email_facturas
            })
        });
    };

    // Construir HTML del modal estándar de envío por WhatsApp y Email
    let wpItemsHtml = '';
    if (contacts.length === 0) {
        wpItemsHtml = `<div style="padding: 8px; font-size: 11.5px; color: #94a3b8; text-align: center;">No hay contactos de WhatsApp cargados en la ficha. Puede ingresar uno debajo.</div>`;
    } else {
        wpItemsHtml = contacts.map((c, index) => {
            let isChecked = false;
            if (savedConfig && Array.isArray(savedConfig.selectedWps)) {
                isChecked = savedConfig.selectedWps.includes(c.numero);
            } else {
                isChecked = c.default_efectivo === true || index === 0;
            }

            const formattedNum = c.numero.replace(/\D/g, '');
            let displayNum = c.numero;
            if (formattedNum.length === 10) {
                displayNum = `(${formattedNum.substring(0, 3)}) ${formattedNum.substring(3, 6)}-${formattedNum.substring(6, 10)}`;
            } else if (formattedNum.length === 13 && formattedNum.startsWith('549')) {
                displayNum = `+54 9 (${formattedNum.substring(3, 6)}) ${formattedNum.substring(6, 9)}-${formattedNum.substring(9, 13)}`;
            } else if (formattedNum.length === 11 && formattedNum.startsWith('54')) {
                displayNum = `+54 (${formattedNum.substring(2, 5)}) ${formattedNum.substring(5, 8)}-${formattedNum.substring(8, 11)}`;
            }

            const labelText = c.nombre
                ? `<strong>${c.nombre}</strong>${c.cargo ? ` <span style="font-size: 9px; background: #e0f2fe; color: #0369a1; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${c.cargo}</span>` : ''}`
                : `Contacto #${index + 1}`;

            return `
                <label style="display: flex; align-items: flex-start; gap: 8px; padding: 7px 8px; border: 1px solid #e2e8f0; border-radius: 6px; background: #ffffff; cursor: pointer; margin-bottom: 0;">
                    <input type="checkbox" class="swal-sobre-wp-chk" value="${c.numero}" ${isChecked ? 'checked' : ''} style="margin-top: 2px; cursor: pointer; width: 15px; height: 15px; accent-color: #16a34a;">
                    <div style="flex: 1; font-size: 11.5px;">
                        <div style="color: #1f2937; margin-bottom: 1px;">${labelText}</div>
                        <div style="color: #6b7280;">📱 ${displayNum}</div>
                    </div>
                </label>
            `;
        }).join('');
    }

    let emailItemsHtml = '';
    if (emails.length === 0) {
        emailItemsHtml = `<div style="padding: 8px; font-size: 11.5px; color: #94a3b8; text-align: center;">No hay correos cargados en la ficha. Puede ingresar uno debajo.</div>`;
    } else {
        emailItemsHtml = emails.map((e, index) => {
            let isChecked = false;
            if (savedConfig && Array.isArray(savedConfig.selectedEmails)) {
                isChecked = savedConfig.selectedEmails.includes(e.email);
            } else {
                isChecked = e.default_efectivo === true;
            }

            const labelText = e.nombre
                ? `<strong>${e.nombre}</strong>${e.cargo ? ` <span style="font-size: 9px; background: #f3e8ff; color: #6b21a8; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${e.cargo}</span>` : ''}`
                : `Correo #${index + 1}`;

            return `
                <label style="display: flex; align-items: flex-start; gap: 8px; padding: 7px 8px; border: 1px solid #e2e8f0; border-radius: 6px; background: #ffffff; cursor: pointer; margin-bottom: 0;">
                    <input type="checkbox" class="swal-sobre-email-chk" value="${e.email}" ${isChecked ? 'checked' : ''} style="margin-top: 2px; cursor: pointer; width: 15px; height: 15px; accent-color: #7c3aed;">
                    <div style="flex: 1; font-size: 11.5px;">
                        <div style="color: #1f2937; margin-bottom: 1px;">${labelText}</div>
                        <div style="color: #6b7280; word-break: break-all;">📧 ${e.email}</div>
                    </div>
                </label>
            `;
        }).join('');
    }

    const savedCustomPhone = (savedConfig && savedConfig.customPhone) ? savedConfig.customPhone : '';
    const savedCustomEmail = (savedConfig && savedConfig.customEmail) ? savedConfig.customEmail : '';
    const clienteDisplay = (cliente && (cliente.razon_social || cliente.cliente_nombre)) || sobre.cliente_razon_social || sobre.cliente_id;

    const urlReciboPdf = `/api/logistica/bunker/cuentas-corrientes/movimientos/${movId}/pdf?tipo_doc=recibo&inline=1`;
    const urlTrazabilidadPdf = `/api/logistica/bunker/cuentas-corrientes/movimientos/${movId}/pdf?tipo_doc=trazabilidad&codigo_sobre=${encodeURIComponent(sobre.codigo_sobre)}&inline=1`;
    const urlRecomendacionesPdf = `/api/logistica/bunker/cuentas-corrientes/movimientos/${movId}/pdf?tipo_doc=recomendaciones&inline=1`;
    const urlPoliticasPdf = `/api/logistica/bunker/cuentas-corrientes/movimientos/${movId}/pdf?tipo_doc=politicas_financiacion&inline=1`;

    const htmlModal = `
        <div style="text-align: left; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; flex-direction: column; gap: 11px;">
            
            <!-- Banner de Resumen del Sobre Asentado -->
            <div style="background: ${hayDiferenciaMonto ? '#fffbeb' : '#f0fdf4'}; border: 1px solid ${hayDiferenciaMonto ? '#fcd34d' : '#86efac'}; border-left: 4px solid ${hayDiferenciaMonto ? '#f59e0b' : '#16a34a'}; border-radius: 8px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div>
                    <div style="font-size: 12.5px; font-weight: 800; color: ${hayDiferenciaMonto ? '#b45309' : '#166534'};">
                        ${hayDiferenciaMonto ? `⚠️ Sobre #${sobre.codigo_sobre} Acreditado con Diferencia de Arqueo` : `✅ Sobre #${sobre.codigo_sobre} Acreditado en Cuenta Corriente`}
                    </div>
                    <div style="font-size: 11.5px; color: #334155; margin-top: 2px;">
                        Cliente: <strong>${clienteDisplay}</strong> | Acreditado: <strong style="color:#15803d;">${formatCurrency(montoAuditado)}</strong>
                        ${hayDiferenciaMonto ? ` <span style="color:#b91c1c; font-weight:700;">(Declarado: ${formatCurrency(montoDeclarado)} | Dif: ${difTotal > 0 ? '+' : '-'}${formatCurrency(Math.abs(difTotal))})</span>` : ''}
                    </div>
                </div>
            </div>

            <!-- Panel de Documentos PDF Adjuntos y Previsualización -->
            <div style="border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px; background: #f8fafc;">
                <div style="font-size: 11.5px; font-weight: 800; color: #8e4785; text-transform: uppercase; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <span>📎 Documentos PDF a Adjuntar en el Envío (Marque y Previsualice antes de enviar)</span>
                </div>

                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <!-- PDF 1: Recibo Oficial -->
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px;">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1; margin: 0;">
                            <input type="checkbox" class="swal-sobre-doc-chk" value="recibo" checked style="width: 16px; height: 16px; accent-color: #0284c7; cursor: pointer;" />
                            <div>
                                <div style="font-size: 12px; font-weight: 700; color: #0f172a;">📄 1. Recibo Oficial de Pago (<span style="color:#0284c7;">Recibo_Pago_${sobre.codigo_sobre}.pdf</span>)</div>
                                <div style="font-size: 10.5px; color: #64748b;">Comprobante oficial de acreditación en cuenta corriente y saldo resultante.</div>
                            </div>
                        </label>
                        <div style="display: flex; gap: 5px; flex-shrink: 0;">
                            <button type="button" class="btn-preview-pdf-inline" data-url="${urlReciboPdf}" data-title="📄 Recibo Oficial de Pago (#${sobre.codigo_sobre})" style="background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc; border-radius: 5px; padding: 4px 9px; font-size: 11px; font-weight: 700; cursor: pointer;">
                                👁️ Previsualizar
                            </button>
                            <button type="button" onclick="window.open('${urlReciboPdf}', '_blank')" title="Abrir en pestaña nueva" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 5px; padding: 4px 7px; font-size: 11px; font-weight: 700; cursor: pointer;">
                                ↗️
                            </button>
                        </div>
                    </div>

                    <!-- PDF 2: Informe de Trazabilidad y Arqueo -->
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px;">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1; margin: 0;">
                            <input type="checkbox" class="swal-sobre-doc-chk" value="trazabilidad" checked style="width: 16px; height: 16px; accent-color: #8e4785; cursor: pointer;" />
                            <div>
                                <div style="font-size: 12px; font-weight: 700; color: #0f172a;">📋 2. Informe de Trazabilidad y Arqueo del Sobre (<span style="color:#8e4785;">Informe_Arqueo_y_Trazabilidad_${sobre.codigo_sobre}.pdf</span>)</div>
                                <div style="font-size: 10.5px; color: #64748b;">Cronología con fecha/hora de retiro en reparto, apertura y desglose declarado vs. contado real.</div>
                            </div>
                        </label>
                        <div style="display: flex; gap: 5px; flex-shrink: 0;">
                            <button type="button" class="btn-preview-pdf-inline" data-url="${urlTrazabilidadPdf}" data-title="📋 Informe de Trazabilidad y Arqueo (#${sobre.codigo_sobre})" style="background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; border-radius: 5px; padding: 4px 9px; font-size: 11px; font-weight: 700; cursor: pointer;">
                                👁️ Previsualizar
                            </button>
                            <button type="button" onclick="window.open('${urlTrazabilidadPdf}', '_blank')" title="Abrir en pestaña nueva" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 5px; padding: 4px 7px; font-size: 11px; font-weight: 700; cursor: pointer;">
                                ↗️
                            </button>
                        </div>
                    </div>

                    <!-- PDF 3: Recomendaciones de LAMDA para la Seguridad del Ensobrado -->
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px;">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1; margin: 0;">
                            <input type="checkbox" class="swal-sobre-doc-chk" value="recomendaciones" style="width: 16px; height: 16px; accent-color: #d97706; cursor: pointer;" />
                            <div>
                                <div style="font-size: 12px; font-weight: 700; color: #78350f;">🛡️ 3. Recomendaciones de LAMDA para la Seguridad del Ensobrado — Opcional (<span style="color:#b45309;">Recomendaciones_Ensobrado_LAMDA.pdf</span>)</div>
                                <div style="font-size: 10.5px; color: #92400e;">Determinismo, dedicación exclusiva, conteo en paralelo con la app, reserva visual y aviso en mostrador.</div>
                            </div>
                        </label>
                        <div style="display: flex; gap: 5px; flex-shrink: 0;">
                            <button type="button" class="btn-preview-pdf-inline" data-url="${urlRecomendacionesPdf}" data-title="🛡️ Recomendaciones de LAMDA para la Seguridad del Ensobrado" style="background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; border-radius: 5px; padding: 4px 9px; font-size: 11px; font-weight: 700; cursor: pointer;">
                                👁️ Previsualizar
                            </button>
                            <button type="button" onclick="window.open('${urlRecomendacionesPdf}', '_blank')" title="Abrir en pestaña nueva" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 5px; padding: 4px 7px; font-size: 11px; font-weight: 700; cursor: pointer;">
                                ↗️
                            </button>
                        </div>
                    </div>

                    <!-- PDF 4: Políticas y Beneficio de Financiación LAMDA -->
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px;">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1; margin: 0;">
                            <input type="checkbox" class="swal-sobre-doc-chk" value="politicas_financiacion" ${autoCheckPoliticasSobre ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #0284c7; cursor: pointer;" />
                            <div>
                                <div style="font-size: 12px; font-weight: 700; color: #0c4a6e;">📘 4. Políticas y Beneficio de Financiación LAMDA — Opcional (<span style="color:#0284c7;">Politicas_Financiacion_LAMDA.pdf</span>)</div>
                                <div style="font-size: 10.5px; color: #0369a1;">Las 4 etapas de financiación (0% hasta 7 días, +3 días gracia, comodines hasta 14 días, eCheq sin costo) con ejemplo práctico de la cuenta.</div>
                            </div>
                        </label>
                        <div style="display: flex; gap: 5px; flex-shrink: 0;">
                            <button type="button" class="btn-preview-pdf-inline" data-url="${urlPoliticasPdf}" data-title="📘 Políticas y Beneficio de Financiación LAMDA" style="background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc; border-radius: 5px; padding: 4px 9px; font-size: 11px; font-weight: 700; cursor: pointer;">
                                👁️ Previsualizar
                            </button>
                            <button type="button" onclick="window.open('${urlPoliticasPdf}', '_blank')" title="Abrir en pestaña nueva" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 5px; padding: 4px 7px; font-size: 11px; font-weight: 700; cursor: pointer;">
                                ↗️
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Visor PDF Integrado (Colapsable) -->
                <div id="swal-sobre-pdf-preview-box" style="display: none; margin-top: 10px; border: 2px solid #8e4785; border-radius: 8px; overflow: hidden; background: #1e293b;">
                    <div style="background: #8e4785; color: #ffffff; padding: 6px 12px; display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; font-weight: 700;">
                        <span id="swal-sobre-pdf-preview-title">Previsualización de Documento PDF</span>
                        <button type="button" id="btn-close-pdf-preview" style="background: rgba(255,255,255,0.2); color: #ffffff; border: none; border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 700; cursor: pointer;">
                            ✖ Cerrar Vista Previa
                        </button>
                    </div>
                    <iframe id="swal-sobre-pdf-iframe" src="about:blank" style="width: 100%; height: 390px; border: none; background: #525659;"></iframe>
                </div>
            </div>

            <!-- Grilla de Selección de Destinatarios (WhatsApp + Email) -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <!-- Columna WhatsApp -->
                <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; background: #f8fafc;">
                    <div style="font-size: 12px; font-weight: 700; color: #16a34a; text-transform: uppercase; margin-bottom: 6px; display: flex; align-items: center; gap: 5px;">
                        <span>📱 Destinatarios WhatsApp</span>
                    </div>
                    <div id="swal-sobre-wps-container" style="display: flex; flex-direction: column; gap: 5px; max-height: 110px; overflow-y: auto; margin-bottom: 8px;">
                        ${wpItemsHtml}
                    </div>
                    <div>
                        <label style="display: block; font-size: 10.5px; font-weight: 600; color: #475569; margin-bottom: 3px;">Otro número WhatsApp (opcional):</label>
                        <input type="text" id="swal-sobre-custom-phone" placeholder="Ej: 2216615746" value="${savedCustomPhone}" style="width: 100%; padding: 5px 7px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11.5px; box-sizing: border-box;" />
                    </div>
                </div>

                <!-- Columna Correo Electrónico -->
                <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; background: #f8fafc;">
                    <div style="font-size: 12px; font-weight: 700; color: #7c3aed; text-transform: uppercase; margin-bottom: 6px; display: flex; align-items: center; gap: 5px;">
                        <span>📧 Destinatarios Email</span>
                    </div>
                    <div id="swal-sobre-emails-container" style="display: flex; flex-direction: column; gap: 5px; max-height: 110px; overflow-y: auto; margin-bottom: 8px;">
                        ${emailItemsHtml}
                    </div>
                    <div>
                        <label style="display: block; font-size: 10.5px; font-weight: 600; color: #475569; margin-bottom: 3px;">Otro correo electrónico (opcional):</label>
                        <input type="email" id="swal-sobre-custom-email" placeholder="Ej: admin@cliente.com" value="${savedCustomEmail}" style="width: 100%; padding: 5px 7px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11.5px; box-sizing: border-box;" />
                    </div>
                </div>
            </div>

            <!-- Barra de Guardado de Configuración Predeterminada de Contactos -->
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 8px 10px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 6px;">
                <label style="display: flex; align-items: center; gap: 7px; cursor: pointer; font-size: 11.5px; color: #475569; font-weight: 600; user-select: none;">
                    <input type="checkbox" id="swal-sobre-save-default" checked style="width: 15px; height: 15px; cursor: pointer; accent-color: #7c3aed;" />
                    <span>Guardar esta selección de contactos para próximos envíos a este cliente</span>
                </label>
                <button type="button" id="btn-save-sobre-contact-config" style="background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; border-radius: 6px; padding: 5px 11px; font-size: 11px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                    💾 Guardar Configuración Ahora
                </button>
            </div>
            <div id="swal-sobre-save-feedback" style="display: none; font-size: 11px; font-weight: 700; color: #15803d; text-align: right; margin-top: -6px;"></div>

            <!-- Cuerpo Corto del Mensaje de WhatsApp Pre-redactado y Editable -->
            <div style="border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; background: #ffffff;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <label style="font-size: 11.5px; font-weight: 700; color: #0f172a; text-transform: uppercase;">
                        💬 Cuerpo Breve del Mensaje WhatsApp / Email (Toda la trazabilidad y el arqueo van en los PDFs adjuntos):
                    </label>
                    <button type="button" id="btn-reset-sobre-mensaje" style="background: none; border: none; color: #4f46e5; font-size: 11px; font-weight: 700; cursor: pointer; text-decoration: underline;">
                        🔄 Regenerar Texto
                    </button>
                </div>
                <textarea id="swal-sobre-mensaje" rows="4" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; font-family: inherit; box-sizing: border-box; resize: vertical; line-height: 1.45; background: #fcfcfc;"></textarea>
                
                <!-- Barra de prueba rápida en WhatsApp Empresa -->
                <div style="margin-top: 8px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 6px 10px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                    <span style="font-size: 11px; font-weight: 700; color: #92400e;">🧪 Probar envío con los PDFs tildados en WhatsApp Empresa:</span>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <input type="text" id="swal-sobre-tel-prueba" value="5492216615746" style="width: 120px; padding: 3px 6px; font-size: 11px; font-weight: 700; border: 1px solid #f59e0b; border-radius: 4px; color: #78350f;" />
                        <button type="button" id="btn-swal-sobre-enviar-prueba" style="background: #d97706; color: white; border: none; border-radius: 5px; padding: 4px 10px; font-size: 11px; font-weight: 800; cursor: pointer;">
                            🧪 Enviar Prueba
                        </button>
                    </div>
                </div>
                <div id="swal-sobre-prueba-feedback" style="display: none; margin-top: 5px; padding: 5px 8px; border-radius: 5px; font-size: 11px; font-weight: 700;"></div>
            </div>
        </div>
    `;

    const obtenerDocsSeleccionadosEnModal = () => {
        const chks = Array.from(document.querySelectorAll('.swal-sobre-doc-chk:checked')).map(el => el.value);
        return chks.length > 0 ? chks : ['recibo'];
    };

    const enviarNotificacionEfectivo = async (wps, mails, mensajeTexto, docsAdjuntos = ['recibo', 'trazabilidad']) => {
        const syncPayload = {
            desglose_auditado: desgloseAuditado,
            diferencias_arqueo: diferenciasArqueo
        };
        const resultados = { wpOk: false, emailOk: false, errores: [] };

        if (wps.length > 0) {
            try {
                if (movId) {
                    const resWp = await fetch(`/api/logistica/bunker/cuentas-corrientes/movimientos/${movId}/whatsapp`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            destinatarios: wps.join(', '),
                            mensajeTexto,
                            codigo_sobre: sobre.codigo_sobre,
                            documentos_adjuntos: docsAdjuntos,
                            sync_arqueo: syncPayload
                        })
                    });
                    const dataWp = await resWp.json();
                    if (!resWp.ok || !dataWp.success) throw new Error(dataWp.message || dataWp.error || 'Error al enviar WhatsApp con PDF');
                    resultados.wpOk = true;
                } else {
                    for (const numero of wps) {
                        const resWp = await fetch('/api/facturacion/whatsapp/enviar-mensaje', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ telefono: numero, mensaje: mensajeTexto })
                        });
                        const dataWp = await resWp.json();
                        if (!resWp.ok || !dataWp.success) throw new Error(dataWp.message || dataWp.error || 'Error al enviar WhatsApp');
                    }
                    resultados.wpOk = true;
                }
            } catch (errWp) {
                resultados.errores.push(`WhatsApp: ${errWp.message}`);
            }
        }

        if (mails.length > 0 && movId) {
            try {
                const resEm = await fetch(`/api/logistica/bunker/cuentas-corrientes/movimientos/${movId}/email`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        destinatarios: mails.join(', '),
                        mensajeTexto,
                        codigo_sobre: sobre.codigo_sobre,
                        documentos_adjuntos: docsAdjuntos,
                        sync_arqueo: syncPayload
                    })
                });
                const dataEm = await resEm.json();
                if (!resEm.ok || !dataEm.success) throw new Error(dataEm.message || dataEm.error || 'Error al enviar Correo Electrónico');
                resultados.emailOk = true;
            } catch (errEm) {
                resultados.errores.push(`Email: ${errEm.message}`);
            }
        }

        return resultados;
    };

    const { value: modalResult } = await Swal.fire({
        title: `<span style="color: #8e4785; font-size: 1.2rem; font-weight: 800;">📲 Notificar Recepción y Arqueo (${sobre.codigo_sobre})</span>`,
        width: '820px',
        html: htmlModal,
        showCancelButton: true,
        confirmButtonText: '📤 Enviar Mensaje y PDFs Seleccionados',
        cancelButtonText: 'Omitir / Cerrar',
        confirmButtonColor: '#16a34a',
        cancelButtonColor: '#64748b',
        focusConfirm: false,
        didOpen: () => {
            const textarea = document.getElementById('swal-sobre-mensaje');
            if (textarea) {
                textarea.value = defaultMessage;
                textarea.dataset.edited = 'false';
                textarea.addEventListener('input', () => {
                    textarea.dataset.edited = 'true';
                });
            }

            // Actualizar automáticamente el texto corto cuando se tildan/destildan los PDFs (si el usuario no editó manualmente el texto)
            document.querySelectorAll('.swal-sobre-doc-chk').forEach(chk => {
                chk.addEventListener('change', () => {
                    if (textarea && textarea.dataset.edited !== 'true') {
                        textarea.value = construirMensajeDinamicoArqueo(obtenerDocsSeleccionadosEnModal());
                    }
                });
            });

            // Botones de previsualización inline dentro del modal
            const previewBox = document.getElementById('swal-sobre-pdf-preview-box');
            const previewIframe = document.getElementById('swal-sobre-pdf-iframe');
            const previewTitle = document.getElementById('swal-sobre-pdf-preview-title');
            const btnClosePreview = document.getElementById('btn-close-pdf-preview');

            document.querySelectorAll('.btn-preview-pdf-inline').forEach(btn => {
                btn.addEventListener('click', () => {
                    const url = btn.getAttribute('data-url');
                    const title = btn.getAttribute('data-title') || 'Previsualización PDF';
                    if (previewBox && previewIframe) {
                        if (previewTitle) previewTitle.textContent = title;
                        previewIframe.src = url;
                        previewBox.style.display = 'block';
                        previewBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                });
            });

            if (btnClosePreview && previewBox && previewIframe) {
                btnClosePreview.addEventListener('click', () => {
                    previewBox.style.display = 'none';
                    previewIframe.src = 'about:blank';
                });
            }

            const btnReset = document.getElementById('btn-reset-sobre-mensaje');
            if (btnReset && textarea) {
                btnReset.addEventListener('click', () => {
                    textarea.dataset.edited = 'false';
                    textarea.value = construirMensajeDinamicoArqueo(obtenerDocsSeleccionadosEnModal());
                });
            }

            const btnSaveConfig = document.getElementById('btn-save-sobre-contact-config');
            const feedbackSave = document.getElementById('swal-sobre-save-feedback');
            if (btnSaveConfig) {
                btnSaveConfig.addEventListener('click', async () => {
                    btnSaveConfig.disabled = true;
                    const origText = btnSaveConfig.innerHTML;
                    btnSaveConfig.innerHTML = '⏳ Guardando...';

                    const selWps = Array.from(document.querySelectorAll('.swal-sobre-wp-chk:checked')).map(el => el.value);
                    const selEms = Array.from(document.querySelectorAll('.swal-sobre-email-chk:checked')).map(el => el.value);
                    const customP = document.getElementById('swal-sobre-custom-phone')?.value.trim() || '';
                    const customE = document.getElementById('swal-sobre-custom-email')?.value.trim() || '';

                    if (customP) {
                        const cleanP = customP.replace(/\D/g, '');
                        if (cleanP && !selWps.includes(cleanP)) selWps.push(cleanP);
                    }
                    if (customE && customE.includes('@')) {
                        if (!selEms.includes(customE)) selEms.push(customE);
                    }

                    try {
                        await guardarPreferenciasContactosCliente(selWps, selEms, customP, customE);
                        btnSaveConfig.innerHTML = '✅ ¡Configuración Guardada!';
                        btnSaveConfig.style.background = '#dcfce7';
                        btnSaveConfig.style.color = '#15803d';
                        btnSaveConfig.style.borderColor = '#86efac';
                        if (feedbackSave) {
                            feedbackSave.textContent = '✓ Preferencias de contactos guardadas en la ficha del cliente para próximos envíos.';
                            feedbackSave.style.display = 'block';
                        }
                        setTimeout(() => {
                            btnSaveConfig.disabled = false;
                            btnSaveConfig.innerHTML = origText;
                            btnSaveConfig.style.background = '#f3e8ff';
                            btnSaveConfig.style.color = '#6b21a8';
                            btnSaveConfig.style.borderColor = '#d8b4fe';
                        }, 2200);
                    } catch (err) {
                        btnSaveConfig.disabled = false;
                        btnSaveConfig.innerHTML = '❌ Error al guardar';
                    }
                });
            }

            const btnPrueba = document.getElementById('btn-swal-sobre-enviar-prueba');
            const feedbackPrueba = document.getElementById('swal-sobre-prueba-feedback');
            if (btnPrueba) {
                btnPrueba.addEventListener('click', async () => {
                    const telInput = document.getElementById('swal-sobre-tel-prueba');
                    const tel = telInput ? telInput.value.replace(/\D/g, '') : '';
                    const msg = textarea ? textarea.value : defaultMessage;
                    const docsSel = obtenerDocsSeleccionadosEnModal();
                    if (!tel) return;

                    btnPrueba.disabled = true;
                    const orig = btnPrueba.innerHTML;
                    btnPrueba.innerHTML = '⏳ Enviando...';
                    if (feedbackPrueba) feedbackPrueba.style.display = 'none';

                    const res = await enviarNotificacionEfectivo([tel], [], msg, docsSel);
                    btnPrueba.disabled = false;
                    btnPrueba.innerHTML = orig;

                    if (feedbackPrueba) {
                        feedbackPrueba.style.display = 'block';
                        if (res.wpOk) {
                            feedbackPrueba.style.background = '#dcfce7';
                            feedbackPrueba.style.color = '#166534';
                            feedbackPrueba.textContent = `✅ Prueba enviada al ${tel} con ${docsSel.length} PDF(s) adjunto(s) (${docsSel.join(' + ')}).`;
                        } else {
                            feedbackPrueba.style.background = '#fee2e2';
                            feedbackPrueba.style.color = '#991b1b';
                            feedbackPrueba.textContent = `❌ Error en prueba: ${res.errores.join(', ')}`;
                        }
                    }
                });
            }
        },
        preConfirm: () => {
            const selWps = Array.from(document.querySelectorAll('.swal-sobre-wp-chk:checked')).map(el => el.value);
            const selEms = Array.from(document.querySelectorAll('.swal-sobre-email-chk:checked')).map(el => el.value);
            const customP = document.getElementById('swal-sobre-custom-phone')?.value.trim() || '';
            const customE = document.getElementById('swal-sobre-custom-email')?.value.trim() || '';
            const saveDefault = document.getElementById('swal-sobre-save-default')?.checked || false;
            const mensajeTexto = document.getElementById('swal-sobre-mensaje')?.value || defaultMessage;
            const docsAdjuntos = obtenerDocsSeleccionadosEnModal();

            const wps = [...selWps];
            if (customP) {
                customP.split(',').forEach(p => {
                    const clean = p.replace(/\D/g, '');
                    if (clean && !wps.includes(clean)) wps.push(clean);
                });
            }

            const mails = [...selEms];
            if (customE) {
                customE.split(',').forEach(m => {
                    const clean = m.trim();
                    if (clean && clean.includes('@') && !mails.includes(clean)) mails.push(clean);
                });
            }

            if (wps.length === 0 && mails.length === 0) {
                Swal.showValidationMessage('Seleccione al menos un destinatario de WhatsApp o Correo Electrónico.');
                return false;
            }

            return { wps, mails, saveDefault, mensajeTexto, customP, customE, docsAdjuntos };
        }
    });

    if (!modalResult) return;

    const { wps, mails, saveDefault, mensajeTexto, customP, customE, docsAdjuntos } = modalResult;

    Swal.fire({
        title: 'Enviando Mensaje y PDFs...',
        text: `Despachando ${docsAdjuntos.length} documento(s) PDF al cliente...`,
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: () => Swal.showLoading()
    });

    if (saveDefault) {
        try {
            await guardarPreferenciasContactosCliente(wps, mails, customP, customE);
        } catch (e) {
            console.warn('Error al guardar contactos predeterminados:', e);
        }
    }

    const resultadoEnvio = await enviarNotificacionEfectivo(wps, mails, mensajeTexto, docsAdjuntos);

    if (resultadoEnvio.errores.length > 0 && !resultadoEnvio.wpOk && !resultadoEnvio.emailOk) {
        Swal.fire({
            icon: 'error',
            title: 'Error en el Envío',
            text: resultadoEnvio.errores.join(' | '),
            confirmButtonColor: '#8e4785'
        });
        return;
    }

    const canalesEnviados = [];
    if (resultadoEnvio.wpOk) canalesEnviados.push(`WhatsApp (${wps.join(', ')})`);
    if (resultadoEnvio.emailOk) canalesEnviados.push(`Email (${mails.join(', ')})`);

    Swal.fire({
        icon: 'success',
        title: '¡Notificación y PDFs Enviados!',
        html: `
            <div style="text-align: center; font-size: 0.92rem; color: #1e293b;">
                <p>Se despacharon los documentos PDF seleccionados (<strong>${docsAdjuntos.join(', ')}</strong>) correspondientes al sobre <strong>#${sobre.codigo_sobre}</strong> (${formatCurrency(montoAuditado)}).</p>
                <p style="font-size: 0.82rem; color: #15803d; font-weight: 700;">📡 Canales despachados: ${canalesEnviados.join(' + ')}</p>
            </div>
        `,
        showCancelButton: true,
        confirmButtonColor: '#8e4785',
        confirmButtonText: `💳 Ir a Cuenta Corriente (${codigoBunker})`,
        cancelButtonColor: '#64748b',
        cancelButtonText: 'Seguir en Recepción'
    }).then((resFinal) => {
        if (resFinal.isConfirmed && codigoBunker) {
            window.location.href = `cuenta-corriente.html?cliente=${encodeURIComponent(codigoBunker)}`;
        }
    });
};
