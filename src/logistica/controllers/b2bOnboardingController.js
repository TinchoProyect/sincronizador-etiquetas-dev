const crypto = require('crypto');
const QRCode = require('qrcode');
const { pool } = require('../config/database');
const { createClient } = require('@supabase/supabase-js');
const {
    parsearContactoWhatsapp,
    sincronizarTodoElDirectorioB2B,
    sincronizarListasClienteEnNube
} = require('../services/b2bDirectorySyncService');

// Configuración de Supabase B2B (obtenidas del .env)
const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY; // Service Role Key para crear usuarios y perfiles

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

/**
 * Helper para normalizar y limpiar números telefónicos
 */
function sanitizarNumero(numero) {
    if (!numero) return '';
    return String(numero).replace(/[^0-9]/g, '').trim();
}

/**
 * Helper para validar coincidencia de número ingresado contra contactos del cliente
 */
function verificarCoincidenciaTelefono(rawContactos, numeroIngresado) {
    const ingresadoSanitizado = sanitizarNumero(numeroIngresado);
    if (!ingresadoSanitizado) return false;

    if (!rawContactos) return false;
    const val = rawContactos.trim();

    if (val.startsWith('[')) {
        try {
            const contactos = JSON.parse(val);
            return contactos.some(c => {
                const numSanitizado = sanitizarNumero(c.numero);
                // Compara si el ingresado termina con el número del contacto (tolerando prefijos de país)
                return numSanitizado && (ingresadoSanitizado.endsWith(numSanitizado) || numSanitizado.endsWith(ingresadoSanitizado));
            });
        } catch (err) {
            console.error('❌ [B2B-ONBOARDING] Error al parsear contactos del cliente:', err.message);
        }
    }

    const numSanitizado = sanitizarNumero(val);
    return numSanitizado && (ingresadoSanitizado.endsWith(numSanitizado) || numSanitizado.endsWith(ingresadoSanitizado));
}

/**
 * Helper para agregar un contacto a la lista JSON de email_facturas
 */
function agregarContactoEmail(emailFacturasOriginal, nuevoEmail, nombre = '', cargo = '') {
    if (!nuevoEmail || !nuevoEmail.trim()) return emailFacturasOriginal;
    const cleanEmail = nuevoEmail.trim().toLowerCase();
    
    let contacts = [];
    const original = (emailFacturasOriginal || '').trim();
    if (original) {
        if (original.startsWith('[')) {
            try {
                contacts = JSON.parse(original);
            } catch (e) {
                // Fallback si no es JSON válido
            }
        } else {
            // Fallback para lista separada por comas
            contacts = original.split(',').map(em => ({
                email: em.trim().toLowerCase(),
                nombre: '',
                cargo: ''
            })).filter(c => c.email);
        }
    }
    
    if (!Array.isArray(contacts)) {
        contacts = [];
    }
    
    const exists = contacts.some(c => c.email && c.email.toLowerCase() === cleanEmail);
    if (!exists) {
        contacts.push({
            email: cleanEmail,
            nombre: (nombre || '').trim(),
            cargo: (cargo || '').trim()
        });
    } else {
        contacts = contacts.map(c => {
            if (c.email && c.email.toLowerCase() === cleanEmail) {
                return {
                    email: cleanEmail,
                    nombre: (nombre || c.nombre || '').trim(),
                    cargo: (cargo || c.cargo || '').trim()
                };
            }
            return c;
        });
    }
    
    return JSON.stringify(contacts);
}

/**
 * 1. Generar Invitación de Onboarding por WhatsApp
 * POST /api/logistica/b2b-onboarding/invitar
 */
exports.invitarCliente = async (req, res) => {
    try {
        const { cliente_id, codigo_bunker_cliente, id, canal, destino, mensajeTexto } = req.body;
        const resolvedId = cliente_id || codigo_bunker_cliente || id;
        if (!resolvedId) {
            return res.status(400).json({ success: false, error: 'Datos incompletos', message: 'El ID de cliente es obligatorio.' });
        }
        const clienteIdStr = String(resolvedId).trim();
        const canalSeleccionado = (canal === 'email') ? 'email' : 'whatsapp';

        console.log(`📡 [B2B-ONBOARDING] Generando invitación para cliente: ${clienteIdStr} | Canal: ${canalSeleccionado}`);

        // 1. Buscar cliente en la base de datos local
        const queryCliente = `
            SELECT id, codigo_bunker_cliente, lomas_soft_id, cuit_cuil, cliente_nombre, razon_social, whatsapp_facturas, email_portal, email_portal_nombre, email_portal_cargo, email_facturas
            FROM public.bunker_clientes 
            WHERE codigo_bunker_cliente = $1 
               OR lomas_soft_id = $1 
               OR (CASE WHEN $1 ~ '^[0-9]+$' THEN lomas_soft_id = LPAD($1, 4, '0') ELSE FALSE END)
               OR id::text = $1
            LIMIT 1
        `;
        const resCliente = await pool.query(queryCliente, [clienteIdStr]);
        if (resCliente.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No encontrado', message: 'El cliente no se encuentra registrado en el sistema Búnker.' });
        }

        const cliente = resCliente.rows[0];

        // 2. Extraer destino según el canal
        let whatsappDestino = '';
        let emailDestino = '';

        if (canalSeleccionado === 'email') {
            emailDestino = String(destino || cliente.email_portal || '').trim();
            if (!emailDestino) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Sin contacto email', 
                    message: 'La dirección de correo electrónico es obligatoria para enviar la invitación por Email.' 
                });
            }
        } else {
            // Canal WhatsApp
            if (destino) {
                whatsappDestino = sanitizarNumero(destino);
            } else {
                if (cliente.whatsapp_facturas && cliente.whatsapp_facturas.trim()) {
                    const val = cliente.whatsapp_facturas.trim();
                    if (val.startsWith('[')) {
                        try {
                            const contactos = JSON.parse(val);
                            const defaultContact = contactos.find(c => c.default_resumen === true) || 
                                                   contactos.find(c => c.default === true) || 
                                                   contactos[0];
                            if (defaultContact) whatsappDestino = defaultContact.numero;
                        } catch (e) {
                            whatsappDestino = val;
                        }
                    } else {
                        whatsappDestino = val;
                    }
                }
            }

            whatsappDestino = sanitizarNumero(whatsappDestino);
            if (!whatsappDestino) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Sin contacto móvil', 
                    message: 'El cliente no posee un número de WhatsApp configurado en su ficha.' 
                });
            }
        }
 
        // --- 2c. AUTO-LIMPIEZA DE REGISTROS PREVIOS EN SUPABASE (Evitar bloqueo "user already registered") ---
        try {
            const targetEmail = (emailDestino || cliente.email_portal || '').trim().toLowerCase();
            
            // A. Buscar si el cliente ya tiene un perfil registrado en Supabase
            const { data: profile } = await supabaseAdmin
                .from('clientes_b2b_perfiles')
                .select('id, email')
                .eq('cliente_id', cliente.codigo_bunker_cliente)
                .maybeSingle();

            if (profile) {
                console.log(`🧹 [B2B-ONBOARDING] Usuario previo encontrado para cliente ${cliente.codigo_bunker_cliente} (UUID: ${profile.id}). Eliminando...`);
                await supabaseAdmin.auth.admin.deleteUser(profile.id);
            }

            // B. Buscar si el correo electrónico ya está registrado en Supabase Auth
            if (targetEmail) {
                const { data: listUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
                if (!listError && listUsers && listUsers.users) {
                    const existingUser = listUsers.users.find(u => u.email && u.email.toLowerCase() === targetEmail);
                    if (existingUser) {
                        console.log(`🧹 [B2B-ONBOARDING] Correo previo registrado encontrado en Auth: ${targetEmail} (UUID: ${existingUser.id}). Eliminando...`);
                        await supabaseAdmin.auth.admin.deleteUser(existingUser.id);
                    }
                }
            }
        } catch (cleanErr) {
            console.error('⚠️ [B2B-ONBOARDING] Error no crítico durante la auto-limpieza en Supabase:', cleanErr.message);
        }

        // 3. Generar token de 64 caracteres y expiración de 72 horas
        const token = crypto.randomBytes(32).toString('hex');
        const codigoActivacion = token.substring(0, 6);
        const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 horas
 
        // 4. Registrar invitación en base local
        await pool.query(
            `INSERT INTO public.portal_invitaciones (token, cliente_id, expires_at)
             VALUES ($1, $2, $3)`,
            [token, cliente.codigo_bunker_cliente, expiresAt]
        );

        // Persistir el correo en la ficha local bunker_clientes si fue provisto en la invitación
        if (emailDestino) {
            const updatedEmailFacturas = agregarContactoEmail(cliente.email_facturas, emailDestino, cliente.email_portal_nombre, cliente.email_portal_cargo);
            await pool.query(
                `UPDATE public.bunker_clientes 
                 SET email_portal = $1,
                     email_facturas = $2,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE codigo_bunker_cliente = $3`,
                [emailDestino.toLowerCase(), updatedEmailFacturas, cliente.codigo_bunker_cliente]
            );
        }

        // 4b. Sincronizar listas de precios y directorio cloud + Registrar invitación en Supabase Cloud
        try {
            await sincronizarListasClienteEnNube(cliente.codigo_bunker_cliente);
            sincronizarTodoElDirectorioB2B().catch(() => {});

            const { contactName, phoneMasked } = parsearContactoWhatsapp(cliente.whatsapp_facturas);
            const bunkerNumMatch = String(cliente.codigo_bunker_cliente).match(/(\d+)/);
            const bunkerNum = bunkerNumMatch ? String(parseInt(bunkerNumMatch[1], 10)) : '';
            const legacyId = cliente.lomas_soft_id ? String(cliente.lomas_soft_id).trim() : null;
            const legacyNum = (legacyId && /^\d+$/.test(legacyId)) ? String(parseInt(legacyId, 10)) : legacyId;
            const cuitClean = cliente.cuit_cuil ? String(cliente.cuit_cuil).replace(/\D/g, '') : null;
            const nombreContactoInferido = (cliente.email_portal_nombre && String(cliente.email_portal_nombre).trim())
                ? String(cliente.email_portal_nombre).trim()
                : (contactName || null);

            const metadataCargoJson = JSON.stringify({
                legacy_id: legacyId,
                legacy_num: legacyNum,
                bunker_num: bunkerNum,
                cuit: cuitClean,
                nombre: cliente.cliente_nombre || cliente.razon_social,
                contact_name: nombreContactoInferido || '',
                phone_masked: phoneMasked
            });

            console.log(`📡 [B2B-ONBOARDING] Persistiendo invitación en Supabase: ${token}`);
            const supabaseUrlInvitacion = `${SUPABASE_URL}/rest/v1/clientes_b2b_invitaciones`;
            const responseSupaInvite = await fetch(supabaseUrlInvitacion, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    token: token,
                    cliente_id: cliente.codigo_bunker_cliente,
                    expires_at: expiresAt.toISOString(),
                    usado: false,
                    razon_social: cliente.razon_social || cliente.cliente_nombre,
                    email_portal: emailDestino || cliente.email_portal || '',
                    email_portal_nombre: nombreContactoInferido,
                    email_portal_cargo: metadataCargoJson
                })
            });

            if (!responseSupaInvite.ok) {
                const errSupaText = await responseSupaInvite.text();
                console.error('❌ [B2B-ONBOARDING] Error al guardar invitación en Supabase:', errSupaText);
            } else {
                console.log(`✅ [B2B-ONBOARDING] Invitación registrada con éxito en Supabase.`);
            }
        } catch (supaErr) {
            console.error('❌ [B2B-ONBOARDING] Falla de red al conectar con Supabase para registrar invitación:', supaErr.message);
        }
        // 5. Enviar mensaje de invitación por el canal seleccionado
        const portalUrl = process.env.B2B_PORTAL_URL || 'http://localhost:5173';
        // Usamos Hash Routing para evitar el error 404 del servidor/CDN en la carga inicial de subrutas.
        // Agregamos un parámetro de versión/token antes del Hash (?t=...) para evadir el agresivo caché
        // de pre-visualización de enlaces de WhatsApp (de lo contrario, WhatsApp muestra imágenes viejas).
        const linkOnboarding = `${portalUrl}/?t=${token.slice(0, 6)}`;
        
        if (canalSeleccionado === 'email') {
            console.log(`✉️ [B2B-ONBOARDING] Despachando mensaje de invitación por Email a: ${emailDestino}`);
            
            // Usar el texto editado o fallback con reemplazo de placeholder
            let textoCuerpo = mensajeTexto ? mensajeTexto.trim() : '';
            if (textoCuerpo) {
                if (textoCuerpo.includes('[Enlace_Al_Portal]')) {
                    textoCuerpo = textoCuerpo.replace(/\[Enlace_Al_Portal\]/g, linkOnboarding);
                } else {
                    textoCuerpo = textoCuerpo + `\n\nEntrá acá: ${linkOnboarding}`;
                }
                if (textoCuerpo.includes('[Codigo_Activacion]')) {
                    textoCuerpo = textoCuerpo.replace(/\[Codigo_Activacion\]/g, codigoActivacion);
                }
            } else {
                textoCuerpo = `¡Hola! Te damos la bienvenida al nuevo portal de LAMDA. Tu código de activación es: ${codigoActivacion}. Entrá acá: ${linkOnboarding}`;
            }
            const formattedHtmlBody = textoCuerpo.replace(/\n/g, '<br/>');
 
            const emailService = require('../../facturacion/services/emailService');
            await emailService.enviarEmail({
                to: emailDestino,
                subject: 'Invitación al Portal de LAMDA',
                htmlBody: `
                    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; color: #1e293b; background-color: #ffffff;">
                        <div style="text-align: center; margin-bottom: 24px; border-bottom: 2px solid #f1f5f9; padding-bottom: 16px;">
                            <h2 style="color: #8e4785; margin: 0; font-size: 24px; font-weight: bold;">Portal de LAMDA</h2>
                        </div>
                        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px; color: #334155;">¡Hola, <strong>${cliente.razon_social}</strong>!</p>
                        <p style="font-size: 15px; line-height: 1.6; margin-bottom: 24px; color: #334155;">
                            ${formattedHtmlBody}
                        </p>
                        <div style="text-align: center; margin-bottom: 30px;">
                            <a href="${linkOnboarding}" style="background-color: #8e4785; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block; font-size: 15px;">Activar Cuenta</a>
                        </div>
                        <p style="font-size: 13px; color: #64748b; margin-bottom: 0; border-top: 1px solid #f1f5f9; padding-top: 16px; line-height: 1.5;">
                            Este enlace tiene una validez de 72 horas. Si el botón no funciona, copie y pegue el siguiente enlace en su navegador: <br/>
                            <a href="${linkOnboarding}" style="color: #8e4785; word-break: break-all;">${linkOnboarding}</a>
                        </p>
                    </div>
                `
            });
        } else {
            // Usar el texto editado o fallback con reemplazo de placeholder
            let textoFinal = mensajeTexto ? mensajeTexto.trim() : '';
            if (textoFinal) {
                if (textoFinal.includes('[Enlace_Al_Portal]')) {
                    textoFinal = textoFinal.replace(/\[Enlace_Al_Portal\]/g, linkOnboarding);
                } else {
                    textoFinal = textoFinal + `\n\nEntrá acá: ${linkOnboarding}`;
                }
                if (textoFinal.includes('[Codigo_Activacion]')) {
                    textoFinal = textoFinal.replace(/\[Codigo_Activacion\]/g, codigoActivacion);
                }
            } else {
                textoFinal = `¡Hola! Te damos la bienvenida al nuevo portal de LAMDA. Tu código de activación es: ${codigoActivacion}. Entrá acá: ${linkOnboarding}`;
            }

            console.log(`📱 [B2B-ONBOARDING] Despachando mensaje de invitación por WhatsApp a: ${whatsappDestino}`);
            
            const responseWp = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-mensaje', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatarios: whatsappDestino,
                    mensajeTexto: textoFinal
                })
            });

            const resJson = await responseWp.json();
            if (!responseWp.ok || !resJson.success) {
                throw new Error(resJson.error || 'Falla del microservicio de mensajería (3004).');
            }
        }

        res.json({
            success: true,
            message: `Invitación generada y despachada por ${canalSeleccionado === 'email' ? 'Email' : 'WhatsApp'} con éxito.`,
            data: {
                cliente_id: cliente.codigo_bunker_cliente,
                canal: canalSeleccionado,
                destino: canalSeleccionado === 'email' ? emailDestino : whatsappDestino,
                expires_at: expiresAt,
                token: token,
                link: linkOnboarding
            }
        });

    } catch (error) {
        console.error('❌ [B2B-ONBOARDING] Error al enviar invitación:', error.message);
        res.status(500).json({ 
            success: false, 
            error: 'Falla del servidor', 
            message: 'No se pudo generar ni despachar la invitación en este momento. Intente más tarde.' 
        });
    }
};

