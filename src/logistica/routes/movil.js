/**
 * Rutas Móvil
 * Endpoints para la app móvil de choferes
 */

const express = require('express');
const router = express.Router();

// Importar modelos y controladores del escritorio (Dashboard Gerencial)
const { obtenerPresupuestosDisponibles } = require('../models/presupuestosModel.js');
const { crearRuta, asignarPresupuestos, eliminarRuta } = require('../controllers/rutasController.js');
const { obtenerClienteUnificado, resolverDestinatariosAlertaEntrega } = require('../services/clienteResolver.js');
const { obtenerDestinatariosInicioRuta, despacharNotificacionesInicioRuta } = require('../services/notificacionInicioRutaService.js');
const PagosEfectivoService = require('../services/pagosEfectivoService.js');
const { emitirCookieSesionCloud } = require('../../shared/lamdaCloudAuthGuard');
const { extraerChoferIdDeRequest } = require('../middleware/auth.js');

/**
 * Helper: envía un aviso corto por WhatsApp al cliente confirmando que su sobre fue retirado por el chofer.
 * Solo menciona el número de sobre (#SOB-XXXX), nunca el importe.
 */
async function enviarAvisoWhatsAppSobreRetirado(dbPool, sobre) {
    try {
        if (!sobre || !sobre.codigo_sobre) {
            return { enviado: false, destinatarios: [], errores: ['Sobre inválido'] };
        }

        const contactInfo = await obtenerClienteUnificado(dbPool, sobre.cliente_id);
        const destinatariosObjetos = contactInfo ? resolverDestinatariosAlertaEntrega(contactInfo) : [];
        let whatsappDestinatarios = destinatariosObjetos.map(d => d.numero).filter(Boolean);

        if (whatsappDestinatarios.length === 0 && sobre.colaborador_telefono) {
            const digits = String(sobre.colaborador_telefono).replace(/\D/g, '');
            if (digits.length >= 8) {
                whatsappDestinatarios.push(digits);
            }
        }

        if (whatsappDestinatarios.length === 0) {
            return { enviado: false, destinatarios: [], errores: ['El cliente no tiene número de WhatsApp configurado'] };
        }

        const nombreCliente = contactInfo?.cliente_nombre || contactInfo?.razon_social || sobre.colaborador_nombre || 'Cliente';
        const mensajeTexto = `💵 *Sobre Retirado*\n\nHola *${nombreCliente}*, te avisamos que ya fue retirado el sobre *#${sobre.codigo_sobre}*.\n\n¡Muchas gracias!\n*LAMDA*`;

        const facturacionUrl = process.env.FACTURACION_API_URL || 'http://localhost:3004';
        let enviados = 0;
        const errores = [];

        for (const whatsappDestino of whatsappDestinatarios) {
            try {
                const resMsg = await fetch(`${facturacionUrl}/facturacion/whatsapp/enviar-mensaje`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        destinatarios: whatsappDestino,
                        mensajeTexto
                    })
                });
                const dataMsg = await resMsg.json().catch(() => ({}));
                if (resMsg.ok && dataMsg.success) {
                    enviados++;
                    console.log(`[MOVIL-SOBRE-WA] ✅ Aviso de sobre retirado #${sobre.codigo_sobre} enviado a ${whatsappDestino}`);
                } else {
                    errores.push(dataMsg.error || dataMsg.message || `Error HTTP ${resMsg.status}`);
                }
            } catch (errWa) {
                errores.push(errWa.message);
            }
        }

        return {
            enviado: enviados > 0,
            enviados,
            destinatarios: whatsappDestinatarios,
            errores
        };
    } catch (err) {
        console.error('[MOVIL-SOBRE-WA] ❌ Error enviando aviso de sobre retirado:', err.message);
        return { enviado: false, destinatarios: [], errores: [err.message] };
    }
}

console.log('🔍 [MOVIL] Configurando rutas del módulo móvil...');

