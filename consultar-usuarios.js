require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function consultarUsuarios() {
    try {
        console.log('🔍 Consultando usuarios activos en la base de datos...\n');
        
        const result = await pool.query(`
            SELECT 
                id,
                usuario,
                nombre_completo,
                contraseña,
                activo
            FROM usuarios
            WHERE activo = true
            ORDER BY id
            LIMIT 10
        `);
        
        if (result.rows.length === 0) {
            console.log('⚠️ No se encontraron usuarios activos.');
        } else {
            console.log(`✅ Se encontraron ${result.rows.length} usuarios activos:\n`);
            console.log('ID | Usuario | Nombre Completo | Contraseña');
            console.log('---|---------|-----------------|------------');
            
            result.rows.forEach(user => {
                console.log(`${user.id} | ${user.usuario} | ${user.nombre_completo} | ${user.contraseña}`);
            });
            
            console.log('\n📱 Para login móvil, usa cualquiera de estos usuarios.');
        }
        
        await pool.end();
        
    } catch (error) {
        console.error('❌ Error al consultar usuarios:', error.message);
        process.exit(1);
    }
}

consultarUsuarios();