/**
 * 2. Validar Token de Invitación (Desde Frontend)
 * GET /api/logistica/b2b-onboarding/validar-token
 */
exports.validarToken = async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) {
            return res.status(400).json({ success: false, error: 'Token requerido', message: 'Debe especificar el token de invitación en los parámetros.' });
        }

        const isShortCode = token.trim().length === 6;
        const queryToken = `
            SELECT i.token, i.cliente_id, i.expires_at, i.usado, bc.razon_social, bc.email_portal, bc.email_portal_nombre, bc.email_portal_cargo
            FROM public.portal_invitaciones i
            JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = i.cliente_id
            WHERE ${isShortCode ? "i.token LIKE $1 || '%'" : "i.token = $1"}
            ORDER BY i.expires_at DESC
            LIMIT 1
        `;
        const resToken = await pool.query(queryToken, [token.trim()]);
        if (resToken.rows.length === 0) {
            return res.status(400).json({ success: false, error: 'Inexistente', message: 'El código de activación no es válido o ha expirado.' });
        }

        const row = resToken.rows[0];
        
        if (row.usado) {
            return res.status(400).json({ success: false, error: 'Usado', message: 'Este código de activación ya ha sido utilizado.' });
        }

        if (new Date(row.expires_at) < new Date()) {
            return res.status(400).json({ success: false, error: 'Expirado', message: 'El código de activación ha expirado.' });
        }

        res.json({
            success: true,
            data: {
                token: row.token,
                cliente_id: row.cliente_id,
                razon_social: row.razon_social,
                email_portal: row.email_portal,
                email_portal_nombre: row.email_portal_nombre,
                email_portal_cargo: row.email_portal_cargo
            }
        });

    } catch (error) {
        console.error('❌ [B2B-ONBOARDING] Error al validar token:', error.message);
        res.status(500).json({ 
            success: false, 
            error: 'Falla del servidor', 
            message: 'Ocurrió un error en el servidor al verificar el token de acceso.' 
        });
    }
};

/**
 * 3. Completar Registro y Alta en Supabase Auth
 * POST /api/logistica/b2b-onboarding/completar-onboarding
 */
