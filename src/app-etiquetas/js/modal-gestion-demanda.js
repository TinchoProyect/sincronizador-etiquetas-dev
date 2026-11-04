/**
 * Módulo Frontend: Gestión y Despacho Omnicanal de Demanda Satisfecha (Sistema LAMDA)
 * 
 * Abre un modal SweetAlert2 interactivo en doble columna con los contactos de WhatsApp
 * y Correo Electrónico registrados en Búnker, permitiendo seleccionar destinatarios,
 * guardar preferencias por default y despachar directamente mediante la sesión activa
 * de WhatsApp del sistema (puerto 3004) y el servidor de correo.
 */

(function() {
    'use strict';

    /**
     * Formatea números de teléfono para visualización legible
     */
    function formatearTelefonoDisplay(numero) {
        if (!numero) return '';
        const limpio = String(numero).replace(/\D/g, '');
        if (limpio.length === 10) {
            return `(${limpio.substring(0,3)}) ${limpio.substring(3,6)}-${limpio.substring(6,10)}`;
        }
        if (limpio.length === 13 && limpio.startsWith('549')) {
            return `+54 9 (${limpio.substring(3,6)}) ${limpio.substring(6,9)}-${limpio.substring(9,13)}`;
        }
        if (limpio.length === 12 && limpio.startsWith('54')) {
            return `+54 (${limpio.substring(2,5)}) ${limpio.substring(5,8)}-${limpio.substring(8,12)}`;
        }
        return numero;
    }

    /**
     * Persiste la configuración de contactos predeterminados en Búnker (Logística / Puerto 3005)
     */
    async function guardarContactosPredeterminadosBunker(bunkerClienteId, wpContacts, emailContacts, selectedWps, selectedEmails, customPhone = '', customEmail = '') {
        if (!bunkerClienteId) {
            console.warn('⚠️ [DEMANDA-OMNICANAL] No se proporcionó bunker_cliente_id para persistencia.');
            return false;
        }

        // Mapear contactos existentes de WhatsApp actualizando los flags
        const finalWpMap = new Map();
        (wpContacts || []).forEach(c => {
            const key = String(c.numero || '').replace(/\D/g, '');
            if (key) {
                finalWpMap.set(key, {
                    ...c,
                    default_presupuesto: selectedWps.includes(c.numero) || selectedWps.includes(key),
                    default_demanda: selectedWps.includes(c.numero) || selectedWps.includes(key)
                });
            }
        });

        // Si se agregó un número manual, agregarlo a la lista de contactos
        if (customPhone) {
            const cleaned = customPhone.replace(/[^\d,]/g, '');
            if (cleaned) {
                cleaned.split(',').map(n => n.trim()).filter(n => n.length >= 6).forEach(num => {
                    const k = num.replace(/\D/g, '');
                    if (finalWpMap.has(k)) {
                        finalWpMap.get(k).default_presupuesto = true;
                        finalWpMap.get(k).default_demanda = true;
                    } else {
                        finalWpMap.set(k, {
                            numero: num,
                            nombre: 'Contacto Adicional',
                            cargo: 'General',
                            default_presupuesto: true,
                            default_demanda: true
                        });
                    }
                });
            }
        }

        // Mapear contactos existentes de Email
        const finalEmailMap = new Map();
        (emailContacts || []).forEach(e => {
            const key = (e.email || '').toLowerCase().trim();
            if (key) {
                finalEmailMap.set(key, {
                    ...e,
                    default_presupuesto: selectedEmails.includes(e.email) || selectedEmails.includes(key),
                    default_demanda: selectedEmails.includes(e.email) || selectedEmails.includes(key)
                });
            }
        });

        // Si se agregó un correo manual, agregarlo a la lista
        if (customEmail) {
            customEmail.split(',').map(em => em.trim()).filter(em => em.includes('@') && em !== '[]').forEach(em => {
                const key = em.toLowerCase();
                if (finalEmailMap.has(key)) {
                    finalEmailMap.get(key).default_presupuesto = true;
                    finalEmailMap.get(key).default_demanda = true;
                } else {
                    finalEmailMap.set(key, {
                        email: em,
                        nombre: 'Correo Adicional',
                        cargo: 'General',
                        default_presupuesto: true,
                        default_demanda: true
                    });
                }
            });
        }

        const payload = {
            whatsapp_facturas: JSON.stringify(Array.from(finalWpMap.values())),
            email_facturas: JSON.stringify(Array.from(finalEmailMap.values()))
        };

        // Intento 1: Proxy local (/api/logistica/bunker/clientes/...)
        let response = null;
        try {
            response = await fetch(`/api/logistica/bunker/clientes/${bunkerClienteId}/whatsapp-contacts`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e1) {
            console.warn('⚠️ [DEMANDA-OMNICANAL] Proxy local no disponible, intentando directo al puerto 3005...');
        }

        // Intento 2: Fallback directo a Logística (3005)
        if (!response || !response.ok) {
            try {
                const host = window.location.hostname || 'localhost';
                response = await fetch(`http://${host}:3005/api/logistica/bunker/clientes/${bunkerClienteId}/whatsapp-contacts`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } catch (e2) {
                console.error('❌ [DEMANDA-OMNICANAL] Falló conexión con puerto 3005:', e2);
            }
        }

        return response && response.ok;
    }

    /**
     * Abre el modal SweetAlert2 de Gestión Omnicanal de Demanda
     * @param {number|object} itemOrId - Objeto con datos o ID de demanda_faltante
     * @param {function} [onUpdatedCallback] - Función a ejecutar si se actualiza el estado (ej. marcar cubierto)
     */
    window.abrirModalGestionDemanda = async function(itemOrId, onUpdatedCallback) {
        let item = null;

        // Si se pasó un objeto directamente
        if (typeof itemOrId === 'object' && itemOrId !== null) {
            item = itemOrId;
        } else {
            const targetId = parseInt(itemOrId);
            
            // Buscar en caché de Pizarra (main.js)
            if (window.demandaSatisfechaCache && Array.isArray(window.demandaSatisfechaCache)) {
                item = window.demandaSatisfechaCache.find(x => x.id === targetId);
            }
            
            // Buscar en caché de Informe de Faltantes (informe-faltantes.js)
            if (!item && typeof rawDashboardData !== 'undefined' && Array.isArray(rawDashboardData)) {
                for (const g of rawDashboardData) {
                    const found = (g.detalles || []).find(d => d.id === targetId);
                    if (found) {
                        item = {
                            ...found,
                            articulo: g.articulo,
                            descripcion: g.descripcion,
                            stock_consolidado: g.stock_consolidado,
                            stock_granel_disponible: g.stock_granel_disponible,
                            disponibilidad: g.disponibilidad,
                            disponibilidad_texto: g.disponibilidad_texto
                        };
                        break;
                    }
                }
            }

            // Si todavía no se encuentra, consultar al servidor
            if (!item) {
                try {
                    const resp = await fetch(`/api/pizarra/demanda-faltantes?estado=Todos`);
                    if (resp.ok) {
                        const json = await resp.json();
                        if (json.success && Array.isArray(json.data)) {
                            item = json.data.find(x => x.id === targetId);
                        }
                    }
                } catch (err) {
                    console.warn('⚠️ No se pudo consultar demanda en servidor:', err.message);
                }
            }
        }

        if (!item) {
            Swal.fire({
                icon: 'warning',
                title: 'Artículo no encontrado',
                text: 'No se pudieron recuperar los detalles de esta demanda no satisfecha.'
            });
            return;
        }

        // Si no tiene datos de búnker cargados en el ítem, consultar dinámicamente a logística (puerto 3005)
        if (!item.bunker_cliente_id && (item.cliente_id || item.id_cliente)) {
            const cliId = String(item.cliente_id || item.id_cliente).replace(/^0+/, '');
            try {
                let respBunker = null;
                try {
                    respBunker = await fetch(`/api/logistica/bunker/clientes?search=${cliId}`);
                } catch(e) {}
                if (!respBunker || !respBunker.ok) {
                    const host = window.location.hostname || 'localhost';
                    respBunker = await fetch(`http://${host}:3005/api/logistica/bunker/clientes?search=${cliId}`);
                }
                if (respBunker && respBunker.ok) {
                    const jsonBunker = await respBunker.json();
                    if (jsonBunker.success && Array.isArray(jsonBunker.data)) {
                        const match = jsonBunker.data.find(c => {
                            const lomasId = String(c.lomas_soft_id || '').replace(/^0+/, '');
                            return lomasId === cliId;
                        }) || jsonBunker.data[0];

                        if (match) {
                            item.bunker_cliente_id = match.id;
                            item.codigo_bunker_cliente = match.codigo_bunker_cliente;
                            if (match.whatsapp_facturas) item.whatsapp_facturas = match.whatsapp_facturas;
                            if (match.email_facturas) item.email_facturas = match.email_facturas;
                            if (match.cliente_nombre || match.razon_social) {
                                item.cliente_nombre = match.razon_social || match.cliente_nombre;
                            }
                            if (match.email_portal && (!item.email_facturas || item.email_facturas === '[]')) {
                                item.email_facturas = JSON.stringify([{
                                    email: match.email_portal,
                                    nombre: match.email_portal_nombre || match.cliente_nombre || 'Portal B2B',
                                    cargo: 'Portal',
                                    default: true,
                                    default_presupuesto: true
                                }]);
                            }
                        }
                    }
                }
            } catch (errBunker) {
                console.warn('⚠️ No se pudo consultar bunker_clientes dinámicamente:', errBunker.message);
            }
        }

        // 1. Resolver contactos de WhatsApp
        let wpContacts = [];
        if (Array.isArray(item.contactos_whatsapp) && item.contactos_whatsapp.length > 0) {
            wpContacts = [...item.contactos_whatsapp];
        } else if (item.whatsapp_facturas && item.whatsapp_facturas.trim().startsWith('[')) {
            try {
                wpContacts = JSON.parse(item.whatsapp_facturas);
            } catch(e) {}
        }
        if (!Array.isArray(wpContacts) || wpContacts.length === 0) {
            const rawTel = (item.celular || item.telefono || '').replace(/\D/g, '');
            if (rawTel) {
                wpContacts = [{
                    numero: rawTel,
                    nombre: item.cliente_nombre || 'Contacto Principal',
                    cargo: 'Principal',
                    default_presupuesto: true,
                    default: true
                }];
            }
        }

        // 2. Resolver contactos de Correo Electrónico
        let emailContacts = [];
        if (Array.isArray(item.contactos_email) && item.contactos_email.length > 0) {
            emailContacts = [...item.contactos_email];
        } else if (item.email_facturas && item.email_facturas.trim().startsWith('[')) {
            try {
                emailContacts = JSON.parse(item.email_facturas);
            } catch(e) {}
        }
        emailContacts = (emailContacts || []).filter(e => e && e.email && typeof e.email === 'string' && e.email.includes('@') && e.email !== '[]');

        // 3. Evaluar checks predeterminados iniciales
        const hasTypeDefaultWp = wpContacts.some(c => c.default_presupuesto === true || c.default_demanda === true);
        const hasGeneralDefaultWp = !hasTypeDefaultWp && wpContacts.some(c => c.default === true);

        const hasTypeDefaultEmail = emailContacts.some(e => e.default_presupuesto === true || e.default_demanda === true);
        const hasGeneralDefaultEmail = !hasTypeDefaultEmail && emailContacts.some(e => e.default === true);

        // 4. Mensaje predeterminado cordial y comercialmente proactivo
        const defaultMensaje = `Hola ${item.cliente_nombre || 'Estimado Cliente'}, te escribimos de LAMDA.

Te queríamos avisar que ya ingresó stock de ${item.descripcion || item.articulo} (habías solicitado ${item.cantidad} un. que teníamos pendientes). Contamos con disponibilidad inmediata en depósito para preparártelo.

¿Nos confirmás si te lo preparamos o enviamos? Avisanos también si necesitás sumar algún otro artículo a tu pedido.

¡Muchas gracias y saludos!`;

        // 5. Construir HTML del modal interactivo
        let htmlContent = `
            <div style="text-align: left; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <!-- Ficha del Artículo y Demanda -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #10b981; border-radius: 6px; padding: 10px 14px; margin-bottom: 15px; font-size: 13px; line-height: 1.5;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                        <div>
                            <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.5px; display: block;">Artículo Solicitado</span>
                            <strong style="font-size: 14px; color: #1e293b;">${item.descripcion || item.articulo}</strong>
                        </div>
                        <div style="text-align: right;">
                            <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; display: block;">Cantidad Faltante</span>
                            <span style="font-size: 14px; font-weight: 800; color: #dc2626;">${item.cantidad} un.</span>
                        </div>
                    </div>
                    <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed #cbd5e1; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; font-size: 12px;">
                        <div><strong>Cliente:</strong> ${item.cliente_nombre || 'No identificado'}</div>
                        <div><strong>Stock Actual:</strong> <span style="color: #16a34a; font-weight: 700;">${item.disponibilidad_texto || (item.stock_consolidado > 0 ? `Stock listo: ${item.stock_consolidado} un.` : 'Stock Disponible')}</span></div>
                    </div>
                </div>

                <!-- Selección de Destinatarios Doble Columna -->
                <p style="margin-bottom: 10px; font-size: 13px; color: #475569; font-weight: 600;">
                    Seleccione los contactos para enviar la notificación:
                </p>
                
                <div style="display: flex; gap: 14px; margin-bottom: 12px; flex-wrap: wrap;">
                    <!-- Columna WhatsApp -->
                    <div style="flex: 1; min-width: 250px;">
                        <div style="font-size: 11.5px; font-weight: 700; color: #059669; text-transform: uppercase; margin-bottom: 6px; border-bottom: 2px solid #10b981; padding-bottom: 3px; display: flex; align-items: center; gap: 6px;">
                            <span>📱 WhatsApp</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow-y: auto; padding: 4px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fdfdfd;">
        `;

        if (wpContacts.length === 0) {
            htmlContent += `
                <div style="padding: 12px; font-size: 12px; color: #94a3b8; text-align: center;">
                    No hay celulares cargados en Búnker.
                </div>
            `;
        } else {
            wpContacts.forEach((c, index) => {
                const isChecked = hasTypeDefaultWp 
                    ? (c.default_presupuesto === true || c.default_demanda === true) 
                    : (hasGeneralDefaultWp ? (c.default === true) : (index === 0));

                const displayNum = formatearTelefonoDisplay(c.numero);
                const labelText = c.nombre 
                    ? `<strong>${c.nombre}</strong>${c.cargo ? ` <span style="font-size: 9px; background: #e0f2fe; color: #0369a1; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${c.cargo}</span>` : ''}`
                    : `Celular #${index + 1}`;

                htmlContent += `
                    <label style="display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 5px; background: #fff; cursor: pointer; margin-bottom: 0;">
                        <input type="checkbox" class="swal-demanda-wp-chk" value="${c.numero}" ${isChecked ? 'checked' : ''} style="margin-top: 3px; cursor: pointer; width: 15px; height: 15px;">
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-size: 12px; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${labelText}</div>
                            <div style="font-size: 11px; color: #64748b;">📱 ${displayNum}</div>
                        </div>
                    </label>
                `;
            });
        }

        htmlContent += `
                        </div>
                    </div>

                    <!-- Columna Correo Electrónico -->
                    <div style="flex: 1; min-width: 250px;">
                        <div style="font-size: 11.5px; font-weight: 700; color: #4f46e5; text-transform: uppercase; margin-bottom: 6px; border-bottom: 2px solid #6366f1; padding-bottom: 3px; display: flex; align-items: center; gap: 6px;">
                            <span>📧 Correo Electrónico</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow-y: auto; padding: 4px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fdfdfd;">
        `;

        if (emailContacts.length === 0) {
            htmlContent += `
                <div style="padding: 12px; font-size: 12px; color: #94a3b8; text-align: center;">
                    No hay correos registrados en Búnker.
                </div>
            `;
        } else {
            emailContacts.forEach((e, index) => {
                const isChecked = hasTypeDefaultEmail 
                    ? (e.default_presupuesto === true || e.default_demanda === true) 
                    : (hasGeneralDefaultEmail ? (e.default === true) : false);

                const labelText = e.nombre 
                    ? `<strong>${e.nombre}</strong>${e.cargo ? ` <span style="font-size: 9px; background: #e0e7ff; color: #4338ca; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${e.cargo}</span>` : ''}`
                    : `Correo #${index + 1}`;

                htmlContent += `
                    <label style="display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 5px; background: #fff; cursor: pointer; margin-bottom: 0;">
                        <input type="checkbox" class="swal-demanda-email-chk" value="${e.email}" ${isChecked ? 'checked' : ''} style="margin-top: 3px; cursor: pointer; width: 15px; height: 15px;">
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-size: 12px; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${labelText}</div>
                            <div style="font-size: 11px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">✉️ ${e.email}</div>
                        </div>
                    </label>
                `;
            });
        }

        htmlContent += `
                        </div>
                    </div>
                </div>

                <!-- Entradas adicionales para números o correos no registrados -->
                <div style="display: flex; gap: 12px; margin-top: 10px; padding-top: 8px; border-top: 1px dashed #cbd5e1;">
                    <div style="flex: 1;">
                        <label style="display: block; font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 3px;">
                            Otro celular (opcional):
                        </label>
                        <input type="text" id="swal-demanda-custom-phone" placeholder="Ej: 2216615746" style="width: 100%; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                    </div>
                    <div style="flex: 1;">
                        <label style="display: block; font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 3px;">
                            Otro correo (opcional):
                        </label>
                        <input type="email" id="swal-demanda-custom-email" placeholder="Ej: admin@cliente.com" style="width: 100%; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                    </div>
                </div>

                <!-- Editor de Mensaje -->
                <div style="margin-top: 12px; padding-top: 8px; border-top: 1px dashed #cbd5e1;">
                    <label for="swal-demanda-mensaje-texto" style="display: block; font-size: 11.5px; font-weight: 600; color: #334155; margin-bottom: 4px;">
                        📝 Mensaje a Enviar (Editable):
                    </label>
                    <textarea id="swal-demanda-mensaje-texto" style="width: 100%; height: 95px; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; font-family: inherit; box-sizing: border-box; resize: vertical; line-height: 1.4;">${defaultMensaje}</textarea>
                </div>
        `;

        if (item.bunker_cliente_id) {
            htmlContent += `
                <!-- Guardar Predeterminados -->
                <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #cbd5e1; display: flex; flex-direction: column; gap: 6px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 11.5px; color: #475569; margin-bottom: 0;">
                            <input type="checkbox" id="swal-demanda-save-default" style="width: 15px; height: 15px; cursor: pointer;">
                            <span>Guardar esta selección como contactos predeterminados al enviar</span>
                        </label>
                        <button type="button" id="btn-demanda-guardar-default" style="background: #f8fafc; color: #334155; border: 1px solid #cbd5e1; border-radius: 5px; padding: 5px 10px; font-size: 11px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: all 0.2s ease;">
                            <span>💾</span> Guardar como default
                        </button>
                    </div>
                    <div id="swal-demanda-save-feedback" style="display: none; font-size: 11px; font-weight: 500; padding: 5px 8px; border-radius: 4px; text-align: center;"></div>
                </div>
            `;
        }

        htmlContent += `</div>`;

        // 6. Lanzar modal SweetAlert2
        const { value: modalResult } = await Swal.fire({
            title: 'Contactar Cliente (Demanda Satisfecha)',
            html: htmlContent,
            width: '640px',
            showCancelButton: true,
            confirmButtonText: '🟢 Enviar Notificación',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#10b981',
            cancelButtonColor: '#64748b',
            didOpen: (popup) => {
                const btnSaveManual = popup.querySelector('#btn-demanda-guardar-default');
                const feedbackEl = popup.querySelector('#swal-demanda-save-feedback');

                if (btnSaveManual) {
                    btnSaveManual.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        const selectedWps = Array.from(popup.querySelectorAll('.swal-demanda-wp-chk:checked')).map(el => el.value);
                        const selectedEmails = Array.from(popup.querySelectorAll('.swal-demanda-email-chk:checked')).map(el => el.value);
                        const customPhone = (popup.querySelector('#swal-demanda-custom-phone')?.value || '').trim();
                        const customEmail = (popup.querySelector('#swal-demanda-custom-email')?.value || '').trim();

                        btnSaveManual.disabled = true;
                        btnSaveManual.style.opacity = '0.7';
                        btnSaveManual.innerHTML = '<span>⏳</span> Guardando...';

                        try {
                            const ok = await guardarContactosPredeterminadosBunker(
                                item.bunker_cliente_id,
                                wpContacts,
                                emailContacts,
                                selectedWps,
                                selectedEmails,
                                customPhone,
                                customEmail
                            );

                            if (ok) {
                                btnSaveManual.innerHTML = '<span>✅</span> ¡Guardado!';
                                btnSaveManual.style.background = '#ecfdf5';
                                btnSaveManual.style.color = '#065f46';
                                btnSaveManual.style.borderColor = '#6ee7b7';

                                if (feedbackEl) {
                                    feedbackEl.style.display = 'block';
                                    feedbackEl.style.background = '#d1fae5';
                                    feedbackEl.style.color = '#065f46';
                                    feedbackEl.style.border = '1px solid #a7f3d0';
                                    feedbackEl.innerHTML = '✔️ Selección guardada como contactos predeterminados para este cliente.';
                                }

                                setTimeout(() => {
                                    btnSaveManual.disabled = false;
                                    btnSaveManual.style.opacity = '1';
                                    btnSaveManual.innerHTML = '<span>💾</span> Guardar como default';
                                    btnSaveManual.style.background = '#f8fafc';
                                    btnSaveManual.style.color = '#334155';
                                    btnSaveManual.style.borderColor = '#cbd5e1';
                                }, 2500);
                            } else {
                                throw new Error('No se pudo guardar la configuración.');
                            }
                        } catch (err) {
                            console.error('Error guardando contactos:', err);
                            btnSaveManual.disabled = false;
                            btnSaveManual.style.opacity = '1';
                            btnSaveManual.innerHTML = '<span>❌</span> Reintentar';
                        }
                    });
                }
            },
            preConfirm: () => {
                const selectedWps = Array.from(document.querySelectorAll('.swal-demanda-wp-chk:checked')).map(el => el.value);
                const selectedEmails = Array.from(document.querySelectorAll('.swal-demanda-email-chk:checked')).map(el => el.value);
                const customPhone = (document.getElementById('swal-demanda-custom-phone')?.value || '').trim();
                const customEmail = (document.getElementById('swal-demanda-custom-email')?.value || '').trim();
                const mensajeTexto = (document.getElementById('swal-demanda-mensaje-texto')?.value || '').trim();
                const saveDefault = document.getElementById('swal-demanda-save-default')?.checked || false;

                const wps = [...selectedWps];
                if (customPhone) {
                    const cleaned = customPhone.replace(/[^\d,]/g, '');
                    if (cleaned) {
                        cleaned.split(',').forEach(num => {
                            if (num.trim()) wps.push(num.trim());
                        });
                    }
                }

                const emails = [...selectedEmails];
                if (customEmail) {
                    customEmail.split(',').forEach(em => {
                        if (em.trim() && em.includes('@')) emails.push(em.trim());
                    });
                }

                if (wps.length === 0 && emails.length === 0) {
                    Swal.showValidationMessage('Debe seleccionar al menos un canal de contacto (WhatsApp o Correo).');
                    return false;
                }

                if (!mensajeTexto) {
                    Swal.showValidationMessage('El mensaje a enviar no puede estar vacío.');
                    return false;
                }

                return { wps, emails, mensajeTexto, saveDefault, customPhone, customEmail };
            }
        });

        if (!modalResult) return;

        const { wps, emails, mensajeTexto, saveDefault, customPhone, customEmail } = modalResult;

        // Si tildó guardar como predeterminado
        if (saveDefault && item.bunker_cliente_id) {
            guardarContactosPredeterminadosBunker(
                item.bunker_cliente_id,
                wpContacts,
                emailContacts,
                wps,
                emails,
                customPhone,
                customEmail
            ).catch(err => console.warn('Error guardando defaults en background:', err));
        }

        // Mostrar loading mientras despacha
        Swal.fire({
            title: 'Despachando Notificación...',
            text: 'Enviando mensaje a través de los canales seleccionados...',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const enviosResultados = [];
        let huboExito = false;
        let erroresTexto = [];

        // 1. Despacho por WhatsApp
        if (wps.length > 0) {
            try {
                let wpResp = null;
                // Intento 1: Proxy local /api/whatsapp/enviar-mensaje
                try {
                    wpResp = await fetch('/api/whatsapp/enviar-mensaje', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            destinatarios: wps.join(', '),
                            mensajeTexto: mensajeTexto
                        })
                    });
                } catch(e) {}

                // Intento 2: Fallback directo a facturación (puerto 3004)
                if (!wpResp || !wpResp.ok) {
                    const host = window.location.hostname || 'localhost';
                    wpResp = await fetch(`http://${host}:3004/facturacion/whatsapp/enviar-mensaje`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            destinatarios: wps.join(', '),
                            mensajeTexto: mensajeTexto
                        })
                    });
                }

                const wpJson = await wpResp.json();
                if (wpResp.ok && wpJson.success) {
                    huboExito = true;
                    enviosResultados.push(`📱 WhatsApp enviado a: ${wps.join(', ')}`);
                } else {
                    erroresTexto.push(`WhatsApp: ${wpJson.message || wpJson.error || 'Error al enviar'}`);
                }
            } catch (errWp) {
                console.error('Error enviando WhatsApp:', errWp);
                erroresTexto.push(`WhatsApp: ${errWp.message}`);
            }
        }

        // 2. Despacho por Correo Electrónico
        if (emails.length > 0) {
            try {
                let emailResp = null;
                // Intento 1: Proxy local /api/email/enviar-notificacion
                try {
                    emailResp = await fetch('/api/email/enviar-notificacion', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            destinatarios: emails.join(', '),
                            asunto: `Aviso de Stock Disponible: ${item.descripcion || item.articulo} - LAMDA`,
                            mensajeTexto: mensajeTexto,
                            clienteNombre: item.cliente_nombre
                        })
                    });
                } catch(e) {}

                // Intento 2: Fallback directo a facturación (puerto 3004)
                if (!emailResp || !emailResp.ok) {
                    const host = window.location.hostname || 'localhost';
                    emailResp = await fetch(`http://${host}:3004/facturacion/email/notificacion/enviar`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            destinatarios: emails.join(', '),
                            asunto: `Aviso de Stock Disponible: ${item.descripcion || item.articulo} - LAMDA`,
                            mensajeTexto: mensajeTexto,
                            clienteNombre: item.cliente_nombre
                        })
                    });
                }

                const emailJson = await emailResp.json();
                if (emailResp.ok && emailJson.success) {
                    huboExito = true;
                    enviosResultados.push(`✉️ Correo enviado a: ${emails.join(', ')}`);
                } else {
                    erroresTexto.push(`Correo: ${emailJson.message || emailJson.error || 'Error al enviar'}`);
                }
            } catch (errEmail) {
                console.error('Error enviando Correo:', errEmail);
                erroresTexto.push(`Correo: ${errEmail.message}`);
            }
        }

        // 3. Evaluar resultado y mostrar alerta de confirmación con acciones rápidas
        if (huboExito) {
            const resDetallesHtml = enviosResultados.map(r => `<div>${r}</div>`).join('');
            const erroresHtml = erroresTexto.length > 0 
                ? `<div style="margin-top: 10px; color: #dc2626; font-size: 12px;">⚠️ Parcial: ${erroresTexto.join(' | ')}</div>` 
                : '';

            Swal.fire({
                icon: 'success',
                title: '¡Notificación Despachada!',
                html: `
                    <div style="font-size: 13.5px; line-height: 1.6; color: #1e293b; text-align: left; padding: 5px;">
                        <p style="margin-bottom: 8px;">El mensaje fue transmitido exitosamente al cliente:</p>
                        <div style="background: #f1f5f9; padding: 10px; border-radius: 6px; font-size: 12.5px; font-weight: 500;">
                            ${resDetallesHtml}
                        </div>
                        ${erroresHtml}
                        <p style="margin-top: 14px; margin-bottom: 0; font-size: 12px; color: #64748b;">
                            ¿Qué desea realizar a continuación con esta demanda?
                        </p>
                    </div>
                `,
                showCancelButton: true,
                showDenyButton: true,
                confirmButtonText: '✔️ Marcar como Cubierto',
                denyButtonText: '📝 Crear Presupuesto',
                cancelButtonText: 'Cerrar',
                confirmButtonColor: '#16a34a',
                denyButtonColor: '#2563eb',
                cancelButtonColor: '#64748b'
            }).then(async (accionPost) => {
                if (accionPost.isConfirmed) {
                    // Marcar como cubierto
                    try {
                        let resCubierto;
                        try {
                            resCubierto = await fetch(`/api/pizarra/demanda-faltantes/${item.id}/estado`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ nuevoEstado: 'Cubierto', motivo: 'Notificación enviada y marcada como cubierta' })
                            });
                        } catch(e) {
                            resCubierto = await fetch(`/api/presupuestos/faltantes/${item.id}/estado`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ nuevoEstado: 'Cubierto', motivo: 'Notificación enviada y marcada como cubierta' })
                            });
                        }

                        if (resCubierto && resCubierto.ok) {
                            Swal.fire({
                                toast: true,
                                position: 'top-end',
                                icon: 'success',
                                title: '✅ Demanda marcada como cubierta',
                                showConfirmButton: false,
                                timer: 2500
                            });
                            if (typeof onUpdatedCallback === 'function') {
                                onUpdatedCallback();
                            } else if (typeof window.actualizarPizarra === 'function') {
                                window.actualizarPizarra();
                            } else if (typeof fetchDashboardData === 'function') {
                                fetchDashboardData();
                            }
                        }
                    } catch (errCub) {
                        console.error('Error marcando cubierto:', errCub);
                    }
                } else if (accionPost.isDenied) {
                    // Abrir creación de nuevo presupuesto
                    const cliId = item.cliente_id || '';
                    const urlPresupuesto = `http://localhost:3003/pages/crear-presupuesto.html${cliId ? `?cliente_id=${cliId}` : ''}`;
                    window.open(urlPresupuesto, '_blank');
                }
            });
        } else {
            Swal.fire({
                icon: 'error',
                title: 'No se pudo enviar la notificación',
                html: `
                    <div style="font-size: 13px; color: #dc2626; text-align: left;">
                        <p>Ocurrieron los siguientes inconvenientes durante el despacho:</p>
                        <ul>${erroresTexto.map(e => `<li>${e}</li>`).join('')}</ul>
                        <p style="color: #64748b; font-size: 11.5px; margin-top: 10px;">
                            Verifique que la sesión de WhatsApp esté conectada en Facturación (puerto 3004) o que los destinatarios sean válidos.
                        </p>
                    </div>
                `
            });
        }
    };
    window.abrirModalGestionDemandaOmnicanal = window.abrirModalGestionDemanda;
})();
