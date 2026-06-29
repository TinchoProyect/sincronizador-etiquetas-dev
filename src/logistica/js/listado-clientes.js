/**
 * Lógica Frontend - Gestión de Clientes Búnker
 * Controla el listado, filtrado elástico en caliente, la apertura del Drawer lateral
 * y el CRUD interactivo mediante peticiones fetch.
 */

document.addEventListener('DOMContentLoaded', () => {
    const apiEndpoint = '/api/logistica/bunker/clientes';

    console.log(`🔌 [CLIENTES-FRONT] Endpoint API configurado en ruta relativa: ${apiEndpoint}`);

    // Elementos del DOM
    const buscadorInput = document.getElementById('buscador-clientes');
    const btnNuevoCliente = document.getElementById('btn-nuevo-cliente');
    const cuerpoTablaClientes = document.getElementById('cuerpo-tabla-clientes');
    const btnConfigColumnas = document.getElementById('btn-config-columnas');
    const dropdownColumnas = document.getElementById('dropdown-columnas');
    const checkboxesColumnas = document.getElementById('checkboxes-columnas');
    
    // Elementos del Widget de Deuda y Envío en Lote
    const txtDeudaTotal = document.getElementById('txt-deuda-total');
    const btnToggleDeuda = document.getElementById('btn-toggle-deuda');
    const chkSeleccionarTodos = document.getElementById('chk-seleccionar-todos');
    const bulkActionsBar = document.getElementById('bulk-actions-bar');
    const bulkSelectedCount = document.getElementById('bulk-selected-count');
    const btnBulkWhatsapp = document.getElementById('btn-bulk-whatsapp');
    const btnClearSelection = document.getElementById('btn-clear-selection');
    const chkBulkDetallado = document.getElementById('chk-bulk-detallado');
    
    // Elementos del Drawer
    const drawerOverlay = document.getElementById('drawer-overlay');
    const drawerCliente = document.getElementById('drawer-cliente');
    const btnCerrarDrawer = document.getElementById('btn-cerrar-drawer');
    const btnCancelarDrawer = document.getElementById('btn-cancelar-drawer');
    const btnGuardarCliente = document.getElementById('btn-guardar-cliente');
    const formCliente = document.getElementById('form-cliente');
    const drawerTitulo = document.getElementById('drawer-titulo');
    
    // Campos del Formulario
    const txtId = document.getElementById('cliente-id');
    const txtCodigo = document.getElementById('txt-codigo');
    const txtNombre = document.getElementById('txt-nombre');
    const txtRazon = document.getElementById('txt-razon');
    const txtLomasId = document.getElementById('txt-lomas-id');
    const txtCuit = document.getElementById('txt-cuit');
    const selCondicionIva = document.getElementById('sel-condicion-iva');
    const txtDomicilioFiscal = document.getElementById('txt-domicilio-fiscal');
    const txtProvincia = document.getElementById('txt-provincia');
    const txtWhatsappFacturas = document.getElementById('txt-whatsapp-facturas');
    const txtEmailFacturas = document.getElementById('txt-email-facturas');
    const selCanalPreferido = document.getElementById('sel-canal-preferido');
    const helperCuit = document.getElementById('helper-cuit');
    const btnConsultarArca = document.getElementById('btn-consultar-arca');
    
    // Campos fiscales extendidos (Fase 3)
    const txtEstadoClave = document.getElementById('txt-estado-clave');
    const txtCategoriaMonotributo = document.getElementById('txt-categoria-monotributo');
    const txtActividadPrincipal = document.getElementById('txt-actividad-principal');
    
    // Campos de Acceso al Portal B2B
    const txtEmailPortal = document.getElementById('txt-email-portal');
    const txtEmailPortalNombre = document.getElementById('txt-email-portal-nombre');
    const txtEmailPortalCargo = document.getElementById('txt-email-portal-cargo');


    // Configuración de visibilidad de columnas
    const columnasConfig = {
        codigo: { selector: '.col-codigo', visible: true },
        nombre: { selector: '.col-nombre', visible: true },
        razon: { selector: '.col-razon', visible: true },
        externo: { selector: '.col-externo', visible: true },
        saldo: { selector: '.col-saldo', visible: true },
        listas: { selector: '.col-listas', visible: true }
    };

    function inicializarColumnas() {
        const guardado = localStorage.getItem('lamda_columnas_visibles');
        if (guardado) {
            try {
                const configGuardada = JSON.parse(guardado);
                for (const key in configGuardada) {
                    if (columnasConfig[key]) {
                        columnasConfig[key].visible = !!configGuardada[key];
                    }
                }
            } catch (e) {
                console.error('Error al parsear columnas guardadas:', e);
            }
        }
        
        // Sincronizar checkboxes en el dropdown
        if (checkboxesColumnas) {
            checkboxesColumnas.querySelectorAll('input[type="checkbox"]').forEach(chk => {
                const colKey = chk.getAttribute('data-col');
                if (columnasConfig[colKey]) {
                    chk.checked = columnasConfig[colKey].visible;
                }
            });
        }

        aplicarVisibilidadColumnas();
    }

    function aplicarVisibilidadColumnas() {
        let css = '';
        for (const [key, col] of Object.entries(columnasConfig)) {
            if (!col.visible) {
                css += `${col.selector} { display: none !important; }\n`;
            }
        }
        
        let styleEl = document.getElementById('column-visibility-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'column-visibility-style';
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = css;

        // Actualizar el colspan para todas las celdas que ocupan la fila completa
        const visibleCount = Object.values(columnasConfig).filter(c => c.visible).length + 2; // +2 por selección y col-acciones
        cuerpoTablaClientes.querySelectorAll('td[colspan]').forEach(td => {
            td.setAttribute('colspan', visibleCount);
        });
    }

    function guardarColumnas() {
        const configParaGuardar = {};
        for (const [key, col] of Object.entries(columnasConfig)) {
            configParaGuardar[key] = col.visible;
        }
        localStorage.setItem('lamda_columnas_visibles', JSON.stringify(configParaGuardar));
    }

    // Configurar eventos del dropdown y checkboxes
    if (btnConfigColumnas && dropdownColumnas) {
        btnConfigColumnas.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = dropdownColumnas.style.display === 'none';
            dropdownColumnas.style.display = isHidden ? 'block' : 'none';
        });

        document.addEventListener('click', (e) => {
            if (!dropdownColumnas.contains(e.target) && e.target !== btnConfigColumnas) {
                dropdownColumnas.style.display = 'none';
            }
        });
    }

    if (checkboxesColumnas) {
        checkboxesColumnas.addEventListener('change', (e) => {
            if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'checkbox') {
                const colKey = e.target.getAttribute('data-col');
                if (columnasConfig[colKey]) {
                    columnasConfig[colKey].visible = e.target.checked;
                    guardarColumnas();
                    aplicarVisibilidadColumnas();
                }
            }
        });
    }

    // Listado en memoria para búsquedas locales rápidas y precarga
    let todosLosClientes = [];

    // Selección de clientes para acciones en lote
    const clientesSeleccionadosIds = new Set();

    // Estado del ojo (mostrar/ocultar deuda total)
    let mostrarDeuda = localStorage.getItem('lamda_mostrar_deuda_total') !== 'false';

    function actualizarDeudaTotal() {
        const totalDeuda = todosLosClientes.reduce((acc, c) => {
            const val = parseFloat(c.saldo || 0);
            return val > 0 ? acc + val : acc;
        }, 0);

        if (txtDeudaTotal && btnToggleDeuda) {
            if (mostrarDeuda) {
                txtDeudaTotal.textContent = '$ ' + totalDeuda.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                btnToggleDeuda.textContent = '👁️';
                btnToggleDeuda.title = 'Ocultar Deuda';
            } else {
                txtDeudaTotal.textContent = '$ ••••••••';
                btnToggleDeuda.textContent = '🙈';
                btnToggleDeuda.title = 'Mostrar Deuda';
            }
        }
    }

    if (btnToggleDeuda) {
        btnToggleDeuda.addEventListener('click', () => {
            mostrarDeuda = !mostrarDeuda;
            localStorage.setItem('lamda_mostrar_deuda_total', mostrarDeuda);
            actualizarDeudaTotal();
        });
    }

    function actualizarBarraAccionesLote() {
        if (!bulkActionsBar || !bulkSelectedCount) return;
        const count = clientesSeleccionadosIds.size;
        bulkSelectedCount.textContent = count;
        
        if (count > 0) {
            bulkActionsBar.style.display = 'flex';
            setTimeout(() => {
                bulkActionsBar.style.opacity = '1';
                bulkActionsBar.style.transform = 'translateX(-50%) translateY(0)';
            }, 10);
        } else {
            bulkActionsBar.style.opacity = '0';
            bulkActionsBar.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => {
                if (clientesSeleccionadosIds.size === 0) {
                    bulkActionsBar.style.display = 'none';
                }
            }, 300);
        }
    }

    function actualizarEstadoChkTodos() {
        if (!chkSeleccionarTodos) return;
        
        const checkboxesVisibles = Array.from(cuerpoTablaClientes.querySelectorAll('.chk-cliente:not(:disabled)'));
        
        if (checkboxesVisibles.length === 0) {
            chkSeleccionarTodos.checked = false;
            chkSeleccionarTodos.disabled = true;
            return;
        }
        
        chkSeleccionarTodos.disabled = false;
        const todosChequeados = checkboxesVisibles.every(chk => chk.checked);
        chkSeleccionarTodos.checked = todosChequeados;
    }

    function obtenerContactosSeleccionados(clienteId) {
        const saved = localStorage.getItem('lamda_clientes_contactos_seleccionados');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed && parsed[String(clienteId)]) {
                    return parsed[String(clienteId)];
                }
            } catch (e) {
                console.error('Error parseando lamda_clientes_contactos_seleccionados:', e);
            }
        }
        return null;
    }

    function guardarContactosSeleccionados(clienteId, numerosArray) {
        const saved = localStorage.getItem('lamda_clientes_contactos_seleccionados');
        let parsed = {};
        if (saved) {
            try {
                parsed = JSON.parse(saved) || {};
            } catch (e) {
                console.error('Error parseando lamda_clientes_contactos_seleccionados:', e);
            }
        }
        parsed[String(clienteId)] = numerosArray;
        localStorage.setItem('lamda_clientes_contactos_seleccionados', JSON.stringify(parsed));
    }

    function obtenerContactosDeCliente(cliente) {
        const whatsappString = cliente.whatsapp_facturas || '';
        let contactos = [];
        if (whatsappString.trim().startsWith('[')) {
            try {
                contactos = JSON.parse(whatsappString);
            } catch (e) {
                console.error('Error parseando whatsapp_facturas:', e);
            }
        } else if (whatsappString.trim().length > 0) {
            contactos = whatsappString.split(',').map(n => ({ numero: n.trim(), nombre: '', cargo: '', default_factura: true }));
        }
        return contactos.map(c => ({
            numero: c.numero ? c.numero.replace(/\D/g, '') : '',
            nombre: c.nombre || '',
            cargo: c.cargo || '',
            default_factura: c.default_factura !== false
        })).filter(c => c.numero.length > 0);
    }

    function obtenerEmailsDeCliente(cliente) {
        const emailString = cliente.email_facturas || '';
        let emails = [];
        if (emailString.trim().startsWith('[')) {
            try {
                emails = JSON.parse(emailString);
            } catch (e) {
                console.error('Error parseando email_facturas:', e);
            }
        } else if (emailString.trim().length > 0) {
            emails = emailString.split(',').map(e => ({ email: e.trim(), nombre: '', cargo: '', default_factura: true }));
        }
        return emails.map(e => ({
            email: e.email ? e.email.trim() : '',
            nombre: e.nombre || '',
            cargo: e.cargo || '',
            default_factura: e.default_factura !== false
        })).filter(e => e.email.length > 0);
    }

    async function abrirConfiguracionContactosBulk(clienteId, clienteNombre, forceOpen) {
        const cliente = todosLosClientes.find(c => String(c.id) === String(clienteId));
        if (!cliente) return false;

        const contactosWp = obtenerContactosDeCliente(cliente);
        const contactosEmail = obtenerEmailsDeCliente(cliente);

        if (contactosWp.length === 0 && contactosEmail.length === 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Sin contactos',
                text: 'El cliente no posee contactos de WhatsApp ni de Correo configurados.',
                confirmButtonColor: '#6b21a8'
            });
            return false;
        }

        let preSeleccionados = obtenerContactosSeleccionados(clienteId);
        let selectedWps = [];
        let selectedEmails = [];

        if (preSeleccionados) {
            if (Array.isArray(preSeleccionados)) {
                selectedWps = preSeleccionados;
                selectedEmails = contactosEmail.filter(e => e.default_factura).map(e => e.email);
            } else if (preSeleccionados.whatsapp && preSeleccionados.email) {
                selectedWps = preSeleccionados.whatsapp;
                selectedEmails = preSeleccionados.email;
            }
        } else {
            selectedWps = contactosWp.filter(c => c.default_factura).map(c => c.numero);
            selectedEmails = contactosEmail.filter(e => e.default_factura).map(e => e.email);
            if (selectedWps.length === 0 && selectedEmails.length === 0) {
                selectedWps = contactosWp.map(c => c.numero);
                selectedEmails = contactosEmail.map(e => e.email);
            }
        }

        let htmlContent = `
            <div style="text-align: left; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
                <p style="margin-bottom: 12px; font-size: 14px; color: #4b5563; font-weight: 500;">
                    Seleccione los contactos a los que desea enviar el saldo de <strong>${clienteNombre}</strong>:
                </p>
        `;

        // Sección WhatsApp
        htmlContent += `
            <div style="margin-bottom: 15px;">
                <div style="font-size: 12px; font-weight: 600; color: #10b981; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px; display: flex; align-items: center; gap: 4px;">
                    <span>📱 WhatsApp</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px; max-height: 150px; overflow-y: auto; padding: 2px; border: 1px solid #e2e8f0; border-radius: 6px;">
        `;

        if (contactosWp.length === 0) {
            htmlContent += `
                <div style="padding: 10px; font-size: 12px; color: #94a3b8; text-align: center;">
                    No hay contactos de WhatsApp cargados para este cliente.
                </div>
            `;
        } else {
            contactosWp.forEach((c, index) => {
                const isChecked = selectedWps.includes(c.numero) ? 'checked' : '';
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
                    <label style="display: flex; align-items: flex-start; gap: 10px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f9fafb; cursor: pointer; transition: background 0.2s; margin-bottom: 0;">
                        <input type="checkbox" class="swal-bulk-contacto-wp-chk" value="${c.numero}" ${isChecked} style="margin-top: 2px; cursor: pointer; width: 15px; height: 15px; accent-color: #10b981;">
                        <div style="flex: 1;">
                            <div style="font-size: 12px; color: #1f2937; margin-bottom: 1px;">${labelText}</div>
                            <div style="font-size: 11px; color: #6b7280;">📱 ${displayNum}</div>
                        </div>
                    </label>
                `;
            });
        }

        htmlContent += `
                </div>
            </div>
        `;

        // Sección Email
        htmlContent += `
            <div style="margin-bottom: 15px;">
                <div style="font-size: 12px; font-weight: 600; color: #8b5cf6; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">
                    <span>📧 Correo Electrónico</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px; max-height: 150px; overflow-y: auto; padding: 2px; border: 1px solid #e2e8f0; border-radius: 6px;">
        `;

        if (contactosEmail.length === 0) {
            htmlContent += `
                <div style="padding: 10px; font-size: 12px; color: #94a3b8; text-align: center;">
                    No hay contactos de correo cargados para este cliente.
                </div>
            `;
        } else {
            contactosEmail.forEach((e, index) => {
                const isChecked = selectedEmails.includes(e.email) ? 'checked' : '';
                const labelText = e.nombre 
                    ? `<strong>${e.nombre}</strong>${e.cargo ? ` <span style="font-size: 9px; background: #f3e8ff; color: #6b21a8; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${e.cargo}</span>` : ''}`
                    : `Contacto #${index + 1}`;

                htmlContent += `
                    <label style="display: flex; align-items: flex-start; gap: 10px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f9fafb; cursor: pointer; transition: background 0.2s; margin-bottom: 0;">
                        <input type="checkbox" class="swal-bulk-contacto-email-chk" value="${e.email}" ${isChecked} style="margin-top: 2px; cursor: pointer; width: 15px; height: 15px; accent-color: #8b5cf6;">
                        <div style="flex: 1;">
                            <div style="font-size: 12px; color: #1f2937; margin-bottom: 1px;">${labelText}</div>
                            <div style="font-size: 11px; color: #6b7280; word-break: break-all;">📧 ${e.email}</div>
                        </div>
                    </label>
                `;
            });
        }

        htmlContent += `
                </div>
            </div>
            </div>
        `;

        const result = await Swal.fire({
            title: 'Seleccionar Destinatarios',
            html: htmlContent,
            icon: 'info',
            showCancelButton: true,
            confirmButtonText: '💾 Confirmar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: 'var(--purple-primary)',
            cancelButtonColor: '#64748b',
            preConfirm: () => {
                const wps = Array.from(document.querySelectorAll('.swal-bulk-contacto-wp-chk:checked')).map(el => el.value);
                const emails = Array.from(document.querySelectorAll('.swal-bulk-contacto-email-chk:checked')).map(el => el.value);
                return {
                    whatsapp: wps,
                    email: emails
                };
            }
        });

        if (result.isConfirmed) {
            guardarContactosSeleccionados(clienteId, result.value);
            clientesSeleccionadosIds.add(Number(clienteId));
            
            const chk = cuerpoTablaClientes.querySelector(`.chk-cliente[data-id="${clienteId}"]`);
            if (chk) chk.checked = true;
            
            actualizarBarraAccionesLote();
            actualizarEstadoChkTodos();
            return true;
        } else {
            if (forceOpen) {
                clientesSeleccionadosIds.delete(Number(clienteId));
                const chk = cuerpoTablaClientes.querySelector(`.chk-cliente[data-id="${clienteId}"]`);
                if (chk) chk.checked = false;
                actualizarBarraAccionesLote();
                actualizarEstadoChkTodos();
            }
            return false;
        }
    }

    // Estado de ordenamiento para la columna Saldo ('none' | 'desc' | 'asc')
    let sortState = 'none';

    function ordenarYRenderizar() {
        let clientesOrdenados = [...todosLosClientes];
        
        // Aplicar Filtro Portal B2B
        const filtroB2B = document.getElementById('filtro-portal-b2b')?.value || 'todos';
        if (filtroB2B === 'activos') {
            clientesOrdenados = clientesOrdenados.filter(c => c.email_portal && c.email_portal.trim() !== '');
        } else if (filtroB2B === 'pendientes') {
            clientesOrdenados = clientesOrdenados.filter(c => !c.email_portal || c.email_portal.trim() === '');
        }

        if (sortState === 'desc') {
            clientesOrdenados.sort((a, b) => {
                const saldoA = parseFloat(a.saldo || 0);
                const saldoB = parseFloat(b.saldo || 0);
                return saldoB - saldoA; // Mayor saldo deudor primero
            });
        } else if (sortState === 'asc') {
            clientesOrdenados.sort((a, b) => {
                const saldoA = parseFloat(a.saldo || 0);
                const saldoB = parseFloat(b.saldo || 0);
                return saldoA - saldoB; // Menor saldo primero (más a favor primero)
            });
        } else {
            // 'none': Orden por defecto (Nombre Comercial alfabético)
            clientesOrdenados.sort((a, b) => {
                return (a.cliente_nombre || '').localeCompare(b.cliente_nombre || '', 'es');
            });
        }
        renderizarClientes(clientesOrdenados);
    }

    function setupSorting() {
        const thSaldo = document.getElementById('th-saldo');
        const sortIconSaldo = document.getElementById('sort-icon-saldo');

        if (thSaldo && sortIconSaldo) {
            thSaldo.addEventListener('click', () => {
                if (sortState === 'none') {
                    sortState = 'desc';
                    sortIconSaldo.textContent = ' ▼';
                    sortIconSaldo.style.opacity = '1';
                } else if (sortState === 'desc') {
                    sortState = 'asc';
                    sortIconSaldo.textContent = ' ▲';
                    sortIconSaldo.style.opacity = '1';
                } else {
                    sortState = 'none';
                    sortIconSaldo.textContent = ' ⇅';
                    sortIconSaldo.style.opacity = '0.3';
                }
                ordenarYRenderizar();
            });
        }
    }

    // Prefijos telefónicos de 3 dígitos de Argentina
    const PREFIJOS_3 = new Set([
        '220', '221', '223', '249', '260', '261', '263', '264', '280', '291', '294', '297', '298', '299',
        '341', '342', '343', '345', '348', '351', '353', '358', '370', '376', '379', '380', '381', '383', '385', '387', '388'
    ]);

    function stripLocal15(numberStr) {
        if (numberStr.length === 12 && numberStr.startsWith('11') && numberStr.substring(2, 4) === '15') {
            return '11' + numberStr.substring(4);
        }
        const prefix3 = numberStr.substring(0, 3);
        if (numberStr.length === 12 && numberStr.substring(3, 5) === '15') {
            return prefix3 + numberStr.substring(5);
        }
        const prefix4 = numberStr.substring(0, 4);
        if (numberStr.length === 12 && numberStr.substring(4, 6) === '15') {
            return prefix4 + numberStr.substring(6);
        }
        return numberStr;
    }

    function cleanInputForFormatting(val) {
        let clean = val.replace(/\D/g, '');
        
        if (clean.startsWith('540')) {
            clean = '549' + clean.substring(3);
        } else if (clean.startsWith('54') && clean.length > 2 && !clean.startsWith('549')) {
            clean = '549' + clean.substring(2);
        }
        
        if (!clean.startsWith('54') && clean.startsWith('0') && clean.length > 1) {
            clean = clean.substring(1);
        }
        
        clean = stripLocal15(clean);
        return clean;
    }

    function formatArgentinePhone(cleanDigits) {
        if (!cleanDigits) return '';
        let isInternational = false;
        let base = cleanDigits;
        
        if (cleanDigits.startsWith('549')) {
            isInternational = true;
            base = cleanDigits.substring(3);
        } else if (cleanDigits.startsWith('54')) {
            isInternational = true;
            base = cleanDigits.substring(2);
        }
        
        let formattedBase = '';
        if (base.startsWith('11')) {
            const area = base.substring(0, 2);
            const sub = base.substring(2);
            if (sub.length > 4) {
                formattedBase = `(${area}) ${sub.substring(0, 4)}-${sub.substring(4, 8)}`;
            } else if (sub.length > 0) {
                formattedBase = `(${area}) ${sub}`;
            } else {
                formattedBase = `(${area})`;
            }
        } else {
            let prefixLength = 4;
            if (base.length >= 3) {
                const prefix3 = base.substring(0, 3);
                if (PREFIJOS_3.has(prefix3)) {
                    prefixLength = 3;
                }
            }
            
            const area = base.substring(0, prefixLength);
            const sub = base.substring(prefixLength);
            
            if (prefixLength === 3) {
                if (sub.length > 3) {
                    formattedBase = `(${area}) ${sub.substring(0, 3)}-${sub.substring(3, 7)}`;
                } else if (sub.length > 0) {
                    formattedBase = `(${area}) ${sub}`;
                } else if (area.length > 0) {
                    formattedBase = `(${area})`;
                }
            } else {
                if (sub.length > 2) {
                    formattedBase = `(${area}) ${sub.substring(0, 2)}-${sub.substring(2, 6)}`;
                } else if (sub.length > 0) {
                    formattedBase = `(${area}) ${sub}`;
                } else if (area.length > 0) {
                    formattedBase = `(${area})`;
                }
            }
        }
        
        if (isInternational) {
            return `+54 9 ${formattedBase}`;
        }
        return formattedBase;
    }

    // --- Lógica de WhatsApp Dinámico con inputs múltiples y máscara ---
    const btnAddWhatsapp = document.getElementById('btn-add-whatsapp');
    const whatsappInputsContainer = document.getElementById('whatsapp-inputs-container');

    function formatearTelefonoInput(input) {
        let cursorPosition = input.selectionStart;
        const originalLength = input.value.length;

        const clean = cleanInputForFormatting(input.value);
        const formatted = formatArgentinePhone(clean);

        input.value = formatted;

        const newLength = formatted.length;
        cursorPosition = cursorPosition + (newLength - originalLength);
        input.setSelectionRange(cursorPosition, cursorPosition);

        actualizarHiddenWhatsapp();
    }

    function crearFilaWhatsapp(contacto = { numero: '', nombre: '', cargo: '' }) {
        const card = document.createElement('div');
        card.className = 'whatsapp-contact-card';
        card.style.border = '1px solid #cbd5e1';
        card.style.padding = '8px';
        card.style.borderRadius = '6px';
        card.style.backgroundColor = '#f8fafc';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '6px';
        card.style.position = 'relative';

        // Botón de eliminar
        const btnDelete = document.createElement('button');
        btnDelete.type = 'button';
        btnDelete.innerHTML = '❌';
        btnDelete.style.position = 'absolute';
        btnDelete.style.top = '6px';
        btnDelete.style.right = '6px';
        btnDelete.style.background = 'none';
        btnDelete.style.border = 'none';
        btnDelete.style.fontSize = '11px';
        btnDelete.style.cursor = 'pointer';
        btnDelete.style.color = '#ef4444';
        btnDelete.style.padding = '2px';
        btnDelete.title = 'Eliminar contacto';

        btnDelete.addEventListener('click', () => {
            card.remove();
            actualizarHiddenWhatsapp();
        });

        // Fila 1: Nombre y Cargo
        const row1 = document.createElement('div');
        row1.style.display = 'flex';
        row1.style.gap = '6px';
        row1.style.marginRight = '20px'; // No tapar con el botón eliminar

        const inputName = document.createElement('input');
        inputName.type = 'text';
        inputName.className = 'form-control whatsapp-contact-name';
        inputName.placeholder = 'Nombre (ej: Cecilia)';
        inputName.style.flex = '1';
        inputName.style.fontSize = '12px';
        inputName.style.height = '28px';
        inputName.style.padding = '4px 8px';
        inputName.value = contacto.nombre || '';
        inputName.addEventListener('input', actualizarHiddenWhatsapp);

        const inputRole = document.createElement('input');
        inputRole.type = 'text';
        inputRole.className = 'form-control whatsapp-contact-role';
        inputRole.placeholder = 'Cargo (ej: Dueña)';
        inputRole.style.flex = '1';
        inputRole.style.fontSize = '12px';
        inputRole.style.height = '28px';
        inputRole.style.padding = '4px 8px';
        inputRole.value = contacto.cargo || '';
        inputRole.addEventListener('input', actualizarHiddenWhatsapp);

        row1.appendChild(inputName);
        row1.appendChild(inputRole);

        // Fila 2: Teléfono
        const row2 = document.createElement('div');
        
        const inputNumber = document.createElement('input');
        inputNumber.type = 'text';
        inputNumber.className = 'form-control whatsapp-contact-number';
        inputNumber.placeholder = 'Teléfono (ej: 2215474324)';
        inputNumber.style.width = '100%';
        inputNumber.style.fontSize = '12px';
        inputNumber.style.height = '28px';
        inputNumber.style.padding = '4px 8px';
        
        const numberVal = contacto.numero || '';
        inputNumber.value = numberVal;
        if (numberVal) {
            const cleanDigits = cleanInputForFormatting(numberVal);
            inputNumber.value = formatArgentinePhone(cleanDigits);
        }

        inputNumber.addEventListener('input', () => {
            formatearTelefonoInput(inputNumber);
        });

        row2.appendChild(inputNumber);

        card.appendChild(btnDelete);
        card.appendChild(row1);
        card.appendChild(row2);
        whatsappInputsContainer.appendChild(card);

        return inputName;
    }

    function renderWhatsappInputs(valueString) {
        whatsappInputsContainer.innerHTML = '';
        if (!valueString || !valueString.trim()) {
            crearFilaWhatsapp({ numero: '', nombre: '', cargo: '' });
            return;
        }

        const str = valueString.trim();
        if (str.startsWith('[')) {
            try {
                const contacts = JSON.parse(str);
                if (Array.isArray(contacts) && contacts.length > 0) {
                    contacts.forEach(c => {
                        crearFilaWhatsapp(c);
                    });
                    return;
                }
            } catch (err) {
                console.error('Error parseando contactos JSON:', err);
            }
        }

        // Fallback para strings separados por comas tradicionales
        const numbers = str.split(',').map(n => n.trim()).filter(n => n.length > 0);
        numbers.forEach(num => {
            crearFilaWhatsapp({ numero: num, nombre: '', cargo: '' });
        });
    }

    function actualizarHiddenWhatsapp() {
        const cards = Array.from(whatsappInputsContainer.querySelectorAll('.whatsapp-contact-card'));
        const contacts = cards.map(card => {
            const name = card.querySelector('.whatsapp-contact-name').value.trim();
            const role = card.querySelector('.whatsapp-contact-role').value.trim();
            let number = card.querySelector('.whatsapp-contact-number').value.replace(/\D/g, '').trim();

            if (number.length === 10) {
                number = '549' + number;
            } else if (number.startsWith('54') && !number.startsWith('549')) {
                number = '549' + number.substring(2);
            }

            return {
                numero: number,
                nombre: name,
                cargo: role
            };
        }).filter(c => c.numero.length > 0);

        txtWhatsappFacturas.value = contacts.length > 0 ? JSON.stringify(contacts) : '';
    }

    if (btnAddWhatsapp) {
        btnAddWhatsapp.addEventListener('click', () => {
            const input = crearFilaWhatsapp({ numero: '', nombre: '', cargo: '' });
            input.focus();
        });
    }

    // --- Lógica de Email Dinámico con inputs múltiples y autocompletado ---
    const btnAddEmail = document.getElementById('btn-add-email');
    const emailInputsContainer = document.getElementById('email-inputs-container');

    const DOMINIOS_COMUNES = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.ar', 'outlook.com.ar', 'live.com.ar', 'icloud.com', 'fibertel.com.ar', 'speedy.com.ar'];

    function actualizarSugerenciasEmail(input) {
        const value = input.value.trim();
        let datalist = document.getElementById('email-domains-list');
        if (!datalist) {
            datalist = document.createElement('datalist');
            datalist.id = 'email-domains-list';
            document.body.appendChild(datalist);
        }
        
        if (input.getAttribute('list') !== 'email-domains-list') {
            input.setAttribute('list', 'email-domains-list');
        }
        
        datalist.innerHTML = '';
        
        if (!value) return;
        
        const parts = value.split('@');
        const user = parts[0];
        const domain = parts[1] || '';
        
        if (parts.length <= 2) {
            DOMINIOS_COMUNES.forEach(dom => {
                if (!domain || dom.startsWith(domain)) {
                    const option = document.createElement('option');
                    option.value = `${user}@${dom}`;
                    datalist.appendChild(option);
                }
            });
        }
    }

    function validarEmailInput(input) {
        const value = input.value.trim();
        if (!value) {
            input.style.borderColor = '';
            input.style.boxShadow = '';
            return;
        }
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (regex.test(value)) {
            input.style.borderColor = '#10b981'; // Verde
            input.style.boxShadow = '0 0 0 1px #10b981';
        } else {
            input.style.borderColor = '#ef4444'; // Rojo
            input.style.boxShadow = '0 0 0 1px #ef4444';
        }
    }

    function crearFilaEmail(contacto = { email: '', nombre: '', cargo: '' }) {
        const card = document.createElement('div');
        card.className = 'email-contact-card';
        card.style.border = '1px solid #cbd5e1';
        card.style.padding = '8px';
        card.style.borderRadius = '6px';
        card.style.backgroundColor = '#f8fafc';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '6px';
        card.style.position = 'relative';

        // Botón de eliminar
        const btnDelete = document.createElement('button');
        btnDelete.type = 'button';
        btnDelete.innerHTML = '❌';
        btnDelete.style.position = 'absolute';
        btnDelete.style.top = '6px';
        btnDelete.style.right = '6px';
        btnDelete.style.background = 'none';
        btnDelete.style.border = 'none';
        btnDelete.style.fontSize = '11px';
        btnDelete.style.cursor = 'pointer';
        btnDelete.style.color = '#ef4444';
        btnDelete.style.padding = '2px';
        btnDelete.title = 'Eliminar contacto';

        btnDelete.addEventListener('click', () => {
            card.remove();
            actualizarHiddenEmail();
        });

        // Fila 1: Nombre y Cargo
        const row1 = document.createElement('div');
        row1.style.display = 'flex';
        row1.style.gap = '6px';
        row1.style.marginRight = '20px';

        const inputName = document.createElement('input');
        inputName.type = 'text';
        inputName.className = 'form-control email-contact-name';
        inputName.placeholder = 'Nombre (ej: Cecilia)';
        inputName.style.flex = '1';
        inputName.style.fontSize = '12px';
        inputName.style.height = '28px';
        inputName.style.padding = '4px 8px';
        inputName.value = contacto.nombre || '';
        inputName.addEventListener('input', actualizarHiddenEmail);

        const inputRole = document.createElement('input');
        inputRole.type = 'text';
        inputRole.className = 'form-control email-contact-role';
        inputRole.placeholder = 'Cargo (ej: Dueña)';
        inputRole.style.flex = '1';
        inputRole.style.fontSize = '12px';
        inputRole.style.height = '28px';
        inputRole.style.padding = '4px 8px';
        inputRole.value = contacto.cargo || '';
        inputRole.addEventListener('input', actualizarHiddenEmail);

        row1.appendChild(inputName);
        row1.appendChild(inputRole);

        // Fila 2: Correo
        const row2 = document.createElement('div');
        
        const inputEmail = document.createElement('input');
        inputEmail.type = 'email';
        inputEmail.className = 'form-control email-contact-address';
        inputEmail.placeholder = 'Correo electrónico (ej: belgiancitybell@gmail.com)';
        inputEmail.style.width = '100%';
        inputEmail.style.fontSize = '12px';
        inputEmail.style.height = '28px';
        inputEmail.style.padding = '4px 8px';
        inputEmail.style.transition = 'all 0.2s';
        inputEmail.value = contacto.email || '';

        validarEmailInput(inputEmail);

        inputEmail.addEventListener('input', () => {
            actualizarSugerenciasEmail(inputEmail);
            validarEmailInput(inputEmail);
            actualizarHiddenEmail();
        });

        row2.appendChild(inputEmail);

        card.appendChild(btnDelete);
        card.appendChild(row1);
        card.appendChild(row2);
        emailInputsContainer.appendChild(card);

        return inputName;
    }

    function renderEmailInputs(valueString) {
        emailInputsContainer.innerHTML = '';
        if (!valueString || !valueString.trim()) {
            crearFilaEmail({ email: '', nombre: '', cargo: '' });
            return;
        }

        const str = valueString.trim();
        if (str.startsWith('[')) {
            try {
                const contacts = JSON.parse(str);
                if (Array.isArray(contacts) && contacts.length > 0) {
                    contacts.forEach(c => {
                        crearFilaEmail(c);
                    });
                    return;
                }
            } catch (err) {
                console.error('Error parseando email JSON:', err);
            }
        }

        // Fallback para strings separados por comas tradicionales
        const emails = str.split(',').map(e => e.trim()).filter(e => e.length > 0);
        emails.forEach(email => {
            crearFilaEmail({ email: email, nombre: '', cargo: '' });
        });
    }

    function actualizarHiddenEmail() {
        const cards = Array.from(emailInputsContainer.querySelectorAll('.email-contact-card'));
        const contacts = cards.map(card => {
            const name = card.querySelector('.email-contact-name').value.trim();
            const role = card.querySelector('.email-contact-role').value.trim();
            const email = card.querySelector('.email-contact-address').value.trim();

            return {
                email: email,
                nombre: name,
                cargo: role
            };
        }).filter(c => c.email.length > 0);

        txtEmailFacturas.value = contacts.length > 0 ? JSON.stringify(contacts) : '';
    }

    if (btnAddEmail) {
        btnAddEmail.addEventListener('click', () => {
            const input = crearFilaEmail({ email: '', nombre: '', cargo: '' });
            input.focus();
        });
    }

    // --- 1. CARGA DE CLIENTES DESDE LA API ---
    async function cargarClientes(searchQuery = '') {
        try {
            const visibleCount = Object.values(columnasConfig).filter(c => c.visible).length + 2; // +2 por selección y col-acciones
            cuerpoTablaClientes.innerHTML = `
                <tr>
                    <td colspan="${visibleCount}" style="text-align: center; color: #94a3b8; padding: 20px;">
                        ⏳ Buscando clientes...
                    </td>
                </tr>
            `;

            let url = apiEndpoint;
            if (searchQuery) {
                url += `?search=${encodeURIComponent(searchQuery)}`;
            }

            const response = await fetch(url);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Error al obtener clientes.');
            }

            todosLosClientes = data.data;
            actualizarDeudaTotal(); // Actualizar widget de deuda consolidada
            ordenarYRenderizar();
        } catch (error) {
            console.error('❌ [CLIENTES-FRONT] Error al cargar clientes:', error);
            const visibleCount = Object.values(columnasConfig).filter(c => c.visible).length + 2;
            cuerpoTablaClientes.innerHTML = `
                <tr>
                    <td colspan="${visibleCount}" style="text-align: center; color: #dc2626; font-weight: bold; padding: 20px;">
                        ⚠️ Error al conectar con el servidor: ${error.message}
                    </td>
                </tr>
            `;
        }
    }

    // --- 2. RENDERIZACIÓN DE LA GRILLA ---
    function renderizarClientes(clientes) {
        if (!clientes || clientes.length === 0) {
            const visibleCount = Object.values(columnasConfig).filter(c => c.visible).length + 2;
            cuerpoTablaClientes.innerHTML = `
                <tr>
                    <td colspan="${visibleCount}">
                        <div class="empty-state">
                            📭 No se encontraron clientes registrados.
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        cuerpoTablaClientes.innerHTML = '';
        clientes.forEach(cliente => {
            const tr = document.createElement('tr');
            
            // Sanitización del ID externo para visualización
            const extId = cliente.lomas_soft_id;
            const badgeExterno = extId 
                ? `<span class="badge badge-purple" title="ID Sincronizado Lomas Soft">🔗 ${extId}</span>`
                : `<span class="badge badge-gray" title="Cliente Local Búnker">Local</span>`;

            // Procesar listas asignadas
            const listas = cliente.listas_precios || [];
            let htmlListas = '';
            if (listas.length > 0) {
                htmlListas = listas.map(l => `<span class="badge badge-purple" style="margin-right: 4px; margin-bottom: 4px;" title="${l.nombre}">${l.nombre}</span>`).join('');
            } else {
                htmlListas = `<span class="badge" style="background-color: #fef3c7; color: #d97706; border: 1px solid #fde68a;" title="Falta asociar lista del nuevo sistema">⚠️ Sin Lista Bunker</span>`;
            }

            // Calcular y formatear saldo
            const saldoNum = parseFloat(cliente.saldo || 0);
            let colorSaldo = '#64748b'; // neutral (cero)
            if (saldoNum > 0) {
                colorSaldo = '#dc2626'; // rojo (debe / deudor)
            } else if (saldoNum < 0) {
                colorSaldo = '#16a34a'; // verde (a favor / acreedor)
            }
            
            const saldoFormateado = '$ ' + Math.abs(saldoNum).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            let badgeSaldo = `<span style="font-weight: 600; color: ${colorSaldo};">${saldoFormateado}</span>`;
            if (saldoNum > 0) {
                badgeSaldo += `<br><small style="color: #ef4444; font-size: 0.75em; font-weight: 600;">Deudor</small>`;
            } else if (saldoNum < 0) {
                badgeSaldo += `<br><small style="color: #10b981; font-size: 0.75em; font-weight: 600;">A favor</small>`;
            }

            // Procesar contactos para la columna de selección
            const contactosWp = obtenerContactosDeCliente(cliente);
            const contactosEmail = obtenerEmailsDeCliente(cliente);
            const numWp = contactosWp.length;
            const numEmail = contactosEmail.length;
            const tieneContactos = numWp > 0 || numEmail > 0;
            const totalConts = numWp + numEmail;
            
            const tieneDeuda = saldoNum > 0;
            const isChecked = clientesSeleccionadosIds.has(cliente.id) ? 'checked' : '';
            
            let cellSeleccion = '';
            if (!tieneContactos) {
                cellSeleccion = `
                    <div style="display: inline-flex; align-items: center; gap: 4px; justify-content: center; vertical-align: middle;">
                        <input type="checkbox" class="chk-cliente" disabled title="Debe configurar al menos un contacto (WhatsApp o Correo) en la ficha del cliente" style="width: 18px; height: 18px; opacity: 0.4; cursor: not-allowed; margin: 0; vertical-align: middle;">
                        <span style="font-size: 0.9em; cursor: help; vertical-align: middle;" title="Sin contactos. Edite el cliente.">⚠️</span>
                    </div>
                `;
            } else if (!tieneDeuda) {
                cellSeleccion = `
                    <div style="display: inline-flex; align-items: center; gap: 4px; justify-content: center; vertical-align: middle;">
                        <input type="checkbox" class="chk-cliente" disabled title="Sin deuda activa" style="width: 18px; height: 18px; opacity: 0.4; cursor: not-allowed; margin: 0; vertical-align: middle;">
                    </div>
                `;
            } else if (totalConts === 1) {
                cellSeleccion = `
                    <div style="display: inline-flex; align-items: center; gap: 4px; justify-content: center; vertical-align: middle;">
                        <input type="checkbox" class="chk-cliente" data-id="${cliente.id}" data-codigo="${cliente.codigo_bunker_cliente}" ${isChecked} style="width: 18px; height: 18px; accent-color: var(--purple-primary); cursor: pointer; margin: 0; vertical-align: middle;">
                    </div>
                `;
            } else {
                // Múltiples contactos: requiere indicador
                cellSeleccion = `
                    <div style="display: inline-flex; align-items: center; gap: 6px; justify-content: center; vertical-align: middle;">
                        <input type="checkbox" class="chk-cliente" data-id="${cliente.id}" data-codigo="${cliente.codigo_bunker_cliente}" ${isChecked} style="width: 18px; height: 18px; accent-color: var(--purple-primary); cursor: pointer; margin: 0; vertical-align: middle;">
                        <button type="button" class="btn-config-contactos-cliente" data-id="${cliente.id}" data-nombre="${cliente.cliente_nombre}" style="background: none; border: none; cursor: pointer; padding: 2px; font-size: 1.1em; display: inline-flex; align-items: center; justify-content: center; line-height: 1; vertical-align: middle;" title="Configurar destinatarios específicos (posee ${totalConts} contactos)">👥</button>
                    </div>
                `;
            }

            const wpAttr = encodeURIComponent(JSON.stringify(contactosWp));
            const mailAttr = encodeURIComponent(JSON.stringify(contactosEmail));

            // Distintivo visual para clientes con Portal B2B Activo
            const tieneB2B = cliente.email_portal && cliente.email_portal.trim() !== '';
            const htmlNombre = tieneB2B 
                ? `<div style="display: flex; flex-direction: column; gap: 2px;">
                     <span style="font-weight: 700; color: #1e1b4b;">${cliente.cliente_nombre}</span>
                     <span class="badge" style="background-color: #e0e7ff; color: #4338ca; border: 1px solid #c7d2fe; align-self: flex-start; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px;" title="Acceso al Portal B2B Habilitado (${cliente.email_portal})">🌐 Portal Activo</span>
                   </div>`
                : `<span style="font-weight: 600; color: #334155;">${cliente.cliente_nombre}</span>`;

            tr.innerHTML = `
                <td style="text-align: center; vertical-align: middle;">${cellSeleccion}</td>
                <td class="col-codigo" style="font-weight: 700; color: #475569;">${cliente.codigo_bunker_cliente}</td>
                <td class="col-nombre" style="vertical-align: middle;">${htmlNombre}</td>
                <td class="col-razon" style="color: #64748b; vertical-align: middle;">${cliente.razon_social}</td>
                <td class="col-externo" style="vertical-align: middle;">${badgeExterno}</td>
                <td class="col-saldo" style="text-align: right; white-space: nowrap;">${badgeSaldo}</td>
                <td class="col-listas">${htmlListas}</td>
                <td class="col-acciones" style="text-align: center;">
                    <div style="display: flex; gap: 6px; justify-content: center;">
                        <button class="btn-action btn-cc" data-codigo="${cliente.codigo_bunker_cliente}" title="Ver cuenta corriente">💳</button>
                        <button class="btn-action btn-invite" data-codigo="${cliente.codigo_bunker_cliente}" data-nombre="${cliente.cliente_nombre}" data-whatsapp="${wpAttr}" data-emails="${mailAttr}" title="Invitar al Portal B2B (WhatsApp/Email)">✉️</button>
                        <button class="btn-action btn-impersonate" data-codigo="${cliente.codigo_bunker_cliente}" data-nombre="${cliente.cliente_nombre}" title="Acceder como Cliente (Espejo B2B)">🔑</button>
                        <button class="btn-action btn-assign" data-id="${cliente.id}" title="Asociar Listas de Precios Bunker">🏷️</button>
                        <button class="btn-action btn-edit" data-id="${cliente.id}" title="Editar ficha de cliente">✏️</button>
                        <button class="btn-action btn-delete" data-id="${cliente.id}" title="Eliminar cliente permanentemente">🗑️</button>
                    </div>
                </td>
            `;
            cuerpoTablaClientes.appendChild(tr);
        });

        // Sincronizar el checkbox general 'seleccionar todos'
        actualizarEstadoChkTodos();

        // Registrar eventos para los botones de la grilla
        registrarEventosGrilla();
    }

    // Registrar escuchas dinámicos de los botones EDITAR / ELIMINAR / CUENTA CORRIENTE / ASOCIAR LISTAS
    function registrarEventosGrilla() {
        // Evento Invitar al Portal B2B
        cuerpoTablaClientes.querySelectorAll('.btn-invite').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const codigo = btn.getAttribute('data-codigo');
                const nombre = btn.getAttribute('data-nombre');
                
                let wpContacts = [];
                let emailContacts = [];
                try {
                    wpContacts = JSON.parse(decodeURIComponent(btn.getAttribute('data-whatsapp') || '[]'));
                    emailContacts = JSON.parse(decodeURIComponent(btn.getAttribute('data-emails') || '[]'));
                } catch (err) {
                    console.error('Error parseando contactos en invitacion:', err);
                }

                if (wpContacts.length === 0 && emailContacts.length === 0) {
                    Swal.fire({
                        title: 'Sin Contactos',
                        text: 'El cliente no posee contactos de WhatsApp o Email configurados en su ficha. Por favor, edítela primero.',
                        icon: 'warning',
                        confirmButtonColor: 'var(--purple-primary)'
                    });
                    return;
                }

                const hasWp = wpContacts.length > 0;
                const hasEmail = emailContacts.length > 0;
                
                const defaultCanal = hasWp ? 'whatsapp' : 'email';

                const selectorHtml = `
                    <div style="text-align: left; font-family: 'Outfit', sans-serif; font-size: 15px; color: #334155;">
                        <p style="margin: 0 0 10px 0; font-weight: 600; color: #475569;">1. Seleccione el Canal de Envío:</p>
                        <div style="display: flex; gap: 20px; margin-bottom: 15px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; font-weight: 500;">
                                <input type="radio" name="canal-invite" value="whatsapp" ${defaultCanal === 'whatsapp' ? 'checked' : ''} ${!hasWp ? 'disabled' : ''} style="accent-color: var(--purple-primary); width: 16px; height: 16px;">
                                <span style="${!hasWp ? 'opacity: 0.5;' : ''}">📱 WhatsApp</span>
                            </label>
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; font-weight: 500;">
                                <input type="radio" name="canal-invite" value="email" ${defaultCanal === 'email' ? 'checked' : ''} ${!hasEmail ? 'disabled' : ''} style="accent-color: var(--purple-primary); width: 16px; height: 16px;">
                                <span style="${!hasEmail ? 'opacity: 0.5;' : ''}">✉️ Email / Correo</span>
                            </label>
                        </div>
                        
                        <p style="margin: 0 0 8px 0; font-weight: 600; color: #475569;">2. Seleccione el Destinatario:</p>
                        <select id="select-destinatario-invite" class="swal2-select" style="width: 100%; margin: 0 0 15px 0; box-sizing: border-box; display: block; height: 38px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; color: #1e293b; background: #ffffff; padding: 0 8px;"></select>
                        
                        <p style="margin: 0 0 8px 0; font-weight: 600; color: #475569;">3. Vista Previa del Mensaje:</p>
                        <div class="phone-simulator" style="width: 100%; background-color: #0c0d14; border: 10px solid #1e293b; border-radius: 20px; box-sizing: border-box; padding: 12px; margin-bottom: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
                            <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-bottom: 8px; padding: 0 4px; font-family: monospace;">
                                <span>LAMDA Mobile</span>
                                <span>12:00</span>
                            </div>
                            <div id="phone-chat-header" style="background-color: #1e1b29; padding: 8px; border-radius: 8px; color: #f1f5f9; display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                                <div style="width: 28px; height: 28px; background-color: #8e4785; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; color: #fff;">L</div>
                                <div>
                                    <div style="font-weight: 600; font-size: 12px; line-height: 1.2;">Portal LAMDA</div>
                                    <div style="font-size: 9px; color: #10b981; line-height: 1;">En línea</div>
                                </div>
                            </div>
                            <div style="background-color: #161422; border-radius: 12px; padding: 12px; min-height: 100px; display: flex; flex-direction: column; justify-content: flex-end;">
                                <div id="chat-bubble-preview" style="background-color: #2b2545; color: #f1f5f9; border-radius: 12px 12px 0 12px; padding: 10px; font-size: 13px; line-height: 1.45; word-break: break-all; white-space: pre-wrap; align-self: flex-end; max-width: 95%;">
                                    Cargando...
                                </div>
                            </div>
                        </div>

                        <p style="margin: 0 0 8px 0; font-weight: 600; color: #475569;">4. Editar Cuerpo del Mensaje:</p>
                        <textarea id="textarea-message-invite" class="swal2-textarea" style="width: 100%; height: 90px; margin: 0; box-sizing: border-box; font-family: sans-serif; font-size: 13px; line-height: 1.4; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; resize: none;"></textarea>
                        <small style="color: #64748b; font-size: 11px; margin-top: 4px; display: block;">* Los marcadores <strong>[Codigo_Activacion]</strong> y <strong>[Enlace_Al_Portal]</strong> se reemplazarán dinámicamente al enviar.</small>
                    </div>
                `;
 
                 const result = await Swal.fire({
                     title: `<span style="color: var(--purple-primary); font-weight: 700; font-family: 'Outfit'; font-size: 1.35rem;">Invitar al Portal B2B</span>`,
                     html: selectorHtml,
                     showCancelButton: true,
                     confirmButtonColor: 'var(--purple-primary)',
                     cancelButtonColor: '#64748b',
                     confirmButtonText: '🚀 Enviar Invitación',
                     cancelButtonText: 'Cancelar',
                     didOpen: () => {
                         const selectEl = document.getElementById('select-destinatario-invite');
                         const radios = document.getElementsByName('canal-invite');
                         const textareaEl = document.getElementById('textarea-message-invite');
                         const previewEl = document.getElementById('chat-bubble-preview');
                         
                         const getContactName = () => {
                             const selectedOption = selectEl.options[selectEl.selectedIndex];
                             if (!selectedOption) return nombre;
                             const text = selectedOption.text;
                             const match = text.match(/\(([^)]+)\)/);
                             if (match) {
                                 const parts = match[1].split(' - ');
                                 return parts[0].trim();
                             }
                             return nombre;
                         };

                         const updateBubblePreview = () => {
                             let text = textareaEl.value;
                             text = text.replace(/\[Codigo_Activacion\]/g, '31f315');
                             text = text.replace(/\[Enlace_Al_Portal\]/g, 'https://proud-darkness-ac3d.miserrano75.workers.dev/#/onboarding?token=31f315...');
                             previewEl.textContent = text;
                         };

                         const updateTextAndPreview = () => {
                             const contactName = getContactName();
                             textareaEl.value = `Hola ${contactName}, te paso el link del portal para que te loguees. Tu código de activación es: [Codigo_Activacion]. Entrá acá: [Enlace_Al_Portal]`;
                             updateBubblePreview();
                         };
                         
                         const updateSelect = (canal) => {
                             selectEl.innerHTML = '';
                             if (canal === 'whatsapp') {
                                 wpContacts.forEach(c => {
                                     const opt = document.createElement('option');
                                     opt.value = c.numero;
                                     opt.text = `[WhatsApp] ${c.numero} ${c.nombre ? `(${c.nombre} - ${c.cargo || 'Contacto'})` : ''}`;
                                     selectEl.appendChild(opt);
                                 });
                             } else {
                                 emailContacts.forEach(e => {
                                     const opt = document.createElement('option');
                                     opt.value = e.email;
                                     opt.text = `[Email] ${e.email} ${e.nombre ? `(${e.nombre} - ${e.cargo || 'Contacto'})` : ''}`;
                                     selectEl.appendChild(opt);
                                 });
                             }
                             updateTextAndPreview();
                         };
 
                         // Initial populating
                         updateSelect(defaultCanal);
 
                         // Event listeners for radio switch
                         radios.forEach(radio => {
                             radio.addEventListener('change', (e) => {
                                 updateSelect(e.target.value);
                             });
                         });

                         // Event listener for dropdown switch
                         selectEl.addEventListener('change', () => {
                             updateTextAndPreview();
                         });

                         // Event listener for textarea editing
                         textareaEl.addEventListener('input', () => {
                             updateBubblePreview();
                         });
                     },
                     preConfirm: () => {
                         const checkedRadio = document.querySelector('input[name="canal-invite"]:checked');
                         if (!checkedRadio) {
                             Swal.showValidationMessage('Debe seleccionar un canal de envío');
                             return false;
                         }
                         const canal = checkedRadio.value;
                         const destino = document.getElementById('select-destinatario-invite').value;
                         const mensajeTexto = document.getElementById('textarea-message-invite').value;
                         if (!destino) {
                             Swal.showValidationMessage('Debe seleccionar un destinatario válido');
                             return false;
                         }
                         if (!mensajeTexto.trim()) {
                             Swal.showValidationMessage('El cuerpo del mensaje no puede estar vacío');
                             return false;
                         }
                         return { canal, destino, mensajeTexto };
                     }
                 });
 
                 if (!result.isConfirmed) return;
 
                 Swal.fire({
                     title: 'Enviando Invitación...',
                     html: 'Procesando el envío en segundo plano...',
                     allowOutsideClick: false,
                     didOpen: () => {
                         Swal.showLoading();
                     }
                 });
 
                 try {
                     const response = await fetch('/api/logistica/b2b-onboarding/invitar', {
                         method: 'POST',
                         headers: {
                             'Content-Type': 'application/json'
                         },
                         body: JSON.stringify({ 
                             cliente_id: codigo,
                             canal: result.value.canal,
                             destino: result.value.destino,
                             mensajeTexto: result.value.mensajeTexto
                         })
                     });

                    const resData = await response.json();
                    if (!response.ok || !resData.success) {
                        throw new Error(resData.message || 'Error al enviar la invitación.');
                    }

                    Swal.fire({
                        title: '¡Invitación Enviada!',
                        text: `La invitación al portal B2B para ${nombre} ha sido enviada con éxito por ${result.value.canal === 'email' ? 'Email' : 'WhatsApp'} a ${result.value.destino}.`,
                        icon: 'success',
                        confirmButtonColor: 'var(--purple-primary)'
                    });

                } catch (err) {
                    console.error('Error enviando invitacion:', err);
                    Swal.fire({
                        title: 'Error de Envío',
                        text: err.message || 'Ocurrió un error inesperado al procesar la invitación.',
                        icon: 'error',
                        confirmButtonColor: '#ef4444'
                    });
                }
            });
        });

        // Evento Cuenta Corriente
        cuerpoTablaClientes.querySelectorAll('.btn-cc').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const codigo = btn.getAttribute('data-codigo');
                window.location.href = `cuenta-corriente.html?cliente=${encodeURIComponent(codigo)}`;
            });
        });

        // Evento Acceso Espejo (Llave Maestra B2B)
        cuerpoTablaClientes.querySelectorAll('.btn-impersonate').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const codigo = btn.getAttribute('data-codigo');
                const nombre = btn.getAttribute('data-nombre');

                Swal.fire({
                    title: 'Generando Acceso Espejo',
                    html: `Conectando de forma segura con el perfil de <b>${nombre}</b>...`,
                    allowOutsideClick: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });

                try {
                    const res = await fetch(`/api/logistica/b2b-onboarding/acceso-maestro/${encodeURIComponent(codigo)}`);
                    const data = await res.json();

                    if (!res.ok || !data.success) {
                        throw new Error(data.message || 'Error al solicitar el enlace de acceso espejo.');
                    }

                    Swal.close();
                    
                    // Abrir en nueva pestaña
                    window.open(data.redirectUrl, '_blank');

                } catch (err) {
                    console.error('Error al generar enlace espejo:', err);
                    Swal.fire({
                        title: 'Error de Acceso',
                        text: err.message || 'No se pudo generar el enlace espejo. Asegúrese de que el cliente esté registrado y activo en el Portal B2B.',
                        icon: 'error',
                        confirmButtonColor: '#ef4444'
                    });
                }
            });
        });

        // Evento Asociar Listas Bunker
        cuerpoTablaClientes.querySelectorAll('.btn-assign').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = btn.getAttribute('data-id');
                abrirModalListasPrecios(id);
            });
        });

        // Evento Editar
        cuerpoTablaClientes.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = btn.getAttribute('data-id');
                abrirFichaParaEditar(id);
            });
        });

        // Evento Eliminar
        cuerpoTablaClientes.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = btn.getAttribute('data-id');
                confirmarEliminacion(id);
            });
        });
    }


    // --- 3. BÚSQUEDA REACTIVA EN CALIENTE ---
    let debounceTimer;
    buscadorInput.addEventListener('keyup', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            cargarClientes(buscadorInput.value.trim());
        }, 300); // 300ms de retraso para evitar ráfagas de queries al backend
    });

    // Filtro B2B dropdown listener
    const filtroB2BSelect = document.getElementById('filtro-portal-b2b');
    if (filtroB2BSelect) {
        filtroB2BSelect.addEventListener('change', () => {
            ordenarYRenderizar();
        });
    }

    // --- 4. CONTROL DE APERTURA/CIERRE DEL DRAWER ---
    function abrirDrawer(titulo) {
        drawerTitulo.innerHTML = titulo;
        drawerOverlay.style.display = 'block';
        setTimeout(() => {
            drawerOverlay.style.opacity = '1';
            drawerCliente.classList.add('open');
        }, 10);
    }

    function cerrarDrawer() {
        drawerCliente.classList.remove('open');
        drawerOverlay.style.opacity = '0';
        setTimeout(() => {
            drawerOverlay.style.display = 'none';
            // Pizarra limpia del formulario
            formCliente.reset();
            txtId.value = '';

            // Ocultar botones auxiliares del Autocomplete Lomas Soft
            const btnLimpiarLomas = document.getElementById('btn-limpiar-lomas');
            if (btnLimpiarLomas) btnLimpiarLomas.style.display = 'none';
            const lomasSugerencias = document.getElementById('lomas-sugerencias');
            if (lomasSugerencias) lomasSugerencias.style.display = 'none';

            // Limpiar estilos y estados del validador de CUIT
            if (txtCuit) {
                txtCuit.style.borderColor = '';
                txtCuit.style.boxShadow = '';
            }
            if (helperCuit) {
                helperCuit.textContent = 'Identificación tributaria de 11 dígitos.';
                helperCuit.style.color = '';
            }
            if (btnConsultarArca) {
                btnConsultarArca.disabled = true;
                btnConsultarArca.textContent = '⚡ Consultar ARCA';
            }
            btnGuardarCliente.disabled = false;
            btnGuardarCliente.style.opacity = '';
            btnGuardarCliente.style.cursor = '';
        }, 300);
    }

    // --- 4.5 VALIDADOR FISCAL EN CALIENTE (MÓDULO 11) ---
    /**
     * Validador oficial de CUIT/CUIL basado en ponderadores de Módulo 11 (Adaptación de Blueprint ARCA).
     * @param {string} cuit - CUIT a validar.
     * @returns {boolean} Verdadero si es válido, falso de lo contrario.
     */
    function validarCuit(cuit) {
        if (!cuit) return true; // Tolerancia a nulos/vacíos
        const raw = cuit.replace(/[^0-9]/g, '');
        if (raw.length === 0) return true; // Tolerancia a campos vacíos
        if (raw.length !== 11) return false;

        const cuitPre = raw.substring(0, 2);
        const cuitDig = parseInt(raw.substring(10, 11), 10);
        const validPrefixes = ['20', '23', '24', '27', '30', '33', '34'];
        if (!validPrefixes.includes(cuitPre)) return false;

        const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
        let sum = 0;
        for (let i = 0; i < 10; i++) {
            sum += parseInt(raw[i], 10) * weights[i];
        }
        
        let calculated = 11 - (sum % 11);
        if (calculated === 11) calculated = 0;
        if (calculated === 10) return false;
        
        return calculated === cuitDig;
    }

    /**
     * Valida visualmente en caliente el CUIT/CUIL pintando el borde y controlando el botón Guardar.
     */
    function validarYMostrarCuit() {
        const cuit = txtCuit.value;
        const isValid = validarCuit(cuit);
        
        if (cuit.trim() === '') {
            txtCuit.style.borderColor = '';
            txtCuit.style.boxShadow = '';
            helperCuit.textContent = 'Identificación tributaria de 11 dígitos.';
            helperCuit.style.color = '';
            btnGuardarCliente.disabled = false;
            btnGuardarCliente.style.opacity = '';
            btnGuardarCliente.style.cursor = '';
            if (btnConsultarArca) btnConsultarArca.disabled = true;
            return true;
        }
        
        if (!isValid) {
            txtCuit.style.borderColor = '#ef4444';
            txtCuit.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.15)';
            helperCuit.textContent = '❌ CUIT/CUIL inválido según algoritmo oficial (Módulo 11).';
            helperCuit.style.color = '#ef4444';
            btnGuardarCliente.disabled = true;
            btnGuardarCliente.style.opacity = '0.5';
            btnGuardarCliente.style.cursor = 'not-allowed';
            if (btnConsultarArca) btnConsultarArca.disabled = true;
            return false;
        } else {
            txtCuit.style.borderColor = '#10b981';
            txtCuit.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.15)';
            helperCuit.textContent = '✅ CUIT/CUIL válido.';
            helperCuit.style.color = '#10b981';
            btnGuardarCliente.disabled = false;
            btnGuardarCliente.style.opacity = '';
            btnGuardarCliente.style.cursor = '';
            if (btnConsultarArca) btnConsultarArca.disabled = false;
            return true;
        }
    }

    // Escuchadores de eventos para validación en vivo del CUIT
    txtCuit.addEventListener('input', validarYMostrarCuit);
    txtCuit.addEventListener('blur', validarYMostrarCuit);

    // Evento para consultar ARCA (Fase 2)
    if (btnConsultarArca) {
        btnConsultarArca.addEventListener('click', async () => {
            const cuit = txtCuit.value.trim().replace(/[^0-9]/g, '');
            if (!cuit || !validarCuit(cuit)) return;

            try {
                // Estado de carga en el botón
                btnConsultarArca.disabled = true;
                btnConsultarArca.textContent = 'Consultando...';
                
                // Deshabilitar temporalmente campos para evitar ediciones concurrentes
                txtNombre.disabled = true;
                txtRazon.disabled = true;
                selCondicionIva.disabled = true;
                txtDomicilioFiscal.disabled = true;
                txtProvincia.disabled = true;

                console.log(`🔌 [ARCA-FRONT] Consultando datos para CUIT: ${cuit}`);
                const response = await fetch('/api/logistica/bunker/clientes/consultar-arca', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ cuit_cuil: cuit })
                });

                const result = await response.json();

                if (!result.success) {
                    throw new Error(result.error || 'Ocurrió un error al consultar en ARCA.');
                }

                const datos = result.data;
                console.log('🔌 [ARCA-FRONT] Datos fiscales recuperados:', datos);

                // Rellenar campos del Drawer
                txtRazon.value = datos.razon_social || '';
                
                // Si el Nombre Comercial está vacío, sugerir la razón social
                if (!txtNombre.value.trim()) {
                    txtNombre.value = datos.razon_social || '';
                }

                if (datos.condicion_iva) {
                    selCondicionIva.value = datos.condicion_iva;
                }

                if (datos.domicilio_fiscal) {
                    txtDomicilioFiscal.value = datos.domicilio_fiscal;
                }

                if (datos.provincia) {
                    txtProvincia.value = datos.provincia;
                }

                if (txtEstadoClave) {
                    txtEstadoClave.value = datos.estado_clave || 'ACTIVO';
                }

                if (txtCategoriaMonotributo) {
                    txtCategoriaMonotributo.value = datos.categoria_monotributo || 'N/A';
                }

                if (txtActividadPrincipal) {
                    txtActividadPrincipal.value = datos.actividad_principal || 'N/A';
                }

                Swal.fire({
                    icon: 'success',
                    title: 'Datos Recuperados',
                    text: 'Se han autocompletado los datos fiscales correctamente.',
                    timer: 2000,
                    showConfirmButton: false
                });

            } catch (error) {
                console.error('❌ [ARCA-FRONT] Error al consultar ARCA:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error de Consulta',
                    text: error.message || 'No se pudo obtener información del CUIT especificado.',
                    confirmButtonColor: '#6b21a8'
                });
            } finally {
                // Restablecer botón y campos habilitados
                btnConsultarArca.disabled = false;
                btnConsultarArca.textContent = '⚡ Consultar ARCA';
                
                txtNombre.disabled = false;
                txtRazon.disabled = false;
                selCondicionIva.disabled = false;
                txtDomicilioFiscal.disabled = false;
                txtProvincia.disabled = false;
                
                validarYMostrarCuit();
            }
        });
    }

    // Eventos de Cierre
    btnCerrarDrawer.addEventListener('click', cerrarDrawer);
    btnCancelarDrawer.addEventListener('click', cerrarDrawer);
    drawerOverlay.addEventListener('click', cerrarDrawer);

    // Abrir para Nuevo Cliente
    btnNuevoCliente.addEventListener('click', () => {
        // Enforce Pizarra Limpia
        txtId.value = '';
        formCliente.reset();
        renderWhatsappInputs('');
        renderEmailInputs('');
        if (selCanalPreferido) selCanalPreferido.value = 'whatsapp';

        const btnLimpiarLomas = document.getElementById('btn-limpiar-lomas');
        if (btnLimpiarLomas) btnLimpiarLomas.style.display = 'none';
        const lomasSugerencias = document.getElementById('lomas-sugerencias');
        if (lomasSugerencias) lomasSugerencias.style.display = 'none';

        // Autogeneración de Código Legacy Único para altas nativas
        fetch('/api/logistica/bunker/clientes/sugerir-legacy')
            .then(res => res.json())
            .then(data => {
                if (data.success && !txtId.value) { // Solo si seguimos en modo alta nueva
                    txtLomasId.value = data.codigoSugerido;
                    console.log(`💡 [CLIENTES-FRONT] Código legacy autogenerado sugerido: ${data.codigoSugerido}`);
                }
            })
            .catch(err => {
                console.error('⚠️ [CLIENTES-FRONT] Error al sugerir código legacy:', err);
            });

        // Limpiar validaciones fiscales
        if (txtCuit) {
            txtCuit.style.borderColor = '';
            txtCuit.style.boxShadow = '';
        }
        if (helperCuit) {
            helperCuit.textContent = 'Identificación tributaria de 11 dígitos.';
            helperCuit.style.color = '';
        }
        if (btnConsultarArca) {
            btnConsultarArca.disabled = true;
            btnConsultarArca.textContent = '⚡ Consultar ARCA';
        }
        btnGuardarCliente.disabled = false;
        btnGuardarCliente.style.opacity = '';
        btnGuardarCliente.style.cursor = '';

        abrirDrawer('➕ Registrar Nuevo Cliente');
    });

    // --- 5. ABRIR FICHA DE CLIENTE PARA EDICIÓN ---
    function abrirFichaParaEditar(id) {
        const cliente = todosLosClientes.find(c => c.id == id);
        if (!cliente) return;

        // Cargar inputs
        txtId.value = cliente.id;
        txtCodigo.value = cliente.codigo_bunker_cliente;
        txtNombre.value = cliente.cliente_nombre;
        txtRazon.value = cliente.razon_social;
        txtLomasId.value = cliente.lomas_soft_id || '';
        
        // Cargar inputs fiscales (Fase 1 y 3 Fiscal)
        txtCuit.value = cliente.cuit_cuil || '';
        selCondicionIva.value = cliente.condicion_iva || '';
        txtDomicilioFiscal.value = cliente.domicilio_fiscal || '';
        txtProvincia.value = cliente.provincia || '';
        txtWhatsappFacturas.value = cliente.whatsapp_facturas || '';
        renderWhatsappInputs(cliente.whatsapp_facturas || '');
        if (txtEmailFacturas) {
            txtEmailFacturas.value = cliente.email_facturas || '';
            renderEmailInputs(cliente.email_facturas || '');
        }
        if (selCanalPreferido) selCanalPreferido.value = cliente.canal_envio_preferido || 'whatsapp';
        if (txtEstadoClave) txtEstadoClave.value = cliente.estado_clave || '';
        if (txtCategoriaMonotributo) txtCategoriaMonotributo.value = cliente.categoria_monotributo || '';
        if (txtActividadPrincipal) txtActividadPrincipal.value = cliente.actividad_principal || '';
        
        // Cargar inputs del Portal B2B
        if (txtEmailPortal) txtEmailPortal.value = cliente.email_portal || '';
        if (txtEmailPortalNombre) txtEmailPortalNombre.value = cliente.email_portal_nombre || '';
        if (txtEmailPortalCargo) txtEmailPortalCargo.value = cliente.email_portal_cargo || '';


        // Sincronizar el botón de limpieza del autocomplete
        const btnLimpiarLomas = document.getElementById('btn-limpiar-lomas');
        if (btnLimpiarLomas) {
            btnLimpiarLomas.style.display = cliente.lomas_soft_id ? 'inline-block' : 'none';
        }

        // Evaluar la validación fiscal en base a lo cargado
        validarYMostrarCuit();

        abrirDrawer('✏️ Editar Ficha de Cliente');
    }

    // --- 6. GUARDAR CLIENTE (ALTA / MODIFICACIÓN) ---
    btnGuardarCliente.addEventListener('click', async (e) => {
        e.preventDefault();

        // Validaciones manuales básicas
        const id = txtId.value;
        const codigo = txtCodigo.value.trim();
        const nombre = txtNombre.value.trim();
        const razon = txtRazon.value.trim();
        const lomasId = txtLomasId.value.trim();
        const cuit = txtCuit.value.trim();
        const condicionIva = selCondicionIva.value;
        const domicilioFiscal = txtDomicilioFiscal.value.trim();
        const provincia = txtProvincia.value.trim();
        const whatsappFacturas = txtWhatsappFacturas.value.trim();
        const emailFacturas = txtEmailFacturas ? txtEmailFacturas.value.trim() : '';
        const canalPreferido = selCanalPreferido ? selCanalPreferido.value : 'whatsapp';
        const estadoClave = txtEstadoClave ? txtEstadoClave.value.trim() : null;
        const categoriaMonotributo = txtCategoriaMonotributo ? txtCategoriaMonotributo.value.trim() : null;
        const actividadPrincipal = txtActividadPrincipal ? txtActividadPrincipal.value.trim() : null;
        
        // B2B Portal Access fields
        const emailPortal = txtEmailPortal ? txtEmailPortal.value.trim() : '';
        const emailPortalNombre = txtEmailPortalNombre ? txtEmailPortalNombre.value.trim() : '';
        const emailPortalCargo = txtEmailPortalCargo ? txtEmailPortalCargo.value.trim() : '';

        // ARQUITECTURA LAMDA: El Código Búnker es autogenerado por el backend durante la creación,
        // por lo tanto, solo es obligatorio verificar su presencia para flujos de edición/actualización.
        const esEdicion = !!id;
        if ((esEdicion && !codigo) || !nombre || !razon) {
            Swal.fire({
                icon: 'warning',
                title: 'Campos requeridos',
                text: 'Por favor complete todos los campos obligatorios (*).',
                confirmButtonColor: '#6b21a8'
            });
            return;
        }

        // Validar CUIT en caliente client-side antes de enviar
        if (cuit && !validarCuit(cuit)) {
            Swal.fire({
                icon: 'warning',
                title: 'CUIT/CUIL inválido',
                text: 'El CUIT/CUIL no es válido matemáticamente. Por favor corríjalo antes de guardar.',
                confirmButtonColor: '#6b21a8'
            });
            return;
        }

        // Si es creación, pasamos null para gatillar la autogeneración de secuencia CB-XXXX en el servidor
        const payload = {
            codigo_bunker_cliente: esEdicion ? codigo : null,
            cliente_nombre: nombre,
            razon_social: razon,
            lomas_soft_id: lomasId,
            cuit_cuil: cuit || null,
            condicion_iva: condicionIva || null,
            domicilio_fiscal: domicilioFiscal || null,
            provincia: provincia || null,
            whatsapp_facturas: whatsappFacturas || null,
            email_facturas: emailFacturas || null,
            canal_envio_preferido: canalPreferido || 'whatsapp',
            estado_clave: estadoClave || null,
            categoria_monotributo: categoriaMonotributo || null,
            actividad_principal: actividadPrincipal || null,
            email_portal: emailPortal || null,
            email_portal_nombre: emailPortalNombre || null,
            email_portal_cargo: emailPortalCargo || null
        };


        const url = esEdicion ? `${apiEndpoint}/${id}` : apiEndpoint;
        const metodo = esEdicion ? 'PUT' : 'POST';

        try {
            // Deshabilitar botón para evitar multi-submissions
            btnGuardarCliente.disabled = true;
            btnGuardarCliente.textContent = 'Guardando...';

            let response = await fetch(url, {
                method: metodo,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            let data = await response.json();

            if (!data.success) {
                // Si hay un conflicto de CUIT duplicado, mostramos advertencia y preguntamos confirmación excepcional
                if (response.status === 409 && data.code === 'CUIT_DUPLICADO') {
                    btnGuardarCliente.disabled = false;
                    btnGuardarCliente.textContent = 'Guardar Cliente';

                    const confirmacion = await Swal.fire({
                        title: '¿Confirmar excepción de CUIT?',
                        text: `El CUIT/CUIL "${cuit}" ya está registrado para el cliente "${data.clienteNombre}". ¿Desea guardarlo de todas formas como una excepción?`,
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonColor: '#6b21a8',
                        cancelButtonColor: '#ef4444',
                        confirmButtonText: 'Sí, guardar excepción',
                        cancelButtonText: 'Cancelar'
                    });

                    if (confirmacion.isConfirmed) {
                        btnGuardarCliente.disabled = true;
                        btnGuardarCliente.textContent = 'Guardando...';
                        
                        payload.confirmarCuitDuplicado = true;
                        response = await fetch(url, {
                            method: metodo,
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(payload)
                        });
                        data = await response.json();
                        if (!data.success) {
                            throw new Error(data.error || 'Ocurrió un error al persistir el cliente.');
                        }
                    } else {
                        return; // Cancela la acción, el drawer queda abierto
                    }
                } else {
                    throw new Error(data.error || 'Ocurrió un error al persistir el cliente.');
                }
            }

            // Notificación exitosa
            Swal.fire({
                icon: 'success',
                title: esEdicion ? 'Ficha actualizada' : 'Cliente registrado',
                text: data.message || 'La operación se completó exitosamente.',
                timer: 2000,
                showConfirmButton: false
            });

            cerrarDrawer();
            cargarClientes(buscadorInput.value.trim());

        } catch (error) {
            console.error('❌ [CLIENTES-FRONT] Error al guardar:', error);
            Swal.fire({
                icon: 'error',
                title: 'Fallo al guardar',
                text: error.message,
                confirmButtonColor: '#6b21a8'
            });
        } finally {
            btnGuardarCliente.disabled = false;
            btnGuardarCliente.textContent = 'Guardar Cliente';
        }
    });

    // --- 7. ELIMINAR CLIENTE CON CONFIRMACIÓN ---
    function confirmarEliminacion(id) {
        const cliente = todosLosClientes.find(c => c.id == id);
        if (!cliente) return;

        Swal.fire({
            title: '¿Confirmar eliminación?',
            text: `Se eliminará permanentemente al cliente "${cliente.cliente_nombre}". Esta acción no se puede deshacer.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    const response = await fetch(`${apiEndpoint}/${id}`, {
                        method: 'DELETE'
                    });
                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error || 'No se pudo eliminar al cliente.');
                    }

                    Swal.fire({
                        icon: 'success',
                        title: 'Cliente eliminado',
                        text: data.message || 'El registro ha sido removido del sistema.',
                        timer: 1500,
                        showConfirmButton: false
                    });

                    cargarClientes(buscadorInput.value.trim());
                } catch (error) {
                    console.error('❌ [CLIENTES-FRONT] Error al eliminar:', error);
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: error.message,
                        confirmButtonColor: '#6b21a8'
                    });
                }
            }
        });
    }

    // --- 8. CONFIGURACIÓN DEL AUTOCOMPLETE DE LOMAS SOFT ---
    function setupLomasSoftAutocomplete() {
        const lomasSugerencias = document.getElementById('lomas-sugerencias');
        const btnLimpiarLomas = document.getElementById('btn-limpiar-lomas');
        let selectedIndex = -1;
        let currentAbortController = null;

        if (!txtLomasId || !lomasSugerencias || !btnLimpiarLomas) {
            console.warn('⚠️ [CLIENTES-FRONT] Elementos del autocomplete de Lomas Soft no encontrados.');
            return;
        }

        // Evento input con debounce
        let debounceTimerLomas;
        txtLomasId.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            
            // Mostrar u ocultar el botón limpiar basado en si hay texto
            btnLimpiarLomas.style.display = e.target.value.length > 0 ? 'inline-block' : 'none';

            clearTimeout(debounceTimerLomas);
            selectedIndex = -1;

            if (currentAbortController) {
                currentAbortController.abort();
                currentAbortController = null;
            }

            if (query.length < 1) {
                lomasSugerencias.style.display = 'none';
                lomasSugerencias.innerHTML = '';
                return;
            }

            debounceTimerLomas = setTimeout(async () => {
                try {
                    // Mostrar estado cargando
                    lomasSugerencias.innerHTML = '<div class="sugerencia-loading">🔍 Buscando en Lomas Soft...</div>';
                    lomasSugerencias.style.display = 'block';

                    currentAbortController = new AbortController();
                    
                    // Consultar el padrón de Lomas Soft y los clientes de Búnker existentes en paralelo
                    const resPromise = fetch(`/api/logistica/tratamientos/clientes?q=${encodeURIComponent(query)}`, {
                        signal: currentAbortController.signal
                    });
                    const bunkerResPromise = fetch(`/api/logistica/bunker/clientes`, {
                        signal: currentAbortController.signal
                    });

                    const [res, bunkerRes] = await Promise.all([resPromise, bunkerResPromise]);

                    if (!res.ok || !bunkerRes.ok) throw new Error('Error al consultar datos.');

                    const json = await res.json();
                    const bunkerJson = await bunkerRes.json();
                    
                    const asociados = {};
                    if (bunkerJson.success && bunkerJson.data) {
                        bunkerJson.data.forEach(c => {
                            if (c.lomas_soft_id) {
                                asociados[c.lomas_soft_id.toString().padStart(4, '0')] = c;
                            }
                        });
                    }
                    
                    if (json.success && json.data && json.data.length > 0) {
                        renderSugerencias(json.data, asociados);
                    } else {
                        lomasSugerencias.innerHTML = '<div class="sugerencia-sin-resultados">📭 Sin coincidencias en Lomas Soft</div>';
                    }
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.error('❌ [CLIENTES-FRONT] Error al buscar clientes Lomas Soft:', err);
                    lomasSugerencias.innerHTML = '<div class="sugerencia-sin-resultados">⚠️ Error al buscar en padrón externo</div>';
                } finally {
                    currentAbortController = null;
                }
            }, 300);
        });
 
        // Renderizado del dropdown de sugerencias
        function renderSugerencias(sugerencias, asociados = {}) {
            const listados = sugerencias.slice(0, 10); // Limitar a 10 resultados
            const clienteActualId = txtId.value;
            
            lomasSugerencias.innerHTML = listados.map((cli) => {
                // Formatear ID con ceros a la izquierda
                const idFormateado = cli.id.toString().padStart(4, '0');
                const nombreCompleto = `${cli.apellido || ''}, ${cli.nombre || ''}`.replace(/^,\s*/, '').trim() || 'Sin nombre';

                // Verificar si ya está asociado
                const clienteAsociado = asociados[idFormateado];
                const yaAsociadoAOtros = clienteAsociado && clienteAsociado.id != clienteActualId;

                if (yaAsociadoAOtros) {
                    return `
                        <div class="sugerencia-item sugerencia-deshabilitada" 
                             data-id="${idFormateado}" 
                             data-nombre="${nombreCompleto}"
                             data-asociado-nombre="${clienteAsociado.cliente_nombre}"
                             style="opacity: 0.55; background-color: #f1f5f9; cursor: not-allowed; display: flex; justify-content: space-between; align-items: center;"
                             title="Ya asociado a ${clienteAsociado.cliente_nombre}">
                            <div>
                                <span class="sugerencia-id" style="color: #94a3b8; text-decoration: line-through; border-color: #cbd5e1; background-color: #e2e8f0;">${idFormateado}</span>
                                <span class="sugerencia-nombre" style="color: #94a3b8; text-decoration: line-through; font-style: italic;">${nombreCompleto}</span>
                            </div>
                            <span class="badge badge-gray" style="font-size: 10px; background-color: #f59e0b; color: white; padding: 2px 6px; border-radius: 4px; border: none;">Ya cargado (${clienteAsociado.cliente_nombre})</span>
                        </div>
                    `;
                }

                return `
                    <div class="sugerencia-item" 
                         data-id="${idFormateado}" 
                         data-nombre="${nombreCompleto}">
                        <span class="sugerencia-id">${idFormateado}</span>
                        <span class="sugerencia-nombre">${nombreCompleto}</span>
                    </div>
                `;
            }).join('');
 
            // Agregar clics sobre sugerencias
            lomasSugerencias.querySelectorAll('.sugerencia-item').forEach((item) => {
                item.addEventListener('click', (e) => {
                    if (item.classList.contains('sugerencia-deshabilitada')) {
                        e.stopPropagation();
                        seleccionarSugerencia(item);
                        return;
                    }
                    seleccionarSugerencia(item);
                });
            });
        }
 
        // Selección de sugerencia
        function seleccionarSugerencia(element) {
            if (element.classList.contains('sugerencia-deshabilitada')) {
                const asociadoNombre = element.getAttribute('data-asociado-nombre');
                const lomasIdStr = element.getAttribute('data-id');
                Swal.fire({
                    icon: 'warning',
                    title: 'ID externo ya asociado',
                    text: `El ID externo ${lomasIdStr} ya está asociado al cliente "${asociadoNombre}" en Búnker. No se permite asociar por duplicado.`,
                    confirmButtonColor: '#6b21a8'
                });
                return;
            }
            const id = element.getAttribute('data-id');
            txtLomasId.value = id;
            btnLimpiarLomas.style.display = 'inline-block';
            lomasSugerencias.style.display = 'none';
            lomasSugerencias.innerHTML = '';
            selectedIndex = -1;
            console.log(`🔗 [CLIENTES-FRONT] Cliente Lomas Soft seleccionado: ${id}`);
        }

        // Navegación con teclado
        txtLomasId.addEventListener('keydown', (e) => {
            const items = lomasSugerencias.querySelectorAll('.sugerencia-item');
            if (!items || items.length === 0 || lomasSugerencias.style.display === 'none') return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
                actualizarSeleccionVisual(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, -1);
                actualizarSeleccionVisual(items);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (selectedIndex >= 0 && items[selectedIndex]) {
                    seleccionarSugerencia(items[selectedIndex]);
                } else if (items.length > 0) {
                    seleccionarSugerencia(items[0]); // Auto-selecciona el primero
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                lomasSugerencias.style.display = 'none';
                txtLomasId.blur();
            }
        });

        // Actualizar visual de la selección por teclado
        function actualizarSeleccionVisual(items) {
            items.forEach((item, idx) => {
                item.classList.toggle('selected', idx === selectedIndex);
            });
            if (selectedIndex >= 0 && items[selectedIndex]) {
                items[selectedIndex].scrollIntoView({ block: 'nearest' });
            }
        }

        // Limpiar el campo con la cruz
        btnLimpiarLomas.addEventListener('click', () => {
            txtLomasId.value = '';
            btnLimpiarLomas.style.display = 'none';
            lomasSugerencias.style.display = 'none';
            lomasSugerencias.innerHTML = '';
            txtLomasId.focus();
        });

        // Ocultar al perder el foco
        txtLomasId.addEventListener('blur', () => {
            setTimeout(() => {
                if (!lomasSugerencias.matches(':hover')) {
                    lomasSugerencias.style.display = 'none';
                }
            }, 150);
        });

        // Cerrar al hacer clic fuera
        document.addEventListener('click', (e) => {
            if (!txtLomasId.contains(e.target) && !lomasSugerencias.contains(e.target)) {
                lomasSugerencias.style.display = 'none';
            }
        });
    }

    /**
     * Abrir modal interactivo de SweetAlert2 para asociar listas de precios Bunker a un cliente
     * @param {number|string} clienteId - ID del cliente
     */
    async function abrirModalListasPrecios(clienteId) {
        try {
            console.log(`🏷️ [CLIENTES-FRONT] Solicitando listas para vincular a cliente ID: ${clienteId}`);
            
            // 1. Buscar al cliente en la lista local para ver qué listas tiene pre-marcadas
            const cliente = todosLosClientes.find(c => String(c.id) === String(clienteId));
            if (!cliente) {
                Swal.fire({ title: 'Error', text: 'No se encontraron los datos del cliente.', icon: 'error' });
                return;
            }

            // Listas de precios asociadas actualmente al cliente (sus IDs)
            const listasAsociadasIds = (cliente.listas_precios || []).map(l => l.id);

            // 2. Cargar todas las listas de precios Bunker activas
            const resListas = await fetch('/api/logistica/bunker/listas');
            const dataListas = await resListas.json();

            if (!dataListas.success || !dataListas.data) {
                throw new Error(dataListas.error || 'No se pudieron recuperar las listas de precios Bunker.');
            }

            const todasLasListas = dataListas.data.filter(l => l.activa);

            if (todasLasListas.length === 0) {
                Swal.fire({
                    title: 'Sin listas registradas',
                    text: 'Actualmente no existen listas de precios activas registradas en el Búnker. Por favor, crea una lista primero.',
                    icon: 'warning',
                    confirmButtonColor: 'var(--purple-primary)'
                });
                return;
            }

            // 3. Renderizar HTML interactivo de checkboxes
            let htmlContent = `
                <div style="text-align: left; font-family: 'Inter', sans-serif;">
                    <p style="margin-bottom: 16px; font-size: 14px; color: #475569; line-height: 1.5;">
                        Selecciona una o más listas de precios del nuevo sistema <strong>Búnker</strong> para asociar al cliente <strong>${cliente.cliente_nombre}</strong>:
                    </p>
                    <div style="display: flex; flex-direction: column; gap: 10px; max-height: 250px; overflow-y: auto; padding: 4px;">
            `;

            todasLasListas.forEach(l => {
                const isChecked = listasAsociadasIds.includes(l.id) ? 'checked' : '';
                htmlContent += `
                    <label style="display: flex; align-items: flex-start; gap: 12px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; cursor: pointer; transition: background 0.2s, border-color 0.2s; margin-bottom: 0;"
                           onmouseover="this.style.background='#faf5ff'; this.style.borderColor='#d8b4fe';"
                           onmouseout="this.style.background='#f8fafc'; this.style.borderColor='#e2e8f0';">
                        <input type="checkbox" class="swal-lista-chk" value="${l.id}" ${isChecked} style="margin-top: 3px; cursor: pointer; width: 18px; height: 18px; accent-color: var(--purple-primary);">
                        <div style="flex: 1;">
                            <div style="font-size: 14px; font-weight: 600; color: #1e293b;">${l.nombre}</div>
                            ${l.descripcion ? `<div style="font-size: 12px; color: #64748b; margin-top: 2px;">${l.descripcion}</div>` : ''}
                        </div>
                    </label>
                `;
            });

            htmlContent += `
                    </div>
                </div>
            `;

            // 4. Mostrar SweetAlert2
            Swal.fire({
                title: 'Asociar Listas Bunker',
                html: htmlContent,
                icon: 'info',
                showCancelButton: true,
                confirmButtonText: '💾 Guardar Cambios',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: 'var(--purple-primary)',
                cancelButtonColor: '#64748b',
                width: '500px',
                preConfirm: () => {
                    const selectedIds = Array.from(document.querySelectorAll('.swal-lista-chk:checked')).map(el => parseInt(el.value, 10));
                    return selectedIds;
                }
            }).then(async (result) => {
                if (!result.isConfirmed) return;

                const listaIdsSeleccionados = result.value;

                // 5. Guardar asociación mediante PUT
                Swal.fire({
                    title: 'Guardando...',
                    allowOutsideClick: false,
                    didOpen: () => { Swal.showLoading(); }
                });

                try {
                    const resSave = await fetch(`${apiEndpoint}/${clienteId}/listas`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ listaIds: listaIdsSeleccionados })
                    });
                    const dataSave = await resSave.json();

                    if (dataSave.success) {
                        Swal.fire({
                            title: '¡Guardado!',
                            text: 'Asociación de listas de precios actualizada correctamente.',
                            icon: 'success',
                            confirmButtonColor: 'var(--purple-primary)'
                        });
                        cargarClientes(); // Recargar grilla
                    } else {
                        throw new Error(dataSave.error || 'No se pudo guardar la asociación.');
                    }
                } catch (error) {
                    console.error(error);
                    Swal.fire({
                        title: 'Error al asociar',
                        text: error.message,
                        icon: 'error',
                        confirmButtonColor: '#ef4444'
                    });
                }
            });

        } catch (err) {
            console.error('[CLIENTES-FRONT] Error al abrir modal de listas:', err);
            Swal.fire({
                title: 'Error',
                text: 'No se pudo procesar la asociación de listas de precios: ' + err.message,
                icon: 'error'
            });
        }
    }

    // --- LÓGICA DE SELECCIÓN Y ACCIONES MASIVAS ---

    // Delegación de eventos en cuerpoTablaClientes para checkboxes individuales y botones de contacto
    cuerpoTablaClientes.addEventListener('change', (e) => {
        if (e.target && e.target.classList.contains('chk-cliente')) {
            const chk = e.target;
            const id = Number(chk.getAttribute('data-id'));
            const checked = chk.checked;
            
            if (checked) {
                clientesSeleccionadosIds.add(id);
                
                const cliente = todosLosClientes.find(c => c.id === id);
                if (cliente) {
                    const contactosWp = obtenerContactosDeCliente(cliente);
                    const contactosEmail = obtenerEmailsDeCliente(cliente);
                    const totalConts = contactosWp.length + contactosEmail.length;
                    if (totalConts > 1) {
                        const preSeleccionados = obtenerContactosSeleccionados(id);
                        if (!preSeleccionados) {
                            abrirConfiguracionContactosBulk(id, cliente.cliente_nombre, true);
                        }
                    }
                }
            } else {
                clientesSeleccionadosIds.delete(id);
            }
            
            actualizarBarraAccionesLote();
            actualizarEstadoChkTodos();
        }
    });

    cuerpoTablaClientes.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-config-contactos-cliente');
        if (btn) {
            e.preventDefault();
            const id = Number(btn.getAttribute('data-id'));
            const nombre = btn.getAttribute('data-nombre');
            abrirConfiguracionContactosBulk(id, nombre, false);
        }
    });

    // Checkbox de seleccionar todos
    if (chkSeleccionarTodos) {
        chkSeleccionarTodos.addEventListener('change', () => {
            const checked = chkSeleccionarTodos.checked;
            const checkboxesVisibles = cuerpoTablaClientes.querySelectorAll('.chk-cliente:not(:disabled)');
            
            checkboxesVisibles.forEach(chk => {
                chk.checked = checked;
                const id = Number(chk.getAttribute('data-id'));
                if (checked) {
                    clientesSeleccionadosIds.add(id);
                    
                    const cliente = todosLosClientes.find(c => c.id === id);
                    if (cliente) {
                        const contactosWp = obtenerContactosDeCliente(cliente);
                        const contactosEmail = obtenerEmailsDeCliente(cliente);
                        const totalConts = contactosWp.length + contactosEmail.length;
                        if (totalConts > 1) {
                            let preSeleccionados = obtenerContactosSeleccionados(id);
                            if (!preSeleccionados) {
                                const rawWpStr = (cliente.whatsapp_facturas || '').trim();
                                const rawEmailStr = (cliente.email_facturas || '').trim();
                                let hasWpConfig = false;
                                let hasEmailConfig = false;
                                if (rawWpStr.startsWith('[')) {
                                    try {
                                        const parsed = JSON.parse(rawWpStr);
                                        hasWpConfig = Array.isArray(parsed) && parsed.some(c => c.default_factura !== undefined);
                                    } catch(e) {}
                                }
                                if (rawEmailStr.startsWith('[')) {
                                    try {
                                        const parsed = JSON.parse(rawEmailStr);
                                        hasEmailConfig = Array.isArray(parsed) && parsed.some(e => e.default_factura !== undefined);
                                    } catch(e) {}
                                }
                                const isConfigured = hasWpConfig || hasEmailConfig;

                                const defaultSel = {
                                    whatsapp: contactosWp.filter(c => c.default_factura).map(c => c.numero),
                                    email: contactosEmail.filter(e => e.default_factura).map(e => e.email)
                                };
                                if (!isConfigured && defaultSel.whatsapp.length === 0 && defaultSel.email.length === 0) {
                                    defaultSel.whatsapp = contactosWp.map(c => c.numero);
                                    defaultSel.email = contactosEmail.map(e => e.email);
                                }
                                guardarContactosSeleccionados(id, defaultSel);
                            }
                        }
                    }
                } else {
                    clientesSeleccionadosIds.delete(id);
                }
            });
            
            actualizarBarraAccionesLote();
        });
    }

    // Botón de cancelar selección
    if (btnClearSelection) {
        btnClearSelection.addEventListener('click', () => {
            clientesSeleccionadosIds.clear();
            cuerpoTablaClientes.querySelectorAll('.chk-cliente').forEach(chk => {
                chk.checked = false;
            });
            if (chkSeleccionarTodos) chkSeleccionarTodos.checked = false;
            if (chkBulkDetallado) chkBulkDetallado.checked = false;
            actualizarBarraAccionesLote();
        });
    }

    // Botón de envío masivo por WhatsApp (Redirigido a Omnicanal)
    if (btnBulkWhatsapp) {
        btnBulkWhatsapp.addEventListener('click', async () => {
            const idsArray = Array.from(clientesSeleccionadosIds);
            if (idsArray.length === 0) return;

            const confirmacion = await Swal.fire({
                title: '¿Confirmar envío masivo?',
                text: `Se procesará el despacho de saldos de cuenta corriente para los ${idsArray.length} clientes seleccionados según los canales configurados.`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: 'var(--purple-primary)',
                cancelButtonColor: '#64748b',
                confirmButtonText: 'Sí, enviar',
                cancelButtonText: 'Cancelar'
            });

            if (!confirmacion.isConfirmed) return;

            let cancelBulkSend = false;
            Swal.fire({
                title: 'Enviando Reportes...',
                html: `Enviando reporte <strong>1</strong> de <strong>${idsArray.length}</strong>...`,
                allowOutsideClick: false,
                allowEscapeKey: false,
                showCancelButton: true,
                cancelButtonText: 'Cancelar Envío',
                cancelButtonColor: '#dc2626',
                didOpen: () => {
                    Swal.showLoading();
                    const cancelBtn = Swal.getCancelButton();
                    if (cancelBtn) {
                        cancelBtn.addEventListener('click', () => {
                            cancelBulkSend = true;
                        });
                    }
                }
            });

            const exitos = [];
            const fallos = [];

            for (let i = 0; i < idsArray.length; i++) {
                if (cancelBulkSend) break;

                const clienteId = idsArray[i];
                const cliente = todosLosClientes.find(c => c.id === clienteId);
                
                if (!cliente) {
                    fallos.push({ nombre: `ID ${clienteId}`, razon: 'Cliente no encontrado en memoria.' });
                    continue;
                }

                if (!cliente.cuenta_corriente_id) {
                    fallos.push({ nombre: cliente.cliente_nombre, razon: 'No posee cuenta corriente configurada.' });
                    continue;
                }

                let selected = obtenerContactosSeleccionados(clienteId);
                let wps = [];
                let emails = [];

                if (selected) {
                    if (Array.isArray(selected)) {
                        wps = selected;
                        emails = obtenerEmailsDeCliente(cliente).filter(e => e.default_factura).map(e => e.email);
                    } else if (selected.whatsapp && selected.email) {
                        wps = selected.whatsapp;
                        emails = selected.email;
                    }
                } else {
                    wps = obtenerContactosDeCliente(cliente).filter(c => c.default_factura).map(c => c.numero);
                    emails = obtenerEmailsDeCliente(cliente).filter(e => e.default_factura).map(e => e.email);
                    
                    const rawWpStr = (cliente.whatsapp_facturas || '').trim();
                    const rawEmailStr = (cliente.email_facturas || '').trim();
                    let hasWpConfig = false;
                    let hasEmailConfig = false;
                    
                    if (rawWpStr.startsWith('[')) {
                        try {
                            const parsed = JSON.parse(rawWpStr);
                            hasWpConfig = Array.isArray(parsed) && parsed.some(c => c.default_factura !== undefined);
                        } catch(e) {}
                    }
                    if (rawEmailStr.startsWith('[')) {
                        try {
                            const parsed = JSON.parse(rawEmailStr);
                            hasEmailConfig = Array.isArray(parsed) && parsed.some(e => e.default_factura !== undefined);
                        } catch(e) {}
                    }
                    const isConfigured = hasWpConfig || hasEmailConfig;

                    if (!isConfigured && wps.length === 0 && emails.length === 0) {
                        wps = obtenerContactosDeCliente(cliente).map(c => c.numero);
                        emails = obtenerEmailsDeCliente(cliente).map(e => e.email);
                    }
                }

                // Determinar canales a despachar
                const sendWp = wps.length > 0;
                const sendEmail = emails.length > 0;
                const detallado = chkBulkDetallado && chkBulkDetallado.checked;

                if (!sendWp && !sendEmail) {
                    // Descarga manual
                    const queryParam = detallado ? '?detallado=true' : '';
                    window.open(`/api/logistica/bunker/cuentas-corrientes/${cliente.cuenta_corriente_id}/reporte-pdf${queryParam}`, '_blank');
                    exitos.push({ nombre: cliente.cliente_nombre + ' (Descarga manual)' });
                    continue;
                }

                // Actualizar cargador con el cliente actual
                Swal.getHtmlContainer().innerHTML = `Enviando reporte <strong>${exitos.length + fallos.length + 1}</strong> de <strong>${idsArray.length}</strong>...<br><small style="color: #64748b;">Cliente: ${cliente.cliente_nombre}</small>`;

                // Disparar envíos
                let attempts = [];
                if (sendWp) {
                    const url = `/api/logistica/bunker/cuentas-corrientes/${cliente.cuenta_corriente_id}/whatsapp`;
                    attempts.push(fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ destinatarios: wps.join(', '), detallado })
                    }).then(async r => {
                        const data = await r.json();
                        if (!r.ok || !data.success) throw new Error(data.message || data.error || 'Fallo WhatsApp');
                        return 'WhatsApp';
                    }));
                }
                if (sendEmail) {
                    const url = `/api/logistica/bunker/cuentas-corrientes/${cliente.cuenta_corriente_id}/email`;
                    attempts.push(fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ destinatarios: emails.join(', '), detallado })
                    }).then(async r => {
                        const data = await r.json();
                        if (!r.ok || !data.success) throw new Error(data.message || data.error || 'Fallo Correo');
                        return 'Correo';
                    }));
                }

                try {
                    const results = await Promise.all(attempts);
                    exitos.push({ nombre: cliente.cliente_nombre + ` (${results.join(' + ')})` });
                } catch (err) {
                    fallos.push({ nombre: cliente.cliente_nombre, razon: err.message || 'Error de red' });
                }
            }

            // Limpiar selección al finalizar
            clientesSeleccionadosIds.clear();
            cuerpoTablaClientes.querySelectorAll('.chk-cliente').forEach(chk => {
                chk.checked = false;
            });
            if (chkSeleccionarTodos) chkSeleccionarTodos.checked = false;
            if (chkBulkDetallado) chkBulkDetallado.checked = false;
            actualizarBarraAccionesLote();

            // Resumen de la operación
            let summaryHtml = `
                <div style="text-align: left; font-family: 'Inter', sans-serif;">
                    <p style="margin-bottom: 12px; font-size: 14px; color: #1e293b;">
                        El envío masivo ha finalizado.
                    </p>
                    <div style="margin-bottom: 8px;">
                        <strong>Enviados con éxito:</strong> <span style="color: #16a34a; font-weight: bold;">${exitos.length}</span>
                    </div>
                    ${exitos.length > 0 ? `
                    <ul style="max-height: 120px; overflow-y: auto; font-size: 13px; color: #475569; padding-left: 20px; margin-bottom: 16px;">
                        ${exitos.map(e => `<li>${e.nombre}</li>`).join('')}
                    </ul>` : ''}
                    
                    <div style="margin-bottom: 8px;">
                        <strong>Fallidos o omitidos:</strong> <span style="color: #dc2626; font-weight: bold;">${fallos.length}</span>
                    </div>
                    ${fallos.length > 0 ? `
                    <ul style="max-height: 120px; overflow-y: auto; font-size: 13px; color: #dc2626; padding-left: 20px; margin-bottom: 16px;">
                        ${fallos.map(f => `<li><strong>${f.nombre}</strong>: ${f.razon}</li>`).join('')}
                    </ul>` : ''}
                </div>
            `;

            Swal.fire({
                title: cancelBulkSend ? 'Envío Interrumpido' : 'Resumen de Envío Masivo',
                html: summaryHtml,
                icon: fallos.length > 0 ? 'warning' : 'success',
                confirmButtonText: 'Entendido',
                confirmButtonColor: 'var(--purple-primary)'
            });
        });
    }

    // --- INICIALIZACIÓN ---
    setupLomasSoftAutocomplete();
    setupSorting();
    inicializarColumnas();
    cargarClientes();
});