exports.completarOnboarding = async (req, res) => {
    try {
        const { token, email, password, nombre_contacto, cargo_contacto } = req.body;
        if (!token || !email || !password || !nombre_contacto) {
            return res.status(400).json({ success: false, error: 'Datos incompletos', message: 'El correo, la contraseña y el nombre de contacto son obligatorios.' });
        }

        const emailClean = String(email).trim().toLowerCase();

        // 1. Validar el token de invitación y obtener datos completos del cliente y sus listas
        const queryToken = `
            SELECT i.token, i.cliente_id, i.expires_at, i.usado,
                   bc.id AS bunker_id_num, bc.cliente_nombre, bc.razon_social, bc.cuit_cuil,
                   bc.ver_stock, bc.usuario_id, bc.email_facturas
            FROM public.portal_invitaciones i
            JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = i.cliente_id
            WHERE i.token = $1
            LIMIT 1
        `;
        const resToken = await pool.query(queryToken, [token]);
        if (resToken.rows.length === 0 || resToken.rows[0].usado || new Date(resToken.rows[0].expires_at) < new Date()) {
            return res.status(400).json({ success: false, error: 'Token inválido', message: 'El enlace no es válido, ya fue usado o ha expirado.' });
        }

        const tokenRow = resToken.rows[0];

        // Obtener las listas de precios asignadas a este cliente
        const listIds = await sincronizarListasClienteEnNube(tokenRow.cliente_id);
        const permisos = ['compras', 'pagos'];
        if (tokenRow.ver_stock) permisos.push('ver_stock');
        if (tokenRow.usuario_id || tokenRow.cliente_id === 'CB-0006') permisos.push('servicios_colaborador');
        const nombreCompletoFinal = nombre_contacto ? String(nombre_contacto).trim() : (tokenRow.cliente_nombre || tokenRow.razon_social);
        const nombreEmpresaFinal = tokenRow.razon_social || tokenRow.cliente_nombre;

        const appMetaPayload = {
            cliente_id: tokenRow.cliente_id,
            rol: 'Dueno',
            permisos: permisos,
            listas_precios: listIds.length > 0 ? listIds : [1],
            ver_stock: Boolean(tokenRow.ver_stock)
        };
        const userMetaPayload = {
            cliente_id: tokenRow.cliente_id,
            rol: 'Dueno',
            permisos: permisos,
            listas_precios: listIds.length > 0 ? listIds : [1],
            nombre_completo: nombreCompletoFinal,
            nombre_empresa: nombreEmpresaFinal
        };

        // 2. Validar que el correo no esté ocupado por otra cuenta en el ERP local
        const queryMailDuplicado = `
            SELECT codigo_bunker_cliente, razon_social 
            FROM public.bunker_clientes 
            WHERE email_portal = $1 AND codigo_bunker_cliente <> $2
        `;
        const resMailDuplicado = await pool.query(queryMailDuplicado, [emailClean, tokenRow.cliente_id]);
        if (resMailDuplicado.rows.length > 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Email duplicado', 
                message: 'El correo electrónico provisto ya se encuentra registrado para otro cliente.' 
            });
        }

        let userUuid = null;
        let isReactivation = false;

        // 3. Verificamos si el correo ya existe en Supabase public.clientes_b2b_perfiles
        console.log(`📡 [B2B-ONBOARDING] Verificando si el email ya existe en perfiles de Supabase: ${emailClean}`);
        const profileSearchUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_perfiles?email=eq.${encodeURIComponent(emailClean)}`;
        const profileSearchOptions = {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        };
        const responseSearch = await fetch(profileSearchUrl, profileSearchOptions);
        if (responseSearch.ok) {
            const profilesFound = await responseSearch.json();
            if (profilesFound.length > 0) {
                // Buscamos si hay un perfil que coincida con el cliente_id de la invitación
                const myProfile = profilesFound.find(p => p.cliente_id === tokenRow.cliente_id);
                const otherProfile = profilesFound.find(p => p.cliente_id !== tokenRow.cliente_id);

                if (myProfile) {
                    userUuid = myProfile.id;
                    isReactivation = true;
                    console.log(`✅ [B2B-ONBOARDING] Perfil existente encontrado en Supabase para este cliente. UUID: ${userUuid}`);
                } else if (otherProfile) {
                    // El correo ya está registrado pero para otro cliente_id
                    return res.status(400).json({
                        success: false,
                        error: 'Email duplicado',
                        message: 'El correo electrónico provisto ya se encuentra registrado para otro cliente.'
                    });
                }
            }
        }

        // 4. Si ya existe, actualizamos su contraseña y metadatos en Supabase Auth Admin API
        if (isReactivation && userUuid) {
            console.log(`🔑 [Supabase Auth] Actualizando contraseña y metadatos para usuario existente: ${userUuid}`);
            const updateAuthUrl = `${SUPABASE_URL}/auth/v1/admin/users/${userUuid}`;
            const updateAuthOptions = {
                method: 'PUT',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    password: password,
                    email_confirm: true,
                    app_metadata: appMetaPayload,
                    user_metadata: userMetaPayload
                })
            };
            const responseUpdate = await fetch(updateAuthUrl, updateAuthOptions);
            if (!responseUpdate.ok) {
                const updateData = await responseUpdate.json();
                const errMsg = updateData.msg || updateData.message || 'Error al actualizar la contraseña del usuario en el motor de autenticación.';
                console.error('❌ [Supabase Auth Update Error]:', updateData);
                return res.status(400).json({ success: false, error: 'Falla Auth', message: errMsg });
            }
            console.log(`✅ [B2B-ONBOARDING] Contraseña y metadatos actualizados en Supabase Auth.`);
        } else {
            // 5. Crear el usuario nuevo en Supabase Auth usando el GoTrue Admin API
            console.log(`☁️  [Supabase Auth] Registrando nuevo usuario para email: ${emailClean}`);
            const authUrl = `${SUPABASE_URL}/auth/v1/admin/users`;
            const authOptions = {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: emailClean,
                    password: password,
                    email_confirm: true,
                    app_metadata: appMetaPayload,
                    user_metadata: userMetaPayload
                })
            };

            const responseAuth = await fetch(authUrl, authOptions);
            const authData = await responseAuth.json();

            if (!responseAuth.ok) {
                // Manejar error de email ya registrado que no se detectó en perfiles
                const isAlreadyRegistered = authData.msg?.includes('already') || authData.message?.includes('already') || responseAuth.status === 422;
                if (isAlreadyRegistered) {
                    console.log(`📡 Buscando ID de usuario para email ya registrado en Auth: ${emailClean}`);
                    const listUsersUrl = `${SUPABASE_URL}/auth/v1/admin/users`;
                    const resList = await fetch(listUsersUrl, {
                        method: 'GET',
                        headers: {
                            'apikey': SUPABASE_KEY,
                            'Authorization': `Bearer ${SUPABASE_KEY}`
                        }
                    });
                    if (resList.ok) {
                        const usersData = await resList.json();
                        const existingUser = usersData.users.find(u => u.email && u.email.toLowerCase() === emailClean);
                        if (existingUser) {
                            userUuid = existingUser.id;
                            isReactivation = true;
                            
                            // Proceder a actualizar contraseña y metadatos
                            console.log(`🔑 [Supabase Auth] Actualizando contraseña para usuario existente (auth-only): ${userUuid}`);
                            const responseUpdate = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userUuid}`, {
                                method: 'PUT',
                                headers: {
                                    'apikey': SUPABASE_KEY,
                                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    password: password,
                                    email_confirm: true,
                                    app_metadata: appMetaPayload,
                                    user_metadata: userMetaPayload
                                })
                            });
                            if (!responseUpdate.ok) {
                                const updateData = await responseUpdate.json();
                                return res.status(400).json({ success: false, error: 'Falla Auth', message: updateData.message || 'Error al actualizar la contraseña.' });
                            }
                        } else {
                            return res.status(400).json({ success: false, error: 'Falla Auth', message: 'El correo electrónico ya está registrado.' });
                        }
                    } else {
                        return res.status(400).json({ success: false, error: 'Falla Auth', message: 'El correo electrónico ya está registrado.' });
                    }
                } else {
                    const errMsg = authData.msg || authData.message || 'Error en el registro del motor de autenticación.';
                    console.error('❌ [Supabase Auth Error]:', authData);
                    return res.status(400).json({ success: false, error: 'Falla Auth', message: errMsg });
                }
            } else {
                userUuid = authData.id;
            }
        }

        // 6. Crear/Actualizar el perfil en Supabase (public.clientes_b2b_perfiles)
        console.log(`☁️  [Supabase DB] Creando/Actualizando perfil B2B para UUID: ${userUuid}`);
        const profileUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_perfiles`;
        const profileOptions = {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates,return=representation'
            },
            body: JSON.stringify({
                id: userUuid,
                cliente_id: tokenRow.cliente_id,
                rol: 'Dueno',
                permisos: permisos,
                nombre_completo: nombreCompletoFinal,
                nombre_empresa: nombreEmpresaFinal,
                cuit: tokenRow.cuit_cuil || null,
                email: emailClean,
                ver_stock: Boolean(tokenRow.ver_stock)
            })
        };

        const responseProfile = await fetch(profileUrl, profileOptions);
        if (!responseProfile.ok) {
            const errText = await responseProfile.text();
            console.error('❌ [Supabase DB Error] No se pudo crear o actualizar el perfil de cliente:', errText);
            if (!isReactivation) {
                // Revertir creación de auth si falló perfil nuevo
                await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userUuid}`, {
                    method: 'DELETE',
                    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
                });
            }
            throw new Error('Falla al instanciar el perfil de usuario en el catálogo contable de Supabase.');
        }

        // 7. Actualizar la base de datos local y marcar invitación como usada
        const clientLocal = await pool.connect();
        try {
            await clientLocal.query('BEGIN');
            // Graba el correo portal, email de facturación estructurado, nombre y cargo de contacto
            const updatedEmailFacturas = agregarContactoEmail(
                tokenRow.email_facturas, 
                emailClean, 
                nombre_contacto ? String(nombre_contacto).trim() : '', 
                cargo_contacto ? String(cargo_contacto).trim() : ''
            );
            await clientLocal.query(
                `UPDATE public.bunker_clientes 
                 SET email_portal = $1, 
                     email_facturas = $2,
                     email_portal_nombre = COALESCE($3, email_portal_nombre),
                     email_portal_cargo = COALESCE($4, email_portal_cargo),
                     updated_at = CURRENT_TIMESTAMP 
                 WHERE codigo_bunker_cliente = $5`,
                [
                    emailClean, 
                    updatedEmailFacturas,
                    nombre_contacto ? String(nombre_contacto).trim() : null, 
                    cargo_contacto ? String(cargo_contacto).trim() : null, 
                    tokenRow.cliente_id
                ]
            );
            // Inactiva el token en base local y en Supabase Cloud
            await clientLocal.query(
                `UPDATE public.portal_invitaciones SET usado = true WHERE token = $1`,
                [token]
            );
            await clientLocal.query('COMMIT');
        } catch (dbErr) {
            await clientLocal.query('ROLLBACK');
            throw dbErr;
        } finally {
            clientLocal.release();
        }

        try {
            await supabaseAdmin
                .from('clientes_b2b_invitaciones')
                .update({ usado: true })
                .eq('token', token);
            sincronizarTodoElDirectorioB2B().catch(() => {});
        } catch (e) {}

        console.log(`✅ [B2B-ONBOARDING] Registro completado para ${tokenRow.cliente_id}. Email: ${emailClean}`);

        res.json({
            success: true,
            isReactivation,
            message: isReactivation
                ? 'Su cuenta ya se encontraba activa. La contraseña ha sido actualizada con éxito.'
                : 'Acceso registrado correctamente. Ya puede iniciar sesión en el portal B2B.'
        });

    } catch (error) {
        console.error('❌ [B2B-ONBOARDING] Error al completar onboarding:', error.message);
        res.status(500).json({ 
            success: false, 
            error: 'Error interno', 
            message: 'Ocurrió un error en el servidor al registrar su cuenta comercial.' 
        });
    }
};

/**
 * 4. Solicitar OTP por WhatsApp (Autoservicio)
 * POST /api/logistica/b2b-onboarding/otp/solicitar
 */
