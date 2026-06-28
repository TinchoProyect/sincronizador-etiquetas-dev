const crypto = require('crypto');
const { pool } = require('../config/database');
const { createClient } = require('@supabase/supabase-js');

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
 * 1. Generar Invitación de Onboarding por WhatsApp
 * POST /api/logistica/b2b-onboarding/invitar
 */
exports.invitarCliente = async (req, res) => {
    try {
        const { cliente_id, canal, destino, mensajeTexto } = req.body;
        if (!cliente_id) {
            return res.status(400).json({ success: false, error: 'Datos incompletos', message: 'El ID de cliente es obligatorio.' });
        }
        const clienteIdStr = String(cliente_id).trim();
        const canalSeleccionado = (canal === 'email') ? 'email' : 'whatsapp';

        console.log(`📡 [B2B-ONBOARDING] Generando invitación para cliente: ${clienteIdStr} | Canal: ${canalSeleccionado}`);

        // 1. Buscar cliente en la base de datos local
        const queryCliente = `
            SELECT codigo_bunker_cliente, cliente_nombre, razon_social, whatsapp_facturas, email_portal, email_portal_nombre, email_portal_cargo
            FROM public.bunker_clientes 
            WHERE codigo_bunker_cliente = $1 
               OR lomas_soft_id = $1 
               OR (CASE WHEN $1 ~ '^[0-9]+$' THEN lomas_soft_id = LPAD($1, 4, '0') ELSE FALSE END)
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

        // 4b. Registrar invitación en Supabase Cloud (para flujo desacoplado)
        try {
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
                    razon_social: cliente.razon_social,
                    email_portal: emailDestino || cliente.email_portal || '',
                    email_portal_nombre: cliente.email_portal_nombre || '',
                    email_portal_cargo: cliente.email_portal_cargo || ''
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
        // Usamos Hash Routing para evitar el error 404 del servidor/CDN en la carga inicial de subrutas
        const linkOnboarding = `${portalUrl}/#/onboarding?token=${token}`;
        
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

        // 1. Validar el token de invitación
        const queryToken = `
            SELECT i.token, i.cliente_id, i.expires_at, i.usado, bc.razon_social
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

        // 4. Si ya existe, actualizamos su contraseña en Supabase Auth Admin API
        if (isReactivation && userUuid) {
            console.log(`🔑 [Supabase Auth] Actualizando contraseña para usuario existente: ${userUuid}`);
            const updateAuthUrl = `${SUPABASE_URL}/auth/v1/admin/users/${userUuid}`;
            const updateAuthOptions = {
                method: 'PUT',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    password: password
                })
            };
            const responseUpdate = await fetch(updateAuthUrl, updateAuthOptions);
            if (!responseUpdate.ok) {
                const updateData = await responseUpdate.json();
                const errMsg = updateData.msg || updateData.message || 'Error al actualizar la contraseña del usuario en el motor de autenticación.';
                console.error('❌ [Supabase Auth Update Error]:', updateData);
                return res.status(400).json({ success: false, error: 'Falla Auth', message: errMsg });
            }
            console.log(`✅ [B2B-ONBOARDING] Contraseña actualizada en Supabase Auth.`);
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
                    user_metadata: {
                        cliente_id: tokenRow.cliente_id,
                        nombre_completo: tokenRow.razon_social,
                        nombre_empresa: tokenRow.razon_social
                    }
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
                        const existingUser = usersData.users.find(u => u.email === emailClean);
                        if (existingUser) {
                            userUuid = existingUser.id;
                            isReactivation = true;
                            
                            // Proceder a actualizar contraseña
                            console.log(`🔑 [Supabase Auth] Actualizando contraseña para usuario existente (auth-only): ${userUuid}`);
                            const responseUpdate = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userUuid}`, {
                                method: 'PUT',
                                headers: {
                                    'apikey': SUPABASE_KEY,
                                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ password: password })
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
                permisos: ['compras', 'pagos'],
                nombre_completo: nombre_contacto ? String(nombre_contacto).trim() : tokenRow.razon_social,
                nombre_empresa: tokenRow.razon_social,
                email: emailClean
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
            // Graba el correo portal, nombre y cargo de contacto
            await clientLocal.query(
                `UPDATE public.bunker_clientes 
                 SET email_portal = $1, 
                     email_portal_nombre = COALESCE($2, email_portal_nombre),
                     email_portal_cargo = COALESCE($3, email_portal_cargo),
                     updated_at = CURRENT_TIMESTAMP 
                 WHERE codigo_bunker_cliente = $4`,
                [
                    emailClean, 
                    nombre_contacto ? String(nombre_contacto).trim() : null, 
                    cargo_contacto ? String(cargo_contacto).trim() : null, 
                    tokenRow.cliente_id
                ]
            );
            // Inactiva el token
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
