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
    const selPreferenciaFacturacion = document.getElementById('sel-preferencia-facturacion');
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
    const chkVerStock = document.getElementById('chk-ver-stock');

    // Trazabilidad de conversión de prospecto a cliente
    let prospectoConversionId = null;

    // Configuración de visibilidad de columnas
    const columnasConfig = {
        codigo: { selector: '.col-codigo', visible: true },
        nombre: { selector: '.col-nombre', visible: true },
        razon: { selector: '.col-razon', visible: true },
        externo: { selector: '.col-externo', visible: true },
        financiacion: { selector: '.col-financiacion', visible: true },
        saldo: { selector: '.col-saldo', visible: true },
        listas: { selector: '.col-listas', visible: true }
    };

    function obtenerModoSwitchCliente(cliente) {
        if (cliente?.salvavidas_info?.modo_switch) {
            return cliente.salvavidas_info.modo_switch;
        }
        const rawModo = String(cliente?.salvavidas_modo || 'HEREDAR_LISTA').trim().toUpperCase();
        if (rawModo === 'EXCLUIDO') return 'EXCLUIDO';
        if (rawModo === 'SOMBRA') return 'SOMBRA';
        return 'ACTIVO';
    }

    function obtenerFinanciacionCalculadaConIva(cliente) {
        return Number(cliente?.salvavidas_info?.financiacion_calculada_con_iva || 0);
    }

    function obtenerFinanciacionCalculadaNeta(cliente) {
        return Number(cliente?.salvavidas_info?.financiacion_calculada_neta || 0);
    }

    function obtenerFinanciacionCalculadaIva(cliente) {
        return Number(cliente?.salvavidas_info?.financiacion_calculada_iva || 0);
    }

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
        let totalDeuda = 0;
        let totalFinancActivaConIva = 0;
        let totalFinancSombraConIva = 0;
        let countActivo = 0;
        let countActivoConCargo = 0;
        let countSombra = 0;
        let countSombraConCargo = 0;
        let countExcluido = 0;

        todosLosClientes.forEach(c => {
            const val = parseFloat(c.saldo || 0);
            if (val > 0) totalDeuda += val;

            const modo = obtenerModoSwitchCliente(c);
            const financConIva = obtenerFinanciacionCalculadaConIva(c);

            if (modo === 'ACTIVO') {
                countActivo++;
                if (financConIva > 0) {
                    countActivoConCargo++;
                    totalFinancActivaConIva += financConIva;
                }
            } else if (modo === 'SOMBRA') {
                countSombra++;
                if (financConIva > 0) {
                    countSombraConCargo++;
                    totalFinancSombraConIva += financConIva;
                }
            } else {
                countExcluido++;
            }
        });

        const fmt = (n) => Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        if (txtDeudaTotal && btnToggleDeuda) {
            if (mostrarDeuda) {
                txtDeudaTotal.textContent = '$ ' + fmt(totalDeuda);
                btnToggleDeuda.textContent = '👁️';
                btnToggleDeuda.title = 'Ocultar Deuda';
            } else {
                txtDeudaTotal.textContent = '$ ••••••••';
                btnToggleDeuda.textContent = '🙈';
                btnToggleDeuda.title = 'Mostrar Deuda';
            }
        }

        const txtDeudaTotalConFinanc = document.getElementById('txt-deuda-total-con-financiacion');
        if (txtDeudaTotalConFinanc) {
            if (mostrarDeuda) {
                const totalExigibleActivo = totalDeuda + totalFinancActivaConIva;
                const queryActiva = (buscadorInput?.value || '').trim();
                let subHtml = `🛡️ Total c/Financiación Activa (c/IVA): <strong>$ ${fmt(totalExigibleActivo)}</strong>`;
                if (totalFinancSombraConIva > 0) {
                    subHtml += ` &nbsp;·&nbsp; <span style="color:#92400e; opacity:0.8;">🌓 En Sombra: +$ ${fmt(totalFinancSombraConIva)}</span>`;
                }
                if (queryActiva) {
                    subHtml += ` &nbsp;<span style="background:#fee2e2; color:#991b1b; padding:1px 6px; border-radius:4px; font-size:10px; font-weight:700;">🔍 Filtro activo: "${queryActiva}"</span>`;
                }
                txtDeudaTotalConFinanc.innerHTML = subHtml;
            } else {
                txtDeudaTotalConFinanc.textContent = '🛡️ Total c/Financiación Activa: $ ••••••••';
            }
        }

        const txtKpiActiva = document.getElementById('txt-kpi-financ-activa');
        const txtKpiCountActivo = document.getElementById('txt-kpi-count-activo');
        const txtKpiSombra = document.getElementById('txt-kpi-financ-sombra');
        const txtKpiCountSombra = document.getElementById('txt-kpi-count-sombra');
        const txtKpiCountExcluido = document.getElementById('txt-kpi-count-excluido');

        if (txtKpiActiva) {
            txtKpiActiva.textContent = mostrarDeuda ? ('+$ ' + fmt(totalFinancActivaConIva) + ' c/IVA') : '$ ••••••';
        }
        if (txtKpiCountActivo) {
            txtKpiCountActivo.textContent = `${countActivo} en Activo (${countActivoConCargo} con saldo financiado)`;
        }
        if (txtKpiSombra) {
            txtKpiSombra.textContent = mostrarDeuda ? ('+$ ' + fmt(totalFinancSombraConIva) + ' c/IVA') : '$ ••••••';
        }
        if (txtKpiCountSombra) {
            txtKpiCountSombra.textContent = `${countSombra} en Sombra (${countSombraConCargo} con cargo informativo)`;
        }
        if (txtKpiCountExcluido) {
            txtKpiCountExcluido.textContent = `${countExcluido} cliente${countExcluido === 1 ? '' : 's'} apagado${countExcluido === 1 ? '' : 's'}`;
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
            contactos = whatsappString.split(',').map(n => ({ numero: n.trim(), nombre: '', cargo: '', default_factura: true, default_resumen: true }));
        }
        return contactos.map(c => ({
            numero: c.numero ? c.numero.replace(/\D/g, '') : '',
            nombre: c.nombre || '',
            cargo: c.cargo || '',
            default_factura: c.default_factura !== false,
            default_resumen: c.default_resumen === true || c.default === true
        })).filter(c => c.numero.length > 0);
    }

    function obtenerEmailsDeCliente(cliente) {
        const emailString = cliente.email_facturas || '';
        let emails = [];
        if (emailString && emailString.trim().startsWith('[')) {
            try {
                emails = JSON.parse(emailString);
            } catch (e) {
                console.error('Error parseando email_facturas:', e);
            }
        } else if (emailString && emailString.trim().length > 0) {
            emails = emailString.split(',').map(e => ({ email: e.trim(), nombre: '', cargo: '', default_factura: true }));
        }

        // 🚀 FALLBACK AUTOMÁTICO: Si no hay emails en email_facturas, recuperar email_portal si está disponible
        if (emails.length === 0 && cliente.email_portal && cliente.email_portal.trim().length > 0) {
            emails.push({
                email: cliente.email_portal.trim(),
                nombre: cliente.email_portal_nombre || cliente.cliente_nombre || '',
                cargo: cliente.email_portal_cargo || 'Portal B2B',
                default_factura: true
            });
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
                <div id="swal-bulk-wp-list" style="display: flex; flex-direction: column; gap: 6px; max-height: 150px; overflow-y: auto; padding: 2px; border: 1px solid #e2e8f0; border-radius: 6px;">
        `;

        if (contactosWp.length === 0) {
            htmlContent += `
                <div class="empty-placeholder" style="padding: 10px; font-size: 12px; color: #94a3b8; text-align: center;">
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
                <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed #cbd5e1;">
                    <div style="font-size: 11px; font-weight: 600; color: #10b981; margin-bottom: 4px;">➕ O ingrese un número de WhatsApp específico para este envío:</div>
                    <input type="text" id="swal-bulk-whatsapp-manual" placeholder="ej: (221) 563-1117" style="width: 100%; font-size: 13px; height: 32px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0 8px; box-sizing: border-box;">
                </div>
            </div>
        `;

        // Sección Email
        htmlContent += `
            <div style="margin-bottom: 15px;">
                <div style="font-size: 12px; font-weight: 600; color: #8b5cf6; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">
                    <span>📧 Correo Electrónico</span>
                </div>
                <div id="swal-bulk-email-list" style="display: flex; flex-direction: column; gap: 6px; max-height: 150px; overflow-y: auto; padding: 2px; border: 1px solid #e2e8f0; border-radius: 6px;">
        `;

        if (contactosEmail.length === 0) {
            htmlContent += `
                <div class="empty-placeholder" style="padding: 10px; font-size: 12px; color: #94a3b8; text-align: center;">
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
                <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed #cbd5e1;">
                    <div style="font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 4px;">➕ O ingrese un correo específico para este envío:</div>
                    <input type="email" id="swal-bulk-email-manual" placeholder="ej: diana@belgian.com" style="width: 100%; font-size: 13px; height: 32px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0 8px; box-sizing: border-box;">
                </div>
            </div>

            <!-- Sección: Cargar Nuevo Contacto Directo a la Ficha -->
            <div style="margin-top: 14px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden;">
                <div id="toggle-nuevo-contacto-bulk" style="padding: 9px 12px; background: #f1f5f9; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none;">
                    <span style="font-size: 12px; font-weight: 700; color: #1e293b; display: flex; align-items: center; gap: 6px;">
                        <span style="color: #6366f1;">➕</span> Cargar nuevo contacto para este cliente
                    </span>
                    <span id="icon-toggle-nuevo-contacto" style="font-size: 11px; color: #64748b; font-weight: 600;">▼ Desplegar</span>
                </div>
                <div id="form-nuevo-contacto-bulk" style="display: none; padding: 12px; flex-direction: column; gap: 8px;">
                    <div style="display: flex; gap: 8px;">
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 2px;">Nombre:</label>
                            <input type="text" id="swal-bulk-nuevo-nombre" placeholder="Ej: Micaela" style="width: 100%; font-size: 12px; height: 30px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 0 8px; box-sizing: border-box;">
                        </div>
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 2px;">Cargo / Rol:</label>
                            <input type="text" id="swal-bulk-nuevo-cargo" placeholder="Ej: Dueña, Administración" style="width: 100%; font-size: 12px; height: 30px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 0 8px; box-sizing: border-box;">
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 11px; font-weight: 600; color: #10b981; margin-bottom: 2px;">📱 WhatsApp (con máscara):</label>
                            <input type="text" id="swal-bulk-nuevo-wp" placeholder="(221) 305-1684" style="width: 100%; font-size: 12px; height: 30px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 0 8px; box-sizing: border-box;">
                        </div>
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 11px; font-weight: 600; color: #8b5cf6; margin-bottom: 2px;">📧 Correo (opcional):</label>
                            <input type="email" id="swal-bulk-nuevo-email" placeholder="ejemplo@cliente.com" style="width: 100%; font-size: 12px; height: 30px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 0 8px; box-sizing: border-box;">
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; padding-top: 4px;">
                        <label style="font-size: 11px; color: #475569; display: flex; align-items: center; gap: 5px; cursor: pointer; margin: 0;">
                            <input type="checkbox" id="swal-bulk-nuevo-alerta" checked style="accent-color: #10b981; width: 14px; height: 14px;">
                            <span>Alerta Logística 🚚</span>
                        </label>
                        <button type="button" id="btn-guardar-nuevo-contacto-bulk" style="background: #10b981; color: white; border: none; border-radius: 5px; padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                            <span>💾</span> Guardar en ficha y seleccionar
                        </button>
                    </div>
                    <div id="swal-bulk-nuevo-feedback" style="display: none; font-size: 11.5px; font-weight: 600; padding: 6px 10px; border-radius: 4px; text-align: center; margin-top: 4px;"></div>
                </div>
            </div>
            </div>
        `;

        const result = await Swal.fire({
            title: 'Seleccionar Destinatarios',
            html: htmlContent,
            icon: 'info',
            width: '620px',
            showCancelButton: true,
            confirmButtonText: '💾 Confirmar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: 'var(--purple-primary)',
            cancelButtonColor: '#64748b',
            didOpen: (popup) => {
                // 1. Máscara telefónica en número manual
                const manualWpInput = popup.querySelector('#swal-bulk-whatsapp-manual');
                if (manualWpInput) {
                    manualWpInput.addEventListener('input', () => {
                        let cursorPosition = manualWpInput.selectionStart;
                        const originalLength = manualWpInput.value.length;
                        const clean = cleanInputForFormatting(manualWpInput.value);
                        const formatted = formatArgentinePhone(clean);
                        manualWpInput.value = formatted;
                        const newLength = formatted.length;
                        cursorPosition = cursorPosition + (newLength - originalLength);
                        manualWpInput.setSelectionRange(cursorPosition, cursorPosition);
                    });
                }

                // 2. Máscara telefónica en nuevo contacto
                const nuevoWpInput = popup.querySelector('#swal-bulk-nuevo-wp');
                if (nuevoWpInput) {
                    nuevoWpInput.addEventListener('input', () => {
                        let cursorPosition = nuevoWpInput.selectionStart;
                        const originalLength = nuevoWpInput.value.length;
                        const clean = cleanInputForFormatting(nuevoWpInput.value);
                        const formatted = formatArgentinePhone(clean);
                        nuevoWpInput.value = formatted;
                        const newLength = formatted.length;
                        cursorPosition = cursorPosition + (newLength - originalLength);
                        nuevoWpInput.setSelectionRange(cursorPosition, cursorPosition);
                    });
                }

                // 3. Toggle de acordeón de nuevo contacto
                const toggleBtn = popup.querySelector('#toggle-nuevo-contacto-bulk');
                const formContainer = popup.querySelector('#form-nuevo-contacto-bulk');
                const toggleIcon = popup.querySelector('#icon-toggle-nuevo-contacto');
                if (toggleBtn && formContainer) {
                    toggleBtn.addEventListener('click', () => {
                        const isOpen = formContainer.style.display === 'flex';
                        formContainer.style.display = isOpen ? 'none' : 'flex';
                        if (toggleIcon) toggleIcon.textContent = isOpen ? '▼ Desplegar' : '▲ Plegar';
                        if (!isOpen) {
                            setTimeout(() => popup.querySelector('#swal-bulk-nuevo-nombre')?.focus(), 50);
                        }
                    });
                }

                // 4. Guardar nuevo contacto directamente en Bunker
                const btnGuardarNuevo = popup.querySelector('#btn-guardar-nuevo-contacto-bulk');
                const feedbackEl = popup.querySelector('#swal-bulk-nuevo-feedback');
                if (btnGuardarNuevo) {
                    btnGuardarNuevo.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        const nombreVal = (popup.querySelector('#swal-bulk-nuevo-nombre')?.value || '').trim();
                        const cargoVal = (popup.querySelector('#swal-bulk-nuevo-cargo')?.value || '').trim();
                        const rawWp = (popup.querySelector('#swal-bulk-nuevo-wp')?.value || '').trim();
                        const cleanPhone = cleanInputForFormatting(rawWp);
                        const emailVal = (popup.querySelector('#swal-bulk-nuevo-email')?.value || '').trim();
                        const alertaVal = popup.querySelector('#swal-bulk-nuevo-alerta')?.checked !== false;

                        if (!cleanPhone && !emailVal) {
                            if (feedbackEl) {
                                feedbackEl.style.display = 'block';
                                feedbackEl.style.background = '#fef2f2';
                                feedbackEl.style.color = '#991b1b';
                                feedbackEl.style.border = '1px solid #fecaca';
                                feedbackEl.textContent = 'Debe ingresar al menos un número de WhatsApp o un correo electrónico.';
                            }
                            return;
                        }

                        if (cleanPhone && cleanPhone.length < 8) {
                            if (feedbackEl) {
                                feedbackEl.style.display = 'block';
                                feedbackEl.style.background = '#fef2f2';
                                feedbackEl.style.color = '#991b1b';
                                feedbackEl.style.border = '1px solid #fecaca';
                                feedbackEl.textContent = 'El número de WhatsApp ingresado no parece ser un número válido.';
                            }
                            return;
                        }

                        btnGuardarNuevo.disabled = true;
                        btnGuardarNuevo.innerHTML = '<span>⏳</span> Guardando...';

                        try {
                            let curWps = obtenerContactosDeCliente(cliente);
                            let curEmails = obtenerEmailsDeCliente(cliente);

                            let wpAdded = null;
                            if (cleanPhone) {
                                const alreadyExists = curWps.some(c => c.numero && c.numero.replace(/\D/g, '') === cleanPhone);
                                if (!alreadyExists) {
                                    wpAdded = {
                                        id: `cont_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`,
                                        numero: cleanPhone,
                                        nombre: nombreVal,
                                        cargo: cargoVal,
                                        enviar_alerta: alertaVal,
                                        default_factura: true,
                                        default_resumen: true,
                                        default_presupuesto: true,
                                        default: true
                                    };
                                    curWps.push(wpAdded);
                                }
                            }

                            let emailAdded = null;
                            if (emailVal && emailVal.includes('@')) {
                                const alreadyExists = curEmails.some(em => em.email && em.email.toLowerCase() === emailVal.toLowerCase());
                                if (!alreadyExists) {
                                    emailAdded = {
                                        id: `em_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`,
                                        email: emailVal,
                                        nombre: nombreVal,
                                        cargo: cargoVal,
                                        enviar_alerta: alertaVal,
                                        default_factura: true,
                                        default_resumen: true,
                                        default_presupuesto: true,
                                        default: true
                                    };
                                    curEmails.push(emailAdded);
                                }
                            }

                            const payload = {
                                whatsapp_facturas: JSON.stringify(curWps),
                                email_facturas: JSON.stringify(curEmails)
                            };

                            const res = await fetch(`/api/logistica/bunker/clientes/${clienteId}/whatsapp-contacts`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload)
                            });

                            if (!res.ok) {
                                throw new Error(`Error en el servidor al guardar el contacto (${res.status})`);
                            }

                            cliente.whatsapp_facturas = payload.whatsapp_facturas;
                            cliente.email_facturas = payload.email_facturas;

                            // Actualizar DOM en vivo en el modal
                            if (wpAdded) {
                                const wpContainer = popup.querySelector('#swal-bulk-wp-list');
                                if (wpContainer) {
                                    const emptyPlaceholder = wpContainer.querySelector('.empty-placeholder');
                                    if (emptyPlaceholder) emptyPlaceholder.remove();

                                    const formattedDisplay = formatArgentinePhone(cleanPhone);
                                    const labelText = wpAdded.nombre 
                                        ? `<strong>${wpAdded.nombre}</strong>${wpAdded.cargo ? ` <span style="font-size: 9px; background: #e0f2fe; color: #0369a1; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${wpAdded.cargo}</span>` : ''}`
                                        : 'Contacto nuevo';

                                    const newLabel = document.createElement('label');
                                    newLabel.style = 'display: flex; align-items: flex-start; gap: 10px; padding: 8px; border: 1px solid #10b981; border-radius: 6px; background: #ecfdf5; cursor: pointer; transition: background 0.2s; margin-bottom: 0;';
                                    newLabel.innerHTML = `
                                        <input type="checkbox" class="swal-bulk-contacto-wp-chk" value="${wpAdded.numero}" checked style="margin-top: 2px; cursor: pointer; width: 15px; height: 15px; accent-color: #10b981;">
                                        <div style="flex: 1;">
                                            <div style="font-size: 12px; color: #1f2937; margin-bottom: 1px;">${labelText}</div>
                                            <div style="font-size: 11px; color: #059669; font-weight: 600;">📱 ${formattedDisplay}</div>
                                        </div>
                                    `;
                                    wpContainer.prepend(newLabel);
                                }
                            }

                            if (emailAdded) {
                                const emailContainer = popup.querySelector('#swal-bulk-email-list');
                                if (emailContainer) {
                                    const emptyPlaceholder = emailContainer.querySelector('.empty-placeholder');
                                    if (emptyPlaceholder) emptyPlaceholder.remove();

                                    const labelText = emailAdded.nombre 
                                        ? `<strong>${emailAdded.nombre}</strong>${emailAdded.cargo ? ` <span style="font-size: 9px; background: #f3e8ff; color: #6b21a8; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${emailAdded.cargo}</span>` : ''}`
                                        : 'Contacto nuevo';

                                    const newLabel = document.createElement('label');
                                    newLabel.style = 'display: flex; align-items: flex-start; gap: 10px; padding: 8px; border: 1px solid #8b5cf6; border-radius: 6px; background: #f5f3ff; cursor: pointer; transition: background 0.2s; margin-bottom: 0;';
                                    newLabel.innerHTML = `
                                        <input type="checkbox" class="swal-bulk-contacto-email-chk" value="${emailAdded.email}" checked style="margin-top: 2px; cursor: pointer; width: 15px; height: 15px; accent-color: #8b5cf6;">
                                        <div style="flex: 1;">
                                            <div style="font-size: 12px; color: #1f2937; margin-bottom: 1px;">${labelText}</div>
                                            <div style="font-size: 11px; color: #7c3aed; font-weight: 600; word-break: break-all;">📧 ${emailAdded.email}</div>
                                        </div>
                                    `;
                                    emailContainer.prepend(newLabel);
                                }
                            }

                            // Actualizar botón de la tabla
                            const btnCfg = cuerpoTablaClientes.querySelector(`.btn-config-contactos-cliente[data-id="${clienteId}"]`);
                            if (btnCfg) {
                                btnCfg.title = `Configurar destinatarios específicos (${curWps.length} WhatsApp, ${curEmails.length} Correo)`;
                            }

                            if (feedbackEl) {
                                feedbackEl.style.display = 'block';
                                feedbackEl.style.background = '#d1fae5';
                                feedbackEl.style.color = '#065f46';
                                feedbackEl.style.border = '1px solid #a7f3d0';
                                feedbackEl.textContent = '✔️ ¡Contacto guardado en la ficha del cliente y preseleccionado!';
                            }

                            // Limpiar inputs
                            popup.querySelector('#swal-bulk-nuevo-nombre').value = '';
                            popup.querySelector('#swal-bulk-nuevo-cargo').value = '';
                            popup.querySelector('#swal-bulk-nuevo-wp').value = '';
                            popup.querySelector('#swal-bulk-nuevo-email').value = '';

                            setTimeout(() => {
                                btnGuardarNuevo.disabled = false;
                                btnGuardarNuevo.innerHTML = '<span>💾</span> Guardar en ficha y seleccionar';
                            }, 2000);

                        } catch (err) {
                            console.error('Error guardando nuevo contacto:', err);
                            if (feedbackEl) {
                                feedbackEl.style.display = 'block';
                                feedbackEl.style.background = '#fef2f2';
                                feedbackEl.style.color = '#991b1b';
                                feedbackEl.style.border = '1px solid #fecaca';
                                feedbackEl.textContent = 'Error al guardar: ' + err.message;
                            }
                            btnGuardarNuevo.disabled = false;
                            btnGuardarNuevo.innerHTML = '<span>💾</span> Guardar en ficha y seleccionar';
                        }
                    });
                }
            },
            preConfirm: () => {
                const wps = Array.from(document.querySelectorAll('.swal-bulk-contacto-wp-chk:checked')).map(el => el.value);
                const emails = Array.from(document.querySelectorAll('.swal-bulk-contacto-email-chk:checked')).map(el => el.value);
                const manualWp = (document.getElementById('swal-bulk-whatsapp-manual')?.value || '').replace(/\D/g, '').trim();
                if (manualWp && manualWp.length >= 8 && !wps.includes(manualWp)) {
                    wps.push(manualWp);
                }
                const manualEmail = (document.getElementById('swal-bulk-email-manual')?.value || '').trim();
                if (manualEmail && manualEmail.includes('@') && !emails.includes(manualEmail)) {
                    emails.push(manualEmail);
                }
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

    // Estado de ordenamiento para las columnas Saldo ('none' | 'desc' | 'asc') y Financiación ('none' | 'activo_desc' | 'sombra_desc')
    let sortState = 'none';
    let sortFinanciacionState = 'none';

    function obtenerPrioridadOrdenFinanciacion(cliente, modoOrden) {
        const modo = obtenerModoSwitchCliente(cliente);
        const financ = obtenerFinanciacionCalculadaConIva(cliente);
        const saldo = parseFloat(cliente?.saldo || 0);

        if (modoOrden === 'sombra_desc') {
            // Prioriza Modo Sombra con valores arriba, luego Activo con valores
            if (modo === 'SOMBRA' && financ > 0) return 1;
            if (modo === 'ACTIVO' && financ > 0) return 2;
            if (modo === 'SOMBRA' && saldo > 0) return 3;
            if (modo === 'ACTIVO' && saldo > 0) return 4;
            if (modo === 'SOMBRA') return 5;
            if (modo === 'ACTIVO') return 6;
            return 7;
        }

        // 'activo_desc' (Por defecto al tocar encabezado Financiación):
        // 1° Financiación Activa con valores (> $0) arriba de todo
        // 2° Modo Sombra con valores (> $0)
        // 3° Financiación Activa con saldo deudor (en término 0%)
        // 4° Financiación Activa al día
        // 5° Modo Sombra sin cargo
        // 6° Modo Apagado (Excluido)
        if (modo === 'ACTIVO' && financ > 0) return 1;
        if (modo === 'SOMBRA' && financ > 0) return 2;
        if (modo === 'ACTIVO' && saldo > 0) return 3;
        if (modo === 'ACTIVO') return 4;
        if (modo === 'SOMBRA' && saldo > 0) return 5;
        if (modo === 'SOMBRA') return 6;
        return 7;
    }

    function sincronizarEstadoKpiCardsFinanciacion() {
        const filtroFinanc = document.getElementById('filtro-financiacion-modo')?.value || 'todos';
        const cardActiva = document.getElementById('kpi-card-financ-activa');
        const cardSombra = document.getElementById('kpi-card-financ-sombra');
        const cardExcluido = document.getElementById('kpi-card-financ-excluido');

        if (cardActiva) cardActiva.classList.toggle('active-filter', filtroFinanc === 'ACTIVO');
        if (cardSombra) cardSombra.classList.toggle('active-filter', filtroFinanc === 'SOMBRA');
        if (cardExcluido) cardExcluido.classList.toggle('active-filter', filtroFinanc === 'EXCLUIDO');
    }

    function ordenarYRenderizar() {
        let clientesOrdenados = [...todosLosClientes];
        
        // Aplicar Filtro de Programa de Financiación
        const filtroFinanc = document.getElementById('filtro-financiacion-modo')?.value || 'todos';
        if (filtroFinanc === 'con_cargo') {
            clientesOrdenados = clientesOrdenados.filter(c => obtenerFinanciacionCalculadaConIva(c) > 0);
        } else if (filtroFinanc === 'ACTIVO' || filtroFinanc === 'SOMBRA' || filtroFinanc === 'EXCLUIDO') {
            clientesOrdenados = clientesOrdenados.filter(c => obtenerModoSwitchCliente(c) === filtroFinanc);
        }

        sincronizarEstadoKpiCardsFinanciacion();

        // Aplicar Filtro Portal B2B
        const filtroB2B = document.getElementById('filtro-portal-b2b')?.value || 'todos';
        if (filtroB2B === 'activos') {
            clientesOrdenados = clientesOrdenados.filter(c => c.onboarding_completado === true);
        } else if (filtroB2B === 'pendientes') {
            clientesOrdenados = clientesOrdenados.filter(c => c.onboarding_completado !== true);
        }

        if (sortFinanciacionState !== 'none') {
            clientesOrdenados.sort((a, b) => {
                const prioA = obtenerPrioridadOrdenFinanciacion(a, sortFinanciacionState);
                const prioB = obtenerPrioridadOrdenFinanciacion(b, sortFinanciacionState);
                if (prioA !== prioB) return prioA - prioB;

                const financA = obtenerFinanciacionCalculadaConIva(a);
                const financB = obtenerFinanciacionCalculadaConIva(b);
                if (financB !== financA) return financB - financA; // Mayor monto financiado primero

                const saldoA = parseFloat(a.saldo || 0);
                const saldoB = parseFloat(b.saldo || 0);
                if (saldoB !== saldoA) return saldoB - saldoA; // Mayor saldo capital primero

                return (a.cliente_nombre || '').localeCompare(b.cliente_nombre || '', 'es');
            });
        } else if (sortState === 'desc') {
            clientesOrdenados.sort((a, b) => {
                const saldoA = parseFloat(a.saldo || 0);
                const saldoB = parseFloat(b.saldo || 0);
                if (saldoB !== saldoA) return saldoB - saldoA; // Mayor saldo deudor primero
                return obtenerFinanciacionCalculadaConIva(b) - obtenerFinanciacionCalculadaConIva(a);
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
        const thFinanciacion = document.getElementById('th-financiacion');
        const sortIconFinanciacion = document.getElementById('sort-icon-financiacion');

        const resetIconoFinanciacion = () => {
            sortFinanciacionState = 'none';
            if (sortIconFinanciacion) {
                sortIconFinanciacion.textContent = ' ⇅';
                sortIconFinanciacion.style.opacity = '0.3';
            }
        };

        const resetIconoSaldo = () => {
            sortState = 'none';
            if (sortIconSaldo) {
                sortIconSaldo.textContent = ' ⇅';
                sortIconSaldo.style.opacity = '0.3';
            }
        };

        if (thSaldo && sortIconSaldo) {
            thSaldo.addEventListener('click', () => {
                resetIconoFinanciacion();
                if (sortState === 'none') {
                    sortState = 'desc';
                    sortIconSaldo.textContent = ' ▼';
                    sortIconSaldo.style.opacity = '1';
                } else if (sortState === 'desc') {
                    sortState = 'asc';
                    sortIconSaldo.textContent = ' ▲';
                    sortIconSaldo.style.opacity = '1';
                } else {
                    resetIconoSaldo();
                }
                ordenarYRenderizar();
            });
        }

        if (thFinanciacion && sortIconFinanciacion) {
            thFinanciacion.addEventListener('click', () => {
                resetIconoSaldo();
                if (sortFinanciacionState === 'none') {
                    sortFinanciacionState = 'activo_desc';
                    sortIconFinanciacion.textContent = ' ▼ (🛡️ Activos 1°)';
                    sortIconFinanciacion.style.opacity = '1';
                    sortIconFinanciacion.style.color = '#047857';
                } else if (sortFinanciacionState === 'activo_desc') {
                    sortFinanciacionState = 'sombra_desc';
                    sortIconFinanciacion.textContent = ' ▲ (🌓 Sombra 1°)';
                    sortIconFinanciacion.style.opacity = '1';
                    sortIconFinanciacion.style.color = '#b45309';
                } else {
                    resetIconoFinanciacion();
                    sortIconFinanciacion.style.color = '';
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

    function crearFilaWhatsapp(contacto = { numero: '', nombre: '', cargo: '', enviar_alerta: true }) {
        const card = document.createElement('div');
        card.className = 'whatsapp-contact-card';
        card.dataset.contactId = contacto.id || `cont_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`;
        if (contacto.default_factura !== undefined) card.dataset.defaultFactura = contacto.default_factura;
        if (contacto.default_resumen !== undefined) card.dataset.defaultResumen = contacto.default_resumen;
        if (contacto.default_difusion !== undefined) card.dataset.defaultDifusion = contacto.default_difusion;
        if (contacto.default_presupuesto !== undefined) card.dataset.defaultPresupuesto = contacto.default_presupuesto;
        if (contacto.default !== undefined) card.dataset.default = contacto.default;
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

        // Fila 3: Alerta de Entrega Logística
        const row3 = document.createElement('div');
        row3.style.display = 'flex';
        row3.style.alignItems = 'center';
        row3.style.gap = '6px';
        row3.style.marginTop = '4px';

        const checkboxAlerta = document.createElement('input');
        checkboxAlerta.type = 'checkbox';
        checkboxAlerta.className = 'whatsapp-contact-alerta';
        checkboxAlerta.id = `alert-wa-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
        checkboxAlerta.checked = contacto.enviar_alerta !== false; // por defecto true
        checkboxAlerta.addEventListener('change', actualizarHiddenWhatsapp);

        const labelAlerta = document.createElement('label');
        labelAlerta.htmlFor = checkboxAlerta.id;
        labelAlerta.textContent = 'Enviar Alerta de Entrega Logística 📦';
        labelAlerta.style.fontSize = '11px';
        labelAlerta.style.fontWeight = '500';
        labelAlerta.style.color = '#475569';
        labelAlerta.style.cursor = 'pointer';
        labelAlerta.style.userSelect = 'none';

        row3.appendChild(checkboxAlerta);
        row3.appendChild(labelAlerta);

        card.appendChild(btnDelete);
        card.appendChild(row1);
        card.appendChild(row2);
        card.appendChild(row3);
        whatsappInputsContainer.appendChild(card);

        return inputName;
    }

    function renderWhatsappInputs(valueString) {
        whatsappInputsContainer.innerHTML = '';
        if (!valueString || !valueString.trim()) {
            crearFilaWhatsapp({ numero: '', nombre: '', cargo: '', enviar_alerta: true });
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
            crearFilaWhatsapp({ numero: num, nombre: '', cargo: '', enviar_alerta: true });
        });
    }

    function actualizarHiddenWhatsapp() {
        const cards = Array.from(whatsappInputsContainer.querySelectorAll('.whatsapp-contact-card'));
        const contacts = cards.map((card, idx) => {
            const name = card.querySelector('.whatsapp-contact-name').value.trim();
            const role = card.querySelector('.whatsapp-contact-role').value.trim();
            let number = card.querySelector('.whatsapp-contact-number').value.replace(/\D/g, '').trim();
            const alertaCheckbox = card.querySelector('.whatsapp-contact-alerta');
            const alerta = alertaCheckbox ? Boolean(alertaCheckbox.checked) : true;
            const contactId = card.dataset.contactId || `cont_${Date.now().toString(36)}_${idx}`;

            if (number.length === 10) {
                number = '549' + number;
            } else if (number.startsWith('54') && !number.startsWith('549')) {
                number = '549' + number.substring(2);
            }

            return {
                id: contactId,
                numero: number,
                nombre: name,
                cargo: role,
                enviar_alerta: alerta,
                default_factura: card.dataset.defaultFactura !== undefined ? card.dataset.defaultFactura === 'true' : true,
                default_resumen: card.dataset.defaultResumen !== undefined ? card.dataset.defaultResumen === 'true' : true,
                ...(card.dataset.defaultDifusion !== undefined ? { default_difusion: card.dataset.defaultDifusion === 'true' } : {}),
                ...(card.dataset.defaultPresupuesto !== undefined ? { default_presupuesto: card.dataset.defaultPresupuesto === 'true' } : {}),
                ...(card.dataset.default !== undefined ? { default: card.dataset.default === 'true' } : {})
            };
        }).filter(c => c.numero.length > 0);

        txtWhatsappFacturas.value = contacts.length > 0 ? JSON.stringify(contacts) : '';
    }

    if (btnAddWhatsapp) {
        btnAddWhatsapp.addEventListener('click', () => {
            const input = crearFilaWhatsapp({ numero: '', nombre: '', cargo: '', enviar_alerta: true });
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

    function crearFilaEmail(contacto = { email: '', nombre: '', cargo: '', enviar_alerta: true }) {
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

        // Fila 3: Alerta de Entrega Logística
        const row3 = document.createElement('div');
        row3.style.display = 'flex';
        row3.style.alignItems = 'center';
        row3.style.gap = '6px';
        row3.style.marginTop = '4px';

        const checkboxAlerta = document.createElement('input');
        checkboxAlerta.type = 'checkbox';
        checkboxAlerta.className = 'email-contact-alerta';
        checkboxAlerta.id = `alert-em-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
        checkboxAlerta.checked = contacto.enviar_alerta !== false; // por defecto true
        checkboxAlerta.addEventListener('change', actualizarHiddenEmail);

        const labelAlerta = document.createElement('label');
        labelAlerta.htmlFor = checkboxAlerta.id;
        labelAlerta.textContent = 'Enviar Alerta de Entrega Logística 📦';
        labelAlerta.style.fontSize = '11px';
        labelAlerta.style.fontWeight = '500';
        labelAlerta.style.color = '#475569';
        labelAlerta.style.cursor = 'pointer';
        labelAlerta.style.userSelect = 'none';

        row3.appendChild(checkboxAlerta);
        row3.appendChild(labelAlerta);

        card.appendChild(btnDelete);
        card.appendChild(row1);
        card.appendChild(row2);
        card.appendChild(row3);
        emailInputsContainer.appendChild(card);

        return inputName;
    }

    function renderEmailInputs(valueString) {
        emailInputsContainer.innerHTML = '';
        if (!valueString || !valueString.trim()) {
            crearFilaEmail({ email: '', nombre: '', cargo: '', enviar_alerta: true });
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
            crearFilaEmail({ email: email, nombre: '', cargo: '', enviar_alerta: true });
        });
    }

    function actualizarHiddenEmail() {
        const cards = Array.from(emailInputsContainer.querySelectorAll('.email-contact-card'));
        const contacts = cards.map(card => {
            const name = card.querySelector('.email-contact-name').value.trim();
            const role = card.querySelector('.email-contact-role').value.trim();
            const email = card.querySelector('.email-contact-address').value.trim();
            const alertaCheckbox = card.querySelector('.email-contact-alerta');
            const alerta = alertaCheckbox ? alertaCheckbox.checked : true;

            return {
                email: email,
                nombre: name,
                cargo: role,
                enviar_alerta: alerta
            };
        }).filter(c => c.email.length > 0);

        txtEmailFacturas.value = contacts.length > 0 ? JSON.stringify(contacts) : '';
    }

    if (btnAddEmail) {
        btnAddEmail.addEventListener('click', () => {
            const input = crearFilaEmail({ email: '', nombre: '', cargo: '', enviar_alerta: true });
            input.focus();
        });
    }

    // Caché del mapa de financiación por cliente
    let ultimoMapaFinanciacion = {};

    // Estado de Estructura Tipo Árbol para Nodos Barriales (Clientes del Nodo + Subcuentas)
    const nodosExpandidosIds = new Set();
    const cacheArbolNodos = new Map();
    let ultimaBusquedaClientes = '';
    const escHtmlNodo = (v) => String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

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

            const [clientesRes, dashRes] = await Promise.allSettled([
                fetch(url).then(r => r.json()),
                fetch('/api/logistica/bunker/cuentas-corrientes/salvavidas/dashboard-sombra').then(r => r.json())
            ]);

            if (clientesRes.status !== 'fulfilled' || !clientesRes.value?.success) {
                throw new Error(clientesRes.value?.error || 'Error al obtener clientes.');
            }

            if (dashRes.status === 'fulfilled' && dashRes.value?.success && dashRes.value?.data?.clientes_financiacion_map) {
                ultimoMapaFinanciacion = dashRes.value.data.clientes_financiacion_map;
            }

            todosLosClientes = (clientesRes.value.data || []).map(c => {
                const infoFinanc = ultimoMapaFinanciacion[c.codigo_bunker_cliente] || null;
                return {
                    ...c,
                    salvavidas_info: infoFinanc || {
                        codigo_bunker_cliente: c.codigo_bunker_cliente,
                        salvavidas_modo_raw: c.salvavidas_modo || 'HEREDAR_LISTA',
                        modo_switch: String(c.salvavidas_modo || '').toUpperCase() === 'EXCLUIDO'
                            ? 'EXCLUIDO'
                            : (String(c.salvavidas_modo || '').toUpperCase() === 'SOMBRA' ? 'SOMBRA' : 'ACTIVO'),
                        financiacion_calculada_neta: 0,
                        financiacion_calculada_iva: 0,
                        financiacion_calculada_con_iva: 0,
                        estado_semaforo: parseFloat(c.saldo || 0) > 0 ? 'EN_TERMINO' : 'AL_DIA',
                        max_dias: 0,
                        tasa_tem_pct: 3
                    }
                };
            });

            const cleanSearch = String(searchQuery || '').trim();
            if (cleanSearch !== ultimaBusquedaClientes) {
                cacheArbolNodos.clear();
                ultimaBusquedaClientes = cleanSearch;
            }
            if (cleanSearch.length > 0) {
                todosLosClientes.forEach(c => {
                    if (c.nodo_info && Number(c.nodo_info.vecinos_coincidentes || 0) > 0) {
                        nodosExpandidosIds.add(Number(c.id));
                    }
                });
            }

            actualizarDeudaTotal(); // Actualizar widget de deuda consolidada y KPIs de financiación
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
                            📭 No se encontraron clientes registrados para el filtro seleccionado.
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        const fmtMoneda = (n) => Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

            // Datos de Financiación y Switch de 3 posiciones
            const modoSwitch = obtenerModoSwitchCliente(cliente);
            const financConIva = obtenerFinanciacionCalculadaConIva(cliente);
            const financNeta = obtenerFinanciacionCalculadaNeta(cliente);
            const infoFinanc = cliente.salvavidas_info || {};
            const maxDias = Number(infoFinanc.dias_max_antiguedad || infoFinanc.max_dias || 0);
            const tasaPct = Number(infoFinanc.tasa_tem_pct || 3);
            const estadoSem = infoFinanc.estado_general || infoFinanc.estado_semaforo || 'AL_DIA';

            // Calcular y formatear saldo
            const saldoNum = parseFloat(cliente.saldo || 0);
            let colorSaldo = '#64748b'; // neutral (cero)
            if (saldoNum > 0) {
                colorSaldo = '#dc2626'; // rojo (debe / deudor)
            } else if (saldoNum < 0) {
                colorSaldo = '#16a34a'; // verde (a favor / acreedor)
            }
            
            const saldoFormateado = '$ ' + fmtMoneda(Math.abs(saldoNum));
            let badgeSaldo = `<span style="font-weight: 700; color: ${colorSaldo}; font-size: 1.02em;">${saldoFormateado}</span>`;
            if (saldoNum > 0) {
                if (financConIva > 0) {
                    const totalConFinanc = saldoNum + financConIva;
                    if (modoSwitch === 'ACTIVO') {
                        badgeSaldo += `
                            <div style="margin-top: 3px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 5px; padding: 2px 6px; display: inline-block;">
                                <div style="font-size: 11px; font-weight: 800; color: #b91c1c;" title="Saldo Capital + Financiación Activa c/IVA">
                                    🛡️ Total c/Financ.: $ ${fmtMoneda(totalConFinanc)}
                                </div>
                                <div style="font-size: 9.5px; font-weight: 700; color: #047857;">
                                    (+Financ. c/IVA: $ ${fmtMoneda(financConIva)})
                                </div>
                            </div>
                        `;
                    } else if (modoSwitch === 'SOMBRA') {
                        badgeSaldo += `
                            <div style="margin-top: 3px; background: #fffbeb; border: 1px dashed #f59e0b; border-radius: 5px; padding: 2px 6px; display: inline-block; opacity: 0.62;" title="Modo Sombra: informativo para el cliente, sin aplicación efectiva">
                                <div style="font-size: 10.5px; font-weight: 700; color: #92400e;">
                                    🌓 Sombra c/IVA: $ ${fmtMoneda(totalConFinanc)}
                                </div>
                                <div style="font-size: 9.5px; font-weight: 600; color: #b45309;">
                                    (+$ ${fmtMoneda(financConIva)} informativo)
                                </div>
                            </div>
                        `;
                    } else {
                        badgeSaldo += `<br><small style="color: #94a3b8; font-size: 0.74em; font-weight: 600;">Deudor · ⚪ Sin financiación</small>`;
                    }
                } else {
                    badgeSaldo += `<br><small style="color: #ef4444; font-size: 0.75em; font-weight: 600;">Deudor (0% interés)</small>`;
                }
            } else if (saldoNum < 0) {
                badgeSaldo += `<br><small style="color: #10b981; font-size: 0.75em; font-weight: 600;">A favor</small>`;
            }

            // Construir Switch interactivo de 3 posiciones + Indicador de Monto Financiado (Activo vs. Sombra apagadito vs. Excluido)
            let detalleFinancHtml = '';
            if (financConIva > 0) {
                if (modoSwitch === 'ACTIVO') {
                    detalleFinancHtml = `
                        <div style="display: inline-flex; flex-direction: column; align-items: center; background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 7px; padding: 3px 10px; margin-top: 5px; box-shadow: 0 1px 2px rgba(5, 150, 105, 0.12);">
                            <span style="font-size: 11.5px; font-weight: 800; color: #047857;">
                                🛡️ +$ ${fmtMoneda(financConIva)} c/IVA (Activo)
                            </span>
                            <span style="font-size: 9.5px; color: #065f46; font-weight: 600;">
                                Neto $ ${fmtMoneda(financNeta)} + IVA · Día ${maxDias} (${tasaPct}%/mes)
                            </span>
                        </div>
                    `;
                } else if (modoSwitch === 'SOMBRA') {
                    detalleFinancHtml = `
                        <div style="display: inline-flex; flex-direction: column; align-items: center; background: #fffbeb; border: 1px dashed #d97706; border-radius: 7px; padding: 3px 10px; margin-top: 5px; opacity: 0.62;" title="En Modo Sombra: el cliente visualiza cómo opera la financiación de manera educativa sin aplicación efectiva">
                            <span style="font-size: 11.5px; font-weight: 700; color: #92400e;">
                                🌓 +$ ${fmtMoneda(financConIva)} c/IVA (En Sombra)
                            </span>
                            <span style="font-size: 9.5px; color: #b45309; font-weight: 600;">
                                Informativo · Día ${maxDias} (Neto $ ${fmtMoneda(financNeta)} + IVA)
                            </span>
                        </div>
                    `;
                } else {
                    detalleFinancHtml = `
                        <div style="display: inline-flex; flex-direction: column; align-items: center; background: #f8fafc; border: 1px dotted #cbd5e1; border-radius: 7px; padding: 2px 9px; margin-top: 5px; opacity: 0.58;" title="Cliente excluido del programa de financiación">
                            <span style="font-size: 10.5px; font-weight: 700; color: #64748b;">
                                ⚪ Excluido ($ 0,00) · <s style="font-weight: 500;">$ ${fmtMoneda(financConIva)}</s>
                            </span>
                        </div>
                    `;
                }
            } else if (saldoNum > 0) {
                const opacidadVentana = modoSwitch === 'ACTIVO' ? '1' : '0.62';
                let etiquetaVentana = `🟢 En término (Día ${maxDias}/7 · $ 0,00)`;
                let bgVentana = '#f0fdf4';
                let colorVentana = '#15803d';
                let borderVentana = '#bbf7d0';
                if (estadoSem === 'GRACIA_3D') {
                    etiquetaVentana = `⏳ +3d Gracia (Día ${maxDias}/10 · $ 0,00)`;
                    bgVentana = '#eff6ff';
                    colorVentana = '#1d4ed8';
                    borderVentana = '#bfdbfe';
                } else if (estadoSem === 'COMODIN_TRIMESTRAL') {
                    etiquetaVentana = `🎟️ Comodín (Día ${maxDias}/14 · $ 0,00)`;
                    bgVentana = '#fffbeb';
                    colorVentana = '#b45309';
                    borderVentana = '#fde68a';
                }
                detalleFinancHtml = `
                    <div style="display: inline-block; background: ${bgVentana}; color: ${colorVentana}; border: 1px ${modoSwitch === 'SOMBRA' ? 'dashed' : 'solid'} ${borderVentana}; border-radius: 6px; padding: 2px 8px; margin-top: 5px; font-size: 10px; font-weight: 700; opacity: ${opacidadVentana};">
                        ${etiquetaVentana}${modoSwitch === 'SOMBRA' ? ' · Sombra' : (modoSwitch === 'EXCLUIDO' ? ' · Apagado' : '')}
                    </div>
                `;
            } else {
                if (modoSwitch === 'ACTIVO') {
                    detalleFinancHtml = `<div style="font-size: 10px; color: #64748b; margin-top: 4px; font-weight: 500;">🛡️ Vigente · Al día ($ 0,00)</div>`;
                } else if (modoSwitch === 'SOMBRA') {
                    detalleFinancHtml = `<div style="font-size: 10px; color: #92400e; opacity: 0.62; margin-top: 4px; font-weight: 600;">🌓 Modo Sombra (Informativo)</div>`;
                } else {
                    detalleFinancHtml = `<div style="font-size: 10px; color: #94a3b8; opacity: 0.7; margin-top: 4px; font-weight: 500;">⚪ Apagado (Sin financiación)</div>`;
                }
            }

            const htmlFinanciacionCell = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <div class="financiacion-3way-switch" role="group" aria-label="Modo de Financiación de ${cliente.cliente_nombre}">
                        <button type="button" class="financiacion-3way-btn ${modoSwitch === 'EXCLUIDO' ? 'active-excluido' : ''}" data-codigo="${cliente.codigo_bunker_cliente}" data-modo="EXCLUIDO" title="Apagado / Excluido: No aplica financiación ni intereses (0%)">
                            ⚪ Apagado
                        </button>
                        <button type="button" class="financiacion-3way-btn ${modoSwitch === 'SOMBRA' ? 'active-sombra' : ''}" data-codigo="${cliente.codigo_bunker_cliente}" data-modo="SOMBRA" title="Modo Sombra: Activo de forma informativa/educativa para que el cliente comprenda el esquema, sin implementación efectiva">
                            🌓 Sombra
                        </button>
                        <button type="button" class="financiacion-3way-btn ${modoSwitch === 'ACTIVO' ? 'active-activo' : ''}" data-codigo="${cliente.codigo_bunker_cliente}" data-modo="ACTIVO" title="Financiación Activa: Implementación efectiva vigente en cuenta corriente y portal">
                            🛡️ Activo
                        </button>
                    </div>
                    ${detalleFinancHtml}
                </div>
            `;

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
                        <button type="button" class="btn-config-contactos-cliente" data-id="${cliente.id}" data-nombre="${cliente.cliente_nombre}" style="background: none; border: none; cursor: pointer; padding: 2px; font-size: 1.1em; display: inline-flex; align-items: center; justify-content: center; line-height: 1; vertical-align: middle;" title="Configurar destinatarios específicos (${numWp} WhatsApp, ${numEmail} Correo)">👥</button>
                    </div>
                `;
            }

            const wpAttr = encodeURIComponent(JSON.stringify(contactosWp));
            const mailAttr = encodeURIComponent(JSON.stringify(contactosEmail));

            // Distintivo visual para clientes con Portal B2B Activo o Nodos Barriales (Estructura en Árbol)
            const ni = cliente.nodo_info || null;
            const esNodoBarrial = Boolean(ni && ni.nodo_id);
            const estaExpandidoNodo = esNodoBarrial && nodosExpandidosIds.has(Number(cliente.id));
            if (esNodoBarrial) {
                tr.classList.add('fila-nodo-barrial');
            }

            const tieneB2B = cliente.onboarding_completado === true;
            const tieneStock = cliente.ver_stock === true;
            let codigoCellHtml = cliente.codigo_bunker_cliente;
            let htmlNombre = '';
            let htmlFinanciacionFinal = htmlFinanciacionCell;
            let badgeSaldoFinal = badgeSaldo;
            let htmlAccionesFinal = `
                <div style="display: flex; gap: 6px; justify-content: center;">
                    <button class="btn-action btn-cc" data-codigo="${cliente.codigo_bunker_cliente}" title="Ver cuenta corriente">💳</button>
                    <button class="btn-action btn-invite" data-codigo="${cliente.codigo_bunker_cliente}" data-nombre="${cliente.cliente_nombre}" data-whatsapp="${wpAttr}" data-emails="${mailAttr}" title="Invitar al Portal B2B (WhatsApp/Email)">✉️</button>
                    <button class="btn-action btn-colaborador-b2b" data-codigo="${cliente.codigo_bunker_cliente}" data-nombre="${cliente.cliente_nombre}" data-whatsapp="${wpAttr}" data-ver-stock="${cliente.ver_stock === true}" title="Habilitar Operador de Pre-Pedido B2B (Selección de Artículos)">👷</button>
                    ${tieneB2B ? `<button class="btn-action btn-impersonate" data-codigo="${cliente.codigo_bunker_cliente}" data-nombre="${cliente.cliente_nombre}" title="Acceder como Cliente (Espejo B2B)">🔑</button>` : ''}
                    <button class="btn-action btn-assign" data-id="${cliente.id}" title="Asociar Listas de Precios Bunker">🏷️</button>
                    <button class="btn-action btn-edit" data-id="${cliente.id}" title="Editar ficha de cliente">✏️</button>
                    <button class="btn-action btn-delete" data-id="${cliente.id}" title="Eliminar cliente permanentemente">🗑️</button>
                </div>
            `;

            if (esNodoBarrial) {
                const cantVecinos = Number(ni.cantidad_vecinos || 0);
                const totalSaldoVecinos = Number(ni.total_saldo_vecinos || 0);
                const efvoGestor = Number(ni.efectivo_mano_gestor || 0);
                const vecinosMatch = Number(ni.vecinos_coincidentes || 0);

                codigoCellHtml = `
                    <div style="display:flex; align-items:center; gap:7px;">
                        <button type="button" onclick="window.toggleArbolNodoBunker(${cliente.id})" title="${estaExpandidoNodo ? 'Contraer árbol del Nodo' : 'Desplegar clientes vecinos del Nodo'}"
                            style="width:24px; height:24px; border-radius:6px; border:1px solid #86efac; background:${estaExpandidoNodo ? '#16a34a' : '#dcfce7'}; color:${estaExpandidoNodo ? '#ffffff' : '#166534'}; font-size:11px; font-weight:900; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">
                            ${estaExpandidoNodo ? '▼' : '▶'}
                        </button>
                        <div>
                            <div style="font-weight:800; color:#14532d;">${escHtmlNodo(cliente.codigo_bunker_cliente)}</div>
                            <div style="font-size:10px; font-weight:700; color:#15803d;">${escHtmlNodo(ni.codigo_nodo)}</div>
                        </div>
                    </div>
                `;

                htmlNombre = `
                    <div style="display:flex; flex-direction:column; gap:5px;">
                        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <span style="font-weight:800; color:#14532d; font-size:1.01em;">🏘️ ${escHtmlNodo(ni.nombre_marca || cliente.cliente_nombre)}</span>
                            <button type="button" class="btn-toggle-nodo-tree" onclick="window.toggleArbolNodoBunker(${cliente.id})">
                                <span>${estaExpandidoNodo ? '▼' : '▶'}</span>
                                <span>🌳 Clientes del Nodo (${cantVecinos})</span>
                            </button>
                            ${vecinosMatch > 0 && ultimaBusquedaClientes ? `<span class="badge" style="background:#fef9c3; color:#854d0e; border:1px solid #fde047; font-size:10.5px; font-weight:800;">🔍 ${vecinosMatch} vecino${vecinosMatch === 1 ? '' : 's'} coincide${vecinosMatch === 1 ? '' : 'n'}</span>` : ''}
                        </div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; font-size:11px; color:#475569;">
                            <span>👤 Gestor: <strong>${escHtmlNodo(ni.gestor_nombre || '-')}</strong></span>
                            ${ni.codigo_bunker_cliente_madre ? `
                                <span class="badge" style="background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; font-size:10px; font-weight:700;" title="Cuenta personal del colaborador aislada de la operatoria diaria del Nodo">
                                    🔗 Cta. Personal aislada: ${escHtmlNodo(ni.codigo_bunker_cliente_madre)}
                                </span>
                            ` : ''}
                        </div>
                    </div>
                `;

                htmlFinanciacionFinal = `
                    <div style="display:inline-flex; flex-direction:column; align-items:center; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:5px 11px;">
                        <span style="font-size:11px; font-weight:800; color:#166534;">🔄 Liquidación por Lote Canasto</span>
                        <span style="font-size:9.5px; color:#15803d; font-weight:600;">Subcuenta Operativa Nodo (0% interés)</span>
                    </div>
                `;

                const labelEstadoNodo = saldoNum > 0.01
                    ? `<small style="color:#dc2626; font-size:0.75em; font-weight:700;">Deudor a LAMDA</small>`
                    : (saldoNum < -0.01
                        ? `<small style="color:#16a34a; font-size:0.75em; font-weight:700;">Saldo a favor del Nodo</small>`
                        : `<small style="color:#15803d; font-size:0.74em; font-weight:700;">Cta. Nodo Al Día ($ 0,00)</small>`);

                badgeSaldoFinal = `
                    <div>
                        <span style="font-weight:800; color:${colorSaldo}; font-size:1.04em;">${saldoFormateado}</span><br>
                        ${labelEstadoNodo}
                        <div style="margin-top:4px; display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
                            <span style="font-size:10.5px; font-weight:700; padding:1px 6px; border-radius:4px; background:${totalSaldoVecinos > 0.01 ? '#fffbeb' : '#f1f5f9'}; color:${totalSaldoVecinos > 0.01 ? '#b45309' : '#64748b'}; border:1px solid ${totalSaldoVecinos > 0.01 ? '#fde68a' : '#e2e8f0'};">
                                👥 Vecinos s/cobrar: $ ${fmtMoneda(totalSaldoVecinos)}
                            </span>
                            ${efvoGestor > 0.01 ? `
                                <span style="font-size:10.5px; font-weight:700; padding:1px 6px; border-radius:4px; background:#ecfeff; color:#0e7490; border:1px solid #a5f3fc;">
                                    💵 Efvo. en Gestor: $ ${fmtMoneda(efvoGestor)}
                                </span>
                            ` : ''}
                        </div>
                    </div>
                `;

                htmlAccionesFinal = `
                    <div style="display:flex; gap:5px; justify-content:center; flex-wrap:wrap;">
                        <button type="button" class="btn-action" onclick="window.toggleArbolNodoBunker(${cliente.id})" style="background:#dcfce7; border:1px solid #86efac; color:#166534;" title="Desplegar / contraer Clientes Vecinos del Nodo">🌳</button>
                        <button type="button" class="btn-action" onclick="window.open('/liquidacion-nodos', '_blank')" style="background:#e0f2fe; border:1px solid #7dd3fc; color:#0369a1;" title="Abrir Tablero de Conciliación y Liquidación de Lotes del Nodo">⚖️</button>
                        <button class="btn-action btn-cc" data-codigo="${cliente.codigo_bunker_cliente}" title="Ver Cuenta Corriente Operativa del Nodo (${cliente.codigo_bunker_cliente})">💳</button>
                        <button class="btn-action btn-assign" data-id="${cliente.id}" title="Asociar Listas de Precios Bunker">🏷️</button>
                        <button class="btn-action btn-edit" data-id="${cliente.id}" title="Editar ficha de Nodo">✏️</button>
                    </div>
                `;
            } else {
                htmlNombre = tieneB2B 
                    ? `<div style="display: flex; flex-direction: column; gap: 2px;">
                         <span style="font-weight: 700; color: #1e1b4b;">${cliente.cliente_nombre}</span>
                         <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                           <span class="badge" style="background-color: #e0e7ff; color: #4338ca; border: 1px solid #c7d2fe; align-self: flex-start; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px;" title="Acceso al Portal B2B Habilitado (${cliente.email_portal})">🌐 Portal Activo</span>
                           ${tieneStock ? `<span class="badge" style="background-color: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px;" title="Visualización de Stock Habilitada">📦 Stock ON</span>` : ''}
                         </div>
                       </div>`
                    : `<span style="font-weight: 600; color: #334155;">${cliente.cliente_nombre}</span>`;
            }

            tr.innerHTML = `
                <td style="text-align: center; vertical-align: middle;">${cellSeleccion}</td>
                <td class="col-codigo" style="font-weight: 700; color: #475569;">${codigoCellHtml}</td>
                <td class="col-nombre" style="vertical-align: middle;">${htmlNombre}</td>
                <td class="col-razon" style="color: #64748b; vertical-align: middle;">${cliente.razon_social}</td>
                <td class="col-externo" style="vertical-align: middle;">${badgeExterno}</td>
                <td class="col-financiacion" style="text-align: center; vertical-align: middle;">${htmlFinanciacionFinal}</td>
                <td class="col-saldo" style="text-align: right; white-space: nowrap; vertical-align: middle;">${badgeSaldoFinal}</td>
                <td class="col-listas">${htmlListas}</td>
                <td class="col-acciones" style="text-align: center; vertical-align: middle;">
                    ${htmlAccionesFinal}
                </td>
            `;
            cuerpoTablaClientes.appendChild(tr);

            if (estaExpandidoNodo) {
                const trArbol = document.createElement('tr');
                trArbol.id = `arbol-nodo-row-${cliente.id}`;
                trArbol.className = 'fila-arbol-nodo-detalle';
                trArbol.innerHTML = `
                    <td colspan="9" style="padding: 4px 12px 12px 12px; border-bottom: 2px solid #cbd5e1;">
                        <div id="arbol-nodo-box-${cliente.id}" class="arbol-nodo-wrapper">
                            <div style="color:#64748b; font-size:13px; padding:8px;">⏳ Cargando estructura en árbol de clientes del Nodo...</div>
                        </div>
                    </td>
                `;
                cuerpoTablaClientes.appendChild(trArbol);
                cargarYRenderizarArbolNodo(cliente.id);
            }
        });

        // Sincronizar el checkbox general 'seleccionar todos'
        actualizarEstadoChkTodos();

        // Registrar eventos para los botones de la grilla
        registrarEventosGrilla();
    }

    // Registrar escuchas dinámicos de los botones EDITAR / ELIMINAR / CUENTA CORRIENTE / ASOCIAR LISTAS / SWITCH FINANCIACIÓN
    function registrarEventosGrilla() {
        // Evento Switch de 3 posiciones de Financiación (Apagado | Sombra | Activo)
        cuerpoTablaClientes.querySelectorAll('.financiacion-3way-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                const codigo = btn.getAttribute('data-codigo');
                const nuevoModo = btn.getAttribute('data-modo');
                if (!codigo || !nuevoModo) return;

                const cliente = todosLosClientes.find(c => c.codigo_bunker_cliente === codigo);
                if (!cliente) return;

                const modoAnterior = obtenerModoSwitchCliente(cliente);
                if (modoAnterior === nuevoModo) return;

                // Actualización optimista inmediata en memoria y DOM
                cliente.salvavidas_modo = nuevoModo;
                if (!cliente.salvavidas_info) cliente.salvavidas_info = {};
                cliente.salvavidas_info.salvavidas_modo_raw = nuevoModo;
                cliente.salvavidas_info.modo_switch = nuevoModo;
                if (ultimoMapaFinanciacion[codigo]) {
                    ultimoMapaFinanciacion[codigo].salvavidas_modo_raw = nuevoModo;
                    ultimoMapaFinanciacion[codigo].modo_switch = nuevoModo;
                }

                actualizarDeudaTotal();
                ordenarYRenderizar();

                try {
                    const res = await fetch(`/api/logistica/bunker/cuentas-corrientes/salvavidas/configuracion-cliente/${encodeURIComponent(codigo)}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ salvavidas_modo: nuevoModo })
                    });
                    const data = await res.json();
                    if (!res.ok || !data.success) {
                        throw new Error(data.error || 'No se pudo actualizar el modo de financiación.');
                    }

                    const etiquetasModo = {
                        ACTIVO: '🛡️ Financiación Activa (Efectiva)',
                        SOMBRA: '🌓 Modo Sombra (Informativo para el cliente)',
                        EXCLUIDO: '⚪ Modo Apagado (Excluido 0%)'
                    };

                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        icon: 'success',
                        title: `${cliente.cliente_nombre}`,
                        text: etiquetasModo[nuevoModo] || nuevoModo,
                        showConfirmButton: false,
                        timer: 2000
                    });
                } catch (err) {
                    console.error('Error al cambiar modo de financiación:', err);
                    // Revertir en caso de error
                    cliente.salvavidas_modo = modoAnterior;
                    if (cliente.salvavidas_info) cliente.salvavidas_info.modo_switch = modoAnterior;
                    if (ultimoMapaFinanciacion[codigo]) ultimoMapaFinanciacion[codigo].modo_switch = modoAnterior;
                    actualizarDeudaTotal();
                    ordenarYRenderizar();

                    Swal.fire({
                        icon: 'error',
                        title: 'Error al cambiar estado',
                        text: err.message || 'No se pudo guardar el cambio en el servidor.',
                        confirmButtonColor: '#ef4444'
                    });
                }
            });
        });
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
                             text = text.replace(/\[Enlace_Al_Portal\]/g, 'https://proud-darkness-ac3d.miserrano75.workers.dev/?t=31f315');
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

        // Evento Habilitar Operador de Pre-Pedido B2B (Selección de Artículos y Envío para Aprobación)
        cuerpoTablaClientes.querySelectorAll('.btn-colaborador-b2b').forEach(btn => {
            btn.addEventListener('click', async () => {
                const codigo = btn.getAttribute('data-codigo');
                const nombreComercio = btn.getAttribute('data-nombre');
                const defaultVerStock = btn.getAttribute('data-ver-stock') === 'true';

                let wpContacts = [];
                try {
                    wpContacts = JSON.parse(decodeURIComponent(btn.getAttribute('data-whatsapp') || '[]'));
                } catch (err) {
                    console.error('Error parseando contactos WhatsApp para operador:', err);
                }

                if (wpContacts.length === 0) {
                    Swal.fire({
                        title: 'Sin Contactos Telefónicos',
                        text: 'Este cliente no tiene contactos de WhatsApp cargados en su ficha. Edite la ficha del cliente y cargue los contactos antes de habilitar un operador.',
                        icon: 'warning',
                        confirmButtonColor: 'var(--purple-primary)'
                    });
                    return;
                }

                // Preseleccionar inteligentemente quién suele ser el titular/aprobador vs el empleado/operador
                const esCargoTitular = (cargo) => /dueñ|titular|encargad|gerent|admin|jefe|jefa/i.test(String(cargo || ''));
                let idxAprobadorDefault = wpContacts.findIndex(c => esCargoTitular(c.cargo));
                if (idxAprobadorDefault === -1) idxAprobadorDefault = 0;

                let idxOperadorDefault = wpContacts.findIndex((c, idx) => idx !== idxAprobadorDefault && !esCargoTitular(c.cargo));
                if (idxOperadorDefault === -1) {
                    idxOperadorDefault = wpContacts.findIndex((c, idx) => idx !== idxAprobadorDefault);
                }
                if (idxOperadorDefault === -1) idxOperadorDefault = 0;

                const modalHtml = `
                    <div style="text-align: left; font-family: 'Outfit', sans-serif; font-size: 14px; color: #334155;">
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; font-size: 12.5px; color: #475569; line-height: 1.45;">
                            <strong>🔒 Acceso de Pre-Armado con Dispositivo Vinculado:</strong> El operador accede únicamente al catálogo de artículos sin iniciar sesión (validando por única vez los últimos 4 dígitos de su celular) y envía su selección por WhatsApp al responsable de aprobación para que la edite o confirme.
                        </div>

                        <label style="display: block; font-weight: 700; color: #1e293b; margin-bottom: 5px;">
                            1. Contacto Operador (Quien selecciona los artículos):
                        </label>
                        <select id="select-operador-b2b" style="width: 100%; height: 38px; border: 1px solid #cbd5e1; border-radius: 7px; padding: 0 10px; font-size: 13.5px; margin-bottom: 12px; background: #fff; color: #0f172a;">
                            ${wpContacts.map((c, idx) => `
                                <option value="${idx}" ${idx === idxOperadorDefault ? 'selected' : ''}>
                                    📱 ${c.nombre || 'Contacto'}${c.cargo ? ` (${c.cargo})` : ''} — ${c.numero}
                                </option>
                            `).join('')}
                        </select>

                        <label style="display: block; font-weight: 700; color: #1e293b; margin-bottom: 5px;">
                            2. Responsable de Aprobación (Quien recibe y confirma el pedido):
                        </label>
                        <select id="select-aprobador-b2b" style="width: 100%; height: 38px; border: 1px solid #cbd5e1; border-radius: 7px; padding: 0 10px; font-size: 13.5px; margin-bottom: 14px; background: #fff; color: #0f172a;">
                            ${wpContacts.map((c, idx) => `
                                <option value="${idx}" ${idx === idxAprobadorDefault ? 'selected' : ''}>
                                    ✅ ${c.nombre || 'Contacto'}${c.cargo ? ` (${c.cargo})` : ''} — ${c.numero}
                                </option>
                            `).join('')}
                        </select>

                        <label style="display: block; font-weight: 700; color: #1e293b; margin-bottom: 6px;">
                            3. Permisos de Catálogo para el Operador:
                        </label>
                        <div style="display: flex; flex-direction: column; gap: 7px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin-bottom: 14px;">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px;">
                                <input type="checkbox" id="chk-colab-precios" checked style="accent-color: var(--purple-primary); width: 15px; height: 15px;">
                                <span>Mostrar precios de lista, ofertas activas y bonificación por volumen</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px;">
                                <input type="checkbox" id="chk-colab-toggle-iva" checked style="accent-color: var(--purple-primary); width: 15px; height: 15px;">
                                <span>Permitir alternar modalidad de precios (Con IVA / Sin IVA)</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px;">
                                <input type="checkbox" id="chk-colab-stock" ${defaultVerStock ? 'checked' : ''} style="accent-color: var(--purple-primary); width: 15px; height: 15px;">
                                <span>Mostrar semáforo de disponibilidad de stock</span>
                            </label>
                        </div>

                        <label style="display: block; font-weight: 700; color: #1e293b; margin-bottom: 5px;">
                            4. Mensaje de WhatsApp para el Operador:
                        </label>
                        <textarea id="txt-mensaje-colab-b2b" style="width: 100%; height: 95px; box-sizing: border-box; font-family: sans-serif; font-size: 12.5px; line-height: 1.4; border: 1px solid #cbd5e1; border-radius: 7px; padding: 8px; resize: vertical;"></textarea>
                        <small style="color: #64748b; font-size: 11px; display: block; margin-top: 3px; margin-bottom: 12px;">
                            * Los marcadores <strong>[Enlace_PrePedido]</strong> y <strong>[Ultimos_4_Digitos]</strong> se completan automáticamente al generar.
                        </small>

                        <div id="box-delegaciones-activas" style="border-top: 1px solid #e2e8f0; padding-top: 10px; margin-top: 6px;">
                            <div style="font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 6px;">
                                🔗 Enlaces de Operador Activos en este Comercio:
                            </div>
                            <div id="lista-delegaciones-activas" style="font-size: 12px; color: #94a3b8;">
                                Consultando enlaces activos...
                            </div>
                        </div>
                    </div>
                `;

                const result = await Swal.fire({
                    title: `<span style="color: var(--purple-primary); font-weight: 700; font-family: 'Outfit'; font-size: 1.25rem;">👷 Habilitar Operador de Pre-Pedido</span>`,
                    html: modalHtml,
                    width: '560px',
                    showCancelButton: true,
                    confirmButtonColor: 'var(--purple-primary)',
                    cancelButtonColor: '#64748b',
                    confirmButtonText: '🚀 Generar y Enviar por WhatsApp',
                    cancelButtonText: 'Cerrar',
                    didOpen: () => {
                        const selOp = document.getElementById('select-operador-b2b');
                        const selAp = document.getElementById('select-aprobador-b2b');
                        const txtMsg = document.getElementById('txt-mensaje-colab-b2b');
                        const listContainer = document.getElementById('lista-delegaciones-activas');

                        const actualizarMensajeTemplate = () => {
                            const op = wpContacts[parseInt(selOp.value, 10)] || {};
                            const ap = wpContacts[parseInt(selAp.value, 10)] || {};
                            const opNombre = op.nombre || 'Operador';
                            const apNombre = ap.nombre || 'Administración';
                            txtMsg.value = `Hola ${opNombre}, te habilitamos el acceso al catálogo de artículos de LAMDA para que puedas pre-armar pedidos de mercadería de *${nombreComercio}* y enviárselos a ${apNombre} para su aprobación.\n\n🔒 La primera vez que ingreses desde tu celular, validá los últimos 4 dígitos de tu número ([Ultimos_4_Digitos]) para dejar vinculado tu teléfono:\n[Enlace_PrePedido]`;
                        };

                        actualizarMensajeTemplate();
                        selOp.addEventListener('change', actualizarMensajeTemplate);
                        selAp.addEventListener('change', actualizarMensajeTemplate);

                        const cargarDelegacionesExistentes = async () => {
                            try {
                                const r = await fetch(`/api/logistica/b2b-onboarding/delegaciones/${encodeURIComponent(codigo)}`);
                                const j = await r.json();
                                if (!r.ok || !j.success || !Array.isArray(j.data) || j.data.length === 0) {
                                    listContainer.innerHTML = `<span style="color:#94a3b8; font-style:italic;">No hay operadores habilitados actualmente para este cliente.</span>`;
                                    return;
                                }
                                listContainer.innerHTML = j.data.map(d => `
                                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; background:#fff; border:1px solid #cbd5e1; border-radius:7px; padding:6px 9px; margin-bottom:5px;">
                                        <div style="flex:1; min-width:0;">
                                            <div style="font-weight:700; color:#1e293b; font-size:12.5px;">
                                                👤 ${d.nombre_colaborador} ${d.telefono_colaborador ? `<span style="color:#64748b; font-weight:400;">(${d.telefono_colaborador})</span>` : ''}
                                            </div>
                                            <div style="font-size:11px; color:${d.dispositivo_vinculado ? '#15803d' : '#d97706'}; font-weight:600;">
                                                ${d.dispositivo_vinculado ? '🔒 Teléfono vinculado' : '⏳ Pendiente de primera apertura'}
                                                ${d.aprobador_nombre ? ` • Aprueba: ${d.aprobador_nombre}` : ''}
                                            </div>
                                        </div>
                                        <div style="display:flex; gap:4px;">
                                            <button type="button" class="btn-copy-del" data-link="${d.link}" title="Copiar enlace" style="border:1px solid #cbd5e1; background:#f8fafc; border-radius:5px; padding:3px 7px; cursor:pointer; font-size:11.5px;">📋</button>
                                            ${d.dispositivo_vinculado ? `<button type="button" class="btn-unbind-del" data-id="${d.id}" title="Liberar teléfono vinculado (si cambió de celular)" style="border:1px solid #fed7aa; background:#fff7ed; border-radius:5px; padding:3px 7px; cursor:pointer; font-size:11.5px;">🔓</button>` : ''}
                                            <button type="button" class="btn-revoke-del" data-id="${d.id}" title="Revocar acceso" style="border:1px solid #fecaca; background:#fef2f2; border-radius:5px; padding:3px 7px; cursor:pointer; font-size:11.5px;">🗑️</button>
                                        </div>
                                    </div>
                                `).join('');

                                listContainer.querySelectorAll('.btn-copy-del').forEach(b => {
                                    b.addEventListener('click', () => {
                                        navigator.clipboard.writeText(b.getAttribute('data-link'));
                                        b.textContent = '✅';
                                        setTimeout(() => { b.textContent = '📋'; }, 1500);
                                    });
                                });

                                listContainer.querySelectorAll('.btn-unbind-del').forEach(b => {
                                    b.addEventListener('click', async () => {
                                        const delId = b.getAttribute('data-id');
                                        await fetch(`/api/logistica/b2b-onboarding/delegaciones/${delId}/desvincular-dispositivo`, { method: 'POST' });
                                        cargarDelegacionesExistentes();
                                    });
                                });

                                listContainer.querySelectorAll('.btn-revoke-del').forEach(b => {
                                    b.addEventListener('click', async () => {
                                        const delId = b.getAttribute('data-id');
                                        await fetch(`/api/logistica/b2b-onboarding/delegaciones/${delId}`, { method: 'DELETE' });
                                        cargarDelegacionesExistentes();
                                    });
                                });
                            } catch (e) {
                                listContainer.innerHTML = `<span style="color:#ef4444;">No se pudieron consultar los enlaces activos.</span>`;
                            }
                        };

                        cargarDelegacionesExistentes();
                    },
                    preConfirm: () => {
                        const selOpIdx = parseInt(document.getElementById('select-operador-b2b').value, 10);
                        const selApIdx = parseInt(document.getElementById('select-aprobador-b2b').value, 10);
                        const op = wpContacts[selOpIdx];
                        const ap = wpContacts[selApIdx];

                        if (!op || !op.numero) {
                            Swal.showValidationMessage('Debe seleccionar un contacto operador con número de teléfono.');
                            return false;
                        }

                        return {
                            nombre_colaborador: op.nombre || 'Operador',
                            telefono_colaborador: op.numero,
                            aprobador_nombre: ap ? (ap.nombre || 'Administración') : 'Administración',
                            aprobador_telefono: ap ? ap.numero : '',
                            mostrar_precios: document.getElementById('chk-colab-precios').checked,
                            permitir_toggle_iva: document.getElementById('chk-colab-toggle-iva').checked,
                            ver_stock: document.getElementById('chk-colab-stock').checked,
                            mensaje_texto: document.getElementById('txt-mensaje-colab-b2b').value
                        };
                    }
                });

                if (!result.isConfirmed) return;

                Swal.fire({
                    title: 'Habilitando Operador...',
                    html: 'Sincronizando listas de precios y generando enlace protegido...',
                    allowOutsideClick: false,
                    didOpen: () => Swal.showLoading()
                });

                try {
                    const response = await fetch('/api/logistica/b2b-onboarding/habilitar-colaborador', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            cliente_id: codigo,
                            ...result.value,
                            mostrar_sin_iva: true,
                            enviar_whatsapp: true
                        })
                    });

                    const resData = await response.json();
                    if (!response.ok || !resData.success) {
                        throw new Error(resData.message || 'No se pudo habilitar el operador.');
                    }

                    const linkGenerado = resData.data?.link || '';
                    const waMeUrl = resData.data?.waMeUrl || '';

                    await Swal.fire({
                        title: resData.whatsappEnviado ? '¡Operador Habilitado y Notificado!' : '¡Enlace de Operador Generado!',
                        html: `
                            <div style="text-align:left; font-size:13.5px; color:#334155; line-height:1.5;">
                                <p style="margin:0 0 10px 0;">
                                    ${resData.whatsappEnviado
                                        ? `Se envió el enlace por WhatsApp a <strong>${result.value.nombre_colaborador}</strong> (${result.value.telefono_colaborador}).`
                                        : `El enlace fue creado con éxito. Podés copiarlo o abrir WhatsApp directamente desde acá:`}
                                </p>
                                <div style="background:#f1f5f9; border:1px solid #cbd5e1; border-radius:8px; padding:8px 10px; font-family:monospace; font-size:12px; word-break:break-all; margin-bottom:12px;">
                                    ${linkGenerado}
                                </div>
                                <div style="display:flex; gap:8px;">
                                    <button type="button" id="btn-swal-copy-colab" style="flex:1; background:#334155; color:#fff; border:none; border-radius:7px; padding:8px 10px; font-weight:700; cursor:pointer; font-size:12.5px;">
                                        📋 Copiar Enlace
                                    </button>
                                    <a href="${waMeUrl}" target="_blank" rel="noopener noreferrer" style="flex:1; background:#16a34a; color:#fff; text-decoration:none; border-radius:7px; padding:8px 10px; font-weight:700; text-align:center; font-size:12.5px;">
                                        📲 Abrir WhatsApp
                                    </a>
                                </div>
                            </div>
                        `,
                        icon: 'success',
                        confirmButtonColor: 'var(--purple-primary)',
                        confirmButtonText: 'Listo',
                        didOpen: () => {
                            const btnCopy = document.getElementById('btn-swal-copy-colab');
                            if (btnCopy) {
                                btnCopy.addEventListener('click', () => {
                                    navigator.clipboard.writeText(linkGenerado);
                                    btnCopy.textContent = '✅ ¡Enlace Copiado!';
                                });
                            }
                        }
                    });
                } catch (err) {
                    console.error('Error habilitando operador:', err);
                    Swal.fire({
                        title: 'Error',
                        text: err.message || 'Ocurrió un error al generar el acceso del operador.',
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

    // Filtro Programa de Financiación dropdown y tarjetas KPI interactivas
    const filtroFinanciacionSelect = document.getElementById('filtro-financiacion-modo');
    if (filtroFinanciacionSelect) {
        filtroFinanciacionSelect.addEventListener('change', () => {
            ordenarYRenderizar();
        });
    }

    const toggleFiltroKpiFinanc = (modoTarget) => {
        if (!filtroFinanciacionSelect) return;
        filtroFinanciacionSelect.value = (filtroFinanciacionSelect.value === modoTarget) ? 'todos' : modoTarget;
        ordenarYRenderizar();
    };

    const kpiCardActiva = document.getElementById('kpi-card-financ-activa');
    const kpiCardSombra = document.getElementById('kpi-card-financ-sombra');
    const kpiCardExcluido = document.getElementById('kpi-card-financ-excluido');

    if (kpiCardActiva) kpiCardActiva.addEventListener('click', () => toggleFiltroKpiFinanc('ACTIVO'));
    if (kpiCardSombra) kpiCardSombra.addEventListener('click', () => toggleFiltroKpiFinanc('SOMBRA'));
    if (kpiCardExcluido) kpiCardExcluido.addEventListener('click', () => toggleFiltroKpiFinanc('EXCLUIDO'));

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
            if (chkVerStock) chkVerStock.checked = false;

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

                if (datos.advertencia_fiscal) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Datos Recuperados con Advertencia',
                        html: `
                            <p style="font-size: 14px; color: #1e293b; margin-bottom: 10px;">
                                <strong>${datos.razon_social || 'Contribuyente'}</strong> (${datos.condicion_iva})
                            </p>
                            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 10px; border-radius: 4px; text-align: left; font-size: 12px; color: #92400e;">
                                ⚠️ ${datos.advertencia_fiscal}
                            </div>
                        `,
                        confirmButtonColor: '#6b21a8'
                    });
                } else {
                    Swal.fire({
                        icon: 'success',
                        title: 'Datos Recuperados',
                        text: 'Se han autocompletado los datos fiscales correctamente.',
                        timer: 2000,
                        showConfirmButton: false
                    });
                }

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
        if (selPreferenciaFacturacion) selPreferenciaFacturacion.value = 'PREGUNTAR';
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
        domiciliosMemoria = [];
        domiciliosClienteActual = [];
        renderizarListaDomicilios();
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
        if (selPreferenciaFacturacion) selPreferenciaFacturacion.value = cliente.preferencia_facturacion || 'PREGUNTAR';
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
        if (chkVerStock) chkVerStock.checked = cliente.ver_stock === true;

        // Cargar domicilios de entrega del cliente
        domiciliosMemoria = [];
        cargarDomiciliosDeCliente(cliente.id);

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

        // Forzar actualización inmediata de strings JSON de contactos desde la interfaz
        actualizarHiddenWhatsapp();
        actualizarHiddenEmail();

        // Validar si existen contactos de correo con nombre/cargo pero sin dirección cargada
        if (emailInputsContainer) {
            const emailCards = Array.from(emailInputsContainer.querySelectorAll('.email-contact-card'));
            for (const card of emailCards) {
                const name = card.querySelector('.email-contact-name')?.value.trim() || '';
                const role = card.querySelector('.email-contact-role')?.value.trim() || '';
                const email = card.querySelector('.email-contact-address')?.value.trim() || '';
                if ((name || role) && !email) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Correo Electrónico Faltante',
                        text: `Ha ingresado el contacto "${name || role}" pero dejó vacía su dirección de correo electrónico. Por favor complete el correo antes de guardar.`,
                        confirmButtonColor: '#6b21a8'
                    });
                    return;
                }
            }
        }

        // Validaciones manuales básicas
        const id = txtId.value;
        const codigo = txtCodigo.value.trim();
        const nombre = txtNombre.value.trim();
        const razon = txtRazon.value.trim();
        const lomasId = txtLomasId.value.trim();
        const cuit = txtCuit.value.trim();
        const condicionIva = selCondicionIva.value;
        const preferenciaFacturacion = selPreferenciaFacturacion ? selPreferenciaFacturacion.value : 'PREGUNTAR';
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
        const verStock = chkVerStock ? chkVerStock.checked : false;

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
            preferencia_facturacion: preferenciaFacturacion,
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
            email_portal_cargo: emailPortalCargo || null,
            ver_stock: verStock,
            domicilios: !esEdicion ? domiciliosMemoria : undefined
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

            // Si proviene de la conversión de un prospecto de CRM, marcarlo formalmente como CONVERTIDO
            if (prospectoConversionId && data.data && data.data.id) {
                try {
                    await fetch(`/api/logistica/prospectos/${prospectoConversionId}/convertir`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ bunker_cliente_id: data.data.id })
                    });
                    console.log(`[PROSPECTO] Prospecto #${prospectoConversionId} convertido formalmente a Cliente #${data.data.id}`);
                    prospectoConversionId = null;
                } catch (convErr) {
                    console.error('[PROSPECTO] Error registrando conversión:', convErr);
                }
            }

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
                    wps = obtenerContactosDeCliente(cliente).filter(c => c.default_resumen).map(c => c.numero);
                    emails = obtenerEmailsDeCliente(cliente).filter(e => e.default_factura).map(e => e.email);
                    
                    const rawWpStr = (cliente.whatsapp_facturas || '').trim();
                    const rawEmailStr = (cliente.email_facturas || '').trim();
                    let hasWpConfig = false;
                    let hasEmailConfig = false;
                    
                    if (rawWpStr.startsWith('[')) {
                        try {
                            const parsed = JSON.parse(rawWpStr);
                            hasWpConfig = Array.isArray(parsed) && parsed.some(c => c.default_resumen !== undefined);
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

    // --- LÓGICA DE GESTIÓN MULTIDOMICILIO Y PREDETERMINADOS ---
    let domiciliosMemoria = [];
    let domiciliosClienteActual = [];
    let mapaModalInstance = null;

    const domiciliosListaContainer = document.getElementById('domicilios-lista-container');
    const btnAddDomicilio = document.getElementById('btn-add-domicilio');
    const modalDomicilioOverlay = document.getElementById('modal-domicilio-overlay');
    const modalDomicilio = document.getElementById('modal-domicilio');
    const modalDomicilioTitulo = document.getElementById('modal-domicilio-titulo');
    const btnCerrarModalDomicilio = document.getElementById('btn-cerrar-modal-domicilio');
    const btnCancelarModalDomicilio = document.getElementById('btn-cancelar-modal-domicilio');
    const btnGuardarModalDomicilio = document.getElementById('btn-guardar-modal-domicilio');
    const formDomicilio = document.getElementById('form-domicilio');

    const txtDomId = document.getElementById('domicilio-id');
    const txtDomIndex = document.getElementById('domicilio-index');
    const txtDomAlias = document.getElementById('txt-dom-alias');
    const txtDomDireccion = document.getElementById('txt-dom-direccion');
    const txtDomLocalidad = document.getElementById('txt-dom-localidad');
    const txtDomProvincia = document.getElementById('txt-dom-provincia');
    const txtDomTelefono = document.getElementById('txt-dom-telefono');
    const txtDomCp = document.getElementById('txt-dom-cp');
    const txtDomHorarioDesde = document.getElementById('txt-dom-horario-desde');
    const txtDomHorarioHasta = document.getElementById('txt-dom-horario-hasta');
    const txtDomInstrucciones = document.getElementById('txt-dom-instrucciones');
    const chkDomPredeterminado = document.getElementById('chk-dom-predeterminado');

    const txtDomLatitud = document.getElementById('txt-dom-latitud');
    const txtDomLongitud = document.getElementById('txt-dom-longitud');
    const coordenadasDisplay = document.getElementById('coordenadas-display');
    const btnGeocodificarDireccion = document.getElementById('btn-geocodificar-direccion');
    const btnToggleMaximizarDomicilio = document.getElementById('btn-toggle-maximizar-domicilio');
    const iconMaximizarDomicilio = document.getElementById('icon-maximizar-domicilio');
    const textMaximizarDomicilio = document.getElementById('text-maximizar-domicilio');

    const txtDomCalle = document.getElementById('txt-dom-calle');
    const txtDomNumero = document.getElementById('txt-dom-numero');
    const txtDomEntreCalles = document.getElementById('txt-dom-entre-calles');
    const selDomTelefonoPreexistente = document.getElementById('sel-dom-telefono-preexistente');

    function aplicarMascaraTelefono(val) {
        if (!val) return '';
        let digits = String(val).replace(/\D/g, '');
        if (!digits) return '';

        if (digits.startsWith('549')) digits = digits.substring(3);
        else if (digits.startsWith('54')) digits = digits.substring(2);

        if (digits.length <= 2) {
            return `+54 9 (${digits}`;
        } else if (digits.length <= 6) {
            return `+54 9 (${digits.substring(0, 2)}) ${digits.substring(2)}`;
        } else if (digits.length <= 10) {
            return `+54 9 (${digits.substring(0, 2)}) ${digits.substring(2, 6)}-${digits.substring(6, 10)}`;
        } else {
            return `+54 9 (${digits.substring(0, 3)}) ${digits.substring(3, 7)}-${digits.substring(7, 11)}`;
        }
    }

    function extraerNumeroLimpio(cadena) {
        if (!cadena) return '';
        const str = String(cadena).trim();
        let numBase = str;

        // 1. Si viene con formato comillas / metadatos '"Nombre" <numero>' o similar
        const matchAngle = str.match(/<([^>]+)>/);
        if (matchAngle) {
            numBase = matchAngle[1];
        } else {
            // 2. Buscar secuencia de formato telefónico (+54 9 221 476-8551, 11 4455-6677, etc.)
            const matchPhone = str.match(/(?:\+?\d{1,3}[\s\-]?)?(?:\(?\d{2,4}\)?[\s\-]?)?\d{3,4}[\s\-]?\d{3,4}/);
            if (matchPhone) {
                numBase = matchPhone[0];
            }
        }

        return aplicarMascaraTelefono(numBase);
    }

    function actualizarDireccionFormateada() {
        const calle = txtDomCalle ? txtDomCalle.value.trim() : '';
        const num = txtDomNumero ? txtDomNumero.value.trim() : '';
        const entre = txtDomEntreCalles ? txtDomEntreCalles.value.trim() : '';

        if (!calle && !num && !entre) return;

        let res = calle;
        if (num) res += (res ? ' N° ' : '') + num;
        if (entre) res += (res ? ' e/ ' : '') + entre;

        if (txtDomDireccion) txtDomDireccion.value = res;
    }

    function toggleMaximizarModalDomicilio() {
        if (!modalDomicilio) return;
        const estaMaximizado = modalDomicilio.classList.toggle('modal-maximized');

        if (iconMaximizarDomicilio) iconMaximizarDomicilio.textContent = estaMaximizado ? '🗗' : '🗖';
        if (textMaximizarDomicilio) textMaximizarDomicilio.textContent = estaMaximizado ? 'Restaurar' : 'Maximizar';
        if (btnToggleMaximizarDomicilio) {
            btnToggleMaximizarDomicilio.title = estaMaximizado ? 'Restaurar tamaño normal' : 'Maximizar a Pantalla Completa (Ver mapa expandido)';
        }

        // Notificar a Google Maps para recalcular su visor
        setTimeout(() => {
            if (mapaModalInstance && mapaModalInstance.map && window.google && window.google.maps) {
                google.maps.event.trigger(mapaModalInstance.map, 'resize');
            }
        }, 150);
    }

    async function cargarDomiciliosDeCliente(clienteId) {
        if (!domiciliosListaContainer) return;
        domiciliosListaContainer.innerHTML = '<div style="text-align: center; color: #94a3b8; font-size: 0.85em; padding: 8px;">⏳ Cargando domicilios...</div>';
        try {
            console.log(`📡 [DOMICILIOS-DEBUG] Cargar domicilios para clienteId: ${clienteId}`);
            const res = await fetch(`/api/logistica/domicilios?id_cliente=${clienteId}`);
            const data = await res.json();
            console.log('📥 [DOMICILIOS-DEBUG] GET /api/logistica/domicilios respuesta:', data);
            if (data.success) {
                domiciliosClienteActual = data.data || [];
                renderizarListaDomicilios();
            } else {
                domiciliosListaContainer.innerHTML = '<div style="text-align: center; color: #ef4444; font-size: 0.85em; padding: 8px;">Error al cargar domicilios.</div>';
            }
        } catch (err) {
            console.error('❌ Error al cargar domicilios del cliente:', err);
            domiciliosListaContainer.innerHTML = '<div style="text-align: center; color: #ef4444; font-size: 0.85em; padding: 8px;">Error de conexión.</div>';
        }
    }

    function renderizarListaDomicilios() {
        console.log('🎨 [DOMICILIOS-DEBUG] renderizarListaDomicilios ejecutándose. domiciliosClienteActual:', domiciliosClienteActual);
        if (!domiciliosListaContainer) return;

        domiciliosListaContainer.innerHTML = '';

        const esEdicionCliente = !!txtId.value;
        const lista = esEdicionCliente ? domiciliosClienteActual : domiciliosMemoria;

        if (!Array.isArray(lista) || lista.length === 0) {
            console.log('🎨 [DOMICILIOS-DEBUG] Lista vacía, mostrando mensaje de sin domicilios.');
            domiciliosListaContainer.innerHTML = `
                <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 12px; text-align: center; color: #64748b; font-size: 0.85em;">
                    📍 No hay domicilios de entrega registrados. Haga clic en <b>Agregar Domicilio</b>.
                </div>
            `;
            return;
        }

        console.log(`🎨 [DOMICILIOS-DEBUG] Dibujando ${lista.length} tarjetas de domicilio en el panel lateral...`);

        lista.forEach((dom, index) => {
            try {
                const card = document.createElement('div');
                card.style.border = dom.es_predeterminado ? '2px solid #8b5cf6' : '1px solid #cbd5e1';
                card.style.backgroundColor = dom.es_predeterminado ? '#faf5ff' : '#ffffff';
                card.style.borderRadius = '8px';
                card.style.padding = '10px 12px';
                card.style.display = 'flex';
                card.style.flexDirection = 'column';
                card.style.gap = '4px';
                card.style.position = 'relative';

                const badgePredeterminado = dom.es_predeterminado ? `
                    <button type="button" class="btn-set-predeterminado" data-index="${index}" data-id="${dom.id || ''}" style="background-color: #8b5cf6; color: white; border: none; padding: 2px 8px; border-radius: 9999px; font-size: 0.75em; font-weight: bold; cursor: pointer;" title="Quitar como predeterminada">
                        ⭐ Predeterminada
                    </button>
                ` : `
                    <button type="button" class="btn-set-predeterminado" data-index="${index}" data-id="${dom.id || ''}" style="background: none; border: 1px solid #cbd5e1; color: #64748b; padding: 2px 6px; border-radius: 4px; font-size: 0.75em; cursor: pointer;" title="Fijar como predeterminada">
                        Fijar como predeterminada
                    </button>
                `;

                const latNum = dom.latitud ? parseFloat(dom.latitud) : NaN;
                const lngNum = dom.longitud ? parseFloat(dom.longitud) : NaN;
                const tieneCoords = !isNaN(latNum) && !isNaN(lngNum);

                const badgeCoords = tieneCoords ? `
                    <span style="background-color: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; padding: 1px 6px; border-radius: 4px; font-size: 0.75em;" title="Coordenadas GPS para la App del Chofer">
                        🗺️ ${latNum.toFixed(4)}, ${lngNum.toFixed(4)}
                    </span>
                ` : '';

                let detalleUbicacion = [dom.direccion, dom.localidad, dom.provincia].filter(Boolean).join(', ');
                let detalleHorario = (dom.horario_atencion_desde || dom.horario_atencion_hasta) ? ` 🕒 ${dom.horario_atencion_desde || ''} a ${dom.horario_atencion_hasta || ''}` : '';
                let detalleTel = dom.telefono_contacto ? ` 📞 ${dom.telefono_contacto}` : '';

                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                        <div style="font-weight: 600; font-size: 0.9em; color: #1e293b; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span>📍 ${dom.alias || 'Domicilio de Entrega'}</span>
                            ${badgePredeterminado}
                            ${badgeCoords}
                        </div>
                        <div style="display: flex; gap: 4px;">
                            <button type="button" class="btn-edit-domicilio btn-action btn-edit" data-index="${index}" data-id="${dom.id || ''}" style="width: 26px; height: 26px; font-size: 12px;" title="Editar Domicilio">✏️</button>
                            <button type="button" class="btn-delete-domicilio btn-action btn-delete" data-index="${index}" data-id="${dom.id || ''}" style="width: 26px; height: 26px; font-size: 12px;" title="Eliminar Domicilio">🗑️</button>
                        </div>
                    </div>
                    <div style="font-size: 0.85em; color: #475569;">${detalleUbicacion || 'Sin dirección registrada'}</div>
                    ${(detalleTel || detalleHorario) ? `<div style="font-size: 0.8em; color: #64748b;">${detalleTel}${detalleHorario}</div>` : ''}
                    ${dom.instrucciones_entrega ? `<div style="font-size: 0.8em; color: #7c3aed; font-style: italic;">📝 ${dom.instrucciones_entrega}</div>` : ''}
                `;

                const btnSetPred = card.querySelector('.btn-set-predeterminado');
                if (btnSetPred) {
                    btnSetPred.addEventListener('click', () => cambiarPredeterminado(index, dom.id));
                }

                const btnEdit = card.querySelector('.btn-edit-domicilio');
                if (btnEdit) {
                    btnEdit.addEventListener('click', () => abrirModalDomicilio(index, dom));
                }

                const btnDelete = card.querySelector('.btn-delete-domicilio');
                if (btnDelete) {
                    btnDelete.addEventListener('click', () => eliminarDomicilio(index, dom.id));
                }

                domiciliosListaContainer.appendChild(card);
                console.log(`✅ [DOMICILIOS-DEBUG] Tarjeta ${index + 1} insertada exitosamente en el DOM.`);
            } catch (errCard) {
                console.error(`❌ [DOMICILIOS-DEBUG] Error al renderizar tarjeta ${index}:`, errCard);
            }
        });
    }

    async function asegurarGoogleMapsSDK() {
        if (window.google && window.google.maps) return true;
        try {
            const res = await fetch('/api/logistica/config');
            const data = await res.json();
            const apiKey = data?.data?.googleMapsApiKey;
            if (!apiKey) {
                console.warn('[MAPA] googleMapsApiKey no configurado en servidor');
                return false;
            }
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
            return true;
        } catch (err) {
            console.error('[MAPA] Error al cargar Google Maps SDK:', err);
            return false;
        }
    }

    async function inicializarMapaEnModal(latInicial = null, lngInicial = null) {
        const container = document.getElementById('mapa-domicilio-interactive');
        if (!container) return;

        const hasSdk = await asegurarGoogleMapsSDK();
        if (!hasSdk) {
            container.innerHTML = '<div style="display:flex; height:100%; align-items:center; justify-content:center; color:#94a3b8; font-size:12px; padding:10px; text-align:center;">🗺️ Seleccione coordenadas en el mapa (Verifique API Key de Google Maps).</div>';
            return;
        }

        const lat = latInicial || -34.9214; // La Plata por defecto
        const lng = lngInicial || -57.9545;

        try {
            if (!mapaModalInstance && window.MapaInteractivo) {
                mapaModalInstance = new window.MapaInteractivo();
            }

            if (mapaModalInstance) {
                await mapaModalInstance.inicializar('mapa-domicilio-interactive', {
                    lat,
                    lng,
                    zoom: 15
                });

                mapaModalInstance.onCoordenadasChange = (newLat, newLng) => {
                    if (txtDomLatitud) txtDomLatitud.value = newLat;
                    if (txtDomLongitud) txtDomLongitud.value = newLng;
                    if (coordenadasDisplay) {
                        coordenadasDisplay.innerHTML = `📍 <b>${newLat.toFixed(6)}, ${newLng.toFixed(6)}</b>`;
                        coordenadasDisplay.style.color = '#7c3aed';
                    }
                };

                mapaModalInstance.onDireccionChange = (dir) => {
                    if (dir.calle && txtDomDireccion && !txtDomDireccion.value) {
                        txtDomDireccion.value = dir.calle + (dir.numero ? ' ' + dir.numero : '');
                    }
                    if (dir.localidad && txtDomLocalidad && !txtDomLocalidad.value) {
                        txtDomLocalidad.value = dir.localidad;
                    }
                    if (dir.provincia && txtDomProvincia && !txtDomProvincia.value) {
                        txtDomProvincia.value = dir.provincia;
                    }
                };

                if (latInicial && lngInicial) {
                    mapaModalInstance.posicionarMarcador(latInicial, lngInicial);
                }
            }
        } catch (err) {
            console.error('[MAPA] Error al inicializar mapa en modal:', err);
        }
    }

    async function geocodificarDireccionEnMapa() {
        const dir = txtDomDireccion ? txtDomDireccion.value.trim() : '';
        const loc = txtDomLocalidad ? txtDomLocalidad.value.trim() : '';
        const prov = txtDomProvincia ? txtDomProvincia.value.trim() : '';

        const direccionCompleta = [dir, loc, prov].filter(Boolean).join(', ');
        if (!direccionCompleta) {
            Swal.fire({
                icon: 'warning',
                title: 'Dirección requerida',
                text: 'Por favor ingrese la calle y número para ubicar en el mapa.',
                confirmButtonColor: '#6b21a8'
            });
            return;
        }

        if (mapaModalInstance) {
            try {
                const coords = await mapaModalInstance.geocode(direccionCompleta);
                if (coords) {
                    if (txtDomLatitud) txtDomLatitud.value = coords.lat;
                    if (txtDomLongitud) txtDomLongitud.value = coords.lng;
                    if (coordenadasDisplay) {
                        coordenadasDisplay.innerHTML = `📍 <b>${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}</b>`;
                        coordenadasDisplay.style.color = '#7c3aed';
                    }
                } else {
                    Swal.fire({
                        icon: 'info',
                        title: 'Búsqueda en Mapa',
                        text: 'Puede hacer clic directamente en el mapa o mover el pin marcador para fijar la ubicación exacta de entrega.',
                        confirmButtonColor: '#6b21a8'
                    });
                }
            } catch (err) {
                console.warn('[MAPA-LOGISTICA] Geocodificación:', err);
            }
        }
    }

    function abrirModalDomicilio(index = null, domicilio = null) {
        if (!formDomicilio || !modalDomicilio) return;
        formDomicilio.reset();
        txtDomId.value = '';
        txtDomIndex.value = '';
        if (txtDomLatitud) txtDomLatitud.value = '';
        if (txtDomLongitud) txtDomLongitud.value = '';
        if (txtDomCalle) txtDomCalle.value = '';
        if (txtDomNumero) txtDomNumero.value = '';
        if (txtDomEntreCalles) txtDomEntreCalles.value = '';

        // Cargar teléfonos del cliente en el selector preexistente (limpios de metadatos)
        if (selDomTelefonoPreexistente) {
            selDomTelefonoPreexistente.innerHTML = '<option value="">📋 Usar teléfono registrado del cliente...</option>';
            const tels = new Set();
            
            if (txtWhatsappFacturas && txtWhatsappFacturas.value.trim()) {
                const tLimpio = extraerNumeroLimpio(txtWhatsappFacturas.value);
                if (tLimpio) tels.add(tLimpio);
            }

            const containerWhatsapp = document.getElementById('container-whatsapp-facturas');
            if (containerWhatsapp) {
                const inputs = containerWhatsapp.querySelectorAll('input');
                inputs.forEach(inp => {
                    const tLimpio = extraerNumeroLimpio(inp.value);
                    if (tLimpio) tels.add(tLimpio);
                });
            }

            tels.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = `📞 ${t}`;
                selDomTelefonoPreexistente.appendChild(opt);
            });
        }

        const esEdicionCliente = !!txtId.value;
        const listaActual = esEdicionCliente ? domiciliosClienteActual : domiciliosMemoria;

        let initialLat = null;
        let initialLng = null;

        if (domicilio) {
            modalDomicilioTitulo.textContent = '✏️ Editar Domicilio de Entrega';
            txtDomId.value = domicilio.id || '';
            txtDomIndex.value = index !== null ? index : '';
            txtDomAlias.value = domicilio.alias || '';
            txtDomDireccion.value = domicilio.direccion || '';
            txtDomLocalidad.value = domicilio.localidad || '';
            txtDomProvincia.value = domicilio.provincia || '';
            txtDomTelefono.value = domicilio.telefono_contacto || '';
            txtDomCp.value = domicilio.codigo_postal || '';
            txtDomHorarioDesde.value = domicilio.horario_atencion_desde || '';
            txtDomHorarioHasta.value = domicilio.horario_atencion_hasta || '';
            txtDomInstrucciones.value = domicilio.instrucciones_entrega || '';
            chkDomPredeterminado.checked = !!domicilio.es_predeterminado;

            if (domicilio.latitud && domicilio.longitud) {
                initialLat = parseFloat(domicilio.latitud);
                initialLng = parseFloat(domicilio.longitud);
                if (txtDomLatitud) txtDomLatitud.value = initialLat;
                if (txtDomLongitud) txtDomLongitud.value = initialLng;
                if (coordenadasDisplay) {
                    coordenadasDisplay.innerHTML = `📍 <b>${initialLat.toFixed(6)}, ${initialLng.toFixed(6)}</b>`;
                    coordenadasDisplay.style.color = '#7c3aed';
                }
            } else {
                if (coordenadasDisplay) {
                    coordenadasDisplay.innerHTML = '📍 Sin coordenadas';
                    coordenadasDisplay.style.color = '#64748b';
                }
            }
        } else {
            modalDomicilioTitulo.textContent = '📍 Agregar Domicilio de Entrega';
            chkDomPredeterminado.checked = (listaActual.length === 0);
            if (coordenadasDisplay) {
                coordenadasDisplay.innerHTML = '📍 Sin coordenadas';
                coordenadasDisplay.style.color = '#64748b';
            }
        }

        if (modalDomicilioOverlay) modalDomicilioOverlay.style.display = 'block';
        modalDomicilio.style.display = 'flex';

        // Inicializar o refrescar el mapa interactivo una vez visible el modal
        setTimeout(() => {
            inicializarMapaEnModal(initialLat, initialLng);
        }, 100);
    }

    function cerrarModalDomicilio() {
        if (modalDomicilioOverlay) modalDomicilioOverlay.style.display = 'none';
        if (modalDomicilio) {
            modalDomicilio.style.display = 'none';
            modalDomicilio.classList.remove('modal-maximized');
        }
        if (iconMaximizarDomicilio) iconMaximizarDomicilio.textContent = '🗖';
        if (textMaximizarDomicilio) textMaximizarDomicilio.textContent = 'Maximizar';
        if (btnToggleMaximizarDomicilio) {
            btnToggleMaximizarDomicilio.title = 'Maximizar a Pantalla Completa (Ver mapa expandido)';
        }
        if (formDomicilio) formDomicilio.reset();
    }

    async function guardarModalDomicilio() {
        console.log('🚀 [DOMICILIOS-DEBUG] guardarModalDomicilio INICIADO');
        try {
            // Forzar consolidación preventiva de subcampos (Calle, N°, Entre calles)
            actualizarDireccionFormateada();

            let alias = txtDomAlias ? txtDomAlias.value.trim() : '';
            let direccion = txtDomDireccion ? txtDomDireccion.value.trim() : '';

            console.log('🔍 [DOMICILIOS-DEBUG] Valores antes de validación:', { 
                alias, 
                direccion, 
                calle: txtDomCalle ? txtDomCalle.value : null, 
                numero: txtDomNumero ? txtDomNumero.value : null 
            });

            // Fallback directo si txtDomDireccion estaba vacío pero se tipeó Calle
            if (!direccion && txtDomCalle && txtDomCalle.value.trim()) {
                const calleVal = txtDomCalle.value.trim();
                const numVal = txtDomNumero ? txtDomNumero.value.trim() : '';
                const entreVal = txtDomEntreCalles ? txtDomEntreCalles.value.trim() : '';
                direccion = calleVal + (numVal ? ' N° ' + numVal : '') + (entreVal ? ' e/ ' + entreVal : '');
                if (txtDomDireccion) txtDomDireccion.value = direccion;
            }

            if (!direccion) {
                console.warn('⚠️ [DOMICILIOS-DEBUG] Proceso detenido: dirección evaluada como vacía');
                Swal.fire({
                    icon: 'warning',
                    title: 'Dirección requerida',
                    text: 'Por favor ingrese la Dirección de entrega (Calle y N°).',
                    confirmButtonColor: '#6b21a8'
                });
                return;
            }

            if (!alias) {
                alias = 'Domicilio de Entrega';
                if (txtDomAlias) txtDomAlias.value = alias;
            }

            const datosDom = {
                alias,
                direccion,
                localidad: (txtDomLocalidad && txtDomLocalidad.value.trim()) ? txtDomLocalidad.value.trim() : null,
                provincia: (txtDomProvincia && txtDomProvincia.value.trim()) ? txtDomProvincia.value.trim() : null,
                codigo_postal: (txtDomCp && txtDomCp.value.trim()) ? txtDomCp.value.trim() : null,
                telefono_contacto: (txtDomTelefono && txtDomTelefono.value.trim()) ? txtDomTelefono.value.trim() : null,
                horario_atencion_desde: (txtDomHorarioDesde && txtDomHorarioDesde.value) ? txtDomHorarioDesde.value : null,
                horario_atencion_hasta: (txtDomHorarioHasta && txtDomHorarioHasta.value) ? txtDomHorarioHasta.value : null,
                instrucciones_entrega: (txtDomInstrucciones && txtDomInstrucciones.value.trim()) ? txtDomInstrucciones.value.trim() : null,
                latitud: (txtDomLatitud && txtDomLatitud.value) ? parseFloat(txtDomLatitud.value) : null,
                longitud: (txtDomLongitud && txtDomLongitud.value) ? parseFloat(txtDomLongitud.value) : null,
                coordenadas_validadas: !!(txtDomLatitud && txtDomLatitud.value && txtDomLongitud && txtDomLongitud.value),
                es_predeterminado: chkDomPredeterminado ? chkDomPredeterminado.checked : false
            };

            const esEdicionCliente = !!(txtId && txtId.value);
            const domId = txtDomId ? txtDomId.value : '';
            const indexStr = txtDomIndex ? txtDomIndex.value : '';

            console.log('📡 [DOMICILIOS-DEBUG] Payload preparado:', { datosDom, esEdicionCliente, clienteId: txtId ? txtId.value : null, domId });

            if (esEdicionCliente) {
                let res;
                if (domId) {
                    console.log(`📡 [DOMICILIOS-DEBUG] Enviando PUT /api/logistica/domicilios/${domId}`);
                    res = await fetch(`/api/logistica/domicilios/${domId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(datosDom)
                    });
                } else {
                    console.log(`📡 [DOMICILIOS-DEBUG] Enviando POST /api/logistica/domicilios para cliente ID ${txtId.value}`);
                    res = await fetch('/api/logistica/domicilios', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...datosDom, id_cliente: txtId.value })
                    });
                }

                console.log(`📥 [DOMICILIOS-DEBUG] Respuesta HTTP Status: ${res.status}`);
                const data = await res.json();
                console.log('📥 [DOMICILIOS-DEBUG] Respuesta JSON del Servidor:', data);

                if (!res.ok || !data.success) {
                    throw new Error(data.error || data.message || 'Error al guardar el domicilio.');
                }

                cerrarModalDomicilio();
                await cargarDomiciliosDeCliente(txtId.value);

                Swal.fire({
                    icon: 'success',
                    title: 'Domicilio guardado',
                    text: 'La dirección de entrega fue registrada correctamente.',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 3000
                });
            } else {
                console.log('📝 [DOMICILIOS-DEBUG] Guardando en memoria para cliente nuevo');
                if (datosDom.es_predeterminado) {
                    domiciliosMemoria.forEach(d => d.es_predeterminado = false);
                }

                if (indexStr !== '') {
                    const idx = parseInt(indexStr, 10);
                    domiciliosMemoria[idx] = { ...domiciliosMemoria[idx], ...datosDom };
                } else {
                    if (domiciliosMemoria.length === 0) {
                        datosDom.es_predeterminado = true;
                    }
                    domiciliosMemoria.push(datosDom);
                }

                cerrarModalDomicilio();
                renderizarListaDomicilios();
            }
        } catch (err) {
            console.error('❌ [DOMICILIOS-DEBUG] Excepción capturada:', err);
            Swal.fire({
                icon: 'error',
                title: 'Error al guardar',
                text: err.message || 'Ocurrió un error inesperado al procesar la solicitud.',
                confirmButtonColor: '#6b21a8'
            });
        }
    }

    async function cambiarPredeterminado(index, domId) {
        const esEdicionCliente = !!txtId.value;
        if (esEdicionCliente && domId) {
            const dom = domiciliosClienteActual.find(d => String(d.id) === String(domId));
            if (!dom) return;
            const nuevoEstado = !dom.es_predeterminado;

            try {
                const res = await fetch(`/api/logistica/domicilios/${domId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ es_predeterminado: nuevoEstado })
                });
                const data = await res.json();
                if (data.success) {
                    await cargarDomiciliosDeCliente(txtId.value);
                }
            } catch (err) {
                console.error('Error al cambiar domicilio predeterminado:', err);
            }
        } else {
            const dom = domiciliosMemoria[index];
            if (!dom) return;
            const nuevoEstado = !dom.es_predeterminado;

            domiciliosMemoria.forEach((d, i) => {
                if (nuevoEstado) {
                    d.es_predeterminado = (i === index);
                } else {
                    if (i === index) {
                        d.es_predeterminado = false;
                    }
                }
            });
            renderizarListaDomicilios();
        }
    }

    async function eliminarDomicilio(index, domId) {
        const esEdicionCliente = !!txtId.value;
        const confirmacion = await Swal.fire({
            title: '¿Eliminar domicilio?',
            text: 'Se eliminará esta dirección de entrega.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar'
        });

        if (!confirmacion.isConfirmed) return;

        if (esEdicionCliente && domId) {
            try {
                const res = await fetch(`/api/logistica/domicilios/${domId}`, {
                    method: 'DELETE'
                });
                const data = await res.json();
                if (data.success) {
                    await cargarDomiciliosDeCliente(txtId.value);
                } else {
                    throw new Error(data.error || 'No se pudo eliminar el domicilio.');
                }
            } catch (err) {
                console.error('Error al eliminar domicilio:', err);
                Swal.fire({ icon: 'error', title: 'Error', text: err.message, confirmButtonColor: '#6b21a8' });
            }
        } else {
            const fuePredeterminado = domiciliosMemoria[index]?.es_predeterminado;
            domiciliosMemoria.splice(index, 1);
            if (fuePredeterminado && domiciliosMemoria.length > 0) {
                domiciliosMemoria[0].es_predeterminado = true;
            }
            renderizarListaDomicilios();
        }
    }

    // Event listeners para modal de domicilios
    if (btnAddDomicilio) {
        btnAddDomicilio.addEventListener('click', () => abrirModalDomicilio());
    }
    if (btnCerrarModalDomicilio) {
        btnCerrarModalDomicilio.addEventListener('click', cerrarModalDomicilio);
    }
    if (btnCancelarModalDomicilio) {
        btnCancelarModalDomicilio.addEventListener('click', cerrarModalDomicilio);
    }
    if (btnGuardarModalDomicilio) {
        btnGuardarModalDomicilio.addEventListener('click', guardarModalDomicilio);
    }
    if (btnToggleMaximizarDomicilio) {
        btnToggleMaximizarDomicilio.addEventListener('click', toggleMaximizarModalDomicilio);
    }
    if (btnGeocodificarDireccion) {
        btnGeocodificarDireccion.addEventListener('click', geocodificarDireccionEnMapa);
    }
    if (txtDomCalle) txtDomCalle.addEventListener('input', actualizarDireccionFormateada);
    if (txtDomNumero) txtDomNumero.addEventListener('input', actualizarDireccionFormateada);
    if (txtDomEntreCalles) txtDomEntreCalles.addEventListener('input', actualizarDireccionFormateada);

    if (txtDomTelefono) {
        txtDomTelefono.addEventListener('input', (e) => {
            e.target.value = aplicarMascaraTelefono(e.target.value);
        });
    }

    if (selDomTelefonoPreexistente) {
        selDomTelefonoPreexistente.addEventListener('change', () => {
            if (selDomTelefonoPreexistente.value && txtDomTelefono) {
                txtDomTelefono.value = extraerNumeroLimpio(selDomTelefonoPreexistente.value);
            }
        });
    }

    if (formDomicilio) {
        formDomicilio.addEventListener('submit', (e) => {
            e.preventDefault();
            guardarModalDomicilio();
        });
    }

    // --- ESTRUCTURA TIPO ÁRBOL: NODOS BARRIALES → CLIENTES VECINOS Y SUBCUENTAS ---
    const fmtMonedaNodo = (n) => Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    async function cargarYRenderizarArbolNodo(bunkerClienteId, forceReload = false) {
        const numId = Number(bunkerClienteId);
        const box = document.getElementById(`arbol-nodo-box-${numId}`);
        if (!box) return;

        try {
            let data = (!forceReload && cacheArbolNodos.has(numId)) ? cacheArbolNodos.get(numId) : null;
            if (!data) {
                const q = encodeURIComponent((buscadorInput?.value || '').trim());
                const resp = await fetch(`/api/logistica/bunker/clientes/${numId}/arbol-nodo${q ? `?search=${q}` : ''}`);
                const json = await resp.json();
                if (!resp.ok || (!json.ok && !json.success)) {
                    throw new Error(json.error || 'No se pudo cargar el árbol del Nodo.');
                }
                data = json;
                cacheArbolNodos.set(numId, data);
            }

            const nodo = data.nodo || {};
            const cuad = data.cuadratura || {};
            const vecinos = Array.isArray(data.vecinos) ? data.vecinos : [];

            const saldoNodo = Number(cuad.saldo_cc_nodo_lamda || 0);
            const txtSaldoNodo = saldoNodo > 0.01
                ? `<span style="color:#dc2626;">+$ ${fmtMonedaNodo(saldoNodo)}</span> <small style="font-size:11px; color:#dc2626;">(Deudor a LAMDA)</small>`
                : (saldoNodo < -0.01
                    ? `<span style="color:#16a34a;">$ ${fmtMonedaNodo(Math.abs(saldoNodo))}</span> <small style="font-size:11px; color:#16a34a;">(A favor del Nodo)</small>`
                    : `<span style="color:#15803d;">$ 0,00</span> <small style="font-size:11px; color:#15803d;">(Al día)</small>`);

            const totalVecinosPend = Number(cuad.total_subcuentas_vecinos || 0);
            const efvoGestor = Number(cuad.efectivo_en_mano_gestor_lotes_abiertos || 0);
            const transfLamda = Number(cuad.transferencias_en_lamda_lotes_abiertos || 0);

            const saldoMadre = Number(nodo.saldo_cuenta_madre || 0);
            const htmlTarjetaMadre = nodo.codigo_bunker_cliente_madre
                ? `
                    <div class="nodo-cuadratura-card" style="border-left:3px solid #64748b;">
                        <div style="font-size:10.5px; font-weight:800; color:#475569; text-transform:uppercase;">🔗 Cuenta Personal Vinculada (${escHtmlNodo(nodo.codigo_bunker_cliente_madre)})</div>
                        <div style="font-size:1.05rem; font-weight:800; color:${saldoMadre > 0.01 ? '#dc2626' : '#16a34a'}; margin-top:3px;">
                            ${saldoMadre < -0.01 ? `$ ${fmtMonedaNodo(Math.abs(saldoMadre))} a favor` : `$ ${fmtMonedaNodo(saldoMadre)}`}
                        </div>
                        <div style="font-size:11px; color:#64748b; margin-top:2px;">🔒 Aislada en operatoria diaria (${escHtmlNodo(nodo.cliente_madre_nombre || '')})</div>
                    </div>
                `
                : `
                    <div class="nodo-cuadratura-card" style="border-left:3px solid #cbd5e1;">
                        <div style="font-size:10.5px; font-weight:800; color:#64748b; text-transform:uppercase;">🔗 Cuenta Personal Colaborador</div>
                        <div style="font-size:0.95rem; font-weight:700; color:#94a3b8; margin-top:4px;">Sin cuenta personal vinculada</div>
                        <div style="font-size:11px; color:#64748b; margin-top:2px;">Rendición directa sobre ${escHtmlNodo(nodo.codigo_bunker_cliente || '')}</div>
                    </div>
                `;

            const filasVecinosHtml = vecinos.length === 0
                ? `<tr><td colspan="7" style="text-align:center; padding:18px; color:#64748b;">Todavía no hay clientes vecinos empadronados en este Nodo.</td></tr>`
                : vecinos.map(v => {
                    const saldoV = Number(v.saldo_actual || 0);
                    const ult = v.ultimo_pedido || null;
                    const pendPrimero = (v.pedidos_pendientes_pago || [])[0] || null;
                    const esEfvoPend = pendPrimero && String(pendPrimero.medio_pago || '').toUpperCase() === 'EFECTIVO';

                    const badgeSaldoVec = saldoV > 0.01
                        ? `<span style="font-weight:800; color:#dc2626;">$ ${fmtMonedaNodo(saldoV)}</span><div style="font-size:10px; color:#b91c1c; font-weight:700;">Pendiente cobro</div>`
                        : (saldoV < -0.01
                            ? `<span style="font-weight:800; color:#16a34a;">$ ${fmtMonedaNodo(Math.abs(saldoV))}</span><div style="font-size:10px; color:#15803d; font-weight:700;">Saldo a favor</div>`
                            : `<span style="font-weight:800; color:#15803d;">$ 0,00</span><div style="font-size:10px; color:#64748b; font-weight:600;">Al día</div>`);

                    return `
                        <tr class="${v.coincide_busqueda ? 'vecino-match-busqueda' : ''}">
                            <td style="font-family:monospace; font-weight:800; color:#166534; white-space:nowrap;">
                                ↳ ${escHtmlNodo(v.codigo_vecino)}
                            </td>
                            <td>
                                <div style="font-weight:800; color:#0f172a;">👤 ${escHtmlNodo(v.nombre_completo)}</div>
                                <div style="font-size:11px; color:#475569;">📱 ${escHtmlNodo(v.telefono_whatsapp)} <span style="color:#94a3b8; font-family:monospace;">(ID: ${escHtmlNodo(v.telefono_normalizado)})</span></div>
                            </td>
                            <td style="font-size:11.5px; color:#334155;">
                                ${v.direccion_calle
                                    ? `<div>🛵 ${escHtmlNodo(v.direccion_calle)}</div>${v.entrecalles_referencia ? `<div style="font-size:10.5px; color:#64748b;">(${escHtmlNodo(v.entrecalles_referencia)})</div>` : ''}`
                                    : `<span style="color:#15803d; font-weight:600;">🏡 Retira en Nodo (${escHtmlNodo(nodo.nombre_marca)})</span>`
                                }
                            </td>
                            <td>
                                <div style="font-weight:700; color:#1e293b;">${v.cantidad_pedidos_activos} compra${v.cantidad_pedidos_activos === 1 ? '' : 's'} · $ ${fmtMonedaNodo(v.total_comprado)}</div>
                                ${ult ? `
                                    <div style="font-size:11px; color:#64748b; margin-top:2px;">
                                        Último: <strong style="font-family:monospace; color:#0369a1;">#${escHtmlNodo(ult.codigo_pedido)}</strong>
                                        ${ult.anulado
                                            ? `<span style="color:#e11d48; font-weight:700;">(Anulado)</span>`
                                            : (ult.pago_confirmado ? `<span style="color:#16a34a; font-weight:700;">(Pagado)</span>` : `<span style="color:#d97706; font-weight:700;">(Pendiente)</span>`)
                                        }
                                    </div>
                                ` : ''}
                            </td>
                            <td>
                                ${v.titular_habitual
                                    ? `<span class="badge" style="background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; font-size:10.5px; font-weight:700;">🏦 ${escHtmlNodo(v.titular_habitual)}</span>`
                                    : `<span style="font-size:11px; color:#64748b;">${ult && ult.medio_pago === 'EFECTIVO' ? '💵 Pago en Efectivo' : 'Sin titular aprendido'}</span>`
                                }
                            </td>
                            <td style="text-align:right; white-space:nowrap;">
                                ${badgeSaldoVec}
                            </td>
                            <td style="text-align:center; white-space:nowrap;">
                                <div style="display:inline-flex; gap:5px; align-items:center; flex-wrap:wrap; justify-content:center;">
                                    <button type="button" onclick="window.abrirModalSubcuentaVecinoNodo(${v.id}, ${numId})"
                                        style="padding:5px 10px; border-radius:6px; border:1px solid #cbd5e1; background:#ffffff; color:#1e293b; font-size:11.5px; font-weight:700; cursor:pointer;">
                                        📄 Subcuenta
                                    </button>
                                    ${pendPrimero ? `
                                        <button type="button"
                                            onclick="window.conciliarPagoPedidoVecinoDesdeBunker(${pendPrimero.id}, '${escHtmlNodo(pendPrimero.codigo_pedido)}', '${escHtmlNodo(v.nombre_completo)}', '${escHtmlNodo(pendPrimero.medio_pago)}', '${escHtmlNodo(v.titular_habitual || v.nombre_completo.toUpperCase())}', ${Number(pendPrimero.total_vecino)}, null, ${numId})"
                                            style="padding:5px 9px; border-radius:6px; border:1px solid ${esEfvoPend ? '#f59e0b' : '#38bdf8'}; background:${esEfvoPend ? '#fef3c7' : '#e0f2fe'}; color:${esEfvoPend ? '#92400e' : '#0369a1'}; font-size:11px; font-weight:800; cursor:pointer;"
                                            title="Registrar cobro de #${escHtmlNodo(pendPrimero.codigo_pedido)}">
                                            ${esEfvoPend ? '💵' : '🏦'} Cobrar #${escHtmlNodo(pendPrimero.codigo_pedido)}
                                        </button>
                                    ` : ''}
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');

            box.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px; padding-bottom:9px; border-bottom:1px solid #e2e8f0;">
                    <div>
                        <div style="font-size:14px; font-weight:800; color:#14532d; display:flex; align-items:center; gap:8px;">
                            <span>🌳 Árbol de Clientes y Cuadratura Contable — ${escHtmlNodo(nodo.nombre_marca)} (${escHtmlNodo(nodo.codigo_bunker_cliente)})</span>
                            <span class="badge" style="background:#dcfce7; color:#166534; border:1px solid #86efac; font-size:11px;">${vecinos.length} vecino${vecinos.length === 1 ? '' : 's'} único${vecinos.length === 1 ? '' : 's'} por teléfono</span>
                        </div>
                        <div style="font-size:11.5px; color:#64748b; margin-top:2px;">
                            Gestor responsable: <strong>${escHtmlNodo(nodo.gestor_nombre)}</strong> · Cada vecino mantiene su subcuenta auditable bajo este Nodo sin mezclarse en el listado mayorista.
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <button type="button" onclick="window.recargarArbolNodoBunker(${numId})"
                            style="padding:6px 11px; border-radius:7px; border:1px solid #cbd5e1; background:#f8fafc; color:#334155; font-size:12px; font-weight:700; cursor:pointer;">
                            🔄 Actualizar Árbol
                        </button>
                        <button type="button" onclick="window.open('/liquidacion-nodos', '_blank')"
                            style="padding:6px 13px; border-radius:7px; border:1px solid #0284c7; background:#0284c7; color:#ffffff; font-size:12px; font-weight:800; cursor:pointer;">
                            ⚖️ Abrir Liquidación de Lotes
                        </button>
                    </div>
                </div>

                <div class="nodo-cuadratura-grid">
                    <div class="nodo-cuadratura-card" style="border-left:3px solid ${saldoNodo > 0.01 ? '#dc2626' : '#16a34a'};">
                        <div style="font-size:10.5px; font-weight:800; color:#475569; text-transform:uppercase;">📒 Saldo Cta. Cte. Nodo (${escHtmlNodo(nodo.codigo_bunker_cliente)})</div>
                        <div style="font-size:1.08rem; font-weight:800; margin-top:3px;">${txtSaldoNodo}</div>
                        <div style="font-size:11px; color:#64748b; margin-top:2px;">Transf. conciliadas en LAMDA: $ ${fmtMonedaNodo(transfLamda)}</div>
                    </div>
                    <div class="nodo-cuadratura-card" style="border-left:3px solid ${totalVecinosPend > 0.01 ? '#d97706' : '#16a34a'};">
                        <div style="font-size:10.5px; font-weight:800; color:#475569; text-transform:uppercase;">👥 Subcuentas de Vecinos s/Cobrar</div>
                        <div style="font-size:1.08rem; font-weight:800; color:${totalVecinosPend > 0.01 ? '#b45309' : '#15803d'}; margin-top:3px;">$ ${fmtMonedaNodo(totalVecinosPend)}</div>
                        <div style="font-size:11px; color:#64748b; margin-top:2px;">${cuad.vecinos_con_saldo_pendiente || 0} de ${cuad.vecinos_totales || 0} vecino(s) con pago pendiente</div>
                    </div>
                    <div class="nodo-cuadratura-card" style="border-left:3px solid #0284c7;">
                        <div style="font-size:10.5px; font-weight:800; color:#475569; text-transform:uppercase;">💵 Efectivo en Mano del Gestor</div>
                        <div style="font-size:1.08rem; font-weight:800; color:#0369a1; margin-top:3px;">$ ${fmtMonedaNodo(efvoGestor)}</div>
                        <div style="font-size:11px; color:#64748b; margin-top:2px;">Cobrado en lotes abiertos · Ganancia lote: +$ ${fmtMonedaNodo(cuad.ganancia_gestor_lotes_abiertos || 0)}</div>
                    </div>
                    ${htmlTarjetaMadre}
                </div>

                <div style="overflow-x:auto;">
                    <table class="tabla-vecinos-arbol">
                        <thead>
                            <tr>
                                <th>Código</th>
                                <th>Cliente del Nodo / WhatsApp</th>
                                <th>Entrega / Domicilio Barrial</th>
                                <th>Compras / Último Pedido</th>
                                <th>Titular / Medio</th>
                                <th style="text-align:right;">Saldo Subcuenta</th>
                                <th style="text-align:center;">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filasVecinosHtml}
                        </tbody>
                    </table>
                </div>
            `;
        } catch (err) {
            box.innerHTML = `<div style="padding:12px; color:#dc2626; font-weight:700;">⚠️ Error al cargar el árbol del Nodo: ${escHtmlNodo(err.message)}</div>`;
        }
    }

    window.toggleArbolNodoBunker = function(bunkerClienteId) {
        const numId = Number(bunkerClienteId);
        if (nodosExpandidosIds.has(numId)) {
            nodosExpandidosIds.delete(numId);
        } else {
            nodosExpandidosIds.add(numId);
        }
        ordenarYRenderizar();
    };

    window.recargarArbolNodoBunker = async function(bunkerClienteId) {
        const numId = Number(bunkerClienteId);
        cacheArbolNodos.delete(numId);
        nodosExpandidosIds.add(numId);
        await cargarClientes(buscadorInput?.value || '');
    };

    const modalSubcuentaVecino = document.getElementById('modal-subcuenta-vecino-nodo');
    if (modalSubcuentaVecino) {
        modalSubcuentaVecino.addEventListener('click', () => window.cerrarModalSubcuentaVecinoNodo());
    }

    window.cerrarModalSubcuentaVecinoNodo = function() {
        if (modalSubcuentaVecino) {
            modalSubcuentaVecino.style.display = 'none';
        }
    };

    window.abrirModalSubcuentaVecinoNodo = async function(vecinoId, bunkerClienteNodoId) {
        const headerEl = document.getElementById('modal-subcuenta-vecino-header');
        const bodyEl = document.getElementById('modal-subcuenta-vecino-body');
        if (!modalSubcuentaVecino || !bodyEl) return;

        modalSubcuentaVecino.style.display = 'flex';
        bodyEl.innerHTML = `<div style="padding:28px; text-align:center; color:#64748b; font-weight:600;">⏳ Consultando subcuenta, pedidos y libro mayor del vecino...</div>`;

        try {
            const resp = await fetch(`/api/logistica/bunker/clientes/nodos-vecinos/${Number(vecinoId)}/subcuenta`);
            const data = await resp.json();
            if (!resp.ok || (!data.ok && !data.success)) {
                throw new Error(data.error || 'No se pudo cargar la subcuenta del vecino.');
            }

            const v = data.vecino || {};
            const pedidos = Array.isArray(data.pedidos) ? data.pedidos : [];
            const movs = Array.isArray(data.movimientos_cc) ? data.movimientos_cc : [];
            const saldoActual = Number(v.saldo_actual || 0);

            if (headerEl) {
                headerEl.innerHTML = `
                    <div>
                        <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; opacity:0.88; font-weight:700;">
                            🏘️ ${escHtmlNodo(v.nombre_marca)} (${escHtmlNodo(v.codigo_bunker_cliente)}) · Código Único ${escHtmlNodo(v.codigo_vecino)}
                        </div>
                        <h3 style="margin:3px 0 0 0; font-size:1.18rem; font-weight:800;">
                            👤 ${escHtmlNodo(v.nombre_completo)} &nbsp;·&nbsp; <span style="font-weight:600; font-size:0.92rem;">📱 ${escHtmlNodo(v.telefono_whatsapp)} (ID canónico: ${escHtmlNodo(v.telefono_normalizado)})</span>
                        </h3>
                    </div>
                    <button type="button" onclick="window.cerrarModalSubcuentaVecinoNodo()" style="background: rgba(255,255,255,0.18); border: none; color: #fff; width: 34px; height: 34px; border-radius: 8px; font-size: 20px; cursor: pointer; font-weight: 700;">&times;</button>
                `;
            }

            const filasPedidos = pedidos.length === 0
                ? `<tr><td colspan="6" style="text-align:center; padding:14px; color:#64748b;">Sin pedidos registrados.</td></tr>`
                : pedidos.map(p => {
                    const esAnulado = Boolean(p.anulado);
                    const esEfvo = String(p.medio_pago || '').toUpperCase() === 'EFECTIVO';
                    const itemsTxt = (p.items || []).map(i => `${i.cantidad}x ${escHtmlNodo(i.nombre_publico)}`).join(' · ');
                    const ajusteCred = Number(p.monto_ajuste_credito || 0);

                    return `
                        <tr style="${esAnulado ? 'opacity:0.6; background:#f1f5f9;' : ''}">
                            <td style="font-family:monospace; font-weight:800; color:${esAnulado ? '#64748b' : '#0369a1'}; ${esAnulado ? 'text-decoration:line-through;' : ''}">
                                #${escHtmlNodo(p.codigo_pedido)}
                                <div style="font-size:10px; color:#64748b; font-family:sans-serif; text-decoration:none;">${escHtmlNodo(p.codigo_canasto || '')}</div>
                            </td>
                            <td>
                                <div style="font-size:12px; font-weight:600; color:#1e293b;">${itemsTxt || '—'}</div>
                                <div style="font-size:11px; color:#64748b; margin-top:2px;">📅 ${escHtmlNodo(p.fecha_entrega_label || '')} · ${p.modalidad_entrega === 'ENVIO_DOMICILIO' ? '🛵 Envío barrial' : '🏡 Retiro en Nodo'}</div>
                            </td>
                            <td>
                                <span class="badge" style="background:${esEfvo ? '#fef3c7' : '#e0f2fe'}; color:${esEfvo ? '#92400e' : '#0369a1'}; font-size:10.5px; font-weight:700;">
                                    ${esEfvo ? '💵 Efectivo al Gestor' : '🏦 Transferencia LAMDA'}
                                </span>
                            </td>
                            <td>
                                ${esAnulado
                                    ? `<span class="badge" style="background:#ffe4e6; color:#be123c; border:1px solid #fda4af; font-size:10.5px; font-weight:800;">🚫 ANULADO</span><div style="font-size:10px; color:#be123c; margin-top:2px;">${escHtmlNodo(p.motivo_anulacion_ajuste || '')}</div>`
                                    : (p.pago_confirmado
                                        ? `<span class="badge" style="background:#dcfce7; color:#166534; border:1px solid #86efac; font-size:10.5px; font-weight:800;">✅ Pagado</span>`
                                        : `<span class="badge" style="background:#fef9c3; color:#854d0e; border:1px solid #fde047; font-size:10.5px; font-weight:800;">⏳ Pendiente</span>`)
                                }
                                ${!esAnulado && ajusteCred > 0 ? `<div style="font-size:10px; color:#6d28d9; font-weight:700; margin-top:2px;">➖ Nota Crédito: -$ ${fmtMonedaNodo(ajusteCred)}</div>` : ''}
                            </td>
                            <td style="text-align:right; font-weight:800; color:#0f172a; white-space:nowrap;">
                                $ ${fmtMonedaNodo(p.total_vecino)}
                            </td>
                            <td style="text-align:center; white-space:nowrap;">
                                <div style="display:inline-flex; gap:4px; flex-wrap:wrap; justify-content:center;">
                                    ${!esAnulado && !p.pago_confirmado ? `
                                        <button type="button"
                                            onclick="window.conciliarPagoPedidoVecinoDesdeBunker(${p.id}, '${escHtmlNodo(p.codigo_pedido)}', '${escHtmlNodo(v.nombre_completo)}', '${escHtmlNodo(p.medio_pago)}', '${escHtmlNodo(p.titular_sugerido || '')}', ${Number(p.total_vecino)}, ${v.id}, ${Number(bunkerClienteNodoId)})"
                                            style="padding:4px 8px; border-radius:5px; border:1px solid #0284c7; background:#0284c7; color:#fff; font-size:11px; font-weight:700; cursor:pointer;">
                                            ✅ Cobrar
                                        </button>
                                    ` : ''}
                                    ${p.puede_nota_credito ? `
                                        <button type="button"
                                            onclick="window.notaCreditoPedidoVecinoDesdeBunker(${p.id}, '${escHtmlNodo(p.codigo_pedido)}', '${escHtmlNodo(v.nombre_completo)}', ${Number(p.total_vecino)}, ${v.id}, ${Number(bunkerClienteNodoId)})"
                                            style="padding:4px 8px; border-radius:5px; border:1px solid #6366f1; background:#eef2ff; color:#4338ca; font-size:11px; font-weight:700; cursor:pointer;"
                                            title="Aplicar Nota de Crédito parcial">
                                            ➖ Ajuste
                                        </button>
                                    ` : ''}
                                    ${p.puede_anular ? `
                                        <button type="button"
                                            onclick="window.anularPedidoVecinoDesdeBunker(${p.id}, '${escHtmlNodo(p.codigo_pedido)}', '${escHtmlNodo(v.nombre_completo)}', ${v.id}, ${Number(bunkerClienteNodoId)})"
                                            style="padding:4px 8px; border-radius:5px; border:1px solid #f43f5e; background:#fff1f2; color:#be123c; font-size:11px; font-weight:700; cursor:pointer;"
                                            title="Anular pedido antes de entrega">
                                            ✕ Anular
                                        </button>
                                    ` : ''}
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');

            const filasMovs = movs.length === 0
                ? `<tr><td colspan="5" style="text-align:center; padding:14px; color:#64748b;">Sin movimientos en la subcuenta.</td></tr>`
                : movs.map(m => {
                    const esDeb = String(m.tipo || '').toUpperCase() === 'DEBITO';
                    const fechaStr = m.created_at ? new Date(m.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '-';
                    return `
                        <tr>
                            <td style="font-size:11.5px; color:#475569; white-space:nowrap;">${escHtmlNodo(fechaStr)}</td>
                            <td>
                                <span class="badge" style="background:${esDeb ? '#fee2e2' : '#dcfce7'}; color:${esDeb ? '#991b1b' : '#166534'}; font-size:10px; font-weight:800;">
                                    ${esDeb ? 'DÉBITO (+)' : 'CRÉDITO (-)'}
                                </span>
                            </td>
                            <td style="font-size:12px; color:#1e293b;">
                                <strong>${escHtmlNodo(m.concepto || m.origen_tipo)}</strong>
                                ${m.codigo_pedido ? `<span style="font-family:monospace; color:#64748b;"> · #${escHtmlNodo(m.codigo_pedido)}</span>` : ''}
                            </td>
                            <td style="text-align:right; font-weight:800; color:${esDeb ? '#dc2626' : '#16a34a'}; white-space:nowrap;">
                                ${esDeb ? '+' : '-'}$ ${fmtMonedaNodo(m.importe)}
                            </td>
                            <td style="text-align:right; font-weight:800; color:#0f172a; white-space:nowrap;">
                                $ ${fmtMonedaNodo(m.saldo_resultante)}
                            </td>
                        </tr>
                    `;
                }).join('');

            bodyEl.innerHTML = `
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; margin-bottom:16px;">
                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px;">
                        <div style="font-size:11px; font-weight:800; color:#64748b; text-transform:uppercase;">🛍️ Total Comprado Activo</div>
                        <div style="font-size:1.25rem; font-weight:800; color:#0f172a; margin-top:4px;">$ ${fmtMonedaNodo(v.total_comprado)}</div>
                    </div>
                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px;">
                        <div style="font-size:11px; font-weight:800; color:#64748b; text-transform:uppercase;">✅ Total Abonado / Conciliado</div>
                        <div style="font-size:1.25rem; font-weight:800; color:#16a34a; margin-top:4px;">$ ${fmtMonedaNodo(v.total_abonado)}</div>
                    </div>
                    <div style="background:#ffffff; border:2px solid ${saldoActual > 0.01 ? '#fca5a5' : '#86efac'}; border-radius:10px; padding:12px 14px;">
                        <div style="font-size:11px; font-weight:800; color:#475569; text-transform:uppercase;">📒 Saldo Actual Subcuenta Vecino</div>
                        <div style="font-size:1.28rem; font-weight:900; color:${saldoActual > 0.01 ? '#dc2626' : '#15803d'}; margin-top:4px;">
                            ${saldoActual < -0.01 ? `$ ${fmtMonedaNodo(Math.abs(saldoActual))} a favor` : `$ ${fmtMonedaNodo(saldoActual)}`}
                        </div>
                    </div>
                </div>

                <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:14px; margin-bottom:16px;">
                    <div style="font-size:13px; font-weight:800; color:#1e293b; margin-bottom:10px;">📦 1. Pedidos del Vecino en ${escHtmlNodo(v.nombre_marca)}</div>
                    <div style="overflow-x:auto;">
                        <table class="tabla-vecinos-arbol">
                            <thead>
                                <tr>
                                    <th>Pedido / Lote</th>
                                    <th>Detalle y Entrega</th>
                                    <th>Medio de Pago</th>
                                    <th>Estado</th>
                                    <th style="text-align:right;">Importe</th>
                                    <th style="text-align:center;">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>${filasPedidos}</tbody>
                        </table>
                    </div>
                </div>

                <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:14px;">
                    <div style="font-size:13px; font-weight:800; color:#1e293b; margin-bottom:10px;">📒 2. Libro Mayor Cronológico de Subcuenta</div>
                    <div style="overflow-x:auto;">
                        <table class="tabla-vecinos-arbol">
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Asiento</th>
                                    <th>Concepto / Referencia</th>
                                    <th style="text-align:right;">Movimiento</th>
                                    <th style="text-align:right;">Saldo Resultante</th>
                                </tr>
                            </thead>
                            <tbody>${filasMovs}</tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (err) {
            bodyEl.innerHTML = `<div style="padding:18px; color:#dc2626; font-weight:700;">⚠️ ${escHtmlNodo(err.message)}</div>`;
        }
    };

    window.conciliarPagoPedidoVecinoDesdeBunker = async function(pedidoId, codigoPedido, vecinoNombre, medioPago, titularSugerido, monto, vecinoIdModal, bunkerClienteNodoId) {
        const esEfvo = String(medioPago || '').toUpperCase() === 'EFECTIVO';
        let payload = {};

        if (esEfvo) {
            const conf = await Swal.fire({
                title: `💵 Registrar Efectivo #${codigoPedido}`,
                html: `Confirmar cobro en efectivo en mano del Gestor a <strong>${escHtmlNodo(vecinoNombre)}</strong> por <strong>$ ${fmtMonedaNodo(monto)}</strong>.`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: '✅ Registrar Efectivo Cobrado',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#d97706'
            });
            if (!conf.isConfirmed) return;
            payload = { comprobante_referencia: `REC-EFVO-${codigoPedido}` };
        } else {
            const { value: formVals } = await Swal.fire({
                title: `🏦 Conciliar Transferencia #${codigoPedido}`,
                width: '520px',
                html: `
                    <div style="text-align:left; font-size:13.5px; display:flex; flex-direction:column; gap:10px;">
                        <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:10px; color:#0c4a6e;">
                            Transferencia de <strong>${escHtmlNodo(vecinoNombre)}</strong> por <strong>$ ${fmtMonedaNodo(monto)}</strong>.<br>
                            Salda la subcuenta del vecino y acredita <strong>-$ ${fmtMonedaNodo(monto)} (CRÉDITO a favor)</strong> en la Cta. Cte. del Nodo.
                        </div>
                        <div>
                            <label style="display:block; font-size:12px; font-weight:700; color:#475569; margin-bottom:4px;">Titular bancario / billetera</label>
                            <input id="swal-bk-titular" class="form-control" value="${escHtmlNodo(titularSugerido)}">
                        </div>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                            <div>
                                <label style="display:block; font-size:12px; font-weight:700; color:#475569; margin-bottom:4px;">Entidad origen</label>
                                <input id="swal-bk-entidad" class="form-control" value="Mercado Pago">
                            </div>
                            <div>
                                <label style="display:block; font-size:12px; font-weight:700; color:#475569; margin-bottom:4px;">Referencia</label>
                                <input id="swal-bk-ref" class="form-control" value="MP-${escHtmlNodo(codigoPedido)}">
                            </div>
                        </div>
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: '✅ Conciliar Pago',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#0284c7',
                preConfirm: () => ({
                    titular_transferencia: document.getElementById('swal-bk-titular').value,
                    billetera_origen: document.getElementById('swal-bk-entidad').value,
                    comprobante_referencia: document.getElementById('swal-bk-ref').value
                })
            });
            if (!formVals) return;
            payload = formVals;
        }

        try {
            const resp = await fetch(`/api/logistica/bunker/clientes/nodos-pedidos/${Number(pedidoId)}/conciliar-pago`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await resp.json();
            if (!resp.ok || (!json.ok && !json.success)) throw new Error(json.error || 'No se pudo conciliar el pago.');

            await window.recargarArbolNodoBunker(bunkerClienteNodoId);
            if (vecinoIdModal) {
                await window.abrirModalSubcuentaVecinoNodo(vecinoIdModal, bunkerClienteNodoId);
            }
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `Pago #${codigoPedido} conciliado`, showConfirmButton: false, timer: 2000 });
        } catch (err) {
            Swal.fire('Error', err.message, 'error');
        }
    };

    window.anularPedidoVecinoDesdeBunker = async function(pedidoId, codigoPedido, vecinoNombre, vecinoIdModal, bunkerClienteNodoId) {
        const { value: motivo } = await Swal.fire({
            title: `🚫 Anular Pedido #${codigoPedido}`,
            input: 'text',
            inputLabel: `Motivo de anulación del pedido de ${vecinoNombre} (revierte subcuenta y Cta. Cte.)`,
            inputValue: 'Cancelado por el vecino antes del despacho',
            showCancelButton: true,
            confirmButtonText: '🚫 Confirmar Anulación',
            cancelButtonText: 'Volver',
            confirmButtonColor: '#e11d48'
        });
        if (!motivo) return;

        try {
            const resp = await fetch(`/api/logistica/bunker/clientes/nodos-pedidos/${Number(pedidoId)}/anular`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ motivo })
            });
            const json = await resp.json();
            if (!resp.ok || (!json.ok && !json.success)) throw new Error(json.error || 'No se pudo anular el pedido.');

            await window.recargarArbolNodoBunker(bunkerClienteNodoId);
            if (vecinoIdModal) {
                await window.abrirModalSubcuentaVecinoNodo(vecinoIdModal, bunkerClienteNodoId);
            }
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `Pedido #${codigoPedido} anulado`, showConfirmButton: false, timer: 2200 });
        } catch (err) {
            Swal.fire('Error', err.message, 'error');
        }
    };

    window.notaCreditoPedidoVecinoDesdeBunker = async function(pedidoId, codigoPedido, vecinoNombre, totalActual, vecinoIdModal, bunkerClienteNodoId) {
        const { value: formVals } = await Swal.fire({
            title: `➖ Nota de Crédito — #${codigoPedido}`,
            width: '500px',
            html: `
                <div style="text-align:left; font-size:13px; display:flex; flex-direction:column; gap:10px;">
                    <div>Total actual de <strong>${escHtmlNodo(vecinoNombre)}</strong>: <strong>$ ${fmtMonedaNodo(totalActual)}</strong></div>
                    <div>
                        <label style="display:block; font-weight:700; margin-bottom:4px;">Monto a bonificar / descontar al vecino ($)</label>
                        <input id="swal-bk-nc-monto" type="number" min="1" max="${Number(totalActual)}" step="1" class="form-control" placeholder="Ej: 1500">
                    </div>
                    <div>
                        <label style="display:block; font-weight:700; margin-bottom:4px;">Motivo</label>
                        <input id="swal-bk-nc-motivo" type="text" class="form-control" value="Ajuste parcial sobre pedido">
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '✅ Aplicar Nota de Crédito',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#6366f1',
            preConfirm: () => {
                const m = Number(document.getElementById('swal-bk-nc-monto').value || 0);
                if (!Number.isFinite(m) || m <= 0 || m >= Number(totalActual)) {
                    Swal.showValidationMessage('Ingresá un monto mayor a $0 y menor al total del pedido.');
                    return false;
                }
                return {
                    monto_credito_vecino: m,
                    motivo: document.getElementById('swal-bk-nc-motivo').value.trim() || 'Nota de Crédito'
                };
            }
        });
        if (!formVals) return;

        try {
            const resp = await fetch(`/api/logistica/bunker/clientes/nodos-pedidos/${Number(pedidoId)}/nota-credito`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formVals)
            });
            const json = await resp.json();
            if (!resp.ok || (!json.ok && !json.success)) throw new Error(json.error || 'No se pudo aplicar la Nota de Crédito.');

            await window.recargarArbolNodoBunker(bunkerClienteNodoId);
            if (vecinoIdModal) {
                await window.abrirModalSubcuentaVecinoNodo(vecinoIdModal, bunkerClienteNodoId);
            }
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `Nota de Crédito aplicada en #${codigoPedido}`, showConfirmButton: false, timer: 2200 });
        } catch (err) {
            Swal.fire('Error', err.message, 'error');
        }
    };

    // --- INICIALIZACIÓN ---
    setupLomasSoftAutocomplete();
    setupSorting();
    inicializarColumnas();
    cargarClientes();

    // Verificación de conversión desde CRM Preventa & Prospectos
    const urlParams = new URLSearchParams(window.location.search);
    const fromProspectoId = urlParams.get('fromProspecto');
    if (fromProspectoId) {
        prospectoConversionId = fromProspectoId;
        const nombreParam = urlParams.get('nombre') || '';
        const direccionParam = urlParams.get('direccion') || '';
        const telefonoParam = urlParams.get('telefono') || '';

        setTimeout(() => {
            btnNuevoCliente.click();
            drawerTitulo.innerHTML = '🚀 Convertir Prospecto a Cliente';
            if (nombreParam) {
                txtNombre.value = nombreParam;
                txtRazon.value = nombreParam;
            }
            if (telefonoParam) {
                renderWhatsappInputs(JSON.stringify([{
                    id: `wa_${Date.now()}`,
                    numero: telefonoParam,
                    nombre: nombreParam,
                    cargo: 'Contacto',
                    enviar_alerta: true
                }]));
            }
            if (direccionParam) {
                domiciliosMemoria = [{
                    alias: 'Sucursal Principal',
                    direccion: direccionParam,
                    es_predeterminado: true,
                    activo: true
                }];
                renderizarListaDomicilios();
            }
        }, 350);
    }
});

// Window function para Modal de Telemetría y Salud Cloudflare
window.abrirModalTelemetriaCloudflare = async function() {
    Swal.fire({
        title: '⚡ Telemetría y Rendimiento Cloudflare',
        html: `<div style="text-align:center; padding: 20px;"><p style="margin-top:10px;">Consultando API de Cloudflare y métricas en vivo...</p></div>`,
        showConfirmButton: false,
        width: '650px'
    });

    try {
        const resp = await fetch('/api/logistica/telemetria/cloudflare');
        const res = await resp.json();
        if (!res.success) throw new Error(res.error || 'Error al obtener telemetría');

        const cf = res.resumenCloudflare;
        
        Swal.fire({
            title: '📊 Telemetría y Salud de Red Cloudflare',
            width: '700px',
            html: `
                <div style="text-align: left; font-family: sans-serif; font-size: 0.95em;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
                            <div style="color: #64748b; font-size: 0.85em; font-weight: 600;">ESTADO DE RED</div>
                            <div style="color: #16a34a; font-size: 1.1em; font-weight: 700; margin-top: 4px;">🟢 ${cf.estado}</div>
                        </div>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
                            <div style="color: #64748b; font-size: 0.85em; font-weight: 600;">SUBDOMINIO WORKER</div>
                            <div style="color: #6b21a8; font-size: 0.85em; font-weight: 700; margin-top: 4px; word-break: break-all;">⚡ ${cf.subdominio}</div>
                        </div>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
                            <div style="color: #64748b; font-size: 0.85em; font-weight: 600;">TASA CACHE HITS</div>
                            <div style="color: #2563eb; font-size: 1.2em; font-weight: 700; margin-top: 4px;">🎯 ${cf.tasaCacheHits}</div>
                        </div>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
                            <div style="color: #64748b; font-size: 0.85em; font-weight: 600;">LATENCIA PROMEDIO</div>
                            <div style="color: #059669; font-size: 1.2em; font-weight: 700; margin-top: 4px;">⚡ ${cf.latenciaPromedio}</div>
                        </div>
                    </div>
                    <div style="background: #f3e8ff; border: 1px solid #d8b4fe; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
                        <div style="color: #6b21a8; font-weight: 700; font-size: 0.9em;">
                            📱 PWA Service Worker (Instalación Local en Celulares)
                        </div>
                        <div style="color: #4c1d95; font-size: 0.85em; margin-top: 4px;">
                            Marco visual pre-cacheado en memoria interna de dispositivos. Respuesta en 0.002s por solicitud.
                        </div>
                    </div>
                    <div style="text-align: right; color: #94a3b8; font-size: 0.8em;">
                        Última sincronización API: ${new Date(res.timestamp).toLocaleTimeString()}
                    </div>
                </div>
            `,
            confirmButtonText: '🔄 Actualizar Métricas',
            confirmButtonColor: '#8b5cf6',
            showCancelButton: true,
            cancelButtonText: 'Cerrar'
        }).then((result) => {
            if (result.isConfirmed) {
                window.abrirModalTelemetriaCloudflare();
            }
        });
    } catch(err) {
        Swal.fire('Error', err.message, 'error');
    }
};