exports.solicitarOtp = async (req, res) => {
    try {
        const { cliente_id, whatsapp } = req.body;
        if (!cliente_id || !whatsapp) {
            return res.status(400).json({ success: false, error: 'Datos incompletos', message: 'El código de cliente y el número de WhatsApp son obligatorios.' });
        }
        const clienteIdStr = String(cliente_id).trim();

        const ingresadoSanitizado = sanitizarNumero(whatsapp);
        if (!ingresadoSanitizado) {
            return res.status(400).json({ success: false, error: 'Móvil no válido', message: 'El número de WhatsApp ingresado no posee un formato correcto.' });
        }

        // 1. Buscar cliente en la base local
        const queryCliente = `
            SELECT codigo_bunker_cliente, cliente_nombre, razon_social, whatsapp_facturas 
            FROM public.bunker_clientes 
            WHERE codigo_bunker_cliente = $1 
               OR lomas_soft_id = $1 
               OR (CASE WHEN $1 ~ '^[0-9]+$' THEN lomas_soft_id = LPAD($1, 4, '0') ELSE FALSE END)
            LIMIT 1
        `;
        const resCliente = await pool.query(queryCliente, [clienteIdStr]);
        if (resCliente.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No encontrado', message: 'El código de cliente no corresponde a un distribuidor registrado.' });
        }

        const cliente = resCliente.rows[0];

        // 2. Validar coincidencia de teléfono con contactos registrados
        if (!verificarCoincidenciaTelefono(cliente.whatsapp_facturas, ingresadoSanitizado)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Sin coincidencia', 
                message: 'El número de WhatsApp ingresado no coincide con el registrado en su ficha de cliente. Póngase en contacto con la distribuidora para actualizar sus datos de contacto.' 
            });
        }

        // 3. Generar OTP de 6 dígitos
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos de vigencia

        // 4. Persistir OTP en base local
        await pool.query(
            `INSERT INTO public.portal_otp (cliente_id, whatsapp, codigo, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [cliente.codigo_bunker_cliente, ingresadoSanitizado, otp, expiresAt]
        );

        // 5. Despachar el OTP por WhatsApp a través del puerto 3004
        const mensajeTexto = `🔑 *Portal B2B LAMDA*
Su código de activación es: *${otp}*

_Este código expira en 5 minutos._`;

        console.log(`📱 [B2B-OTP] Despachando OTP a: ${ingresadoSanitizado}`);

        const responseWp = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-mensaje', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                destinatarios: ingresadoSanitizado,
                mensajeTexto: mensajeTexto
            })
        });

        const resJson = await responseWp.json();
        if (!responseWp.ok || !resJson.success) {
            throw new Error(resJson.error || 'Falla del microservicio de mensajería (3004).');
        }

        res.json({
            success: true,
            message: 'Código de verificación OTP enviado exitosamente por WhatsApp.'
        });

    } catch (error) {
        console.error('❌ [B2B-OTP] Error al solicitar OTP:', error.message);
        res.status(500).json({ 
            success: false, 
            error: 'Falla del servidor', 
            message: 'No se pudo despachar el código OTP en este momento. Intente más tarde.' 
        });
    }
};

/**
 * 5. Verificar OTP y Generar Token de Activación
 * POST /api/logistica/b2b-onboarding/otp/verificar
 */
exports.verificarOtp = async (req, res) => {
    try {
        const { cliente_id, otp } = req.body;
        if (!cliente_id || !otp) {
            return res.status(400).json({ success: false, error: 'Datos incompletos', message: 'El código de cliente y el OTP son requeridos.' });
        }

        const clienteIdStr = String(cliente_id).trim();
        const otpClean = String(otp).trim();

        // 1. Obtener el codigo_bunker_cliente real (resuelve ceros a la izquierda y códigos Lomasoft)
        const queryCliente = `
            SELECT codigo_bunker_cliente 
            FROM public.bunker_clientes 
            WHERE codigo_bunker_cliente = $1 
               OR lomas_soft_id = $1 
               OR (CASE WHEN $1 ~ '^[0-9]+$' THEN lomas_soft_id = LPAD($1, 4, '0') ELSE FALSE END)
            LIMIT 1
        `;
        const resCliente = await pool.query(queryCliente, [clienteIdStr]);
        if (resCliente.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No encontrado', message: 'El código de cliente no corresponde a un distribuidor registrado.' });
        }

        const realClienteId = resCliente.rows[0].codigo_bunker_cliente;

        // 2. Buscar último OTP generado para este cliente
        const queryOtp = `
            SELECT id, codigo, expires_at, intentos, whatsapp
            FROM public.portal_otp
            WHERE cliente_id = $1
            ORDER BY created_at DESC
            LIMIT 1
        `;
        const resOtp = await pool.query(queryOtp, [realClienteId]);
        if (resOtp.rows.length === 0) {
            return res.status(400).json({ success: false, error: 'Inexistente', message: 'No se ha solicitado ningún código de activación para esta cuenta.' });
        }

        const otpRow = resOtp.rows[0];

        // 3. Control de intentos fallidos
        if (otpRow.intentos >= 3) {
            return res.status(400).json({ 
                success: false, 
                error: 'Bloqueado', 
                message: 'Código bloqueado por exceso de intentos fallidos. Solicite uno nuevo.' 
            });
        }

        // 4. Control de vigencia temporal
        if (new Date(otpRow.expires_at) < new Date()) {
            return res.status(400).json({ success: false, error: 'Expirado', message: 'El código de activación ha expirado. Solicite uno nuevo.' });
        }

        // 5. Comparación de código
        if (otpRow.codigo !== otpClean) {
            // Incrementar intento fallido
            await pool.query(
                `UPDATE public.portal_otp SET intentos = intentos + 1 WHERE id = $1`,
                [otpRow.id]
            );
            
            const restantes = 3 - (otpRow.intentos + 1);
            return res.status(400).json({ 
                success: false, 
                error: 'Incorrecto', 
                message: restantes > 0 
                    ? `Código incorrecto. Le quedan ${restantes} intento(s) antes de bloquear el código.` 
                    : 'Código incorrecto. Código bloqueado. Solicite uno nuevo.' 
            });
        }

        // 6. Verificación Exitosa: Generamos un token de onboarding de corta duración (15 minutos)
        // para enlazarlo con el flujo de carga final.
        const activationToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

        await pool.query(
            `INSERT INTO public.portal_invitaciones (token, cliente_id, expires_at)
             VALUES ($1, $2, $3)`,
            [activationToken, realClienteId, expiresAt]
        );

        console.log(`✅ [B2B-OTP] OTP verificado para cliente: ${realClienteId}. Token temporal generado.`);

        res.json({
            success: true,
            message: 'Verificación exitosa.',
            token: activationToken
        });

    } catch (error) {
        console.error('❌ [B2B-OTP] Error al verificar OTP:', error.message);
        res.status(500).json({ 
            success: false, 
            error: 'Falla del servidor', 
            message: 'Ocurrió un error al procesar la verificación del código OTP.' 
        });
    }
};

/**
 * Helper para validar si una IP proviene de la intranet/LAN local o localhost.
 */
function esIpPrivada(ip) {
    if (!ip) return false;
    let cleanIp = String(ip).trim();
    if (cleanIp.startsWith('::ffff:')) {
        cleanIp = cleanIp.substring(7);
    }
    
    // Loopback
    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
        return true;
    }
    
    // RFC 1918 Private IP ranges
    const parts = cleanIp.split('.');
    if (parts.length === 4) {
        const p1 = parseInt(parts[0], 10);
        const p2 = parseInt(parts[1], 10);
        if (p1 === 10) return true;
        if (p1 === 172 && (p2 >= 16 && p2 <= 31)) return true;
        if (p1 === 192 && p2 === 168) return true;
    }
    return false;
}

/**
 * Generar enlace de Acceso Maestro (Bypass de Autenticación)
 * GET /api/logistica/b2b-onboarding/acceso-maestro/:clienteId
 */
exports.accesoMaestro = async (req, res) => {
    try {
        const { clienteId } = req.params;
        if (!clienteId) {
            return res.status(400).json({ success: false, error: 'Datos incompletos', message: 'El ID de cliente es obligatorio.' });
        }

        // 1. Validar seguridad: Solo peticiones desde la Intranet/LAN
        const clientIp = req.ip || req.connection.remoteAddress;
        console.log(`🔐 [B2B-ACCESO-MAESTRO] Solicitud recibida desde IP: ${clientIp} para cliente: ${clienteId}`);

        if (!esIpPrivada(clientIp)) {
            console.warn(`🚨 [B2B-ACCESO-MAESTRO] Intento de acceso bloqueado. IP pública no autorizada: ${clientIp}`);
            return res.status(403).json({ 
                success: false, 
                error: 'Acceso denegado', 
                message: 'Esta funcionalidad de Llave Maestra solo es válida para solicitudes iniciadas desde la red interna de la empresa.' 
            });
        }

        // 2. Buscar el email del cliente en Supabase B2B, Auth Cloud o BD local
        let targetEmail = null;

        // A. Intentar consulta en clientes_b2b_perfiles
        try {
            const { data: profile } = await supabaseAdmin
                .from('clientes_b2b_perfiles')
                .select('email')
                .eq('cliente_id', String(clienteId).trim())
                .maybeSingle();
            if (profile && profile.email) targetEmail = profile.email;
        } catch (e) {}

        // B. Intentar consulta en Auth Users por app_metadata.cliente_id
        if (!targetEmail && supabaseAdmin) {
            try {
                const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
                const matchedUser = (usersData?.users || []).find(u => 
                    u.app_metadata?.cliente_id === clienteId ||
                    u.user_metadata?.cliente_id === clienteId
                );
                if (matchedUser && matchedUser.email) targetEmail = matchedUser.email;
            } catch (e) {}
        }

        // C. Intentar consulta en bunker_clientes en PostgreSQL local
        if (!targetEmail) {
            try {
                const resCli = await pool.query(
                    `SELECT email_portal, email_facturas FROM public.bunker_clientes WHERE codigo_bunker_cliente = $1 LIMIT 1`,
                    [clienteId]
                );
                if (resCli.rows.length > 0) {
                    const row = resCli.rows[0];
                    if (row.email_portal) {
                        targetEmail = row.email_portal;
                    } else if (row.email_facturas) {
                        try {
                            const parsed = JSON.parse(row.email_facturas);
                            if (Array.isArray(parsed) && parsed[0]?.email) {
                                targetEmail = parsed[0].email;
                            }
                        } catch (e) {}
                    }
                }
            } catch (e) {}
        }

        if (!targetEmail && clienteId === 'CB-0038') {
            targetEmail = 'martin@lamdaser.com';
        }

        if (!targetEmail) {
            return res.status(404).json({ 
                success: false, 
                error: 'No registrado', 
                message: 'El cliente no posee un perfil activo en el Portal B2B. Debe invitarlo y completar el onboarding primero.' 
            });
        }

        // 2b. Auto-recuperación y verificación preventiva de consistencia Cloud (Self-Healing)
        // Asegura que el usuario exista en Auth, tenga su perfil en clientes_b2b_perfiles,
        // sus listas en clientes_b2b_perfiles_listas y app_metadata con cliente_id y listas_precios.
        try {
            const resLocalCli = await pool.query(
                `SELECT bc.id, bc.codigo_bunker_cliente, bc.cliente_nombre, bc.razon_social, bc.cuit_cuil, bc.email_portal, bc.email_portal_nombre, bc.ver_stock, bc.lomas_soft_id
                 FROM public.bunker_clientes bc
                 WHERE bc.codigo_bunker_cliente = $1 
                    OR bc.lomas_soft_id = $1 
                    OR (CASE WHEN $1 ~ '^[0-9]+$' THEN bc.lomas_soft_id = LPAD($1, 4, '0') ELSE FALSE END)
                 LIMIT 1`,
                [clienteId]
            );
            const localCli = resLocalCli.rows[0];

            if (localCli) {
                const targetCid = localCli.codigo_bunker_cliente;
                const cleanEmail = targetEmail.trim().toLowerCase();

                // Buscar usuario en Auth
                const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
                let matchedUser = (usersData?.users || []).find(u => 
                    u.email?.toLowerCase() === cleanEmail ||
                    u.app_metadata?.cliente_id === targetCid ||
                    (localCli.lomas_soft_id && u.app_metadata?.cliente_id === localCli.lomas_soft_id)
                );

                if (!matchedUser) {
                    console.log(`✨ [B2B-ACCESO-MAESTRO] Creando usuario Auth para ${cleanEmail} (${targetCid})...`);
                    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
                        email: cleanEmail,
                        password: crypto.randomBytes(16).toString('hex'),
                        email_confirm: true,
                        user_metadata: {
                            cliente_id: targetCid,
                            nombre_completo: localCli.email_portal_nombre || localCli.cliente_nombre,
                            nombre_empresa: localCli.razon_social || localCli.cliente_nombre
                        }
                    });
                    if (!createErr && created?.user) {
                        matchedUser = created.user;
                    }
                }

                if (matchedUser) {
                    // Obtener listas asignadas localmente
                    const resListas = await pool.query(
                        `SELECT bunker_lista_precio_id FROM public.bunker_cliente_listas_precios WHERE bunker_cliente_id = $1`,
                        [localCli.id]
                    );
                    const listIds = resListas.rows.map(r => parseInt(r.bunker_lista_precio_id, 10)).filter(lid => !isNaN(lid));

                    const permisos = ['compras', 'pagos'];
                    if (localCli.ver_stock) permisos.push('ver_stock');

                    // Asegurar perfil en clientes_b2b_perfiles
                    await supabaseAdmin.from('clientes_b2b_perfiles').upsert({
                        id: matchedUser.id,
                        cliente_id: targetCid,
                        rol: matchedUser.app_metadata?.rol || 'Dueno',
                        permisos: permisos,
                        nombre_completo: localCli.email_portal_nombre || localCli.cliente_nombre,
                        nombre_empresa: localCli.razon_social || localCli.cliente_nombre,
                        cuit: localCli.cuit_cuil,
                        email: cleanEmail,
                        ver_stock: !!localCli.ver_stock,
                        updated_at: new Date().toISOString()
                    });

                    // Asegurar listas en clientes_b2b_perfiles_listas
                    if (listIds.length > 0) {
                        for (let idx = 0; idx < listIds.length; idx++) {
                            await supabaseAdmin.from('clientes_b2b_perfiles_listas').upsert({
                                cliente_id: targetCid,
                                lista_id: listIds[idx],
                                es_principal: idx === 0,
                                permitir_toggle_iva: false
                            }, { onConflict: 'cliente_id,lista_id' });
                        }
                    }

                    // Actualizar auth.users app_metadata
                    await supabaseAdmin.auth.admin.updateUserById(matchedUser.id, {
                        app_metadata: {
                            ...(matchedUser.app_metadata || {}),
                            cliente_id: targetCid,
                            listas_precios: listIds,
                            permisos: permisos,
                            rol: matchedUser.app_metadata?.rol || 'Dueno',
                            ver_stock: !!localCli.ver_stock
                        }
                    });
                    console.log(`🛡️ [B2B-ACCESO-MAESTRO] Consistencia garantizada para ${cleanEmail}: cliente_id=${targetCid}, listas=[${listIds.join(',')}]`);
                }
            }
        } catch (healErr) {
            console.warn('⚠️ [B2B-ACCESO-MAESTRO] Advertencia en auto-reparación previa:', healErr.message);
        }

        // 3. Generar el magiclink con la API de administración de Supabase Auth
        const activeCloudflareUrl = 'https://proud-darkness-ac3d.miserrano75.workers.dev';
        let portalUrl = process.env.B2B_PORTAL_URL || activeCloudflareUrl;
        
        const ref = req.headers.referer || req.headers.origin || '';
        if (ref.includes('workers.dev')) {
            try {
                const u = new URL(ref);
                portalUrl = u.origin;
            } catch(e) {}
        }

        const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email: targetEmail,
            options: {
                redirectTo: `${portalUrl}/`
            }
        });

        if (linkErr) {
            console.error('❌ [B2B-ACCESO-MAESTRO] Error al generar Magic Link:', linkErr.message);
            return res.status(500).json({ success: false, error: 'Error Auth', message: 'No se pudo generar el enlace de acceso maestro.' });
        }

        let magicLink = linkData.properties?.action_link;
        if (magicLink) {
            try {
                const parsedUrl = new URL(magicLink);
                parsedUrl.searchParams.set('redirect_to', `${portalUrl}/`);
                magicLink = parsedUrl.toString();
            } catch (e) {}
        }

        console.log(`✨ [B2B-ACCESO-MAESTRO] Magic Link generado exitosamente para ${targetEmail}: ${magicLink}`);

        res.json({
            success: true,
            magicLink: magicLink,
            redirectUrl: magicLink,
            url: magicLink,
            email: targetEmail,
            message: 'Acceso maestro generado exitosamente.'
        });

    } catch (error) {
        console.error('❌ [B2B-ACCESO-MAESTRO] Error interno:', error.message);
        res.status(500).json({ success: false, error: 'Error interno', message: 'Falla al procesar la solicitud de acceso maestro.' });
    }
};

/**
 * 7. Cambiar Contraseña de Cliente en Supabase Auth Cloud
 * POST /api/logistica/b2b-onboarding/cambiar-password
 */
exports.cambiarPassword = async (req, res) => {
    try {
        const { cliente_id, password } = req.body;
        if (!cliente_id || !password) {
            return res.status(400).json({ success: false, error: 'Datos incompletos', message: 'El cliente y la nueva contraseña son obligatorios.' });
        }

        const clienteIdClean = String(cliente_id).trim();

        // 1. Resolver cliente en bunker_clientes
        const queryCliente = `
            SELECT codigo_bunker_cliente, email_portal, cliente_nombre, razon_social 
            FROM public.bunker_clientes 
            WHERE codigo_bunker_cliente = $1 
               OR lomas_soft_id = $1 
               OR (CASE WHEN $1 ~ '^[0-9]+$' THEN lomas_soft_id = LPAD($1, 4, '0') ELSE FALSE END)
            LIMIT 1
        `;
        const resCliente = await pool.query(queryCliente, [clienteIdClean]);
        if (resCliente.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No encontrado', message: 'El código de cliente no corresponde a un distribuidor registrado.' });
        }
        const cliente = resCliente.rows[0];

        // 2. Buscar usuario en Supabase Auth mediante Supabase Admin API
        const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
        let targetUser = users?.find(u => {
            const cid = u.user_metadata?.cliente_id || u.app_metadata?.cliente_id;
            return cid === cliente.codigo_bunker_cliente || (u.email && cliente.email_portal && u.email.toLowerCase() === cliente.email_portal.toLowerCase());
        });

        if (!targetUser) {
            // Si el usuario no existe en Supabase Auth, crearlo con las credenciales
            const targetEmail = cliente.email_portal || `${cliente.codigo_bunker_cliente.toLowerCase()}@b2b.lamdaser.com`;
            const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
                email: targetEmail,
                password: password,
                email_confirm: true,
                user_metadata: {
                    cliente_id: cliente.codigo_bunker_cliente,
                    nombre_empresa: cliente.razon_social || cliente.cliente_nombre
                },
                app_metadata: {
                    cliente_id: cliente.codigo_bunker_cliente,
                    listas_precios: [1, 2],
                    rol: 'Dueno'
                }
            });
            if (createErr) throw createErr;
            targetUser = created.user;
        } else {
            // Actualizar contraseña de forma segura usando Supabase Admin API
            const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(targetUser.id, {
                password: password,
                email_confirm: true
            });
            if (updateErr) throw updateErr;
        }

        console.log(`✅ [B2B-CAMBIAR-PASSWORD] Contraseña actualizada exitosamente en Supabase Cloud para ${cliente.codigo_bunker_cliente} (${targetUser.email})`);

        res.json({
            success: true,
            email: targetUser.email,
            message: 'Contraseña actualizada correctamente.'
        });

    } catch (err) {
        console.error('❌ [B2B-CAMBIAR-PASSWORD] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * 8. Generar Enlace de Vinculación Rápida de Dispositivo (Magic Link + QR)
 * POST /api/logistica/b2b-onboarding/generar-vinculo-dispositivo
 * POST /api/b2b/generar-vinculo-dispositivo
 */
exports.generarVinculoDispositivo = async (req, res) => {
    try {
        let targetEmail = null;
        let targetCid = null;

        // 1. Validar Bearer Token si viene en headers
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
                if (userData?.user) {
                    targetEmail = userData.user.email;
                    targetCid = userData.user.app_metadata?.cliente_id || userData.user.user_metadata?.cliente_id;
                }
            } catch (e) {}
        }

        // 2. Si no vino por token o es llamada directa, tomar clienteId o email del body
        if (!targetEmail) {
            targetCid = req.body.clienteId || req.body.cliente_id || targetCid;
            targetEmail = req.body.email || null;
        }

        if (!targetEmail && targetCid) {
            try {
                const { data: profile } = await supabaseAdmin
                    .from('clientes_b2b_perfiles')
                    .select('email')
                    .eq('cliente_id', targetCid)
                    .maybeSingle();
                if (profile && profile.email) targetEmail = profile.email;
            } catch (e) {}

            if (!targetEmail) {
                try {
                    const resCli = await pool.query(
                        `SELECT email_portal, email_facturas FROM public.bunker_clientes WHERE codigo_bunker_cliente = $1 LIMIT 1`,
                        [targetCid]
                    );
                    if (resCli.rows.length > 0) {
                        const row = resCli.rows[0];
                        targetEmail = row.email_portal;
                        if (!targetEmail && row.email_facturas) {
                            try {
                                const parsed = JSON.parse(row.email_facturas);
                                if (Array.isArray(parsed) && parsed[0]?.email) targetEmail = parsed[0].email;
                            } catch (e) {}
                        }
                    }
                } catch (e) {}
            }

            if (!targetEmail) {
                targetEmail = `${targetCid.toLowerCase()}@lamdaclientes.com`;
            }
        }

        if (!targetEmail) {
            return res.status(400).json({ 
                success: false, 
                error: 'Identificación requerida', 
                message: 'No se pudo identificar la cuenta del cliente para generar el vínculo.' 
            });
        }

        // 3. Generar Magic Link con Supabase Auth Admin
        const activeCloudflareUrl = 'https://proud-darkness-ac3d.miserrano75.workers.dev';
        const portalUrl = process.env.B2B_PORTAL_URL || activeCloudflareUrl;

        const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email: targetEmail,
            options: {
                redirectTo: `${portalUrl}/`
            }
        });

        if (linkErr) {
            console.error('❌ [B2B-VINCULO] Error al generar Magic Link:', linkErr.message);
            return res.status(500).json({ success: false, error: 'Error Auth', message: linkErr.message });
        }

        let magicLink = linkData.properties?.action_link;
        if (magicLink) {
            try {
                const parsedUrl = new URL(magicLink);
                parsedUrl.searchParams.set('redirect_to', `${portalUrl}/`);
                magicLink = parsedUrl.toString();
            } catch (e) {}
        }

        // 4. Generar QR Code en formato DataURL
        let qrDataUrl = '';
        try {
            qrDataUrl = await QRCode.toDataURL(magicLink, {
                errorCorrectionLevel: 'M',
                margin: 2,
                width: 320,
                color: {
                    dark: '#0f172a',
                    light: '#ffffff'
                }
            });
        } catch (qrErr) {
            console.warn('⚠️ [B2B-VINCULO] Error generando QR Base64:', qrErr.message);
        }

        console.log(`📱 [B2B-VINCULO] Vínculo generado para ${targetEmail} (Cliente: ${targetCid || 'N/A'})`);

        res.json({
            success: true,
            magicLink: magicLink,
            url: magicLink,
            qrDataUrl: qrDataUrl,
            email: targetEmail,
            clienteId: targetCid,
            expiresInSeconds: 600
        });

    } catch (error) {
        console.error('❌ [B2B-VINCULO] Error interno:', error.message);
        res.status(500).json({ success: false, error: 'Error interno', message: error.message });
    }
};

/**
 * 🔄 Bucle automático para escuchar e intermediar el envío de OTPs de Supabase Cloud a WhatsApp 3004
 */
let cloudOtpTimer = null;
async function procesarOtpsPendientesCloud() {
    try {
        // 1. Escuchar solicitudes OTP por WhatsApp (tipo_acceso: OTPWAP-code-clienteId)
        const { data: pendingOtps, error } = await supabaseAdmin
            .from('telemetria_accesos')
            .select('*')
            .or('tipo_acceso.ilike.OTPWAP-%,tipo_acceso.ilike.OTP-%')
            .not('tipo_acceso', 'like', 'OTPEMAIL-%')
            .not('tipo_acceso', 'like', '%-SENT')
            .order('created_at', { ascending: false })
            .limit(10);

        if (pendingOtps && pendingOtps.length > 0) {
            for (const otpItem of pendingOtps) {
                const match = otpItem.tipo_acceso.match(/(?:OTPWAP|OTP)-(\d{4})-(.+)/);
                if (match) {
                    const otpCode = match[1];
                    const clienteId = match[2];

                    let destinatario = '5492216615746';
                    try {
                        const resCli = await pool.query(
                            `SELECT whatsapp_facturas FROM public.bunker_clientes WHERE codigo_bunker_cliente = $1 LIMIT 1`,
                            [clienteId]
                        );
                        if (resCli.rows.length > 0 && resCli.rows[0].whatsapp_facturas) {
                            const rawWp = resCli.rows[0].whatsapp_facturas;
                            let targetNum = rawWp;
                            if (typeof rawWp === 'string' && rawWp.trim().startsWith('[')) {
                                try {
                                    const parsedArray = JSON.parse(rawWp);
                                    const activeContact = parsedArray.find(c => c.enviar_alerta || c.numero) || parsedArray[0];
                                    if (activeContact && activeContact.numero) {
                                        targetNum = activeContact.numero;
                                    }
                                } catch (e) {}
                            }
                            const numClean = sanitizarNumero(targetNum);
                            if (numClean && numClean.length >= 10) {
                                destinatario = numClean.startsWith('549') ? numClean : `549${numClean.replace(/^0+/, '')}`;
                            }
                        }
                    } catch (e) {}

                    console.log(`📲 [B2B-CLOUD-DISPATCHER] Despachando WhatsApp para ${clienteId} (OTP ${otpCode}) a ${destinatario}...`);

                    const mensajeTexto = `🔑 *Portal B2B LAMDA*
Su código de verificación de 4 cifras es: *${otpCode}*

_Este código expira en 5 minutos._`;

                    const fetchModule = await import('node-fetch');
                    const fetchFn = fetchModule.default || fetchModule;

                    const responseWp = await fetchFn('http://localhost:3004/facturacion/whatsapp/enviar-mensaje', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            destinatarios: destinatario,
                            mensajeTexto: mensajeTexto
                        })
                    });

                    const resJson = await responseWp.json();
                    if (responseWp.ok && resJson.success) {
                        console.log(`✅ [B2B-CLOUD-DISPATCHER] WhatsApp ${otpCode} enviado exitosamente a ${destinatario}!`);
                        await supabaseAdmin
                            .from('telemetria_accesos')
                            .update({ tipo_acceso: `${otpItem.tipo_acceso}-SENT` })
                            .eq('id', otpItem.id);
                    }
                }
            }
        }

        // 2. Escuchar solicitudes OTP por Email (OTPEMAIL-code-email-clienteId)
        const { data: pendingEmails } = await supabaseAdmin
            .from('telemetria_accesos')
            .select('*')
            .like('tipo_acceso', 'OTPEMAIL-%')
            .not('tipo_acceso', 'like', '%-SENT')
            .order('created_at', { ascending: false })
            .limit(5);

        if (pendingEmails && pendingEmails.length > 0) {
            const emailService = require('../../facturacion/services/emailService');
            for (const item of pendingEmails) {
                const parts = item.tipo_acceso.split('-');
                if (parts.length >= 4) {
                    const otpCode = parts[1];
                    const targetEmail = parts[2];
                    const clienteId = parts[3];

                    console.log(`📧 [B2B-CLOUD-DISPATCHER] Despachando Email de OTP ${otpCode} a ${targetEmail} (${clienteId})...`);

                    try {
                        const resMail = await emailService.enviarEmail({
                            to: targetEmail,
                            subject: `🔑 Código de Verificación B2B: ${otpCode}`,
                            htmlBody: `
                                <div style="font-family: Arial, sans-serif; max-width: 500px; padding: 25px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; margin: 0 auto;">
                                  <div style="text-align: center; margin-bottom: 20px;">
                                    <h2 style="color: #4f46e5; margin: 0; font-size: 22px;">Portal B2B LAMDA</h2>
                                    <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Recuperación de Contraseña</p>
                                  </div>
                                  <p style="font-size: 15px; color: #1e293b;">Hola <b>${item.cliente_nombre || 'Distribuidor B2B'}</b>,</p>
                                  <p style="font-size: 14px; color: #475569;">Su código de verificación de 4 cifras para el Portal B2B es:</p>
                                  <div style="text-align: center; margin: 25px 0;">
                                    <span style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #4f46e5; background: #e0e7ff; padding: 12px 28px; border-radius: 10px; border: 1px solid #c7d2fe; display: inline-block;">${otpCode}</span>
                                  </div>
                                  <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 20px;">Este código expira en 5 minutos. Si usted no solicitó este código, ignore este mensaje.</p>
                                </div>
                            `
                        });

                        if (resMail && resMail.success) {
                            console.log(`✅ [B2B-CLOUD-DISPATCHER] Email de OTP ${otpCode} enviado a ${targetEmail}!`);
                            await supabaseAdmin
                                .from('telemetria_accesos')
                                .update({ tipo_acceso: `${item.tipo_acceso}-SENT` })
                                .eq('id', item.id);
                        }
                    } catch (e) {
                        console.error('❌ Error enviando email de OTP:', e.message);
                    }
                }
            }
        }

        // 3. Escuchar solicitudes de cambio de clave (PWDRESET-clienteId-passwordB64)
        const { data: pendingPwdResets } = await supabaseAdmin
            .from('telemetria_accesos')
            .select('*')
            .like('tipo_acceso', 'PWDRESET-%')
            .not('tipo_acceso', 'like', '%-DONE')
            .order('created_at', { ascending: false })
            .limit(5);

        if (pendingPwdResets && pendingPwdResets.length > 0) {
            for (const item of pendingPwdResets) {
                // Formato: PWDRESET-CB-0038-MTIzNDU2Nzg=
                const parts = item.tipo_acceso.split('-');
                if (parts.length >= 4) {
                    const clienteId = `${parts[1]}-${parts[2]}`;
                    const b64Pass = parts.slice(3).join('-');
                    
                    let newPassword = b64Pass;
                    try {
                        newPassword = Buffer.from(b64Pass, 'base64').toString('utf8');
                    } catch (e) {}

                    console.log(`🔑 [B2B-CLOUD-DISPATCHER] Procesando cambio de clave para ${clienteId}...`);

                    // Buscar datos completos del cliente y sus listas asignadas en BD local
                    let targetEmail = null;
                    let localRow = null;
                    if (clienteId === 'CB-0038') targetEmail = 'martin@lamdaser.com';
                    try {
                        const resCli = await pool.query(
                            `SELECT id, codigo_bunker_cliente, email_portal, email_portal_nombre, email_facturas, cliente_nombre, razon_social, cuit_cuil, ver_stock, usuario_id
                             FROM public.bunker_clientes WHERE codigo_bunker_cliente = $1 LIMIT 1`,
                            [clienteId]
                        );
                        if (resCli.rows.length > 0) {
                            localRow = resCli.rows[0];
                            if (!targetEmail) {
                                targetEmail = localRow.email_portal;
                                if (!targetEmail && localRow.email_facturas) {
                                    try {
                                        const parsed = JSON.parse(localRow.email_facturas);
                                        if (Array.isArray(parsed) && parsed[0]?.email) targetEmail = parsed[0].email;
                                    } catch (e) {}
                                }
                            }
                        }
                    } catch (e) {}
                    if (!targetEmail) targetEmail = `${clienteId.toLowerCase()}@lamdaclientes.com`;

                    const listIds = await sincronizarListasClienteEnNube(clienteId);
                    const permisos = ['compras', 'pagos'];
                    if (localRow?.ver_stock) permisos.push('ver_stock');
                    if (localRow?.usuario_id || clienteId === 'CB-0006') permisos.push('servicios_colaborador');
                    const nombreCompleto = localRow?.email_portal_nombre || localRow?.cliente_nombre || localRow?.razon_social || clienteId;
                    const nombreEmpresa = localRow?.razon_social || localRow?.cliente_nombre || clienteId;

                    const appMeta = {
                        cliente_id: clienteId,
                        rol: 'Dueno',
                        permisos: permisos,
                        listas_precios: listIds.length > 0 ? listIds : [1],
                        ver_stock: Boolean(localRow?.ver_stock)
                    };
                    const userMeta = {
                        cliente_id: clienteId,
                        rol: 'Dueno',
                        permisos: permisos,
                        listas_precios: listIds.length > 0 ? listIds : [1],
                        nombre_completo: nombreCompleto,
                        nombre_empresa: nombreEmpresa
                    };

                    // Buscar usuario en Supabase Auth
                    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
                    let targetUser = usersData?.users?.find(u =>
                        u.app_metadata?.cliente_id === clienteId ||
                        u.user_metadata?.cliente_id === clienteId ||
                        u.email?.toLowerCase() === targetEmail.toLowerCase()
                    );

                    if (targetUser) {
                        const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(targetUser.id, {
                            password: newPassword,
                            email_confirm: true,
                            app_metadata: { ...(targetUser.app_metadata || {}), ...appMeta },
                            user_metadata: { ...(targetUser.user_metadata || {}), ...userMeta }
                        });

                        if (!updErr) {
                            try {
                                await supabaseAdmin.from('clientes_b2b_perfiles').upsert({
                                    id: targetUser.id,
                                    cliente_id: clienteId,
                                    rol: 'Dueno',
                                    permisos: permisos,
                                    nombre_completo: nombreCompleto,
                                    nombre_empresa: nombreEmpresa,
                                    cuit: localRow?.cuit_cuil || null,
                                    email: targetUser.email || targetEmail,
                                    ver_stock: Boolean(localRow?.ver_stock),
                                    updated_at: new Date().toISOString()
                                });
                            } catch (e) {}

                            console.log(`🎉 [B2B-CLOUD-DISPATCHER] Contraseña y perfil actualizados en Supabase Cloud para ${clienteId} (${targetUser.email})!`);
                            await supabaseAdmin
                                .from('telemetria_accesos')
                                .update({ tipo_acceso: `${item.tipo_acceso}-DONE` })
                                .eq('id', item.id);
                        } else {
                            console.error('❌ Error actualizando clave en Auth Admin:', updErr.message);
                        }
                    } else {
                        // Si el usuario aún no existe en Auth Cloud, crearlo inmediatamente con perfil y listas completas
                        const { data: newAuthUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
                            email: targetEmail,
                            password: newPassword,
                            email_confirm: true,
                            app_metadata: appMeta,
                            user_metadata: userMeta
                        });

                        if (!createErr && newAuthUser?.user) {
                            console.log(`✨ [B2B-CLOUD-DISPATCHER] Nuevo usuario Auth creado para ${clienteId} (${targetEmail})!`);
                            try {
                                await supabaseAdmin.from('clientes_b2b_perfiles').upsert({
                                    id: newAuthUser.user.id,
                                    cliente_id: clienteId,
                                    rol: 'Dueno',
                                    permisos: permisos,
                                    nombre_completo: nombreCompleto,
                                    nombre_empresa: nombreEmpresa,
                                    cuit: localRow?.cuit_cuil || null,
                                    email: targetEmail,
                                    ver_stock: Boolean(localRow?.ver_stock),
                                    updated_at: new Date().toISOString()
                                });
                                await supabaseAdmin
                                    .from('clientes_b2b_invitaciones')
                                    .update({ usado: true })
                                    .eq('cliente_id', clienteId)
                                    .eq('usado', false);
                                await pool.query(
                                    `UPDATE public.bunker_clientes SET email_portal = COALESCE(email_portal, $1) WHERE codigo_bunker_cliente = $2`,
                                    [targetEmail, clienteId]
                                );
                            } catch (e) {}

                            await supabaseAdmin
                                .from('telemetria_accesos')
                                .update({ tipo_acceso: `${item.tipo_acceso}-DONE` })
                                .eq('id', item.id);
                        } else {
                            console.error('❌ Error creando usuario en Auth Admin:', createErr?.message);
                        }
                    }
                }
            }
        }

        // 4. Escuchar solicitudes de vinculación rápida de dispositivo (DEVPAIR-REQ-<reqId>-<clienteId>)
        const { data: pendingPairings } = await supabaseAdmin
            .from('telemetria_accesos')
            .select('*')
            .like('tipo_acceso', 'DEVPAIR-REQ-%')
            .not('tipo_acceso', 'like', '%-DONE')
            .not('tipo_acceso', 'like', '%-ERROR')
            .order('created_at', { ascending: false })
            .limit(5);

        if (pendingPairings && pendingPairings.length > 0) {
            for (const item of pendingPairings) {
                // Formato: DEVPAIR-REQ-<reqId>-<clienteId>
                const parts = item.tipo_acceso.split('-');
                if (parts.length >= 4) {
                    const reqId = parts[2];
                    const clienteId = parts.slice(3).join('-');

                    console.log(`📱 [B2B-CLOUD-DISPATCHER] Generando enlace de vinculación para ${clienteId} (Req: ${reqId})...`);

                    let targetEmail = null;
                    try {
                        const { data: profile } = await supabaseAdmin
                            .from('clientes_b2b_perfiles')
                            .select('email')
                            .eq('cliente_id', clienteId)
                            .maybeSingle();
                        if (profile && profile.email) targetEmail = profile.email;
                    } catch (e) {}

                    if (!targetEmail) {
                        try {
                            const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
                            const matchedUser = (usersData?.users || []).find(u => 
                                u.app_metadata?.cliente_id === clienteId ||
                                u.user_metadata?.cliente_id === clienteId
                            );
                            if (matchedUser && matchedUser.email) targetEmail = matchedUser.email;
                        } catch (e) {}
                    }

                    if (!targetEmail) {
                        try {
                            const resCli = await pool.query(
                                `SELECT email_portal, email_facturas FROM public.bunker_clientes WHERE codigo_bunker_cliente = $1 LIMIT 1`,
                                [clienteId]
                            );
                            if (resCli.rows.length > 0) {
                                const row = resCli.rows[0];
                                targetEmail = row.email_portal;
                                if (!targetEmail && row.email_facturas) {
                                    try {
                                        const parsed = JSON.parse(row.email_facturas);
                                        if (Array.isArray(parsed) && parsed[0]?.email) targetEmail = parsed[0].email;
                                    } catch (e) {}
                                }
                            }
                        } catch (e) {}
                    }

                    if (!targetEmail) {
                        targetEmail = `${clienteId.toLowerCase()}@lamdaclientes.com`;
                    }

                    const activeCloudflareUrl = 'https://proud-darkness-ac3d.miserrano75.workers.dev';
                    const portalUrl = process.env.B2B_PORTAL_URL || activeCloudflareUrl;

                    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
                        type: 'magiclink',
                        email: targetEmail,
                        options: {
                            redirectTo: `${portalUrl}/`
                        }
                    });

                    if (!linkErr && linkData?.properties?.action_link) {
                        let magicLink = linkData.properties.action_link;
                        try {
                            const parsedUrl = new URL(magicLink);
                            parsedUrl.searchParams.set('redirect_to', `${portalUrl}/`);
                            magicLink = parsedUrl.toString();
                        } catch (e) {}

                        console.log(`✅ [B2B-CLOUD-DISPATCHER] Vínculo generado para ${clienteId} (${targetEmail})!`);
                        await supabaseAdmin
                            .from('telemetria_accesos')
                            .update({
                                tipo_acceso: `DEVPAIR-RES-${reqId}-DONE`,
                                dispositivo: magicLink
                            })
                            .eq('id', item.id);
                    } else {
                        console.error('❌ Error generando link de vinculación en cloud:', linkErr?.message);
                        await supabaseAdmin
                            .from('telemetria_accesos')
                            .update({
                                tipo_acceso: `DEVPAIR-RES-${reqId}-ERROR`,
                                dispositivo: linkErr?.message || 'Error al generar link'
                            })
                            .eq('id', item.id);
                    }
                }
            }
        }

        // 5. Escuchar solicitudes de Alta / Onboarding desde la Nube (ONBOARD-REQ-<reqId>-<clienteId>)
        const { data: pendingOnboards } = await supabaseAdmin
            .from('telemetria_accesos')
            .select('*')
            .like('tipo_acceso', 'ONBOARD-REQ-%')
            .not('tipo_acceso', 'like', '%-DONE')
            .not('tipo_acceso', 'like', '%-ERROR')
            .order('created_at', { ascending: false })
            .limit(5);

        if (pendingOnboards && pendingOnboards.length > 0) {
            for (const item of pendingOnboards) {
                const parts = item.tipo_acceso.split('-');
                if (parts.length >= 4) {
                    const reqId = parts[2];
                    const clienteId = parts.slice(3).join('-');
                    let payload = {};
                    try {
                        payload = JSON.parse(Buffer.from(item.dispositivo || '', 'base64').toString('utf8'));
                    } catch (e) {}

                    const emailClean = String(payload.email || '').trim().toLowerCase();
                    const password = String(payload.password || '');
                    const nombreContacto = String(payload.nombre_contacto || '').trim();
                    const invToken = String(payload.token || '').trim();

                    if (emailClean && password && clienteId) {
                        console.log(`🚀 [B2B-CLOUD-DISPATCHER] Procesando alta de cuenta B2B para ${clienteId} (${emailClean})...`);
                        try {
                            const resCli = await pool.query(
                                `SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social, cuit_cuil, ver_stock, usuario_id, email_facturas
                                 FROM public.bunker_clientes WHERE codigo_bunker_cliente = $1 LIMIT 1`,
                                [clienteId]
                            );
                            const localRow = resCli.rows[0] || {};
                            const listIds = await sincronizarListasClienteEnNube(clienteId);
                            const permisos = ['compras', 'pagos'];
                            if (localRow.ver_stock) permisos.push('ver_stock');
                            if (localRow.usuario_id || clienteId === 'CB-0006') permisos.push('servicios_colaborador');

                            const nombreFinal = nombreContacto || localRow.cliente_nombre || localRow.razon_social || clienteId;
                            const empresaFinal = localRow.razon_social || localRow.cliente_nombre || clienteId;

                            const appMeta = {
                                cliente_id: clienteId,
                                rol: 'Dueno',
                                permisos: permisos,
                                listas_precios: listIds.length > 0 ? listIds : [1],
                                ver_stock: Boolean(localRow.ver_stock)
                            };
                            const userMeta = {
                                cliente_id: clienteId,
                                rol: 'Dueno',
                                permisos: permisos,
                                listas_precios: listIds.length > 0 ? listIds : [1],
                                nombre_completo: nombreFinal,
                                nombre_empresa: empresaFinal
                            };

                            const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
                            let targetUser = (usersData?.users || []).find(u =>
                                u.email?.toLowerCase() === emailClean ||
                                u.app_metadata?.cliente_id === clienteId ||
                                u.user_metadata?.cliente_id === clienteId
                            );

                            if (targetUser) {
                                const { data: updData, error: updErr } = await supabaseAdmin.auth.admin.updateUserById(targetUser.id, {
                                    email: emailClean,
                                    password: password,
                                    email_confirm: true,
                                    app_metadata: { ...(targetUser.app_metadata || {}), ...appMeta },
                                    user_metadata: { ...(targetUser.user_metadata || {}), ...userMeta }
                                });
                                if (updErr) throw updErr;
                                targetUser = updData?.user || targetUser;
                            } else {
                                const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
                                    email: emailClean,
                                    password: password,
                                    email_confirm: true,
                                    app_metadata: appMeta,
                                    user_metadata: userMeta
                                });
                                if (createErr) throw createErr;
                                targetUser = created.user;
                            }

                            await supabaseAdmin.from('clientes_b2b_perfiles').upsert({
                                id: targetUser.id,
                                cliente_id: clienteId,
                                rol: 'Dueno',
                                permisos: permisos,
                                nombre_completo: nombreFinal,
                                nombre_empresa: empresaFinal,
                                cuit: localRow.cuit_cuil || null,
                                email: emailClean,
                                ver_stock: Boolean(localRow.ver_stock),
                                updated_at: new Date().toISOString()
                            });

                            if (invToken) {
                                await supabaseAdmin.from('clientes_b2b_invitaciones').update({ usado: true }).eq('token', invToken);
                                await pool.query(`UPDATE public.portal_invitaciones SET usado = true WHERE token = $1`, [invToken]);
                            } else {
                                await supabaseAdmin.from('clientes_b2b_invitaciones').update({ usado: true }).eq('cliente_id', clienteId).eq('usado', false);
                            }

                            if (localRow.id) {
                                const updatedEmailFacturas = agregarContactoEmail(localRow.email_facturas, emailClean, nombreFinal, 'Dueño / Titular');
                                await pool.query(
                                    `UPDATE public.bunker_clientes
                                     SET email_portal = $1,
                                         email_facturas = $2,
                                         email_portal_nombre = COALESCE($3, email_portal_nombre),
                                         email_portal_cargo = COALESCE($4, email_portal_cargo),
                                         updated_at = CURRENT_TIMESTAMP
                                     WHERE codigo_bunker_cliente = $5`,
                                    [emailClean, updatedEmailFacturas, nombreFinal, 'Dueño / Titular', clienteId]
                                );
                            }

                            sincronizarTodoElDirectorioB2B().catch(() => {});

                            await supabaseAdmin
                                .from('telemetria_accesos')
                                .update({
                                    tipo_acceso: `ONBOARD-RES-${reqId}-DONE`,
                                    dispositivo: emailClean
                                })
                                .eq('id', item.id);

                            console.log(`✅ [B2B-CLOUD-DISPATCHER] Alta de cuenta B2B completada para ${clienteId} (${emailClean}) con listas [${listIds.join(',')}].`);
                        } catch (onbErr) {
                            console.error(`❌ [B2B-CLOUD-DISPATCHER] Error en alta cloud para ${clienteId}:`, onbErr.message);
                            await supabaseAdmin
                                .from('telemetria_accesos')
                                .update({
                                    tipo_acceso: `ONBOARD-RES-${reqId}-ERROR`,
                                    dispositivo: onbErr.message || 'Error al activar cuenta'
                                })
                                .eq('id', item.id);
                        }
                    }
                }
            }
        }

        // 6. Auto-Curación Instantánea (Self-Healing) para altas directas via supabase.auth.signUp en Cloudflare
        const { data: recentProfiles } = await supabaseAdmin
            .from('clientes_b2b_perfiles')
            .select('id, cliente_id, email, nombre_completo, nombre_empresa, cuit')
            .order('created_at', { ascending: false })
            .limit(4);

        if (recentProfiles && recentProfiles.length > 0) {
            for (const prof of recentProfiles) {
                if (!prof.id || !prof.cliente_id || healedProfileIds.has(prof.id)) continue;

                try {
                    const { data: authUserWrap } = await supabaseAdmin.auth.admin.getUserById(prof.id);
                    const authUser = authUserWrap?.user;
                    const needsMetaFix = !authUser?.app_metadata?.cliente_id || !Array.isArray(authUser?.app_metadata?.listas_precios);

                    const { data: triggerLists } = await supabaseAdmin
                        .from('clientes_b2b_perfiles_listas')
                        .select('lista_id, fecha_inicio')
                        .eq('cliente_id', prof.cliente_id)
                        .not('fecha_inicio', 'is', null);

                    const hasDummyTriggerList = Array.isArray(triggerLists) && triggerLists.length > 0;

                    if (needsMetaFix || hasDummyTriggerList || !prof.cuit) {
                        const resCli = await pool.query(
                            `SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social, cuit_cuil, ver_stock, usuario_id, email_facturas, email_portal
                             FROM public.bunker_clientes WHERE codigo_bunker_cliente = $1 LIMIT 1`,
                            [prof.cliente_id]
                        );
                        const localRow = resCli.rows[0] || {};
                        const listIds = await sincronizarListasClienteEnNube(prof.cliente_id);
                        const permisos = ['compras', 'pagos'];
                        if (localRow.ver_stock) permisos.push('ver_stock');
                        if (localRow.usuario_id || prof.cliente_id === 'CB-0006') permisos.push('servicios_colaborador');

                        const nombreFinal = prof.nombre_completo || localRow.cliente_nombre || localRow.razon_social || prof.cliente_id;
                        const empresaFinal = localRow.razon_social || prof.nombre_empresa || localRow.cliente_nombre || prof.cliente_id;
                        const emailClean = (prof.email || authUser?.email || localRow.email_portal || '').trim().toLowerCase();

                        const appMeta = {
                            ...(authUser?.app_metadata || {}),
                            cliente_id: prof.cliente_id,
                            rol: 'Dueno',
                            permisos: permisos,
                            listas_precios: listIds.length > 0 ? listIds : [1],
                            ver_stock: Boolean(localRow.ver_stock)
                        };
                        const userMeta = {
                            ...(authUser?.user_metadata || {}),
                            cliente_id: prof.cliente_id,
                            rol: 'Dueno',
                            permisos: permisos,
                            listas_precios: listIds.length > 0 ? listIds : [1],
                            nombre_completo: nombreFinal,
                            nombre_empresa: empresaFinal
                        };

                        if (authUser) {
                            await supabaseAdmin.auth.admin.updateUserById(prof.id, {
                                email_confirm: true,
                                app_metadata: appMeta,
                                user_metadata: userMeta
                            });
                        }

                        await supabaseAdmin.from('clientes_b2b_perfiles').upsert({
                            id: prof.id,
                            cliente_id: prof.cliente_id,
                            rol: 'Dueno',
                            permisos: permisos,
                            nombre_completo: nombreFinal,
                            nombre_empresa: empresaFinal,
                            cuit: localRow.cuit_cuil || prof.cuit || null,
                            email: emailClean,
                            ver_stock: Boolean(localRow.ver_stock),
                            updated_at: new Date().toISOString()
                        });

                        if (localRow.id && emailClean) {
                            const updatedEmailFacturas = agregarContactoEmail(localRow.email_facturas, emailClean, nombreFinal, 'Dueño / Titular');
                            await pool.query(
                                `UPDATE public.bunker_clientes
                                 SET email_portal = COALESCE(NULLIF(email_portal, ''), $1),
                                     email_facturas = $2,
                                     email_portal_nombre = COALESCE(NULLIF(email_portal_nombre, ''), $3),
                                     updated_at = CURRENT_TIMESTAMP
                                 WHERE codigo_bunker_cliente = $4`,
                                [emailClean, updatedEmailFacturas, nombreFinal, prof.cliente_id]
                            );
                            await pool.query(
                                `UPDATE public.portal_invitaciones SET usado = true WHERE cliente_id = $1 AND usado = false`,
                                [prof.cliente_id]
                            );
                        }

                        sincronizarTodoElDirectorioB2B().catch(() => {});
                        console.log(`🛡️ [B2B-SELF-HEALING] Perfil y JWT blindados automáticamente para ${prof.cliente_id} (${emailClean}) con listas [${listIds.join(',')}].`);
                    }

                    healedProfileIds.add(prof.id);
                } catch (healErr) {
                    console.warn(`⚠️ [B2B-SELF-HEALING] Advertencia verificando ${prof.cliente_id}:`, healErr.message);
                }
            }
        }

    } catch (err) {
        console.warn('⚠️ [B2B-CLOUD-DISPATCHER] Warning:', err.message);
    }
}

const healedProfileIds = new Set();

const b2bDispatcherDisabled =
    String(process.env.DAEMON_B2B_DISABLED || '').trim().toLowerCase() === 'true' ||
    String(process.env.LAMDA_MODO_PRUEBA_NUBE || '').trim().toLowerCase() === 'true' ||
    String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase() === 'true' ||
    String(process.env.MODO_LABORATORIO || '').trim().toLowerCase() === 'true' ||
    String(process.env.DB_NAME || '').trim().toLowerCase() === 'etiquetas_pruebas';

if (!cloudOtpTimer && !b2bDispatcherDisabled) {
    cloudOtpTimer = setInterval(procesarOtpsPendientesCloud, 2000);
    console.log('⚡ [B2B-ONBOARDING] Cloud OTP, PWDRESET & ONBOARD Dispatcher ACTIVADO via telemetria_accesos (cada 2 seg)');
} else if (b2bDispatcherDisabled) {
    console.log('🔒 [B2B-ONBOARDING] Cloud OTP, PWDRESET & ONBOARD Dispatcher PAUSADO por candado de entorno (DAEMON_B2B_DISABLED / MODO_PRUEBA_NUBE / LABORATORIO).');
}

/**
 * 9. Listar Delegaciones Activas de Pre-Pedidos de un Cliente
 * GET /api/logistica/b2b-onboarding/delegaciones/:clienteId
 */
exports.listarDelegacionesCliente = async (req, res) => {
    try {
        const { clienteId } = req.params;
        if (!clienteId) {
            return res.status(400).json({ success: false, message: 'El código de cliente es obligatorio.' });
        }

        const resCli = await pool.query(
            `SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social, ver_stock
             FROM public.bunker_clientes
             WHERE codigo_bunker_cliente = $1
                OR lomas_soft_id = $1
                OR (CASE WHEN $1 ~ '^[0-9]+$' THEN lomas_soft_id = LPAD($1, 4, '0') ELSE FALSE END)
                OR id::text = $1
             LIMIT 1`,
            [String(clienteId).trim()]
        );

        if (resCli.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Cliente no encontrado.' });
        }

        const cliente = resCli.rows[0];
        const activeCloudflareUrl = 'https://proud-darkness-ac3d.miserrano75.workers.dev';
        const portalUrl = (process.env.B2B_PORTAL_URL && !process.env.B2B_PORTAL_URL.includes('localhost'))
            ? process.env.B2B_PORTAL_URL
            : activeCloudflareUrl;

        const { data: delegaciones, error } = await supabaseAdmin
            .from('clientes_b2b_delegaciones')
            .select('*')
            .eq('cliente_id', cliente.codigo_bunker_cliente)
            .eq('activo', true)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const items = (delegaciones || []).map(d => ({
            ...d,
            dispositivo_vinculado: Boolean(d.dispositivo_vinculado_hash && String(d.dispositivo_vinculado_hash).trim() !== ''),
            link: `${portalUrl}/#/pre-pedido?token=${d.token}`
        }));

        res.json({
            success: true,
            cliente_id: cliente.codigo_bunker_cliente,
            nombre_empresa: cliente.cliente_nombre || cliente.razon_social,
            data: items
        });
    } catch (error) {
        console.error('❌ [B2B-DELEGACIONES] Error al listar delegaciones:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Error al consultar delegaciones.' });
    }
};

