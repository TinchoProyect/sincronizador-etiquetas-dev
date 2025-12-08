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

console.log('✅ [MOVIL] Rutas configuradas exitosamente');
console.log('📋 [MOVIL] Rutas disponibles:');
console.log('   - POST   /api/logistica/movil/login');
console.log('   - GET    /api/logistica/movil/ruta-activa');

module.exports = router;