// 🛠️ MODO LABORATORIO: Auto-inyección de token de Administrador (Martin Ignacio Serrano, id: 2) si no viene en headers
router.use((req, res, next) => {
    const isLab = String(process.env.MODO_LABORATORIO).toLowerCase() === 'true' || process.env.DB_NAME === 'etiquetas_pruebas';
    if (isLab && (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer '))) {
        req.headers.authorization = 'Bearer ' + Buffer.from(`2:${Date.now()}`).toString('base64');
    }
    next();
});

/**
 * @route GET /api/logistica/public-qr-resolve/:token
 * @desc Resolver cualquier token de QR (UUID, token corto msf... o ID local entero) a su UUID de Supabase B2B.
 * @access Público (Sin autenticación para lectura de QR B2B)
 */
async function resolverQrPublicoHandler(req, res) {
    try {
        const token = String(req.params.token || '').trim();
        if (!token) {
            return res.status(400).json({ success: false, error: 'Token no especificado' });
        }

        // Si ya es un UUID válido de 36 caracteres, devolverlo directamente
        const esUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
        if (esUUID) {
            return res.json({ success: true, supabase_pedido_id: token });
        }

        const pool = req.db || (req.app && req.app.get && req.app.get('db'));
        if (!pool) {
            return res.status(500).json({ success: false, error: 'Base de datos no disponible' });
        }

        const queryFind = `
            SELECT m.supabase_pedido_id 
            FROM public.presupuestos p
            LEFT JOIN public.b2b_pedidos_mapeo m ON m.local_presupuesto_id = p.id
            WHERE p.id_presupuesto_ext = $1 
               OR (CASE WHEN $1 ~ '^[0-9]+$' THEN p.id = $1::integer ELSE false END)
            LIMIT 1
        `;
        const resFind = await pool.query(queryFind, [token]);

        if (resFind.rowCount > 0 && resFind.rows[0].supabase_pedido_id) {
            return res.json({
                success: true,
                supabase_pedido_id: resFind.rows[0].supabase_pedido_id
            });
        }

        return res.status(404).json({ success: false, error: 'Mapeo no encontrado' });
    } catch (err) {
        console.error('❌ Error en public-qr-resolve:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
}
router.get('/public-qr-resolve/:token', resolverQrPublicoHandler);
router.resolverQrPublicoHandler = resolverQrPublicoHandler;

/**
 * @route POST /api/logistica/movil/login
 * @desc Login de chofer con validación de texto plano
 * @access Público
 * 
 * ESTRUCTURA DE BD:
 * - Tabla: public.usuarios
 * - Campo usuario: varchar (NO es email)
 * - Campo contraseña: text (TEXTO PLANO, sin encriptar)
 * - Campo activo: boolean
 */
router.post('/login', async (req, res) => {
    // ============================================
    // PASO 1: VALIDACIÓN DE ENTRADA
    // ============================================
    console.log('\n[LOGIN] ========================================');
    console.log('[LOGIN] Nueva solicitud de login recibida');
    console.log('[LOGIN] Timestamp:', new Date().toISOString());

    try {
        // Extraer credenciales del body
        const rawUsuario = req.body?.usuario;
        const rawPassword = req.body?.password ?? req.body?.contraseña;
        const usuario = typeof rawUsuario === 'string' ? rawUsuario.trim() : '';
        const password = typeof rawPassword === 'string' ? rawPassword : '';
        const isLab = String(process.env.MODO_LABORATORIO).toLowerCase() === 'true' || process.env.DB_NAME === 'etiquetas_pruebas';
        if (isLab && (!usuario || !password)) {
            const tokenLab = Buffer.from(`2:${Date.now()}`).toString('base64');
            return res.status(200).json({
                success: true,
                message: 'Auto-login en Modo Laboratorio',
                data: {
                    id: 2,
                    usuario: 'Tincho',
                    nombre_completo: 'Martin Ignacio Serrano',
                    rol_id: 1,
                    token: tokenLab
                }
            });
        }

        console.log('[LOGIN] Usuario recibido:', usuario || '(vacío)');
        console.log('[LOGIN] Password recibido:', password ? '***' : '(vacío)');

        // Validar que existan ambos campos
        if (!usuario || !password) {
            console.log('[LOGIN] ❌ ERROR: Credenciales incompletas');
            console.log('[LOGIN] ========================================\n');
            return res.status(400).json({
                success: false,
                error: 'Usuario y contraseña son requeridos'
            });
        }

        // ============================================
        // PASO 2: VERIFICAR CONEXIÓN A BD
        // ============================================
        console.log('[LOGIN] Verificando conexión a base de datos...');

        if (!req.db) {
            console.error('[LOGIN] ❌ ERROR CRÍTICO: req.db no está disponible');
            console.error('[LOGIN] El middleware de BD no está funcionando');
            console.log('[LOGIN] ========================================\n');
            return res.status(500).json({
                success: false,
                error: 'Error de configuración del servidor'
            });
        }

        console.log('[LOGIN] ✅ Conexión a BD disponible');

        // ============================================
        // PASO 3: BUSCAR USUARIO EN BD
        // ============================================
        console.log(`[LOGIN] Buscando usuario: "${usuario}"`);

        const query = `
            SELECT 
                id,
                nombre_completo,
                usuario,
                contraseña,
                activo,
                rol_id
            FROM public.usuarios
            WHERE LOWER(TRIM(usuario)) = LOWER(TRIM($1)) AND activo = true
        `;

        console.log('[LOGIN] Ejecutando query SQL...');
        const result = await req.db.query(query, [usuario]);
        console.log('[LOGIN] Query ejecutado. Resultados:', result.rows.length);

        // Usuario no encontrado
        if (result.rows.length === 0) {
            console.log('[LOGIN] ⚠️ Usuario no encontrado o inactivo');
            console.log('[LOGIN] ========================================\n');
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }

        // ============================================
        // PASO 4: EXTRAER DATOS DEL USUARIO
        // ============================================
        const user = result.rows[0];

        console.log('[LOGIN] ✅ Usuario encontrado en BD');
        console.log('[LOGIN] ID:', user.id);
        console.log('[LOGIN] Nombre:', user.nombre_completo);
        console.log('[LOGIN] Rol ID:', user.rol_id);
        console.log('[LOGIN] Activo:', user.activo);

        // ============================================
        // PASO 5: VALIDAR CONTRASEÑA (TEXTO PLANO)
        // ============================================
        console.log('[LOGIN] Verificando contraseña...');

        // CRÍTICO: Usar corchetes para acceder al campo con ñ
        const dbPassword = user['contraseña'];

        // Verificar que se pudo leer la contraseña
        if (dbPassword === undefined || dbPassword === null) {
            console.error('[LOGIN] ❌ ERROR: No se pudo leer el campo contraseña');
            console.error('[LOGIN] Claves disponibles en objeto user:', Object.keys(user));
            console.log('[LOGIN] ========================================\n');
            return res.status(500).json({
                success: false,
                error: 'Error al procesar credenciales'
            });
        }

        console.log('[LOGIN] Contraseña leída correctamente de BD');
        console.log('[LOGIN] Longitud password BD:', dbPassword.length);
        console.log('[LOGIN] Longitud password recibido:', password.length);

        // Comparación directa (texto plano, sin bcrypt) con tolerancia a espacios finales de teclado móvil
        if (dbPassword !== password && dbPassword !== password.trim()) {
            console.log('[LOGIN] ❌ Contraseña incorrecta');
            console.log('[LOGIN] ========================================\n');
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }

        // ============================================
        // PASO 6: GENERAR TOKEN Y RESPONDER
        // ============================================
        console.log('[LOGIN] ✅ Contraseña correcta');
        console.log('[LOGIN] Generando token de sesión...');

        // Token simple: base64(id:timestamp)
        const token = Buffer.from(`${user.id}:${Date.now()}`).toString('base64');
        try {
            emitirCookieSesionCloud(res, {
                id: user.id,
                usuario: user.usuario,
                nombre_completo: user.nombre_completo,
                rol_id: user.rol_id
            });
        } catch (_) {}

        console.log('[LOGIN] ✅ Token generado exitosamente');
        console.log('[LOGIN] ✅ ACCESO CONCEDIDO');
        console.log('[LOGIN] Usuario:', user.nombre_completo);
        console.log('[LOGIN] ========================================\n');

        // Respuesta exitosa
        return res.status(200).json({
            success: true,
            message: 'Login exitoso',
            data: {
                id: user.id,
                usuario: user.usuario,
                nombre_completo: user.nombre_completo,
                rol_id: user.rol_id,
                token: token
            }
        });

    } catch (error) {
        // ============================================
        // MANEJO DE ERRORES
        // ============================================
        console.error('\n[LOGIN] ========================================');
        console.error('[LOGIN] ❌ ERROR CRÍTICO EN LOGIN');
        console.error('[LOGIN] ========================================');
        console.error('[LOGIN] Tipo:', error.name);
        console.error('[LOGIN] Mensaje:', error.message);
        console.error('[LOGIN] Stack trace:');
        console.error(error.stack);
        console.error('[LOGIN] ========================================\n');

        return res.status(500).json({
            success: false,
            error: 'Error al procesar login',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * @route GET /api/logistica/movil/mis-rutas
 * @desc Obtener listado compacto de TODAS las rutas no finalizadas del chofer.
 *       Devuelve metadata para el selector de rutas (Context Switcher).
 *       No incluye entregas, solo id, nombre, estado y count de entregas.
 * @access Privado (requiere token)
 */
router.get('/mis-rutas', async (req, res) => {
    console.log('🔍 [MOVIL] Ruta GET /mis-rutas - Listando rutas del chofer');
    try {
        const choferId = extraerChoferIdDeRequest(req);
        if (!choferId) {
            return res.status(401).json({ success: false, error: req.headers.authorization ? 'Token inválido' : 'Token no proporcionado' });
        }

        // Obtener todas las rutas activas (ARMANDO o EN_CAMINO) del chofer con conteo de entregas
        const query = `
            SELECT 
                r.id,
                r.nombre_ruta,
                r.fecha_salida,
                r.estado,
                (SELECT COUNT(*) FROM presupuestos p WHERE p.id_ruta = r.id) +
                (SELECT COUNT(*) FROM ordenes_tratamiento t WHERE t.id_ruta = r.id) +
                (SELECT COUNT(*) FROM public.factura_pagos_efectivo s WHERE s.id_ruta = r.id) +
                (SELECT COUNT(*) FROM public.bunker_prospectos pr WHERE pr.id_ruta = r.id AND pr.activo = true) as total_entregas
            FROM rutas r
            WHERE r.id_chofer = $1 
              AND r.estado IN ('ARMANDO', 'EN_CAMINO')
            ORDER BY 
                CASE 
                    WHEN r.estado = 'EN_CAMINO' THEN 1
                    WHEN r.estado = 'ARMANDO' THEN 2
                END ASC,
                r.id DESC
        `;
        const result = await req.db.query(query, [choferId]);
        console.log(`[MOVIL] ✅ ${result.rows.length} rutas encontradas para chofer ${choferId}`);

        res.json({
            success: true,
            data: result.rows.map(r => ({
                id: r.id,
                nombre_ruta: r.nombre_ruta,
                fecha_salida: r.fecha_salida,
                estado: r.estado,
                total_entregas: parseInt(r.total_entregas) || 0
            }))
        });
    } catch (error) {
        console.error('❌ [MOVIL] Error al listar rutas:', error);
        res.status(500).json({ success: false, error: 'Error al listar rutas', message: error.message });
    }
});

/**
 * @route GET /api/logistica/movil/ruta-activa
 * @desc Obtener ruta activa del chofer autenticado.
 *       Acepta query param ?id=X para cargar una ruta específica (multigestión).
 *       Si no se envía ?id, devuelve la ruta de mayor prioridad (EN_CAMINO > ARMANDO).
 * @access Privado (requiere token)
 */
router.get('/ruta-activa', async (req, res) => {
    console.log('🔍 [MOVIL] Ruta GET /ruta-activa - Obteniendo ruta del chofer');

    try {
        const choferId = extraerChoferIdDeRequest(req);
        if (!choferId) {
            return res.status(401).json({
                success: false,
                error: req.headers.authorization ? 'Token inválido' : 'Token no proporcionado'
            });
        }

        // Soporte multigestión: si se envía ?id=X, cargar esa ruta específica
        const rutaIdSolicitada = req.query.id ? parseInt(req.query.id) : null;
        console.log('[MOVIL] Buscando ruta para chofer ID:', choferId, rutaIdSolicitada ? `(ruta específica: ${rutaIdSolicitada})` : '(auto-prioridad)');

        // Buscar ruta activa del chofer
        // Si se envió ?id, filtrar por ese ID específico
        // Si no, priorizar EN_CAMINO > ARMANDO, más reciente primero
        let queryRuta;
        let queryParams;

        if (rutaIdSolicitada) {
            // Modo multigestión: cargar ruta específica (verificando que pertenezca al chofer)
            queryRuta = `
                SELECT 
                    r.id,
                    r.nombre_ruta,
                    r.fecha_salida,
                    r.estado,
                    r.id_vehiculo,
                    r.en_pausa,
                    r.inicio_ultima_pausa,
                    r.tiempo_pausado_minutos,
                    u.nombre_completo as chofer_nombre
                FROM rutas r
                INNER JOIN usuarios u ON r.id_chofer = u.id
                WHERE r.id = $1 
                  AND r.id_chofer = $2
                  AND r.estado IN ('ARMANDO', 'EN_CAMINO')
                LIMIT 1
            `;
            queryParams = [rutaIdSolicitada, choferId];
        } else {
            // Modo legacy: auto-seleccionar por prioridad
            queryRuta = `
                SELECT 
                    r.id,
                    r.nombre_ruta,
                    r.fecha_salida,
                    r.estado,
                    r.id_vehiculo,
                    r.en_pausa,
                    r.inicio_ultima_pausa,
                    r.tiempo_pausado_minutos,
                    u.nombre_completo as chofer_nombre
                FROM rutas r
                INNER JOIN usuarios u ON r.id_chofer = u.id
                WHERE r.id_chofer = $1 
                  AND r.estado IN ('ARMANDO', 'EN_CAMINO')
                ORDER BY 
                    CASE 
                        WHEN r.estado = 'EN_CAMINO' THEN 1
                        WHEN r.estado = 'ARMANDO' THEN 2
                    END ASC,
                    r.id DESC
                LIMIT 1
            `;
            queryParams = [choferId];
        }

        const resultRuta = await req.db.query(queryRuta, queryParams);

        if (resultRuta.rows.length === 0) {
            console.log('[MOVIL] ⚠️ No hay ruta activa para chofer:', choferId);
            return res.json({
                success: true,
                data: null,
                message: 'No hay ruta activa'
            });
        }

        const ruta = resultRuta.rows[0];

        console.log('[MOVIL] ✅ Ruta encontrada:', ruta.nombre_ruta);
        console.log('[MOVIL] Estado:', ruta.estado);
        console.log('[MOVIL] ID de ruta:', ruta.id);

        // Obtener entregas de la ruta ordenadas
        // IMPORTANTE: JOIN CORREGIDO
        // presupuestos.id_cliente (TEXT) -> clientes.cliente_id (INTEGER)
        // NO usar clientes.id (es PK autoincremental, no el ID del cliente)
        const queryEntregas = `
            SELECT 
                p.id as id_presupuesto,
                p.id_presupuesto_ext,
                p.estado,
                p.orden_entrega,
                p.estado_logistico,
                p.nota,
                p.descuento,
                p.comprobante_lomasoft,
                p.id_factura_lomasoft,
                c.cliente_id as cliente_id,
                COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin nombre') as cliente_nombre,
                c.telefono as cliente_telefono,
                cd.id as domicilio_id,
                cd.alias as domicilio_alias,
                cd.direccion as domicilio_direccion,
                cd.localidad as domicilio_localidad,
                cd.provincia as domicilio_provincia,
                cd.telefono_contacto as domicilio_telefono,
                cd.instrucciones_entrega as domicilio_instrucciones,
                cd.latitud,
                cd.longitud,
                (SELECT json_agg(json_build_object('id', d.id, 'direccion', d.direccion, 'localidad', d.localidad, 'latitud', d.latitud, 'longitud', d.longitud)) 
                 FROM clientes_domicilios d WHERE d.id_cliente = c.id OR d.id_cliente::text = c.cliente_id::text) as domicilios_alternativos,
                COALESCE(
                    (SELECT ROUND(SUM(pd.cantidad * COALESCE(pd.precio1, 0)) * (1 - (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN p.descuento / 100.0 ELSE COALESCE(p.descuento, 0) END)), 2)
                     FROM presupuestos_detalles pd
                     WHERE pd.id_presupuesto = p.id),
                    0
                ) as total,
                (SELECT f.estado FROM public.factura_facturas f WHERE f.presupuesto_id = p.id ORDER BY f.id DESC LIMIT 1) as factura_estado,
                EXISTS(SELECT 1 FROM public.factura_facturas f WHERE f.presupuesto_id = p.id AND f.estado IN ('APROBADA', 'APROBADA_LOCAL')) as esta_facturado,
                (SELECT m.supabase_pedido_id::text FROM public.b2b_pedidos_mapeo m WHERE m.local_presupuesto_id = p.id LIMIT 1) as supabase_pedido_id
            FROM presupuestos p
            INNER JOIN clientes c ON ltrim(p.id_cliente::text, '0') = c.cliente_id::text
            LEFT JOIN clientes_domicilios cd ON p.id_domicilio_entrega = cd.id
            WHERE p.id_ruta = $1
              AND p.activo = true
              AND COALESCE(p.estado, '') NOT IN ('Anulado', 'Anulado por el Cliente', 'ANULADO')
            ORDER BY COALESCE(p.orden_entrega, 999) ASC
        `;

        console.log('[MOVIL] Buscando entregas para ruta ID:', ruta.id);
        const resultEntregas = await req.db.query(queryEntregas, [ruta.id]);
        console.log('[MOVIL] ✅ Entregas encontradas:', resultEntregas.rows.length);

        // Formatear entregas
        const entregas = resultEntregas.rows.map(e => ({
            id_presupuesto: e.id_presupuesto,
            id_presupuesto_ext: e.id_presupuesto_ext,
            supabase_pedido_id: e.supabase_pedido_id || null,
            orden_entrega: e.orden_entrega,
            estado: e.estado,
            estado_logistico: e.estado_logistico,
            comprobante_lomasoft: e.comprobante_lomasoft,
            id_factura_lomasoft: e.id_factura_lomasoft,
            total: e.total,
            factura_estado: e.factura_estado,
            esta_facturado: e.esta_facturado,
            cliente: {
                id: e.cliente_id,
                nombre: e.cliente_nombre,
                telefono: e.cliente_telefono
            },
            domicilio: {
                id: e.domicilio_id,
                alias: e.domicilio_alias,
                direccion: e.domicilio_direccion,
                localidad: e.domicilio_localidad,
                provincia: e.domicilio_provincia,
                telefono_contacto: e.domicilio_telefono,
                instrucciones_entrega: e.domicilio_instrucciones,
                latitud: e.latitud,
                longitud: e.longitud
            },
            domicilios_alternativos: e.domicilios_alternativos
        }));

        console.log(`[MOVIL] ✅ Ruta activa encontrada: ${ruta.nombre_ruta} con ${entregas.length} entregas comerciales`);

        // INYECCIÓN DE RETIROS DE MANTENIMIENTO (FASE 3)
        const queryRetiros = `
            SELECT 
                o.id as id_orden,
                o.orden_entrega,
                o.estado_logistico,
                o.estado_tratamiento,
                o.codigo_qr_hash,
                o.fecha_creacion,
                c.cliente_id,
                COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin nombre') as cliente_nombre,
                c.telefono as cliente_telefono,
                cd.id as domicilio_id,
                COALESCE(cd.direccion, 'Retiro en Cliente') as domicilio_direccion,
                COALESCE(cd.localidad, c.localidad) as domicilio_localidad,
                cd.latitud as domicilio_latitud,
                cd.longitud as domicilio_longitud,
                (SELECT json_agg(json_build_object(
                    'articulo_numero', d.articulo_numero,
                    'descripcion_externa', d.descripcion_externa,
                    'kilos', d.kilos,
                    'bultos', d.bultos
                )) FROM ordenes_tratamiento_detalles d WHERE d.id_orden_tratamiento = o.id) as detalles
            FROM ordenes_tratamiento o
            LEFT JOIN clientes c ON o.id_cliente = c.cliente_id
            LEFT JOIN clientes_domicilios cd ON cd.id = COALESCE(
                o.id_domicilio_entrega,
                (
                    SELECT id 
                    FROM clientes_domicilios 
                    WHERE id_cliente = c.id AND activo = true
                    ORDER BY es_predeterminado DESC, id ASC
                    LIMIT 1
                )
            )
            WHERE o.id_ruta = $1
            AND o.estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION', 'EN_CAMINO', 'PENDIENTE_DEVOLUCION_CLIENTE')
            ORDER BY o.id ASC
        `;
        const resultRetiros = await req.db.query(queryRetiros, [ruta.id]);
        
        const retirosMantenimiento = resultRetiros.rows.map(r => ({
            id_orden: r.id_orden,
            es_retiro_tratamiento: true,
            orden_entrega: r.orden_entrega,
            estado_logistico: r.estado_logistico,
            estado_tratamiento: r.estado_tratamiento,
            hash: r.codigo_qr_hash,
            fecha_creacion: r.fecha_creacion,
            cliente: {
                id: r.cliente_id,
                nombre: r.cliente_nombre,
                telefono: r.cliente_telefono
            },
            domicilio: {
                id: r.domicilio_id,
                direccion: r.domicilio_direccion,
                localidad: r.domicilio_localidad,
                latitud: r.domicilio_latitud,
                longitud: r.domicilio_longitud
            },
            detalles: r.detalles || []
        }));

        console.log(`[MOVIL] ✅ Retiros de Mantenimiento encontrados: ${retirosMantenimiento.length}`);

        // INYECCIÓN DE SOBRES DE EFECTIVO ASIGNADOS A LA RUTA (FASE 4)
        const querySobres = `
            SELECT 
                s.id as id_sobre,
                s.codigo_sobre,
                s.monto_declarado,
                s.foto_frente_url,
                s.foto_dorso_url,
                s.estado,
                s.orden_entrega,
                s.observaciones_cliente,
                s.fecha_creacion,
                c.cliente_id as cliente_id,
                s.cliente_id as codigo_bunker_cliente,
                COALESCE(c.nombre || ' ' || c.apellido, c.nombre, bc.cliente_nombre, bc.razon_social, s.cliente_id) as cliente_nombre,
                COALESCE(c.telefono, bc.whatsapp_facturas, s.colaborador_telefono) as cliente_telefono,
                cd.id as domicilio_id,
                cd.alias as domicilio_alias,
                COALESCE(cd.direccion, bc.domicilio_fiscal, 'Retiro de Sobre') as domicilio_direccion,
                COALESCE(cd.localidad, c.localidad) as domicilio_localidad,
                COALESCE(cd.provincia, bc.provincia, '') as domicilio_provincia,
                cd.telefono_contacto as domicilio_telefono,
                cd.instrucciones_entrega as domicilio_instrucciones,
                cd.latitud as domicilio_latitud,
                cd.longitud as domicilio_longitud
            FROM public.factura_pagos_efectivo s
            LEFT JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = s.cliente_id OR bc.lomas_soft_id = s.cliente_id
            LEFT JOIN public.clientes c ON (bc.lomas_soft_id IS NOT NULL AND c.cliente_id::text = ltrim(bc.lomas_soft_id, '0'))
                                        OR (bc.id IS NULL AND c.cliente_id::text = ltrim(s.cliente_id, '0'))
            LEFT JOIN public.clientes_domicilios cd ON cd.id = COALESCE(
                s.id_domicilio_entrega,
                (
                    SELECT cd_sub.id 
                    FROM public.clientes_domicilios cd_sub
                    WHERE (
                        cd_sub.id_cliente = bc.id
                        OR cd_sub.id_cliente = c.id
                        OR cd_sub.id_cliente::text = bc.lomas_soft_id
                        OR cd_sub.id_cliente::text = c.cliente_id::text
                    ) AND cd_sub.activo = true
                    ORDER BY cd_sub.es_predeterminado DESC, cd_sub.fecha_creacion ASC, cd_sub.id ASC
                    LIMIT 1
                )
            )
            WHERE s.id_ruta = $1
            ORDER BY COALESCE(s.orden_entrega, 999) ASC, s.id ASC
        `;
        const resultSobres = await req.db.query(querySobres, [ruta.id]);

        const sobresEfectivo = resultSobres.rows.map(s => ({
            id_sobre: s.id_sobre,
            codigo_sobre: s.codigo_sobre,
            es_sobre_efectivo: true,
            orden_entrega: s.orden_entrega,
            estado: s.estado,
            estado_logistico: ['EN_TRANSITO', 'RECIBIDO_LOCAL', 'ACREDITADO'].includes(s.estado) ? 'RETIRADO' : 'ASIGNADO',
            monto_declarado: parseFloat(s.monto_declarado || 0),
            foto_frente_url: s.foto_frente_url,
            foto_dorso_url: s.foto_dorso_url,
            observaciones_cliente: s.observaciones_cliente,
            fecha_creacion: s.fecha_creacion,
            cliente: {
                id: s.cliente_id || s.codigo_bunker_cliente,
                codigo_bunker: s.codigo_bunker_cliente,
                nombre: s.cliente_nombre,
                telefono: s.cliente_telefono
            },
            domicilio: {
                id: s.domicilio_id,
                alias: s.domicilio_alias,
                direccion: s.domicilio_direccion,
                localidad: s.domicilio_localidad,
                provincia: s.domicilio_provincia,
                telefono_contacto: s.domicilio_telefono,
                instrucciones_entrega: s.domicilio_instrucciones,
                latitud: s.domicilio_latitud,
                longitud: s.domicilio_longitud
            }
        }));

        console.log(`[MOVIL] ✅ Sobres de Efectivo en ruta encontrados: ${sobresEfectivo.length}`);

        // INYECCIÓN DE VISITAS COMERCIALES DE PREVENTA ASIGNADAS A LA RUTA (FASE 5)
        const queryProspectosRuta = `
            SELECT 
                p.id as id_prospecto,
                p.codigo_prospecto,
                p.origen_contacto,
                p.cliente_activo_id,
                p.cliente_domicilio_id,
                p.nombre_fantasia,
                p.rubro,
                p.direccion,
                p.localidad,
                p.zona,
                p.latitud,
                p.longitud,
                p.contacto_nombre,
                p.contacto_rol,
                p.telefono_whatsapp,
                p.email,
                p.estado as estado_prospecto,
                p.estado_ruta,
                p.orden_entrega,
                p.notas,
                p.imagen_url,
                p.web_redes,
                p.lista_precios_sugerida_id
            FROM public.bunker_prospectos p
            WHERE p.id_ruta = $1 AND p.activo = true
            ORDER BY COALESCE(p.orden_entrega, 999) ASC, p.id ASC
        `;
        const resultProspectos = await req.db.query(queryProspectosRuta, [ruta.id]);

        const visitasPreventa = resultProspectos.rows.map(p => ({
            id_prospecto: p.id_prospecto,
            codigo_prospecto: p.codigo_prospecto,
            origen_contacto: p.origen_contacto,
            cliente_activo_id: p.cliente_activo_id,
            cliente_domicilio_id: p.cliente_domicilio_id,
            es_visita_preventa: true,
            orden_entrega: p.orden_entrega,
            estado: p.estado_prospecto,
            estado_ruta: p.estado_ruta || 'PENDIENTE',
            estado_logistico: p.estado_ruta === 'VISITADO'
                ? 'ENTREGADO'
                : (['NO_ENCONTRADO', 'NO_CONCRETADA'].includes(p.estado_ruta) ? 'RECHAZADO' : 'ASIGNADO'),
            rubro: p.rubro,
            contacto_nombre: p.contacto_nombre,
            contacto_rol: p.contacto_rol,
            telefono_whatsapp: p.telefono_whatsapp,
            email: p.email,
            notas: p.notas,
            imagen_url: p.imagen_url,
            web_redes: p.web_redes,
            lista_precios_sugerida_id: p.lista_precios_sugerida_id,
            cliente: {
                id: p.codigo_prospecto,
                nombre: p.nombre_fantasia,
                telefono: p.telefono_whatsapp
            },
            domicilio: {
                id: `dom_pr_${p.id_prospecto}`,
                alias: p.zona || p.localidad || 'Preventa',
                direccion: p.direccion || 'Presentación Comercial',
                localidad: p.zona || p.localidad || 'Gran La Plata',
                provincia: 'Buenos Aires',
                telefono_contacto: p.telefono_whatsapp,
                instrucciones_entrega: p.notas,
                latitud: p.latitud,
                longitud: p.longitud
            }
        }));

        console.log(`[MOVIL] ✅ Visitas de Preventa en ruta encontradas: ${visitasPreventa.length}`);

        res.json({
            success: true,
            data: {
                ruta: ruta,
                entregas: entregas,
                retiros: retirosMantenimiento,
                sobres: sobresEfectivo,
                visitas_preventa: visitasPreventa
            }
        });

    } catch (error) {
        console.error('❌ [MOVIL] Error al obtener ruta activa:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener ruta activa',
            message: error.message
        });
    }
});

/**
 * @route GET /api/logistica/movil/pedidos/:id/detalles
 * @desc Obtener detalles de artículos de un pedido para checklist
 * @access Privado (requiere token)
 */
router.get('/pedidos/:id/detalles', async (req, res) => {
    console.log('🔍 [MOVIL] Ruta GET /pedidos/:id/detalles - Obteniendo detalles del pedido');

    try {
        const { id } = req.params;
        const rawId = String(id || '').trim();

        console.log('[MOVIL] Buscando detalles para presupuesto identificador:', rawId);

        const isNumeric = /^\d+$/.test(rawId);
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);

        // Resolver presupuesto por ID numérico local, id_presupuesto_ext o supabase_pedido_id (QR de remito)
        const presupuestoQuery = `
            SELECT p.id, p.id_presupuesto_ext
            FROM public.presupuestos p
            LEFT JOIN public.b2b_pedidos_mapeo m ON m.local_presupuesto_id = p.id
            WHERE ($1::int IS NOT NULL AND p.id = $1::int)
               OR p.id_presupuesto_ext = $2
               OR ($3::uuid IS NOT NULL AND m.supabase_pedido_id = $3::uuid)
            ORDER BY p.id DESC
            LIMIT 1
        `;

        const presupuestoResult = await req.db.query(presupuestoQuery, [
            isNumeric ? parseInt(rawId, 10) : null,
            rawId,
            isUuid ? rawId : null
        ]);

        if (presupuestoResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado'
            });
        }

        const localPresupuestoId = presupuestoResult.rows[0].id;
        const idPresupuestoExt = presupuestoResult.rows[0].id_presupuesto_ext;

        // Obtener detalles de artículos por clave foránea entera (Micro-Etapa 2)
        const detallesQuery = `
            SELECT 
                codigo_barras,
                articulo,
                articulo_numero,
                cantidad,
                descripcion,
                descripcion_bunker
            FROM public.v_presupuestos_detalles_resueltos
            WHERE id_presupuesto = $1
            ORDER BY id ASC
        `;

        const detallesResult = await req.db.query(detallesQuery, [localPresupuestoId]);

        console.log('[MOVIL] ✅ Detalles encontrados:', detallesResult.rows.length, 'artículos');

        res.json({
            success: true,
            data: detallesResult.rows
        });

    } catch (error) {
        console.error('❌ [MOVIL] Error al obtener detalles:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener detalles del pedido',
            message: error.message
        });
    }
});

/**
 * @route POST /api/logistica/movil/entregas/escanear-qr
 * @desc Escaneo de remito QR. Confirma entrega automáticamente y busca retiros pendientes.
 */
router.post('/entregas/escanear-qr', async (req, res) => {
    console.log('🔍 [MOVIL] Ruta POST /entregas/escanear-qr - Procesando escaneo');
    const fs = require('fs');
    const path = require('path');
    const emailService = require('../../facturacion/services/emailService');
    
    try {
        const { uuid, foto_remito, foto_bulto, latitud, longitud, itemsModificados, observaciones_chofer } = req.body;
        if (!uuid) {
            return res.status(400).json({ success: false, error: 'Código UUID/Token es requerido.' });
        }

        // Normalizar token: si es una URL, extraer el último segmento del path o parámetro de consulta (soportando hash router)
        let token = uuid.trim();
        if (token.startsWith('http://') || token.startsWith('https://')) {
            try {
                const urlObj = new URL(token);
                if (urlObj.hash) {
                    const hashPath = urlObj.hash.replace(/^#/, '');
                    const qIndex = hashPath.indexOf('?');
                    let cleanHashPath = qIndex !== -1 ? hashPath.substring(0, qIndex) : hashPath;
                    const hashSegments = cleanHashPath.split('/').filter(s => s.length > 0);
                    if (hashSegments.length > 0) {
                        token = hashSegments[hashSegments.length - 1].trim();
                    }
                } else {
                    const queryId = urlObj.searchParams.get('id') || urlObj.searchParams.get('hash') || urlObj.searchParams.get('p');
                    if (queryId) {
                        token = queryId.trim();
                    } else {
                        const pathSegments = urlObj.pathname.split('/').filter(s => s.length > 0);
                        if (pathSegments.length > 0) {
                            token = pathSegments[pathSegments.length - 1].trim();
                        }
                    }
                }
            } catch (urlErr) {
                console.warn('[MOVIL-SCAN] Error parseando URL de QR, usando fallback:', urlErr.message);
                const matchParam = token.match(/[?&](id|hash|p)=([^&#]+)/);
                if (matchParam) {
                    token = matchParam[2];
                } else {
                    const matchSegment = token.match(/\/([^/?#]+)[/?#]*$/);
                    if (matchSegment) {
                        token = matchSegment[1];
                    }
                }
            }
        }

        // Extraer UUID si lo contiene
        const uuidMatch = token.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (uuidMatch) {
            token = uuidMatch[0];
        }

        // Si el token tiene el formato de bulto de presupuesto local (ej: "8234586-1"), quedarnos solo con el ID de presupuesto ("8234586")
        const localPackageMatch = token.match(/^([0-9]+)-[0-9]+$/);
        if (localPackageMatch) {
            token = localPackageMatch[1];
        }

        console.log('🔍 [MOVIL-SCAN] Recibido uuid:', uuid, '-> Token normalizado:', token);

        const client = await req.db.connect();
        try {
            await client.query('BEGIN');

            // 1. Buscar el presupuesto por UUID en id_presupuesto_ext o en b2b_pedidos_mapeo
            const queryFind = `
                SELECT p.id, p.id_cliente, p.id_presupuesto_ext, p.estado_logistico, c.cliente_id,
                       COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Cliente') as cliente_nombre
                FROM public.presupuestos p
                LEFT JOIN public.b2b_pedidos_mapeo m ON m.local_presupuesto_id = p.id
                LEFT JOIN public.clientes c ON ltrim(p.id_cliente::text, '0') = c.cliente_id::text
                WHERE p.id_presupuesto_ext = $1 
                   OR (CASE WHEN $1 ~ '^[0-9]+$' THEN p.id = $1::integer ELSE false END)
                   OR (CASE WHEN $1 ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN m.supabase_pedido_id = $1::uuid ELSE false END)
                LIMIT 1
            `;
            const resFind = await client.query(queryFind, [token]);

            if (resFind.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Pedido no encontrado en el sistema local.' });
            }

            const p = resFind.rows[0];

            // 2. Procesar imágenes opcionales y guardarlas físicamente en logistica/public/uploads
            let foto_remito_url = null;
            let foto_bulto_url = null;
            const uploadsDir = path.join(__dirname, '../public/uploads');

            if (!fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
            }

            if (foto_remito) {
                const base64Clean = foto_remito.replace(/^data:image\/\w+;base64,/, "");
                const filename = `${p.id}_remito_${Date.now()}.jpg`;
                const filepath = path.join(uploadsDir, filename);
                fs.writeFileSync(filepath, base64Clean, 'base64');
                foto_remito_url = `/public/uploads/${filename}`;
                console.log(`[MOVIL-SCAN] 📷 Foto de remito firmada guardada en: ${foto_remito_url}`);
            }

            if (foto_bulto) {
                const base64Clean = foto_bulto.replace(/^data:image\/\w+;base64,/, "");
                const filename = `${p.id}_bulto_${Date.now()}.jpg`;
                const filepath = path.join(uploadsDir, filename);
                fs.writeFileSync(filepath, base64Clean, 'base64');
                foto_bulto_url = `/public/uploads/${filename}`;
                console.log(`[MOVIL-SCAN] 📷 Foto de bultos/conformidad guardada en: ${foto_bulto_url}`);
            }

            // 2.5 Si hay observaciones del chofer o artículos devueltos (Entrega Parcial)
            let itemsDevueltosResumen = [];
            if (itemsModificados && Array.isArray(itemsModificados) && itemsModificados.length > 0) {
                for (const itemMod of itemsModificados) {
                    const { codigo_barras, cantidad: nuevaCantidad } = itemMod;
                    const qtyVal = parseFloat(nuevaCantidad);

                    // Buscar detalle original por FK entera (id_presupuesto) y lectura dual de código (Micro-Etapa 2)
                    const origItemRes = await client.query(
                        `SELECT 
                            id_presupuesto,
                            cantidad,
                            articulo_numero,
                            descripcion as articulo_nombre
                         FROM public.v_presupuestos_detalles_resueltos
                         WHERE id_presupuesto = $1
                           AND (articulo = $2 OR codigo_barras = $2 OR articulo_numero = $2)
                         LIMIT 1`,
                        [p.id, codigo_barras]
                    );

                    if (origItemRes.rows.length > 0) {
                        const orig = origItemRes.rows[0];
                        const cantOriginal = parseFloat(orig.cantidad || 0);
                        const cantDevuelta = Math.max(0, cantOriginal - qtyVal);

                        if (cantDevuelta > 0) {
                            itemsDevueltosResumen.push(`${cantDevuelta} u. de ${orig.articulo_nombre}`);

                            // Inyectar atómicamente la devolución en Mantenimiento (Cuarentena / Pendiente NC)
                            const checkDup = await client.query(`
                                SELECT id FROM public.mantenimiento_movimientos
                                WHERE id_presupuesto_origen = $1 AND articulo_numero = $2 AND estado = 'PENDIENTE'
                            `, [p.id, orig.articulo_numero]);

                            if (checkDup.rowCount === 0) {
                                await client.query(`
                                    INSERT INTO public.mantenimiento_movimientos
                                    (articulo_numero, cantidad, id_presupuesto_origen, usuario, tipo_movimiento, estado, observaciones)
                                    VALUES ($1, $2, $3, $4, 'INGRESO', 'PENDIENTE', $5)
                                `, [
                                    orig.articulo_numero,
                                    cantDevuelta,
                                    p.id,
                                    'Logística Móvil (Chofer QR)',
                                    `Retorno por entrega parcial: ${cantDevuelta} u. de ${orig.articulo_nombre} (Cliente ${p.id_cliente})`
                                ]);
                                if (orig.articulo_numero) {
                                    await client.query(`
                                        UPDATE public.stock_real_consolidado
                                        SET stock_mantenimiento = COALESCE(stock_mantenimiento, 0) + $1, ultima_actualizacion = NOW()
                                        WHERE articulo_numero = $2
                                    `, [cantDevuelta, orig.articulo_numero]);
                                }
                                console.log(`[MOVIL-SCAN] 📦 Inyectada devolución a Mantenimiento y sumado stock_mantenimiento: ${cantDevuelta} u. de ${orig.articulo_nombre} (Presupuesto #${p.id})`);
                            }
                        }
                    }
                }
            }

            // Guardar observaciones del chofer en presupuestos.nota si existen
            if (observaciones_chofer || itemsDevueltosResumen.length > 0) {
                const notasTexto = [
                    observaciones_chofer ? `[Chofer]: ${observaciones_chofer}` : null,
                    itemsDevueltosResumen.length > 0 ? `[Devolución en camión]: ${itemsDevueltosResumen.join(', ')}` : null
                ].filter(Boolean).join(' | ');

                await client.query(
                    `UPDATE public.presupuestos 
                     SET nota = CASE 
                         WHEN nota IS NULL OR TRIM(nota) = '' THEN $1
                         ELSE nota || ' | ' || $1
                     END
                     WHERE id = $2`,
                    [notasTexto, p.id]
                );
            }

            // 3. Si no está ENTREGADO, actualizar localmente el estado logístico
            if (p.estado_logistico !== 'ENTREGADO') {
                await client.query(
                    `UPDATE public.presupuestos 
                     SET secuencia = 'Entregado',
                         estado = 'Entregado',
                         estado_logistico = 'ENTREGADO',
                         fecha_entrega_real = NOW(),
                         motivo_no_entrega = NULL,
                         fecha_actualizacion = NOW()
                     WHERE id = $1`,
                    [p.id]
                );
                console.log(`[MOVIL-SCAN] ✅ Presupuesto #${p.id} marcado localmente como ENTREGADO`);
                
                // Intentar actualizar Supabase B2B si es un UUID válido
                const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
                const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;
                if (SUPABASE_URL && SUPABASE_KEY) {
                    try {
                        const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.${uuid}`;
                        const patchBody = {
                            estado: 'Entregado',
                            entregado_chofer_fecha: new Date().toISOString(),
                            entregado_chofer_nombre: 'Chofer (QR)',
                            recibido_fecha: null,
                            recibido_por_nombre: null,
                            recibido_por_apellido: null,
                            recibido_por_telefono: null
                        };
                        await fetch(url, {
                            method: 'PATCH',
                            headers: {
                                'apikey': SUPABASE_KEY,
                                'Authorization': `Bearer ${SUPABASE_KEY}`,
                                'Content-Type': 'application/json',
                                'Prefer': 'return=minimal'
                            },
                            body: JSON.stringify(patchBody)
                        });
                        console.log(`[MOVIL-SCAN] ✅ Supabase pedido ${uuid} actualizado a Entregado (montos sincronizados: ${newTotal !== null})`);
                    } catch (supErr) {
                        console.error(`[MOVIL-SCAN] Error silencioso actualizando Supabase: ${supErr.message}`);
                    }
                }
            } else {
                console.log(`[MOVIL-SCAN] Presupuesto #${p.id} ya figuraba como ENTREGADO`);
            }

            // 4. Registrar evento de entrega en entregas_eventos (con fotos y observaciones del chofer si existen)
            let observacionesCombined = '';
            if (foto_bulto_url) {
                observacionesCombined += `Foto bulto: ${foto_bulto_url}`;
            }
            if (observaciones_chofer) {
                observacionesCombined += (observacionesCombined ? ' | ' : '') + `Obs Chofer: ${observaciones_chofer}`;
            }

            const tipoEvento = (itemsModificados && itemsModificados.length > 0) ? 'ENTREGA_PARCIAL' : 'ENTREGA';

            await client.query(
                `INSERT INTO public.entregas_eventos 
                 (id_presupuesto, receptor_nombre, receptor_vinculo, dni_receptor,
                  foto_conformidad_url, latitud_confirmacion, longitud_confirmacion,
                  firma_digital, fecha_entrega, observaciones, tipo_evento)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10)`,
                [
                    p.id,
                    'Chofer (QR)',
                    'Chofer',
                    null,
                    foto_remito_url || null,
                    latitud ? parseFloat(latitud) : null,
                    longitud ? parseFloat(longitud) : null,
                    null, // firma_digital
                    observacionesCombined || null,
                    tipoEvento
                ]
            );
            console.log('[MOVIL-SCAN] ✅ Evento de entrega insertado en public.entregas_eventos');

            // 5. Buscar retiros pendientes reales para este cliente (excluyendo órdenes ya en el camión o huérfanas de rutas cerradas)
            const queryRetiros = `
                SELECT 
                    o.id as id_orden,
                    o.orden_entrega,
                    o.estado_logistico,
                    o.estado_tratamiento,
                    o.codigo_qr_hash,
                    o.fecha_creacion,
                    (SELECT json_agg(json_build_object(
                        'articulo_numero', d.articulo_numero,
                        'descripcion_externa', d.descripcion_externa,
                        'kilos', d.kilos,
                        'bultos', d.bultos
                    )) FROM public.ordenes_tratamiento_detalles d WHERE d.id_orden_tratamiento = o.id) as detalles
                FROM public.ordenes_tratamiento o
                LEFT JOIN public.rutas r ON r.id = o.id_ruta
                WHERE (o.id_cliente::text = $1 OR o.id_cliente::text = LTRIM($1, '0'))
                  AND o.estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION')
                  AND (o.id_ruta IS NULL OR o.id_ruta = $2 OR r.estado IN ('ARMANDO', 'EN_CAMINO', 'PAUSADA'))
                ORDER BY o.id ASC
            `;
            const clientQueryId = p.cliente_id ? String(p.cliente_id) : String(p.id_cliente);
            const resRetiros = await client.query(queryRetiros, [clientQueryId, p.id_ruta || null]);

            const retirosPendientes = resRetiros.rows.map(r => ({
                id_orden: r.id_orden,
                orden_entrega: r.orden_entrega,
                estado_logistico: r.estado_logistico,
                estado_tratamiento: r.estado_tratamiento,
                codigo_qr_hash: r.codigo_qr_hash,
                fecha_creacion: r.fecha_creacion,
                cliente_nombre: p.cliente_nombre,
                cliente_id: clientQueryId,
                detalles: r.detalles || []
            }));

            // 5.b Buscar sobres de efectivo ensobrado pendientes para este cliente (Modalidad CHOFER)
            let sobresEfectivoPendientes = [];
            try {
                const resSobres = await client.query(`
                    SELECT id, codigo_sobre, monto_declarado, estado, foto_frente_url, foto_dorso_url
                    FROM public.factura_pagos_efectivo
                    WHERE (cliente_id = $1 OR cliente_id = ('CB-' || LPAD($1, 4, '0')) OR cliente_id = LTRIM($1, '0'))
                      AND estado IN ('PREPARADO', 'EN_TRANSITO')
                      AND modalidad_entrega = 'CHOFER'
                    ORDER BY id ASC
                `, [clientQueryId]);

                sobresEfectivoPendientes = resSobres.rows.map(s => ({
                    id: s.id,
                    codigo_sobre: s.codigo_sobre,
                    monto_declarado: parseFloat(s.monto_declarado),
                    estado: s.estado,
                    foto_frente_url: s.foto_frente_url
                }));
            } catch (eSob) {
                console.warn('[MOVIL] ⚠️ Error al consultar sobres de efectivo (no bloqueante):', eSob.message);
            }

            // 6. Obtener toda la información de contacto unificada del cliente (1-a-1 Búnker/Legacy)
            const clienteUnificado = await obtenerClienteUnificado(client, p.id_cliente);
            const contactInfo = clienteUnificado || {};

            // 7. Obtener detalles de artículos por FK entera (id_presupuesto) con resolución determinista Búnker (Micro-Etapa 2)
            const itemsRes = await client.query(
                `SELECT 
                     codigo_barras,
                     cantidad,
                     cantidad_original,
                     diferencia,
                     descripcion,
                     descripcion_bunker
                 FROM public.v_presupuestos_detalles_resueltos
                 WHERE id_presupuesto = $1
                 ORDER BY id ASC`,
                [p.id]
            );

            await client.query('COMMIT');

            // Responder inmediatamente al chofer
            res.json({
                success: true,
                id_presupuesto: p.id,
                cliente_nombre: p.cliente_nombre,
                retirosPendientes,
                sobresEfectivoPendientes
            });

            // Disparar envío asíncrono headless en background (si la notificación está activa)
            const { notificar } = req.body;
            if (notificar !== false) { // Por defecto true
                setTimeout(async () => {
                    try {
                        const clientName = contactInfo.cliente_nombre || p.cliente_nombre;

                        // Construir desglose separado para entregados vs devueltos
                        let desgloseEntregado = '';
                        let desgloseDevuelto = '';

                        itemsRes.rows.forEach(item => {
                            const cantEntregada = parseFloat(item.cantidad || 0);
                            const cantOriginal = (item.cantidad_original !== null && item.cantidad_original !== undefined) ? parseFloat(item.cantidad_original) : null;
                            const cantDevuelta = (cantOriginal !== null && cantOriginal > cantEntregada) ? (cantOriginal - cantEntregada) : 0;

                            if (cantEntregada > 0) {
                                desgloseEntregado += `• ${cantEntregada} u. - ${item.descripcion}\n`;
                            }
                            if (cantDevuelta > 0) {
                                desgloseDevuelto += `• ${cantDevuelta} u. - ${item.descripcion}\n`;
                            }
                        });

                        let notificationMsg = `📦 *¡Entrega Confirmada!*\n\nEstimado/a *${clientName}*,\nSu pedido #${p.id} ha sido entregado por nuestro chofer.`;

                        if (desgloseEntregado) {
                            notificationMsg += `\n\n*Detalle de mercadería entregada:*\n${desgloseEntregado.trim()}`;
                        }
                        if (desgloseDevuelto) {
                            notificationMsg += `\n\n*Ajuste / Mercadería devuelta:*\n${desgloseDevuelto.trim()}`;
                        }
                        notificationMsg += `\n\n¡Muchas gracias por elegir LAMDA!`;

                        console.log(`[NOTI-BG] 📨 Iniciando envío de notificación para pedido #${p.id}.`);

                        // 1. Resolver lista estricta de destinatarios de WhatsApp mediante clienteResolver
                        const destinatariosObjetos = resolverDestinatariosAlertaEntrega(contactInfo);
                        const whatsappDestinatarios = destinatariosObjetos.map(d => d.numero);

                        // 2. Obtener lista de correos destinatarios
                        const emailDestinatarios = [];
                        if (contactInfo.email_facturas) {
                            try {
                                const list = JSON.parse(contactInfo.email_facturas);
                                if (Array.isArray(list)) {
                                    list.forEach(c => {
                                        if (c.email && c.enviar_alerta !== false) {
                                            emailDestinatarios.push(c.email);
                                        }
                                    });
                                }
                            } catch (e) {
                                const simpleEmails = String(contactInfo.email_facturas).split(',').map(e => e.trim()).filter(Boolean);
                                simpleEmails.forEach(email => emailDestinatarios.push(email));
                            }
                        }
                        
                        if (emailDestinatarios.length === 0 && contactInfo.email) {
                            emailDestinatarios.push(contactInfo.email.trim());
                        }

                        // 3. Despachar WhatsApps en masa (en paralelo)
                        const waPromises = whatsappDestinatarios.map(async (whatsappDestino) => {
                            try {
                                const facturacionUrl = process.env.FACTURACION_API_URL || 'http://localhost:3004';
                                if (foto_remito) {
                                    // Enviar remito
                                    const resRemito = await fetch(`${facturacionUrl}/facturacion/whatsapp/enviar-imagen`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            destinatarios: whatsappDestino,
                                            base64Data: foto_remito.replace(/^data:image\/\w+;base64,/, ""),
                                            mimeType: 'image/jpeg',
                                            filename: `remito_${p.id}.jpg`,
                                            mensajeTexto: notificationMsg
                                        })
                                    });
                                    const dataRemito = await resRemito.json();
                                    if (!dataRemito.success) {
                                        throw new Error(dataRemito.error || 'Error al enviar remito por WhatsApp');
                                    }

                                    if (foto_bulto) {
                                        // Enviar bulto
                                        const resBulto = await fetch(`${facturacionUrl}/facturacion/whatsapp/enviar-imagen`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                destinatarios: whatsappDestino,
                                                base64Data: foto_bulto.replace(/^data:image\/\w+;base64,/, ""),
                                                mimeType: 'image/jpeg',
                                                filename: `bulto_${p.id}.jpg`,
                                                mensajeTexto: 'Foto de conformidad de bultos/entrega.'
                                            })
                                        });
                                        const dataBulto = await resBulto.json();
                                        if (!dataBulto.success) {
                                            throw new Error(dataBulto.error || 'Error al enviar foto de bulto por WhatsApp');
                                        }
                                    }
                                } else if (foto_bulto) {
                                    // Enviar bulto únicamente
                                    const resBulto = await fetch(`${facturacionUrl}/facturacion/whatsapp/enviar-imagen`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            destinatarios: whatsappDestino,
                                            base64Data: foto_bulto.replace(/^data:image\/\w+;base64,/, ""),
                                            mimeType: 'image/jpeg',
                                            filename: `bulto_${p.id}.jpg`,
                                            mensajeTexto: notificationMsg
                                        })
                                    });
                                    const dataBulto = await resBulto.json();
                                    if (!dataBulto.success) {
                                        throw new Error(dataBulto.error || 'Error al enviar foto de bulto por WhatsApp');
                                    }
                                } else {
                                    // Enviar mensaje de texto únicamente
                                    const resMsg = await fetch(`${facturacionUrl}/facturacion/whatsapp/enviar-mensaje`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            destinatarios: whatsappDestino,
                                            mensajeTexto: notificationMsg
                                        })
                                    });
                                    const dataMsg = await resMsg.json();
                                    if (!dataMsg.success) {
                                        throw new Error(dataMsg.error || 'Error al enviar mensaje por WhatsApp');
                                    }
                                }
                                console.log(`[NOTI-BG] ✅ Notificación WhatsApp enviada a: ${whatsappDestino}`);
                            } catch (wsErr) {
                                console.error(`[NOTI-BG] ⚠️ Falló WhatsApp para ${whatsappDestino}, se omitió. Detalle:`, wsErr.message);
                            }
                        });

                        // 4. Despachar Emails en masa (en paralelo)
                        const emailPromises = emailDestinatarios.map(async (emailDestino) => {
                            try {
                                await enviarNotificacionEmail(emailDestino, clientName, p.id, itemsRes.rows, foto_remito, foto_bulto, emailService);
                            } catch (mailErr) {
                                console.error(`[NOTI-BG] ⚠️ Falló Email para ${emailDestino}. Detalle:`, mailErr.message);
                            }
                        });

                        await Promise.all([...waPromises, ...emailPromises]);

                    } catch (notiErr) {
                        console.error('❌ [NOTI-BG] Error en proceso asíncrono de notificación:', notiErr.message);
                    }
                }, 100);
            } else {
                console.log(`[MOVIL-SCAN] 💾 Guardado sin notificación (notificar = false) para pedido #${p.id}`);
            }

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('❌ [MOVIL] Error al procesar escaneo QR:', error);
        res.status(500).json({
            success: false,
            error: 'Error al procesar escaneo QR',
            message: error.message
        });
    }
});

/**
 * @route POST /api/logistica/movil/entregas/incidencia
 * @desc Registrar una incidencia / visita fallida para un pedido en la ruta activa
 * @access Privado (requiere token)
 */
router.post('/entregas/incidencia', async (req, res) => {
    console.log('🔍 [MOVIL] Ruta POST /entregas/incidencia - Procesando visita fallida');
    const client = await req.db.connect();
    try {
        const { id_presupuesto, motivo, latitud, longitud } = req.body;
        
        if (!id_presupuesto || !motivo) {
            return res.status(400).json({ success: false, error: 'ID de presupuesto y motivo son requeridos.' });
        }

        await client.query('BEGIN');

        // 1. Obtener información del presupuesto y el cliente
        const queryFind = `
            SELECT p.id, p.id_cliente, p.id_ruta, p.id_presupuesto_ext, p.estado_logistico, p.estado,
                   COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Cliente') as cliente_nombre
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON ltrim(p.id_cliente::text, '0') = c.cliente_id::text
            WHERE p.id = $1
            LIMIT 1
        `;
        const resFind = await client.query(queryFind, [id_presupuesto]);
        if (resFind.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Pedido no encontrado.' });
        }
        const p = resFind.rows[0];

        // GUARD: No permitir registrar incidencia en un pedido que ya está entregado o retirado
        if (p.estado_logistico === 'ENTREGADO' || p.estado_logistico === 'RETIRADO' || p.estado === 'Entregado' || p.estado === 'Retirado') {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                success: false, 
                error: 'Este pedido ya fue entregado/retirado y debe permanecer en la Hoja de Ruta.' 
            });
        }

        // 2. Registrar el evento de incidencia en public.entregas_eventos
        await client.query(
            `INSERT INTO public.entregas_eventos 
             (id_presupuesto, receptor_nombre, receptor_vinculo, dni_receptor,
              latitud_confirmacion, longitud_confirmacion, fecha_entrega, observaciones, tipo_evento, motivo_incidencia)
             VALUES ($1, 'Chofer', 'Incidencia', null, $2, $3, NOW(), $4, 'INCIDENCIA', $4)`,
            [
                p.id,
                latitud ? parseFloat(latitud) : null,
                longitud ? parseFloat(longitud) : null,
                motivo
            ]
        );
        console.log(`[MOVIL-INCIDENCIA] ✅ Evento de incidencia registrado para pedido #${p.id}: ${motivo}`);

        // 2b. Si existían movimientos PENDIENTE en mantenimiento_movimientos por rechazo/devolución previa de este presupuesto, revertirlos de stock_mantenimiento
        const movsPendInc = await client.query(`
            DELETE FROM public.mantenimiento_movimientos
            WHERE id_presupuesto_origen = $1
              AND estado = 'PENDIENTE'
              AND tipo_movimiento = 'INGRESO'
            RETURNING articulo_numero, cantidad
        `, [p.id]);
        for (const mov of movsPendInc.rows) {
            const cantRev = parseFloat(mov.cantidad) || 0;
            if (mov.articulo_numero && cantRev > 0) {
                await client.query(`
                    UPDATE public.stock_real_consolidado
                    SET stock_mantenimiento = GREATEST(0, COALESCE(stock_mantenimiento, 0) - $1),
                        ultima_actualizacion = NOW()
                    WHERE articulo_numero = $2 OR codigo_barras = $2
                `, [cantRev, mov.articulo_numero]);
            }
        }
        await client.query(`
            UPDATE public.presupuestos_detalles
            SET cantidad = COALESCE(cantidad_original, cantidad),
                cantidad_original = NULL
            WHERE id_presupuesto = $1 AND cantidad_original IS NOT NULL
        `, [p.id]);

        // 3. Devolver presupuesto al pool de pendientes
        await client.query(
            `UPDATE public.presupuestos 
             SET id_ruta = NULL,
                 estado_logistico = 'PENDIENTE_ASIGNAR',
                 secuencia = 'Pedido_Listo',
                 orden_entrega = NULL,
                 fecha_asignacion_ruta = NULL,
                 motivo_no_entrega = $1,
                 fecha_actualizacion = NOW()
             WHERE id = $2`,
            [motivo, p.id]
        );
        console.log(`[MOVIL-INCIDENCIA] ✅ Presupuesto #${p.id} desvinculado de la ruta y retornado a pendientes.`);

        await client.query('COMMIT');

        // 4. Intentar actualizar Supabase B2B si es un pedido mapeado
        const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
        const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;
        if (SUPABASE_URL && SUPABASE_KEY) {
            const mappingRes = await req.db.query(
                'SELECT supabase_pedido_id FROM public.b2b_pedidos_mapeo WHERE local_presupuesto_id = $1 LIMIT 1',
                [p.id]
            );
            if (mappingRes.rowCount > 0) {
                const uuid = mappingRes.rows[0].supabase_pedido_id;
                try {
                    const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.${uuid}`;
                    await fetch(url, {
                        method: 'PATCH',
                        headers: {
                            'apikey': SUPABASE_KEY,
                            'Authorization': `Bearer ${SUPABASE_KEY}`,
                            'Content-Type': 'application/json',
                            'Prefer': 'return=minimal'
                        },
                        body: JSON.stringify({
                            estado: 'Listo para Entregar',
                            updated_at: new Date().toISOString()
                        })
                    });
                    console.log(`[MOVIL-INCIDENCIA] ☁️ [Supabase] Pedido B2B ${uuid} actualizado a 'Listo para Entregar'.`);
                } catch (supabaseErr) {
                    console.error('[MOVIL-INCIDENCIA] ⚠️ No se pudo actualizar Supabase, se resolverá en el sync daemon:', supabaseErr.message);
                }
            }
        }

        res.json({ success: true, message: 'Incidencia registrada con éxito. Pedido retornado a pendientes.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [MOVIL] Error al registrar incidencia:', error);
        res.status(500).json({ success: false, error: 'Error al registrar incidencia', message: error.message });
    } finally {
        client.release();
    }
});


async function enviarNotificacionEmail(toEmail, clientName, pedidoId, items, base64Remito, base64Bulto, emailService) {
    const datosDetalle = [
        { label: 'Pedido Nro', value: `#${pedidoId}` },
        { label: 'Estado de Entrega', value: 'Entregado por chofer' },
        { label: 'Detalle de Productos', value: items.map(item => `• ${parseFloat(item.cantidad)} u. - ${item.descripcion}`).join('<br>') }
    ];

    const htmlBody = emailService.obtenerPlantillaHtml({
        titulo: 'Confirmación de Entrega - LAMDA',
        clienteNombre: clientName,
        mensajePrincipal: `Su pedido #${pedidoId} ha sido entregado exitosamente por nuestro chofer.`,
        datosDetalle,
        piePagina: 'Este es un mensaje automático enviado por el departamento de logística de LAMDA.',
        mostrarTransferencia: false
    });

    const attachments = [];
    if (base64Remito) {
        attachments.push({
            filename: `remito_${pedidoId}.jpg`,
            content: Buffer.from(base64Remito.replace(/^data:image\/\w+;base64,/, ""), 'base64'),
            contentType: 'image/jpeg'
        });
    }
    if (base64Bulto) {
        attachments.push({
            filename: `foto_bulto_${pedidoId}.jpg`,
            content: Buffer.from(base64Bulto.replace(/^data:image\/\w+;base64,/, ""), 'base64'),
            contentType: 'image/jpeg'
        });
    }

    await emailService.enviarEmail({
        to: toEmail,
        subject: `Confirmación de Entrega - Pedido #${pedidoId}`,
        htmlBody,
        attachments
    });
    console.log(`[NOTI-BG] ✅ Notificación enviada por Email a: ${toEmail}`);
}

/**
 * @route POST /api/logistica/movil/entregas/confirmar
 * @desc Confirmar entrega de un pedido (rápida o detallada)
 * @access Privado (requiere token)
 */
router.post('/entregas/confirmar', async (req, res) => {
    console.log('🔍 [MOVIL] Ruta POST /entregas/confirmar - Confirmando entrega');

    try {
        const {
            id_presupuesto,
            tipo_confirmacion, // 'rapida' o 'detallada'
            receptor_nombre,
            receptor_dni,
            foto_remito_url,
            foto_bulto_url,
            firma_digital,
            latitud,
            longitud,
            articulos_checklist, // Array de { codigo_barras, confirmado: boolean }
            nuevo_estado
        } = req.body;

        console.log('[MOVIL] Confirmando entrega:', {
            id_presupuesto,
            tipo_confirmacion,
            receptor_nombre,
            nuevo_estado
        });

        const client = await req.db.connect();

        try {
            await client.query('BEGIN');

            // Determinar estado final (Default: ENTREGADO)
            const estadoFinal = nuevo_estado || 'ENTREGADO';
            const esRechazo = estadoFinal === 'RECHAZADO';
            const secuenciaFinal = esRechazo ? 'Rechazado' : (estadoFinal === 'RETIRADO' ? 'Retirado' : 'Entregado');
            const estadoComercial = esRechazo ? 'Presupuesto/Orden' : (estadoFinal === 'RETIRADO' ? 'Retirado' : 'Entregado');

            // 1. Actualizar presupuesto
            // IMPORTANTE: Si es RECHAZADO no marcar como Entregado ni sumar a stock_mantenimiento (volverá a Pedido_Listo al cerrar ruta)
            await client.query(
                `UPDATE presupuestos 
                 SET secuencia = $2,
                     estado = $3,
                     estado_logistico = $4,
                     fecha_entrega_real = CASE WHEN $5 = true THEN fecha_entrega_real ELSE NOW() END,
                     fecha_actualizacion = NOW()
                 WHERE id = $1`,
                [id_presupuesto, secuenciaFinal, estadoComercial, estadoFinal, esRechazo]
            );

            console.log(`[MOVIL] ✅ Presupuesto actualizado a ${estadoFinal}`);
            console.log(`[MOVIL] ✅ Estado comercial: ${estadoComercial}`);
            console.log('[MOVIL] ✅ Fecha actualización sincronizada para Google Sheets');

            // 2. Insertar evento de entrega (si es confirmación detallada)
            if (tipo_confirmacion === 'detallada') {
                await client.query(
                    `INSERT INTO entregas_eventos 
                     (id_presupuesto, receptor_nombre, receptor_vinculo, dni_receptor,
                      foto_conformidad_url, latitud_confirmacion, longitud_confirmacion,
                      firma_digital, fecha_entrega, observaciones)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)`,
                    [
                        id_presupuesto,
                        receptor_nombre || null,
                        'Cliente', // Por defecto
                        receptor_dni || null,
                        foto_remito_url || null,
                        latitud || null,
                        longitud || null,
                        firma_digital || null,
                        foto_bulto_url ? `Foto bulto: ${foto_bulto_url}` : null
                    ]
                );

                console.log('[MOVIL] ✅ Evento de entrega registrado');
            }

            await client.query('COMMIT');

            if (!esRechazo) {
                try {
                    const { sincronizarCambioSecuenciaDesdeLamda } = require('../../produccion/services/nodosBarrialesService');
                    sincronizarCambioSecuenciaDesdeLamda([String(id_presupuesto)], 'Entregado').catch(errN => {
                        console.warn('⚠️ [MOVIL] Advertencia sincronizando despacho de Nodo Barrial:', errN.message);
                    });
                } catch (_) {}
            }

            console.log('[MOVIL] ✅ Entrega confirmada exitosamente');

            res.json({
                success: true,
                message: 'Entrega confirmada correctamente'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('❌ [MOVIL] Error al confirmar entrega:', error);
        res.status(500).json({
            success: false,
            error: 'Error al confirmar entrega',
            message: error.message
        });
    }
});

/**
 * =========================================================
 * ENDPOINTS FASE 3: RETIROS DE MANTENIMIENTO
 * =========================================================
 */

/**
 * @route POST /api/logistica/movil/retiros/:id/validar
 * @desc El Chofer confirma la lectura e integración del retiro a su camioneta
 */
router.post('/retiros/:id/validar', async (req, res) => {
    try {
        const { id } = req.params;
        const client = await req.db.connect();
        try {
            await client.query('BEGIN');
            
            // Verificamos que esté en PENDIENTE_VALIDACION (PWA ya hecha)
            const getOrden = await client.query(`SELECT id, estado_logistico FROM ordenes_tratamiento WHERE id = $1 FOR UPDATE`, [id]);
            if (getOrden.rowCount === 0) throw new Error('Orden no encontrada');
            
            let choferNombre = req.body?.chofer_nombre || null;
            if (!choferNombre) {
                try {
                    const choferId = extraerChoferIdDeRequest(req);
                    if (choferId) {
                        const uRes = await client.query('SELECT nombre_completo FROM usuarios WHERE id = $1', [choferId]);
                        if (uRes.rows.length > 0) choferNombre = uRes.rows[0].nombre_completo;
                    }
                } catch(e) {}
            }

            await client.query(`
                UPDATE ordenes_tratamiento 
                SET estado_logistico = 'EN_CAMINO', 
                    fecha_validacion_chofer = NOW(),
                    chofer_nombre = COALESCE($2, chofer_nombre)
                WHERE id = $1
            `, [id, choferNombre]);
            
            await client.query('COMMIT');
            res.json({ success: true, message: 'Validación exitosa (EN_CAMINO)' });
        } catch(err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('❌ [MOVIL] Error Validar Retiro:', error);
        res.status(500).json({ success: false, error: 'Error al validar retiro' });
    }
});

/**
 * @route POST /api/logistica/movil/retiros/:id/contingencia
 * @desc El Chofer carga a mano los datos saltándose el pre-checkin del cliente
 */
router.post('/retiros/:id/contingencia', async (req, res) => {
    try {
        const { id } = req.params;
        const { descripcion_externa, kilos, bultos, motivo } = req.body;
        if (!kilos || !bultos) return res.status(400).json({ success: false, error: 'Kilos y Bultos son obligatorios' });

        const client = await req.db.connect();
        try {
            await client.query('BEGIN');
            // Agregamos detalle (Contingencia)
            await client.query(`
                INSERT INTO ordenes_tratamiento_detalles (
                    id_orden_tratamiento, descripcion_externa, kilos, bultos, motivo
                ) VALUES ($1, $2, $3, $4, $5)
            `, [id, descripcion_externa, kilos, bultos, motivo || 'Retiro Mantenimiento (Carga Manual)'] );

            // Validamos salto
            await client.query(`
                UPDATE ordenes_tratamiento 
                SET estado_logistico = 'EN_CAMINO', fecha_validacion_chofer = NOW()
                WHERE id = $1
            `, [id]);
            
            await client.query('COMMIT');
            res.json({ success: true, message: 'Carga manual de contingencia exitosa' });
        } catch(err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('❌ [MOVIL] Error Contingencia Retiro:', error);
        res.status(500).json({ success: false, error: 'Error Contingencia' });
    }
});

/**
 * @route POST /api/logistica/movil/retiros/:id/entregar
 * @desc El Chofer confirma la entrega al cliente del tratamiento completado, cerrando el ciclo.
 */
router.post('/retiros/:id/entregar', async (req, res) => {
    try {
        const { id } = req.params;
        const { firma_digital, receptor_nombre } = req.body;
        
        const client = await req.db.connect();
        try {
            await client.query('BEGIN');
            
            const getOrden = await client.query(`SELECT id, estado_logistico, estado_tratamiento FROM ordenes_tratamiento WHERE id = $1 FOR UPDATE`, [id]);
            if (getOrden.rowCount === 0) throw new Error('Orden no encontrada');
            
            if (getOrden.rows[0].estado_tratamiento !== 'COMPLETADO') {
                throw new Error('La orden de tratamiento aún no ha sido completada en planta.');
            }

            // Cambiamos a ENTREGADO
            await client.query(`
                UPDATE ordenes_tratamiento 
                SET estado_logistico = 'ENTREGADO', 
                    responsable_nombre = COALESCE($2, responsable_nombre)
                WHERE id = $1
            `, [id, receptor_nombre]);

            if (firma_digital) {
                // Registrar evento de entrega para historial/pdf
                await client.query(
                    `INSERT INTO entregas_eventos 
                     (id_orden_tratamiento, receptor_nombre, firma_digital, fecha_entrega, observaciones)
                     VALUES ($1, $2, $3, NOW(), 'Entrega Tratamiento Terminada')`,
                    [id, receptor_nombre, firma_digital]
                );
            }
            
            await client.query('COMMIT');
            res.json({ success: true, message: 'Entrega de tratamiento registrada exitosamente.' });
        } catch(err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('❌ [MOVIL] Error en entregar tratamiento:', error);
        res.status(500).json({ success: false, error: 'Error al registrar entrega.' });
    }
});


/**
 * @route POST /api/logistica/movil/rutas/finalizar
 * @desc Finalizar ruta del día
 * @access Privado (requiere token)
 */
router.post('/rutas/finalizar', async (req, res) => {
    console.log('🔍 [MOVIL] Ruta POST /rutas/finalizar - Finalizando ruta');

    try {
        const choferId = extraerChoferIdDeRequest(req);
        if (!choferId) {
            return res.status(401).json({
                success: false,
                error: req.headers.authorization ? 'Token inválido' : 'Token no proporcionado'
            });
        }

        const rutaIdSolicitada = parseInt(req.body?.id_ruta || req.body?.ruta_id, 10) || null;
        console.log('[MOVIL] Finalizando ruta del chofer ID:', choferId, 'Ruta ID solicitada:', rutaIdSolicitada);

        // Buscar ruta activa (soporta estado EN_CAMINO o ARMANDO si se completaron todas las paradas sin pulsar Iniciar Ruta)
        let rutaResult;
        if (rutaIdSolicitada) {
            rutaResult = await req.db.query(`
                SELECT id, nombre_ruta, estado
                FROM rutas
                WHERE id = $1
                  AND estado IN ('EN_CAMINO', 'ARMANDO')
                LIMIT 1
            `, [rutaIdSolicitada]);
        }

        if (!rutaResult || rutaResult.rows.length === 0) {
            const rutaQuery = `
                SELECT id, nombre_ruta, estado
                FROM rutas
                WHERE id_chofer = $1 
                  AND estado IN ('EN_CAMINO', 'ARMANDO')
                ORDER BY CASE WHEN estado = 'EN_CAMINO' THEN 0 ELSE 1 END, id DESC
                LIMIT 1
            `;
            rutaResult = await req.db.query(rutaQuery, [choferId]);
        }

        if (rutaResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No hay ruta activa para finalizar'
            });
        }

        const ruta = rutaResult.rows[0];

        const client = await req.db.connect();

        try {
            await client.query('BEGIN');

            // 1. Verificar pedidos pendientes
            const pendientesQuery = `
                SELECT COUNT(*) as pendientes
                FROM presupuestos
                WHERE id_ruta = $1
                  AND estado_logistico != 'ENTREGADO'
                  AND estado_logistico != 'RETIRADO'
            `;

            const pendientesResult = await client.query(pendientesQuery, [ruta.id]);
            const pendientes = parseInt(pendientesResult.rows[0].pendientes);

            // 2. PROCESAR ÓRDENES DE TRATAMIENTO (Integración Fase 3 y 4)
            // Desvincular órdenes que quedaron en PENDIENTE_CLIENTE o PENDIENTE_VALIDACION (nunca retiradas en la calle) para que vuelvan al Pool
            await client.query(`
                UPDATE ordenes_tratamiento
                SET id_ruta = NULL,
                    orden_entrega = 999
                WHERE id_ruta = $1 AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION')
            `, [ruta.id]);

            // Marcar únicamente las ordenes_tratamiento efectivamente retiradas en la ruta como "INGRESADO_LOCAL"
            const updatedTR = await client.query(`
                UPDATE ordenes_tratamiento
                SET estado_logistico = 'INGRESADO_LOCAL',
                    fecha_ingreso_mantenimiento = NOW()
                WHERE id_ruta = $1 AND estado_logistico IN ('EN_CAMINO', 'RETIRADO')
                RETURNING id, chofer_nombre
            `, [ruta.id]);

            // 2b. Inyección Atómica en Mantenimiento (Cuarentena)
            if (updatedTR.rows.length > 0) {
                const ids = updatedTR.rows.map(r => r.id);
                await client.query(`
                    INSERT INTO mantenimiento_movimientos (
                        id_orden_tratamiento,
                        cantidad,
                        usuario,
                        tipo_movimiento,
                        observaciones,
                        fecha_movimiento,
                        estado
                    )
                    SELECT 
                        ot.id,
                        COALESCE((SELECT SUM(bultos) FROM ordenes_tratamiento_detalles WHERE id_orden_tratamiento = ot.id), 0),
                        COALESCE(ot.chofer_nombre, (SELECT u.nombre_completo FROM rutas r JOIN usuarios u ON r.id_chofer = u.id WHERE r.id = ot.id_ruta), 'Chofer Móvil'),
                        'RETIRO_TRATAMIENTO',
                        COALESCE((SELECT json_agg(json_build_object('desc', descripcion_externa, 'kilos', kilos, 'bultos', bultos, 'motivo', motivo))::text 
                         FROM ordenes_tratamiento_detalles WHERE id_orden_tratamiento = ot.id), '[]'),
                        NOW(),
                        'PENDIENTE'
                    FROM ordenes_tratamiento ot
                    WHERE ot.id = ANY($1::int[])
                `, [ids]);
            }

            // [TICKET #024] 2c. Procesar Órdenes de Retiro Comerciales (Presupuestos)
            // Cuando una devolución comercial llega en el camión, debe inyectarse en cuarentena (Mantenimiento).
            const updatedRetiros = await client.query(`
                UPDATE presupuestos
                SET estado_logistico = 'INGRESADO_LOCAL'
                WHERE id_ruta = $1 AND (tipo_comprobante = 'Orden de Retiro' OR estado = 'Orden de Retiro' OR estado = 'Administrativa NC')
                AND estado_logistico = 'RETIRADO'
                RETURNING id, id_cliente
            `, [ruta.id]);

            if (updatedRetiros.rows.length > 0) {
                const presupuestosIds = updatedRetiros.rows.map(r => r.id);
                // Extraer detalles e inyectarlos con resolución dual (articulos + bunker_articulos) y suma en stock_mantenimiento
                const retirosDetalles = await client.query(`
                    SELECT 
                        pd.id_presupuesto, 
                        pd.cantidad, 
                        COALESCE(a.numero::text, ba.articulo_id::text, pd.articulo) as articulo_numero,
                        COALESCE(a.codigo_barras, ba.codigo_barras::text, pd.articulo) as codigo_barras,
                        COALESCE(NULLIF(TRIM(ba.descripcion_generada), ''), NULLIF(TRIM(ba.descripcion), ''), NULLIF(TRIM(a.nombre), ''), pd.articulo) as articulo_nombre
                    FROM presupuestos_detalles pd
                    LEFT JOIN LATERAL (
                        SELECT a_inner.numero, a_inner.codigo_barras, a_inner.nombre
                        FROM public.articulos a_inner
                        WHERE a_inner.codigo_barras = pd.articulo OR a_inner.numero = pd.articulo
                        ORDER BY (a_inner.codigo_barras = pd.articulo) DESC
                        LIMIT 1
                    ) a ON true
                    LEFT JOIN LATERAL (
                        SELECT ba_inner.articulo_id, ba_inner.codigo_barras, ba_inner.descripcion_generada, ba_inner.descripcion
                        FROM public.bunker_articulos ba_inner
                        WHERE ba_inner.articulo_id::text = pd.articulo
                           OR ba_inner.codigo_barras::text = pd.articulo
                           OR (a.numero IS NOT NULL AND ba_inner.articulo_id::text = a.numero)
                        ORDER BY (ba_inner.articulo_id::text = pd.articulo) DESC
                        LIMIT 1
                    ) ba ON true
                    WHERE pd.id_presupuesto = ANY($1::int[]) AND pd.articulo IS NOT NULL
                `, [presupuestosIds]);

                for (const det of retirosDetalles.rows) {
                    await client.query(`
                        INSERT INTO mantenimiento_movimientos
                        (articulo_numero, cantidad, id_presupuesto_origen, usuario, tipo_movimiento, estado, observaciones)
                        VALUES ($1, $2, $3, $4, 'INGRESO', 'PENDIENTE', $5)
                    `, [
                        det.articulo_numero,
                        det.cantidad,
                        det.id_presupuesto,
                        'Logística Movil (Chofer)',
                        'Ingreso por Hoja de Ruta - Chofer'
                    ]);

                    if (det.articulo_numero) {
                        const stockCheck = await client.query(
                            'SELECT articulo_numero FROM public.stock_real_consolidado WHERE articulo_numero = $1 OR ($2::text != \'\' AND codigo_barras = $2) LIMIT 1',
                            [det.articulo_numero, det.codigo_barras || '']
                        );
                        if (stockCheck.rowCount > 0) {
                            const targetArtNumero = stockCheck.rows[0].articulo_numero;
                            await client.query(`
                                UPDATE public.stock_real_consolidado
                                SET stock_mantenimiento = COALESCE(stock_mantenimiento, 0) + $1, ultima_actualizacion = NOW()
                                WHERE articulo_numero = $2
                            `, [parseFloat(det.cantidad) || 0, targetArtNumero]);
                        } else {
                            await client.query(`
                                INSERT INTO public.stock_real_consolidado
                                (articulo_numero, descripcion, codigo_barras, stock_consolidado, stock_mantenimiento, ultima_actualizacion, no_producido_por_lambda, solo_produccion_externa)
                                VALUES ($1, $2, $3, 0, $4, NOW(), false, false)
                            `, [det.articulo_numero, det.articulo_nombre, det.codigo_barras, parseFloat(det.cantidad) || 0]);
                        }
                    }
                }
            }

            // [TICKET #025] 2d. Procesar Mercadería No Entregada / Entregas Parciales (Artículos con cantidad_original > cantidad)
            const partialItemsQuery = `
                SELECT 
                    pd.id_presupuesto,
                    pd.articulo,
                    COALESCE(a.numero::text, ba.articulo_id::text, pd.articulo) as articulo_numero,
                    COALESCE(a.codigo_barras, ba.codigo_barras::text, pd.articulo) as codigo_barras,
                    COALESCE(NULLIF(TRIM(ba.descripcion_generada), ''), NULLIF(TRIM(ba.descripcion), ''), NULLIF(TRIM(a.nombre), ''), pd.articulo) as articulo_nombre,
                    (pd.cantidad_original - pd.cantidad) as cantidad_no_entregada,
                    p.id_cliente
                FROM presupuestos_detalles pd
                JOIN presupuestos p ON p.id = pd.id_presupuesto
                LEFT JOIN LATERAL (
                    SELECT a_inner.numero, a_inner.codigo_barras, a_inner.nombre
                    FROM public.articulos a_inner
                    WHERE a_inner.codigo_barras = pd.articulo OR a_inner.numero = pd.articulo
                    ORDER BY (a_inner.codigo_barras = pd.articulo) DESC
                    LIMIT 1
                ) a ON true
                LEFT JOIN LATERAL (
                    SELECT ba_inner.articulo_id, ba_inner.codigo_barras, ba_inner.descripcion_generada, ba_inner.descripcion
                    FROM public.bunker_articulos ba_inner
                    WHERE ba_inner.articulo_id::text = pd.articulo
                       OR ba_inner.codigo_barras::text = pd.articulo
                       OR (a.numero IS NOT NULL AND ba_inner.articulo_id::text = a.numero)
                    ORDER BY (ba_inner.articulo_id::text = pd.articulo) DESC
                    LIMIT 1
                ) ba ON true
                WHERE p.id_ruta = $1
                  AND p.activo = true
                  AND p.estado_logistico = 'ENTREGADO'
                  AND pd.cantidad_original IS NOT NULL
                  AND pd.cantidad_original > pd.cantidad
            `;
            const resPartialItems = await client.query(partialItemsQuery, [ruta.id]);
            if (resPartialItems.rows.length > 0) {
                console.log(`[MOVIL] 📦 Procesando ${resPartialItems.rows.length} artículos no entregados por entregas parciales...`);
                for (const item of resPartialItems.rows) {
                    const checkDup = await client.query(`
                        SELECT id FROM mantenimiento_movimientos
                        WHERE id_presupuesto_origen = $1 AND articulo_numero = $2 AND estado = 'PENDIENTE'
                    `, [item.id_presupuesto, item.articulo_numero]);

                    if (checkDup.rowCount === 0) {
                        const cantNoEntregada = parseFloat(item.cantidad_no_entregada) || 0;
                        await client.query(`
                            INSERT INTO mantenimiento_movimientos
                            (articulo_numero, cantidad, id_presupuesto_origen, usuario, tipo_movimiento, estado, observaciones)
                            VALUES ($1, $2, $3, $4, 'INGRESO', 'PENDIENTE', $5)
                        `, [
                            item.articulo_numero,
                            cantNoEntregada,
                            item.id_presupuesto,
                            'Logística Móvil (Chofer)',
                            `Retorno automático por entrega parcial / rechazo: ${cantNoEntregada} u. de ${item.articulo_nombre} (Cliente ${item.id_cliente})`
                        ]);
                        if (item.articulo_numero && cantNoEntregada > 0) {
                            await client.query(`
                                UPDATE public.stock_real_consolidado
                                SET stock_mantenimiento = COALESCE(stock_mantenimiento, 0) + $1, ultima_actualizacion = NOW()
                                WHERE articulo_numero = $2 OR ($3::text != '' AND codigo_barras = $3)
                            `, [cantNoEntregada, item.articulo_numero, item.codigo_barras || '']);
                        }
                        console.log(`[MOVIL] ✅ Inyectado a Mantenimiento y sumado stock_mantenimiento: ${cantNoEntregada} u. de ${item.articulo_nombre} (Presupuesto #${item.id_presupuesto})`);
                    }
                }
            }

            // [MICRO-ETAPA 5 - FLUJO 5] 2d-bis. Pedidos con Rechazo Total ('RECHAZADO') o no entregados que retornan a Pedido_Listo para re-entrega:
            // Revertir cualquier ingreso provisorio PENDIENTE en mantenimiento_movimientos / stock_mantenimiento para evitar stock fantasma o duplicado.
            const rechazadosRes = await client.query(`
                SELECT id
                FROM public.presupuestos
                WHERE id_ruta = $1
                  AND activo = true
                  AND COALESCE(tipo_comprobante, '') != 'Orden de Retiro'
                  AND COALESCE(estado, '') NOT IN ('Orden de Retiro', 'Administrativa NC', 'Anulado', 'Anulado por el Cliente', 'ANULADO')
                  AND COALESCE(estado_logistico, '') NOT IN ('ENTREGADO', 'RETIRADO', 'INGRESADO_LOCAL')
            `, [ruta.id]);

            if (rechazadosRes.rows.length > 0) {
                const rechazadosIds = rechazadosRes.rows.map(r => r.id);
                const movsRevertir = await client.query(`
                    DELETE FROM public.mantenimiento_movimientos
                    WHERE id_presupuesto_origen = ANY($1::int[])
                      AND estado = 'PENDIENTE'
                      AND tipo_movimiento = 'INGRESO'
                    RETURNING id_presupuesto_origen, articulo_numero, cantidad
                `, [rechazadosIds]);

                for (const mov of movsRevertir.rows) {
                    const cantRev = parseFloat(mov.cantidad) || 0;
                    if (mov.articulo_numero && cantRev > 0) {
                        await client.query(`
                            UPDATE public.stock_real_consolidado
                            SET stock_mantenimiento = GREATEST(0, COALESCE(stock_mantenimiento, 0) - $1),
                                ultima_actualizacion = NOW()
                            WHERE articulo_numero = $2 OR codigo_barras = $2
                        `, [cantRev, mov.articulo_numero]);
                    }
                }

                await client.query(`
                    UPDATE public.presupuestos_detalles
                    SET cantidad = COALESCE(cantidad_original, cantidad),
                        cantidad_original = NULL
                    WHERE id_presupuesto = ANY($1::int[])
                      AND cantidad_original IS NOT NULL
                `, [rechazadosIds]);

                await client.query(`
                    UPDATE public.presupuestos
                    SET estado = 'Presupuesto/Orden',
                        secuencia = 'Pedido_Listo',
                        estado_logistico = 'PENDIENTE',
                        id_ruta = NULL,
                        orden_entrega = NULL,
                        fecha_asignacion_ruta = NULL,
                        fecha_actualizacion = NOW()
                    WHERE id = ANY($1::int[])
                `, [rechazadosIds]);
                console.log(`[MOVIL] ♻️ ${rechazadosIds.length} pedido(s) rechazado(s)/no entregado(s) retornados a Pedido_Listo sin stock fantasma en Mantenimiento.`);
            }

            // 2e. Visitas de Contacto / Cliente Activo en la ruta:
            // Si es visita a un Cliente Activo (sin pedido) aún en PENDIENTE al liquidar la ruta, se asienta automáticamente como VISITADO.
            // Todas las paradas de contacto de la ruta salen del Pool (en_pool_logistica = false).
            await client.query(`
                UPDATE public.bunker_prospectos
                SET estado_ruta = CASE 
                        WHEN origen_contacto = 'CLIENTE_ACTIVO' AND COALESCE(estado_ruta, 'PENDIENTE') = 'PENDIENTE' THEN 'VISITADO'
                        ELSE estado_ruta
                    END,
                    fecha_visita_ruta = CASE 
                        WHEN origen_contacto = 'CLIENTE_ACTIVO' AND COALESCE(estado_ruta, 'PENDIENTE') = 'PENDIENTE' THEN NOW()
                        ELSE fecha_visita_ruta
                    END,
                    id_ruta = CASE 
                        WHEN origen_contacto != 'CLIENTE_ACTIVO' AND COALESCE(estado_ruta, 'PENDIENTE') = 'PENDIENTE' THEN NULL
                        ELSE id_ruta
                    END,
                    en_pool_logistica = false,
                    orden_entrega = CASE 
                        WHEN origen_contacto != 'CLIENTE_ACTIVO' AND COALESCE(estado_ruta, 'PENDIENTE') = 'PENDIENTE' THEN 999
                        ELSE orden_entrega
                    END,
                    updated_at = NOW()
                WHERE id_ruta = $1
            `, [ruta.id]);

            // 2f. Sobres de Efectivo no retirados (aún en PREPARADO): desvincular de la ruta para que vuelvan al Pool
            await client.query(`
                UPDATE public.factura_pagos_efectivo
                SET id_ruta = NULL,
                    orden_entrega = 999,
                    fecha_actualizacion = NOW()
                WHERE id_ruta = $1 AND estado = 'PREPARADO'
            `, [ruta.id]);

            // 2g. Sobres de Efectivo efectivamente retirados en la ruta (EN_TRANSITO): pasan a RECIBIDO_LOCAL al asentar la hoja de ruta
            const sobresRecibidosRes = await client.query(`
                UPDATE public.factura_pagos_efectivo
                SET estado = 'RECIBIDO_LOCAL',
                    sincronizado_supabase = false,
                    fecha_actualizacion = NOW()
                WHERE id_ruta = $1 AND estado = 'EN_TRANSITO'
                RETURNING id, codigo_sobre, cliente_id, monto_declarado
            `, [ruta.id]);

            // 3. Actualizar estado de ruta y calcular duración neta
            await client.query(
                `UPDATE rutas 
                 SET estado = 'FINALIZADA',
                     fecha_salida = COALESCE(fecha_salida, fecha_creacion, NOW()),
                     fecha_finalizacion = NOW(),
                     duracion_neta_minutos = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(fecha_salida, fecha_creacion, NOW())))/60) - COALESCE(tiempo_pausado_minutos, 0))
                 WHERE id = $1`,
                [ruta.id]
            );

            await client.query('COMMIT');

            // Sincronizar en segundo plano a Supabase los sobres que ingresaron al local
            if (sobresRecibidosRes.rows.length > 0) {
                for (const s of sobresRecibidosRes.rows) {
                    PagosEfectivoService.actualizarEstado({
                        sobreId: s.id,
                        nuevoEstado: 'RECIBIDO_LOCAL',
                        operador: 'Cierre Hoja de Ruta'
                    }).catch(err => console.warn('[MOVIL] ⚠️ Error sincronizando sobre RECIBIDO_LOCAL en Supabase:', err.message));
                }
            }

            console.log('[MOVIL] ✅ Ruta finalizada y retiros procesados exitosamente:', ruta.nombre_ruta);

            res.json({
                success: true,
                message: 'Ruta finalizada correctamente',
                data: {
                    ruta_id: ruta.id,
                    nombre_ruta: ruta.nombre_ruta,
                    pedidos_pendientes: pendientes,
                    sobres_recibidos_local: sobresRecibidosRes.rows
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('❌ [MOVIL] Error al finalizar ruta:', error);
        res.status(500).json({
            success: false,
            error: 'Error al finalizar ruta',
            message: error.message
        });
    }
});

console.log('✅ [MOVIL] Rutas configuradas exitosamente');

/**
 * @route DELETE /api/logistica/movil/retiros/:id
 * @desc Eliminar una orden de tratamiento atómicamente
 * @access Privado (requiere token)
 */
router.delete('/retiros/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const client = await req.db.connect();
        try {
            await client.query('BEGIN');
            
            const verify = await client.query('SELECT estado_logistico FROM ordenes_tratamiento WHERE id = $1', [id]);
            if (verify.rowCount === 0) throw new Error('Orden no encontrada');
            if (verify.rows[0].estado_logistico !== 'PENDIENTE_CLIENTE' && verify.rows[0].estado_logistico !== 'PENDIENTE_VALIDACION') {
                throw new Error('Solo se pueden descartar órdenes pendientes.');
            }
            
            // Evaluamos si usamos Soft Delete basado en la integridad histórica (Hijos en Mantenimiento)
            const historialCheck = await client.query('SELECT 1 FROM mantenimiento_movimientos WHERE id_orden_tratamiento = $1 LIMIT 1', [id]);
            
            if (historialCheck.rowCount > 0) {
                // Existe historial. Usar Soft Delete (ANULADO) para no quebrar la llave foránea
                console.log(`[MOVIL] ⚠️ Orden #${id} tiene historial en mantenimiento. Aplicando Soft Delete (ANULADO).`);
                await client.query(`
                    UPDATE ordenes_tratamiento 
                    SET estado_logistico = 'ANULADO', 
                        estado_tratamiento = 'ANULADO',
                        id_ruta = NULL
                    WHERE id = $1
                `, [id]);
                await client.query(`
                    UPDATE mantenimiento_movimientos
                    SET estado = 'ANULADO'
                    WHERE id_orden_tratamiento = $1
                `, [id]);
            } else {
                // No hay hijos. Borrado físico limpio.
                await client.query('DELETE FROM ordenes_tratamiento WHERE id = $1', [id]);
                console.log(`[MOVIL] 🗑️ Orden de Tratamiento #${id} eliminada físicamente.`);
            }
            
            await client.query('COMMIT');
            res.json({ success: true, message: 'Orden descartada exitosamente.' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('❌ [MOVIL] Error al descartar retiro:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route POST /api/logistica/movil/sobres-efectivo/:id/retirar
 * @desc El Chofer confirma que retiró físicamente el sobre de efectivo en la dirección del cliente
 * @access Privado
 */
router.post('/sobres-efectivo/:id/retirar', async (req, res) => {
    try {
        const { id } = req.params;
        const { chofer_nombre, notificar } = req.body || {};

        let choferResuelto = chofer_nombre || null;
        if (!choferResuelto) {
            try {
                const choferId = extraerChoferIdDeRequest(req);
                if (choferId) {
                    const uRes = await req.db.query('SELECT nombre_completo FROM usuarios WHERE id = $1', [choferId]);
                    if (uRes.rows.length > 0) choferResuelto = uRes.rows[0].nombre_completo;
                }
            } catch (e) {}
        }

        const sobreActualizado = await PagosEfectivoService.actualizarEstado({
            sobreId: id,
            nuevoEstado: 'EN_TRANSITO',
            choferNombre: choferResuelto || 'Chofer LAMDA'
        });

        console.log(`[MOVIL] 🚚 Chofer ${choferResuelto || 'LAMDA'} confirmó retiro del sobre ${sobreActualizado.codigo_sobre}`);

        let resultadoWa = { enviado: false, destinatarios: [], errores: [] };
        if (notificar !== false) {
            resultadoWa = await enviarAvisoWhatsAppSobreRetirado(req.db, sobreActualizado);
        }

        res.json({
            success: true,
            mensaje: `Sobre ${sobreActualizado.codigo_sobre} retirado y en camino al depósito.`,
            sobre: sobreActualizado,
            whatsapp_enviado: resultadoWa.enviado,
            destinatarios: resultadoWa.destinatarios,
            whatsapp_errores: resultadoWa.errores
        });
    } catch (error) {
        console.error('❌ [MOVIL] Error al confirmar retiro de sobre:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route POST /api/logistica/movil/sobres-efectivo/:id/notificar-retiro
 * @desc Envía el mensaje corto de WhatsApp confirmando al cliente que su sobre fue retirado (#SOB-XXXX)
 * @access Privado
 */
router.post('/sobres-efectivo/:id/notificar-retiro', async (req, res) => {
    try {
        const { id } = req.params;
        const isId = !isNaN(parseInt(id)) && !String(id).startsWith('SOB-');
        const resSobre = await req.db.query(
            `SELECT * FROM public.factura_pagos_efectivo WHERE ${isId ? 'id = $1' : 'codigo_sobre = $1'} LIMIT 1`,
            [id]
        );
        if (resSobre.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Sobre no encontrado.' });
        }

        const sobre = resSobre.rows[0];
        const resultadoWa = await enviarAvisoWhatsAppSobreRetirado(req.db, sobre);

        if (!resultadoWa.enviado) {
            return res.status(400).json({
                success: false,
                error: resultadoWa.errores.join(' | ') || 'No se pudo enviar el aviso por WhatsApp.',
                codigo_sobre: sobre.codigo_sobre
            });
        }

        res.json({
            success: true,
            whatsapp_enviado: true,
            codigo_sobre: sobre.codigo_sobre,
            destinatarios: resultadoWa.destinatarios,
            mensaje: `Aviso de sobre retirado (#${sobre.codigo_sobre}) enviado por WhatsApp.`
        });
    } catch (error) {
        console.error('❌ [MOVIL] Error al notificar retiro de sobre:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route GET /api/logistica/movil/rutas-historial
 * @desc Obtener historial de rutas finalizadas del chofer
 * @access Privado (requiere token)
 */
router.get('/rutas-historial', async (req, res) => {
    console.log('🔍 [MOVIL] Ruta GET /rutas-historial - Obteniendo historial');

    try {
        const choferId = extraerChoferIdDeRequest(req);
        if (!choferId) {
            return res.status(401).json({ success: false, error: req.headers.authorization ? 'Token inválido' : 'Token no proporcionado' });
        }

        const query = `
            SELECT id, nombre_ruta, fecha_salida, fecha_finalizacion, duracion_neta_minutos 
            FROM rutas
            WHERE id_chofer = $1 AND estado = 'FINALIZADA'
            ORDER BY fecha_finalizacion DESC NULLS LAST, id DESC
            LIMIT 30
        `;
        const result = await req.db.query(query, [choferId]);
        
        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error('❌ [MOVIL] Error al obtener historial:', error);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

/**
 * @route GET /api/logistica/movil/pedidos-pendientes
 * @desc Obtener pedidos huérfanos pendientes de asignar ruta (Delegado a Modelo Escritorio)
 * @access Privado (requiere token)
 */
router.get('/pedidos-pendientes', async (req, res) => {
    console.log('🔍 [MOVIL] Ruta GET /pedidos-pendientes - Listando pendientes (Vía Modelo Central)');

    try {
        if (!extraerChoferIdDeRequest(req) && (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer '))) {
            return res.status(401).json({ success: false, error: 'Token no proporcionado' });
        }

        // Recuperamos la información exacta que usaría la versión Desktop
        const presupuestos = await obtenerPresupuestosDisponibles(req.db);
        
        res.json({
            success: true,
            data: presupuestos
        });
    } catch (error) {
        console.error('❌ [MOVIL] Error al obtener pendientes (Modelo):', error);
        res.status(500).json({ success: false, error: 'Error interno en BD' });
    }
});

// ==========================================
// PROXYS DE GESTION (CRUD DE RUTAS)
// Reutilizan controladores de Backoffice
// ==========================================

const validarTokenMovil = (req, res, next) => {
    if (!extraerChoferIdDeRequest(req) && (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer '))) {
        return res.status(401).json({ success: false, error: 'Token denegado' });
    }
    next();
};

/**
 * @route POST /api/logistica/movil/rutas
 * @desc Crear una nueva ruta desde el celular (Proxy)
 */
router.post('/rutas', validarTokenMovil, async (req, res) => {
    console.log('🔍 [MOVIL-CRUD] Delegando creación de ruta al controlador central...');
    await crearRuta(req, res);
});

/**
 * @route PUT /api/logistica/movil/rutas/:id/asignar
 * @desc Asignar presupuestos a ruta desde celular (Proxy)
 */
router.put('/rutas/:id/asignar', validarTokenMovil, async (req, res) => {
    console.log(`🔍 [MOVIL-CRUD] Delegando asignación de ruta ${req.params.id} al controlador central...`);
    await asignarPresupuestos(req, res);
});

/**
 * @route DELETE /api/logistica/movil/rutas/:id
 * @desc Eliminar o cancelar ruta desde celular (Proxy)
 */
router.delete('/rutas/:id', validarTokenMovil, async (req, res) => {
    console.log(`🔍 [MOVIL-CRUD] Delegando eliminación de ruta ${req.params.id} al controlador central...`);
    await eliminarRuta(req, res);
});
/**
 * @route GET /api/logistica/movil/rutas/:id/detalle-completo
 * @desc Obtener detalle auditoría de ruta con presupuestos e items (App Gerencial)
 */
router.get('/rutas/:id/detalle-completo', validarTokenMovil, async (req, res) => {
    const { id } = req.params;
    try {
        const queryRuta = `SELECT r.id, r.nombre_ruta, u.nombre_completo as chofer_nombre FROM rutas r LEFT JOIN usuarios u ON r.id_chofer = u.id WHERE r.id = $1`;
        const resultRuta = await req.db.query(queryRuta, [id]);
        if(resultRuta.rows.length === 0) return res.status(404).json({ success: false, error: 'Ruta no encontrada' });
        const ruta = resultRuta.rows[0];

        // 1. Obtener Presupuestos y Totalizar Montos
        const queryPresupuestos = `
            SELECT p.id, p.estado, p.estado_logistico, p.comprobante_lomasoft, p.id_factura_lomasoft, 
            COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin nombre') as cliente_nombre,
            COALESCE( (SELECT SUM(pd.cantidad * pd.precio1) FROM presupuestos_detalles pd WHERE pd.id_presupuesto = p.id), 0) * (1 - (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN p.descuento / 100.0 ELSE COALESCE(p.descuento, 0) END)) as total_monto
            FROM presupuestos p 
            INNER JOIN clientes c ON ltrim(p.id_cliente::text, '0') = c.cliente_id::text 
            WHERE p.id_ruta = $1
            ORDER BY p.orden_entrega ASC NULLS LAST, p.id ASC`;
        const resultPresupuestos = await req.db.query(queryPresupuestos, [id]);
        
        // 2. Obtener Detalles y Cruzar ID Numérico por String Real
        const idsPresupuestos = resultPresupuestos.rows.map(p => p.id);
        let items = [];
        if(idsPresupuestos.length > 0) {
            const queryItems = `
                SELECT 
                    id_presupuesto, 
                    cantidad,
                    descripcion as articulo
                FROM public.v_presupuestos_detalles_resueltos
                WHERE id_presupuesto = ANY($1)
                ORDER BY id ASC
            `;
            const resultItems = await req.db.query(queryItems, [idsPresupuestos]);
            items = resultItems.rows;
        }

        // 3. Vincular los items anidados
        const entregasPresupuestos = resultPresupuestos.rows.map(p => ({
            ...p,
            articulos: items.filter(i => i.id_presupuesto === p.id)
        }));

        // 4. Obtener Sobres de Efectivo de la ruta para auditoría de historial
        const resSobresHist = await req.db.query(`
            SELECT 
                s.codigo_sobre as id,
                'Sobre de Efectivo' as estado,
                CASE 
                    WHEN s.estado IN ('EN_TRANSITO', 'RECIBIDO_LOCAL', 'ACREDITADO') THEN 'RETIRADO (' || s.estado || ')'
                    ELSE s.estado
                END as estado_logistico,
                COALESCE(c.nombre || ' ' || c.apellido, c.nombre, bc.cliente_nombre, bc.razon_social, s.cliente_id) as cliente_nombre,
                COALESCE(s.monto_declarado, 0) as total_monto,
                s.orden_entrega
            FROM public.factura_pagos_efectivo s
            LEFT JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = s.cliente_id OR bc.lomas_soft_id = s.cliente_id
            LEFT JOIN public.clientes c ON (bc.lomas_soft_id IS NOT NULL AND c.cliente_id::text = ltrim(bc.lomas_soft_id, '0'))
                                        OR (bc.id IS NULL AND c.cliente_id::text = ltrim(s.cliente_id, '0'))
            WHERE s.id_ruta = $1
            ORDER BY s.orden_entrega ASC NULLS LAST, s.id ASC
        `, [id]);

        const entregasSobres = resSobresHist.rows.map(s => ({
            ...s,
            es_sobre_efectivo: true,
            articulos: [{ cantidad: 1, articulo: `Sobre de efectivo #${s.id}` }]
        }));

        // 5. Obtener Visitas Comerciales de Preventa de la ruta para auditoría de historial
        const resVisitasHist = await req.db.query(`
            SELECT 
                p.codigo_prospecto as id,
                'Visita Comercial' as estado,
                CASE 
                    WHEN p.estado_ruta = 'VISITADO' THEN 'VISITADO'
                    WHEN p.estado_ruta IN ('NO_ENCONTRADO', 'NO_CONCRETADA') THEN 'LOCAL NO ENCONTRADO'
                    ELSE COALESCE(p.estado_ruta, 'PENDIENTE')
                END as estado_logistico,
                p.nombre_fantasia as cliente_nombre,
                0 as total_monto,
                p.notas,
                p.direccion,
                p.orden_entrega
            FROM public.bunker_prospectos p
            WHERE p.id_ruta = $1 AND p.activo = true
            ORDER BY p.orden_entrega ASC NULLS LAST, p.id ASC
        `, [id]);

        const entregasVisitas = resVisitasHist.rows.map(v => ({
            ...v,
            es_visita_preventa: true,
            articulos: [{ cantidad: 1, articulo: `${v.direccion || 'Visita Preventa'}${v.notas ? ' — ' + v.notas : ''}` }]
        }));

        ruta.entregas = [...entregasPresupuestos, ...entregasSobres, ...entregasVisitas];

        res.json({ success: true, data: ruta });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * @route GET /api/logistica/movil/rutas-activas
 * @desc Proxy para listar rutas en ARMANDO usando validador local de celuar (Bearer)
 */
router.get('/rutas-activas', validarTokenMovil, async (req, res) => {
    try {
        const queryRutas = `
            SELECT r.id, r.nombre_ruta, r.estado, u.nombre_completo as chofer_nombre
            FROM rutas r
            LEFT JOIN usuarios u ON r.id_chofer = u.id
            WHERE r.estado = 'ARMANDO'
            ORDER BY r.fecha_creacion DESC
        `;
        const result = await req.db.query(queryRutas);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * @route PUT /api/logistica/movil/rutas/:id/reordenar
 * @desc Proxy PWA para reordenar (Drag & Drop) 
 */
router.put('/rutas/:id/reordenar', validarTokenMovil, async (req, res) => {
    const { id } = req.params;
    const { orden } = req.body;
    try {
        if (!Array.isArray(orden)) throw new Error('Se requiere array orden');
        const client = await req.db.connect();
        try {
            await client.query('BEGIN');
            for (let i = 0; i < orden.length; i++) {
                const item = orden[i];
                if (typeof item === 'string' && item.toUpperCase().startsWith('RT-')) {
                    const idTrat = parseInt(item.toUpperCase().replace('RT-', ''), 10);
                    if (!isNaN(idTrat)) {
                        await client.query(
                            `UPDATE ordenes_tratamiento SET orden_entrega = $1 WHERE id = $2 AND id_ruta = $3`,
                            [i + 1, idTrat, id]
                        );
                    }
                } else if (typeof item === 'string' && item.toUpperCase().startsWith('PR-')) {
                    const idProsp = parseInt(item.toUpperCase().replace('PR-', ''), 10);
                    if (!isNaN(idProsp)) {
                        await client.query(
                            `UPDATE public.bunker_prospectos SET orden_entrega = $1, updated_at = NOW() WHERE id = $2 AND id_ruta = $3`,
                            [i + 1, idProsp, id]
                        );
                    }
                } else if (typeof item === 'string' && item.toUpperCase().startsWith('SOB-')) {
                    const idSobre = parseInt(item.toUpperCase().replace('SOB-', ''), 10);
                    if (!isNaN(idSobre)) {
                        await client.query(
                            `UPDATE public.factura_pagos_efectivo SET orden_entrega = $1, fecha_actualizacion = NOW() WHERE id = $2 AND id_ruta = $3`,
                            [i + 1, idSobre, id]
                        );
                    }
                } else {
                    const idPresu = parseInt(item, 10);
                    if (!isNaN(idPresu)) {
                        await client.query(
                            `UPDATE presupuestos SET orden_entrega = $1 WHERE id = $2 AND id_ruta = $3`,
                            [i + 1, idPresu, id]
                        );
                    }
                }
            }
            await client.query('COMMIT');
            res.json({ success: true, message: 'Reordenado via PWA' });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

/**
 * @route PUT /api/logistica/movil/pedidos/:id/domicilio
 * @desc Persistir cambio de domicilio alternativo On-The-Fly
 */
router.put('/pedidos/:id/domicilio', validarTokenMovil, async (req, res) => {
    const { id } = req.params;
    const { id_domicilio_entrega } = req.body;
    try {
        const idStr = String(id);
        if (idStr.startsWith('SOB-')) {
            const cleanSobreId = parseInt(idStr.replace('SOB-', ''), 10);
            await req.db.query(`UPDATE public.factura_pagos_efectivo SET id_domicilio_entrega = $1, fecha_actualizacion = NOW() WHERE id = $2`, [id_domicilio_entrega, cleanSobreId]);
        } else if (idStr.startsWith('RT-')) {
            const cleanRtId = parseInt(idStr.replace('RT-', ''), 10);
            await req.db.query(`UPDATE ordenes_tratamiento SET id_domicilio_entrega = $1 WHERE id = $2`, [id_domicilio_entrega, cleanRtId]);
        } else {
            await req.db.query(`UPDATE presupuestos SET id_domicilio_entrega = $1 WHERE id = $2`, [id_domicilio_entrega, id]);
        }
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

/**
 * @route GET /api/logistica/movil/rutas/:id/destinatarios-inicio
 * @desc Obtener clientes, tipo de parada y destinatarios de WhatsApp para modal de inicio de ruta
 */
router.get('/rutas/:id/destinatarios-inicio', validarTokenMovil, async (req, res) => {
    try {
        const { id } = req.params;
        const clientes = await obtenerDestinatariosInicioRuta(id);
        res.json({ success: true, clientes });
    } catch (error) {
        console.error(`❌ [MOVIL] Error obteniendo destinatarios de inicio de ruta ${req.params.id}:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route PUT /api/logistica/movil/rutas/:id/estado
 * @desc Cambiar estado a EN_CAMINO o regresar a ARMANDO desde PWA con despacho opcional de WhatsApps
 */
router.put('/rutas/:id/estado', validarTokenMovil, async (req, res) => {
    const { id } = req.params;
    const { estado, notificar_clientes, clientes_ids } = req.body;
    try {
        if (estado === 'EN_CAMINO') {
            await req.db.query(`UPDATE rutas SET estado = $1, fecha_salida = NOW() WHERE id = $2`, [estado, id]);

            // Despachar notificaciones asíncronas en background si fueron requeridas
            if (notificar_clientes === true && Array.isArray(clientes_ids) && clientes_ids.length > 0) {
                setImmediate(async () => {
                    try {
                        await despacharNotificacionesInicioRuta(id, clientes_ids);
                    } catch (errNoti) {
                        console.error(`[MOVIL] ⚠️ Error en background al despachar notificaciones de inicio para ruta #${id}:`, errNoti.message);
                    }
                });
            }
        } else {
            await req.db.query(`UPDATE rutas SET estado = $1 WHERE id = $2`, [estado, id]);
        }
        res.json({ 
            success: true, 
            message: `Ruta movida a ${estado}`, 
            notificados: (notificar_clientes && clientes_ids) ? clientes_ids.length : 0 
        });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

/**
 * @route PUT /api/logistica/movil/rutas/:id/pausa
 * @desc Alternar estado de pausa y calcular telemetría
 */
router.put('/rutas/:id/pausa', validarTokenMovil, async (req, res) => {
    const { id } = req.params;
    const { en_pausa } = req.body;
    try {
        if (en_pausa) {
            await req.db.query(
                `UPDATE rutas SET en_pausa = true, inicio_ultima_pausa = NOW() WHERE id = $1`,
                [id]
            );
            res.json({ success: true, message: 'Ruta en pausa' });
        } else {
            await req.db.query(
                `UPDATE rutas 
                 SET en_pausa = false, 
                     tiempo_pausado_minutos = COALESCE(tiempo_pausado_minutos, 0) + FLOOR(EXTRACT(EPOCH FROM (NOW() - inicio_ultima_pausa))/60),
                     inicio_ultima_pausa = NULL
                 WHERE id = $1 AND en_pausa = true`,
                [id]
            );
            res.json({ success: true, message: 'Ruta reanudada' });
        }
    } catch(err) { 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

/**
 * @route DELETE /api/logistica/movil/rutas/:id/pedidos/:presupuestoId
 * @desc Quitar pedido dinámicamente de una ruta, eludiendo bloqueo de "EN_CAMINO"
 */
router.delete('/rutas/:id/pedidos/:presupuestoId', validarTokenMovil, async (req, res) => {
    const { id, presupuestoId } = req.params;
    try {
        if (String(presupuestoId).startsWith('RT-')) {
            const idOrden = presupuestoId.replace('RT-', '');
            await req.db.query(
                `UPDATE ordenes_tratamiento 
                 SET id_ruta = NULL
                 WHERE id = $1 AND id_ruta = $2 AND estado_logistico NOT IN ('ENTREGADO', 'RETIRADO', 'INGRESADO_LOCAL')`,
                [idOrden, id]
            );
        } else if (String(presupuestoId).startsWith('PR-')) {
            const idProsp = parseInt(String(presupuestoId).replace('PR-', ''), 10);
            await req.db.query(
                `UPDATE public.bunker_prospectos
                 SET id_ruta = NULL, en_pool_logistica = true, orden_entrega = 999, estado_ruta = 'PENDIENTE', updated_at = NOW()
                 WHERE id = $1 AND id_ruta = $2`,
                [idProsp, id]
            );
        } else if (String(presupuestoId).startsWith('SOB-')) {
            const idSobre = parseInt(String(presupuestoId).replace('SOB-', ''), 10);
            const checkSobre = await req.db.query(
                `SELECT estado, codigo_sobre FROM public.factura_pagos_efectivo WHERE id = $1 AND id_ruta = $2`,
                [idSobre, id]
            );
            if (checkSobre.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Sobre no encontrado en esta ruta.' });
            }
            if (['EN_TRANSITO', 'RECIBIDO_LOCAL', 'ACREDITADO'].includes(checkSobre.rows[0].estado)) {
                return res.status(400).json({
                    success: false,
                    error: `Imposible desvincular: El sobre ${checkSobre.rows[0].codigo_sobre} ya fue RETIRADO.`
                });
            }
            await req.db.query(
                `UPDATE public.factura_pagos_efectivo 
                 SET id_ruta = NULL, orden_entrega = 999, fecha_actualizacion = NOW()
                 WHERE id = $1 AND id_ruta = $2`,
                [idSobre, id]
            );
        } else {
            const check = await req.db.query(
                `SELECT estado_logistico, estado FROM presupuestos WHERE id = $1 AND id_ruta = $2`,
                [presupuestoId, id]
            );
            if (check.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Pedido no encontrado en esta ruta.' });
            }
            const p = check.rows[0];
            if (p.estado_logistico === 'ENTREGADO' || p.estado_logistico === 'RETIRADO' || p.estado === 'Entregado' || p.estado === 'Retirado') {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Imposible desvincular: Este pedido ya fue ENTREGADO/RETIRADO y debe permanecer en la Hoja de Ruta para su asentamiento.' 
                });
            }
            await req.db.query(
                `UPDATE presupuestos 
                 SET id_ruta = NULL, estado_logistico = 'PENDIENTE_ASIGNAR', secuencia = 'Pedido_Listo', orden_entrega = NULL, fecha_asignacion_ruta = NULL 
                 WHERE id = $1 AND id_ruta = $2`,
                [presupuestoId, id]
            );
        }
        res.json({ success: true, message: 'Excepción de calle: Pedido desvinculado hacia Pendientes' });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

/**
 * @route DELETE /api/logistica/movil/rutas/:id
 * @desc Eliminar ruta (Solo si está completamente vacía)
 */
router.delete('/rutas/:id', validarTokenMovil, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await req.db.query(`SELECT count(id) as count FROM presupuestos WHERE id_ruta = $1`, [id]);
        if (parseInt(result.rows[0].count) > 0) {
            return res.status(400).json({ success: false, error: 'No se puede eliminar la ruta: Debe vaciarse quitando las paradas primero.' });
        }
        await req.db.query(`DELETE FROM rutas WHERE id = $1`, [id]);
        res.json({ success: true, message: 'Hoja de ruta eliminada exitosamente' });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

console.log('📋 [MOVIL] Rutas disponibles:');
console.log('   - POST   /api/logistica/movil/login');
console.log('   - GET    /api/logistica/movil/mis-rutas');
console.log('   - GET    /api/logistica/movil/ruta-activa[?id=X]');
console.log('   - GET    /api/logistica/movil/pedidos/:id/detalles');
console.log('   - POST   /api/logistica/movil/entregas/confirmar');
console.log('   - POST   /api/logistica/movil/rutas/finalizar');
console.log('   - PUT    /api/logistica/movil/rutas/:id/reordenar');
console.log('   - PUT    /api/logistica/movil/pedidos/:id/domicilio');

module.exports = router;