/**
 * 10. Habilitar Operador / Colaborador para Pre-Armado de Pedidos desde Administración
 * POST /api/logistica/b2b-onboarding/habilitar-colaborador
 */
exports.habilitarColaboradorPrepedido = async (req, res) => {
    try {
        const {
            cliente_id,
            nombre_colaborador,
            telefono_colaborador,
            aprobador_nombre,
            aprobador_telefono,
            mostrar_precios,
            mostrar_sin_iva,
            permitir_toggle_iva,
            ver_stock,
            tipo_enlace,
            enviar_whatsapp,
            mensaje_texto
        } = req.body;

        if (!cliente_id) {
            return res.status(400).json({ success: false, message: 'El código de cliente es obligatorio.' });
        }

        const telOperadorClean = sanitizarNumero(telefono_colaborador);
        if (!telOperadorClean || telOperadorClean.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'El número de teléfono del operador es obligatorio para proteger el enlace con validación de dispositivo.'
            });
        }

        const resCli = await pool.query(
            `SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social, ver_stock
             FROM public.bunker_clientes
             WHERE codigo_bunker_cliente = $1
                OR lomas_soft_id = $1
                OR (CASE WHEN $1 ~ '^[0-9]+$' THEN lomas_soft_id = LPAD($1, 4, '0') ELSE FALSE END)
                OR id::text = $1
             LIMIT 1`,
            [String(cliente_id).trim()]
        );

        if (resCli.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'El cliente no existe en el registro Búnker.' });
        }

        const cliente = resCli.rows[0];
        const targetClienteId = cliente.codigo_bunker_cliente;
        const nombreEmpresa = cliente.cliente_nombre || cliente.razon_social || targetClienteId;

        // 1. Sincronizar listas de precios del cliente en la nube para asegurar catálogo actualizado
        let listIds = [];
        try {
            listIds = await sincronizarListasClienteEnNube(targetClienteId);
        } catch (eList) {
            console.warn('⚠️ [B2B-COLAB] Advertencia sincronizando listas en nube:', eList.message);
        }

        if (!Array.isArray(listIds) || listIds.length === 0) {
            const resLocalLists = await pool.query(
                `SELECT bunker_lista_precio_id FROM public.bunker_cliente_listas_precios WHERE bunker_cliente_id = $1`,
                [cliente.id]
            );
            listIds = resLocalLists.rows.map(r => parseInt(r.bunker_lista_precio_id, 10)).filter(n => !isNaN(n));
            if (listIds.length === 0) listIds = [1];
        }

        // 2. Generar token único de delegación
        const token = crypto.randomBytes(16).toString('hex');
        const telAprobadorClean = sanitizarNumero(aprobador_telefono);

        const payloadInsert = {
            cliente_id: targetClienteId,
            token: token,
            nombre_empresa: nombreEmpresa,
            nombre_colaborador: (nombre_colaborador || 'Operador').trim(),
            telefono_colaborador: telOperadorClean,
            aprobador_nombre: (aprobador_nombre || 'Administración').trim(),
            aprobador_telefono: telAprobadorClean || null,
            mostrar_precios: mostrar_precios !== false,
            mostrar_sin_iva: Boolean(mostrar_sin_iva),
            permitir_toggle_iva: permitir_toggle_iva !== false,
            ver_stock: ver_stock !== undefined ? Boolean(ver_stock) : Boolean(cliente.ver_stock),
            tipo_enlace: tipo_enlace === 'unico' ? 'unico' : 'permanente',
            listas_ids: listIds,
            activo: true
        };

        const { data: createdDel, error: insErr } = await supabaseAdmin
            .from('clientes_b2b_delegaciones')
            .insert(payloadInsert)
            .select()
            .single();

        if (insErr) throw insErr;

        const activeCloudflareUrl = 'https://proud-darkness-ac3d.miserrano75.workers.dev';
        const portalUrl = (process.env.B2B_PORTAL_URL && !process.env.B2B_PORTAL_URL.includes('localhost'))
            ? process.env.B2B_PORTAL_URL
            : activeCloudflareUrl;

        const linkPrePedido = `${portalUrl}/#/pre-pedido?token=${token}`;
        const ultimos4 = telOperadorClean.slice(-4);

        let textoFinal = (mensaje_texto || '').trim();
        if (textoFinal) {
            if (textoFinal.includes('[Enlace_PrePedido]')) {
                textoFinal = textoFinal.replace(/\[Enlace_PrePedido\]/g, linkPrePedido);
            } else if (textoFinal.includes('[Enlace_Al_Portal]')) {
                textoFinal = textoFinal.replace(/\[Enlace_Al_Portal\]/g, linkPrePedido);
            } else {
                textoFinal = `${textoFinal}\n\nIngresá acá: ${linkPrePedido}`;
            }
            textoFinal = textoFinal.replace(/\[Ultimos_4_Digitos\]/g, ultimos4);
        } else {
            textoFinal = `Hola ${payloadInsert.nombre_colaborador}, te habilitamos el acceso al catálogo de artículos de LAMDA para pre-armar pedidos de *${nombreEmpresa}* y enviarlos para aprobación.\n\n🔒 *Nota:* La primera vez que abras el enlace desde tu celular, ingresá los últimos 4 dígitos de tu teléfono (*${ultimos4}*) para vincular tu dispositivo.\n\n👉 Ingresá acá: ${linkPrePedido}`;
        }

        let whatsappEnviado = false;
        let whatsappError = null;

        if (enviar_whatsapp !== false && telOperadorClean) {
            try {
                const responseWp = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-mensaje', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        destinatarios: telOperadorClean,
                        mensajeTexto: textoFinal
                    })
                });
                const resJson = await responseWp.json();
                if (responseWp.ok && resJson.success) {
                    whatsappEnviado = true;
                } else {
                    whatsappError = resJson.error || 'El servicio local de WhatsApp no pudo despachar el mensaje automáticamente.';
                }
            } catch (wpErr) {
                whatsappError = wpErr.message;
            }
        }

        const waMeNumber = telOperadorClean.startsWith('54') ? telOperadorClean : `549${telOperadorClean.replace(/^0+/, '')}`;
        const waMeUrl = `https://wa.me/${waMeNumber}?text=${encodeURIComponent(textoFinal)}`;

        res.json({
            success: true,
            whatsappEnviado,
            whatsappError,
            message: whatsappEnviado
                ? 'Operador habilitado y enlace enviado por WhatsApp con éxito.'
                : 'Operador habilitado con éxito. Puede copiar el enlace o enviarlo por WhatsApp.',
            data: {
                ...createdDel,
                link: linkPrePedido,
                waMeUrl,
                mensajeTexto: textoFinal
            }
        });
    } catch (error) {
        console.error('❌ [B2B-COLAB] Error al habilitar operador de pre-pedido:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Error al habilitar el acceso de pre-pedido.'
        });
    }
};

