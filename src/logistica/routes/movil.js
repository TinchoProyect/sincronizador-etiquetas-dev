/**
 * Rutas Móvil
 * Endpoints para la app móvil de choferes
 */

const express = require('express');
const router = express.Router();

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
 * @route GET /api/logistica/movil/ruta-activa
 * @desc Obtener ruta activa del chofer autenticado
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

        console.log('[MOVIL] Buscando ruta activa para chofer ID:', choferId);

        // Buscar ruta activa del chofer
        // Prioriza EN_CAMINO sobre ARMANDO (la que ya se envió a reparto)
        // Si hay múltiples EN_CAMINO, toma la más reciente (mayor ID)
        const queryRuta = `
            SELECT 
                r.id,
                r.nombre_ruta,
                r.fecha_salida,
                r.estado,
                r.id_vehiculo,
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

        const resultRuta = await req.db.query(queryRuta, [choferId]);

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
                COALESCE(
                    (SELECT ROUND(SUM(pd.cantidad * COALESCE(pd.precio1, 0)), 2)
                     FROM presupuestos_detalles pd
                     WHERE pd.id_presupuesto_ext = p.id_presupuesto_ext),
                    0
                ) as total
            FROM presupuestos p
            INNER JOIN clientes c ON p.id_cliente::integer = c.cliente_id
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
            }
        }));

        console.log(`[MOVIL] ✅ Ruta activa encontrada: ${ruta.nombre_ruta} con ${entregas.length} entregas`);

        res.json({
            success: true,
            data: {
                ruta: ruta,
                entregas: entregas
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

        // Verificar pedidos pendientes
        const pendientesQuery = `
            SELECT COUNT(*) as pendientes
            FROM presupuestos
            WHERE id_ruta = $1
              AND estado_logistico != 'ENTREGADO'
        `;

        const pendientesResult = await req.db.query(pendientesQuery, [ruta.id]);
        const pendientes = parseInt(pendientesResult.rows[0].pendientes);

        // Actualizar estado de ruta
        await req.db.query(
            `UPDATE rutas 
             SET estado = 'FINALIZADA',
                 fecha_finalizacion = NOW()
             WHERE id = $1`,
            [ruta.id]
        );

        console.log('[MOVIL] ✅ Ruta finalizada:', ruta.nombre_ruta);

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
        console.error('❌ [MOVIL] Error al finalizar ruta:', error);
        res.status(500).json({
            success: false,
            error: 'Error al finalizar ruta',
            message: error.message
        });
    }
});

console.log('✅ [MOVIL] Rutas configuradas exitosamente');
console.log('📋 [MOVIL] Rutas disponibles:');
console.log('   - POST   /api/logistica/movil/login');
console.log('   - GET    /api/logistica/movil/ruta-activa');
console.log('   - GET    /api/logistica/movil/pedidos/:id/detalles');
console.log('   - POST   /api/logistica/movil/entregas/confirmar');
console.log('   - POST   /api/logistica/movil/rutas/finalizar');

module.exports = router;
