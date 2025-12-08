/**
 * Rutas de Usuarios
 * Endpoints para obtener usuarios/choferes
 */

const express = require('express');
const router = express.Router();

console.log('🔍 [USUARIOS] Configurando rutas del módulo...');

/**
 * @route GET /api/logistica/usuarios
 * @desc Obtener lista de usuarios activos
 * @query rol - Filtrar por rol (opcional)
 * @access Privado
 */
router.get('/', async (req, res) => {
    console.log('🔍 [USUARIOS] Ruta GET / - Obteniendo usuarios');
    
    try {
        const { rol } = req.query;
        
        let query = `
            SELECT 
                u.id,
                u.nombre_completo,
                u.usuario,
                u.rol_id,
                r.nombre as rol_nombre,
                u.activo
            FROM usuarios u
            LEFT JOIN roles r ON u.rol_id = r.id
            WHERE u.activo = true
        `;
        
        const params = [];
        
        if (rol) {
            query += ` AND r.nombre = $1`;
            params.push(rol);
        }
        
        query += ` ORDER BY u.nombre_completo ASC`;
        
        const result = await req.db.query(query, params);
        
        res.json({
            success: true,
            data: result.rows
        });
        
    } catch (error) {
        console.error('❌ [USUARIOS] Error al obtener usuarios:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener usuarios',
            message: error.message
        });
    }
});

/**
 * @route GET /api/logistica/usuarios/choferes
 * @desc Obtener lista de choferes activos
 * @access Privado
 */
router.get('/choferes', async (req, res) => {
    console.log('🔍 [USUARIOS] Ruta GET /choferes - Obteniendo choferes');
    
    try {
        // Por ahora, devolver todos los usuarios activos
        // TODO: Filtrar por rol específico de chofer cuando esté implementado
        const query = `
            SELECT 
                id,
                nombre_completo,
                usuario
            FROM usuarios
            WHERE activo = true
            ORDER BY nombre_completo ASC
        `;
        
        const result = await req.db.query(query);
        
        res.json({
            success: true,
            data: result.rows
        });
        
    } catch (error) {
        console.error('❌ [USUARIOS] Error al obtener choferes:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener choferes',
            message: error.message
        });
    }
});

/**
 * @route GET /api/logistica/usuarios/:id
 * @desc Obtener datos de un usuario específico (incluyendo contraseña para QR)
 * @access Privado
 */
router.get('/:id', async (req, res) => {
    console.log('🔍 [USUARIOS] Ruta GET /:id - Obteniendo usuario');
    
    try {
        const { id } = req.params;
        
        const query = `
            SELECT 
                id,
                usuario,
                nombre_completo,
                contraseña,
                activo
            FROM usuarios
            WHERE id = $1
        `;
        
        const result = await req.db.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Usuario no encontrado'
            });
        }
        
        console.log('[USUARIOS] ✅ Usuario encontrado:', result.rows[0].usuario);
        
        res.json({
            success: true,
            data: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ [USUARIOS] Error al obtener usuario:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener usuario',
            message: error.message
        });
    }
});

console.log('✅ [USUARIOS] Rutas configuradas exitosamente');
console.log('📋 [USUARIOS] Rutas disponibles:');
console.log('   - GET    /api/logistica/usuarios');
console.log('   - GET    /api/logistica/usuarios/choferes');
console.log('   - GET    /api/logistica/usuarios/:id');

module.exports = router;