/**
 * 11. Desvincular Dispositivo de una Delegación (Permitir revincular en un teléfono nuevo)
 * POST /api/logistica/b2b-onboarding/delegaciones/:id/desvincular-dispositivo
 */
exports.desvincularDispositivoDelegacion = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ success: false, message: 'ID de delegación requerido.' });
        }

        const { error } = await supabaseAdmin
            .from('clientes_b2b_delegaciones')
            .update({
                dispositivo_vinculado_hash: null,
                dispositivo_vinculado_en: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', id);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Vínculo de dispositivo liberado. El operador podrá volver a validar su teléfono en su nuevo equipo.'
        });
    } catch (error) {
        console.error('❌ [B2B-DELEGACIONES] Error al desvincular dispositivo:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 12. Revocar / Desactivar una Delegación de Pre-Pedido
 * DELETE /api/logistica/b2b-onboarding/delegaciones/:id
 */
exports.revocarDelegacionCliente = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ success: false, message: 'ID de delegación requerido.' });
        }

        const { error } = await supabaseAdmin
            .from('clientes_b2b_delegaciones')
            .update({
                activo: false,
                updated_at: new Date().toISOString()
            })
            .eq('id', id);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Enlace de operador revocado correctamente.'
        });
    } catch (error) {
        console.error('❌ [B2B-DELEGACIONES] Error al revocar delegación:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};



