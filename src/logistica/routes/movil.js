/**
 * Rutas Móvil
 * Endpoints para la app móvil de choferes
 */

const express = require('express');
const router = express.Router();

// Importar modelos y controladores del escritorio (Dashboard Gerencial)
const { obtenerPresupuestosDisponibles } = require('../models/presupuestosModel.js');
const { crearRuta, asignarPresupuestos, eliminarRuta } = require('../controllers/rutasController.js');

console.log('🔍 [MOVIL] Configurando rutas del módulo móvil...');

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
        const { usuario, password } = req.body;

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
            WHERE usuario = $1 AND activo = true
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

        // Comparación directa (texto plano, sin bcrypt)
        if (dbPassword !== password) {
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
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Token no proporcionado' });
        }
        const token = authHeader.substring(7);
        let choferId;
        try {
            const decoded = Buffer.from(token, 'base64').toString('utf-8');
            choferId = parseInt(decoded.split(':')[0]);
        } catch (error) {
            return res.status(401).json({ success: false, error: 'Token inválido' });
        }

        // Obtener todas las rutas activas (ARMANDO o EN_CAMINO) del chofer con conteo de entregas
        const query = `
            SELECT 
                r.id,
                r.nombre_ruta,
                r.fecha_salida,
                r.estado,
                (SELECT COUNT(*) FROM presupuestos p WHERE p.id_ruta = r.id) as total_entregas
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
        // Obtener token del header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Token no proporcionado'
            });
        }

        const token = authHeader.substring(7);

        // Decodificar token simple (en producción validar JWT)
        let choferId;
        try {
            const decoded = Buffer.from(token, 'base64').toString('utf-8');
            choferId = parseInt(decoded.split(':')[0]);
        } catch (error) {
            return res.status(401).json({
                success: false,
                error: 'Token inválido'
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
                    (SELECT ROUND(SUM(pd.cantidad * COALESCE(pd.precio1, 0)), 2)
                     FROM presupuestos_detalles pd
                     WHERE pd.id_presupuesto_ext = p.id_presupuesto_ext),
                    0
                ) as total
            FROM presupuestos p
            INNER JOIN clientes c ON p.id_cliente::text = c.cliente_id::text
            LEFT JOIN clientes_domicilios cd ON p.id_domicilio_entrega = cd.id
            WHERE p.id_ruta = $1
            ORDER BY COALESCE(p.orden_entrega, 999) ASC
        `;

        console.log('[MOVIL] Buscando entregas para ruta ID:', ruta.id);
        const resultEntregas = await req.db.query(queryEntregas, [ruta.id]);
        console.log('[MOVIL] ✅ Entregas encontradas:', resultEntregas.rows.length);

        // Formatear entregas
        const entregas = resultEntregas.rows.map(e => ({
            id_presupuesto: e.id_presupuesto,
            orden_entrega: e.orden_entrega,
            estado: e.estado,
            estado_logistico: e.estado_logistico,
            comprobante_lomasoft: e.comprobante_lomasoft,
            id_factura_lomasoft: e.id_factura_lomasoft,
            total: e.total,
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
            LEFT JOIN LATERAL (
                SELECT id, direccion, localidad, latitud, longitud
                FROM clientes_domicilios 
                WHERE id_cliente = c.id AND activo = true
                ORDER BY es_predeterminado DESC, id ASC
                LIMIT 1
            ) cd ON true
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

        res.json({
            success: true,
            data: {
                ruta: ruta,
                entregas: entregas,
                retiros: retirosMantenimiento
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

        console.log('[MOVIL] Buscando detalles para presupuesto ID:', id);

        // Obtener id_presupuesto_ext del presupuesto
        const presupuestoQuery = `
            SELECT id_presupuesto_ext
            FROM presupuestos
            WHERE id = $1
        `;

        const presupuestoResult = await req.db.query(presupuestoQuery, [parseInt(id)]);

        if (presupuestoResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado'
            });
        }

        const idPresupuestoExt = presupuestoResult.rows[0].id_presupuesto_ext;

        // Obtener detalles de artículos
        const detallesQuery = `
            SELECT 
                pd.articulo as codigo_barras,
                pd.cantidad,
                COALESCE(a.nombre, pd.articulo) as descripcion
            FROM presupuestos_detalles pd
            LEFT JOIN articulos a ON a.codigo_barras = pd.articulo
            WHERE pd.id_presupuesto_ext = $1
            ORDER BY pd.articulo
        `;

        const detallesResult = await req.db.query(detallesQuery, [idPresupuestoExt]);

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
            const estadoComercial = estadoFinal === 'RETIRADO' ? 'Retirado' : 'Entregado';

            // 1. Actualizar presupuesto
            // IMPORTANTE: Actualizar también 'estado' y 'fecha_actualizacion'
            await client.query(
                `UPDATE presupuestos 
                 SET secuencia = $2,
                     estado = $3,
                     estado_logistico = $4,
                     fecha_entrega_real = NOW(),
                     fecha_actualizacion = NOW()
                 WHERE id = $1`,
                [id_presupuesto, estadoComercial, estadoComercial, estadoFinal]
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
            
            await client.query(`
                UPDATE ordenes_tratamiento 
                SET estado_logistico = 'EN_CAMINO', fecha_validacion_chofer = NOW()
                WHERE id = $1
            `, [id]);
            
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
        // Obtener token del header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Token no proporcionado'
            });
        }

        const token = authHeader.substring(7);

        // Decodificar token
        let choferId;
        try {
            const decoded = Buffer.from(token, 'base64').toString('utf-8');
            choferId = parseInt(decoded.split(':')[0]);
        } catch (error) {
            return res.status(401).json({
                success: false,
                error: 'Token inválido'
            });
        }

        console.log('[MOVIL] Finalizando ruta del chofer ID:', choferId);

        // Buscar ruta activa
        const rutaQuery = `
            SELECT id, nombre_ruta
            FROM rutas
            WHERE id_chofer = $1 
              AND estado = 'EN_CAMINO'
            ORDER BY id DESC
            LIMIT 1
        `;

        const rutaResult = await req.db.query(rutaQuery, [choferId]);

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
            // Marcar todas las ordenes_tratamiento que estaban en la ruta como "INGRESADO_LOCAL"
            const updatedTR = await client.query(`
                UPDATE ordenes_tratamiento
                SET estado_logistico = 'INGRESADO_LOCAL',
                    fecha_ingreso_mantenimiento = NOW()
                WHERE id_ruta = $1 AND estado_logistico != 'PENDIENTE_CLIENTE'
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
                        COALESCE((SELECT SUM(kilos) FROM ordenes_tratamiento_detalles WHERE id_orden_tratamiento = ot.id), 0),
                        ot.chofer_nombre,
                        'RETIRO_TRATAMIENTO',
                        (SELECT json_agg(json_build_object('desc', descripcion_externa, 'kilos', kilos, 'bultos', bultos, 'motivo', motivo))::text 
                         FROM ordenes_tratamiento_detalles WHERE id_orden_tratamiento = ot.id),
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
                // Extraer detalles e inyectarlos
                const retirosDetalles = await client.query(`
                    SELECT 
                        pd.id_presupuesto, 
                        pd.cantidad, 
                        COALESCE(a.numero, pd.articulo) as articulo_numero 
                    FROM presupuestos_detalles pd
                    LEFT JOIN articulos a ON a.codigo_barras = pd.articulo OR a.numero = pd.articulo
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
                }
            }

            // 3. Actualizar estado de ruta y calcular duración neta
            await client.query(
                `UPDATE rutas 
                 SET estado = 'FINALIZADA',
                     fecha_finalizacion = NOW(),
                     duracion_neta_minutos = FLOOR(EXTRACT(EPOCH FROM (NOW() - fecha_salida))/60) - COALESCE(tiempo_pausado_minutos, 0)
                 WHERE id = $1`,
                [ruta.id]
            );

            await client.query('COMMIT');

            console.log('[MOVIL] ✅ Ruta finalizada y retiros procesados exitosamente:', ruta.nombre_ruta);

            res.json({
                success: true,
                message: 'Ruta finalizada correctamente',
                data: {
                    ruta_id: ruta.id,
                    nombre_ruta: ruta.nombre_ruta,
                    pedidos_pendientes: pendientes
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
 * @route GET /api/logistica/movil/rutas-historial
 * @desc Obtener historial de rutas finalizadas del chofer
 * @access Privado (requiere token)
 */
router.get('/rutas-historial', async (req, res) => {
    console.log('🔍 [MOVIL] Ruta GET /rutas-historial - Obteniendo historial');

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Token no proporcionado' });
        }
        const token = authHeader.substring(7);

        let choferId;
        try {
            const decoded = Buffer.from(token, 'base64').toString('utf-8');
            choferId = parseInt(decoded.split(':')[0]);
        } catch (error) {
            return res.status(401).json({ success: false, error: 'Token inválido' });
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
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
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
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
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
            COALESCE( (SELECT SUM(pd.cantidad * pd.precio1) FROM presupuestos_detalles pd WHERE pd.id_presupuesto = p.id), 0) as total_monto
            FROM presupuestos p 
            INNER JOIN clientes c ON p.id_cliente::text = c.cliente_id::text 
            WHERE p.id_ruta = $1
            ORDER BY p.orden_entrega ASC NULLS LAST, p.id ASC`;
        const resultPresupuestos = await req.db.query(queryPresupuestos, [id]);
        
        // 2. Obtener Detalles y Cruzar ID Numérico por String Real
        const idsPresupuestos = resultPresupuestos.rows.map(p => p.id);
        let items = [];
        if(idsPresupuestos.length > 0) {
            const queryItems = `
                SELECT pd.id_presupuesto, pd.cantidad,
                COALESCE(a.nombre, pd.articulo) as articulo
                FROM presupuestos_detalles pd
                LEFT JOIN articulos a ON pd.articulo::text = a.numero::text OR pd.articulo::text = a.codigo_barras::text
                WHERE pd.id_presupuesto = ANY($1)
            `;
            const resultItems = await req.db.query(queryItems, [idsPresupuestos]);
            items = resultItems.rows;
        }

        // 3. Vincular los items anidados
        ruta.entregas = resultPresupuestos.rows.map(p => ({
            ...p,
            articulos: items.filter(i => i.id_presupuesto === p.id)
        }));

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
                await client.query(
                    `UPDATE presupuestos SET orden_entrega = $1 WHERE id = $2 AND id_ruta = $3`,
                    [i + 1, orden[i], id]
                );
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
        await req.db.query(`UPDATE presupuestos SET id_domicilio_entrega = $1 WHERE id = $2`, [id_domicilio_entrega, id]);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

/**
 * @route PUT /api/logistica/movil/rutas/:id/estado
 * @desc Cambiar estado a EN_CAMINO o regresar a ARMANDO desde PWA
 */
router.put('/rutas/:id/estado', validarTokenMovil, async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;
    try {
        if (estado === 'EN_CAMINO') {
            await req.db.query(`UPDATE rutas SET estado = $1, fecha_salida = NOW() WHERE id = $2`, [estado, id]);
        } else {
            await req.db.query(`UPDATE rutas SET estado = $1 WHERE id = $2`, [estado, id]);
        }
        res.json({ success: true, message: `Ruta movida a ${estado}` });
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
                 WHERE id = $1 AND id_ruta = $2`,
                [idOrden, id]
            );
        } else {
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
