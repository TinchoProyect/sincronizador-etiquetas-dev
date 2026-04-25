require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function auditarDB() {
    try {
        console.log(`[AUDITORÍA] Conectado a base de datos: ${process.env.DB_NAME || 'etiquetas'}`);
        
        // 1. Verificar existencia de tabla categorias_ingredientes
        const tablaCatResult = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'categorias_ingredientes'
            );
        `);
        const existeTabla = tablaCatResult.rows[0].exists;
        console.log(`- Tabla 'categorias_ingredientes' existe: ${existeTabla}`);

        if (existeTabla) {
            // 2. Verificar registros en categorias_ingredientes
            const countCatResult = await pool.query(`SELECT COUNT(*) FROM categorias_ingredientes`);
            console.log(`- Registros en 'categorias_ingredientes': ${countCatResult.rows[0].count}`);
            
            // Mostrar los primeros 5 para confirmar traspaso
            const sampleCatResult = await pool.query(`SELECT id, nombre FROM categorias_ingredientes LIMIT 5`);
            console.log(`- Muestra de categorías:`, sampleCatResult.rows);
        }

        // 3. Verificar estructura de ingredientes (categoria_id y categoria)
        const columnasResult = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'ingredientes' AND column_name IN ('categoria', 'categoria_id');
        `);
        
        const columnas = columnasResult.rows.map(r => r.column_name);
        console.log(`- Columna 'categoria_id' existe en 'ingredientes': ${columnas.includes('categoria_id')}`);
        console.log(`- Columna 'categoria' (antigua) persiste en 'ingredientes': ${columnas.includes('categoria')}`);

        if (columnas.includes('categoria_id')) {
            const huerfanosResult = await pool.query(`SELECT COUNT(*) FROM ingredientes WHERE categoria_id IS NULL`);
            console.log(`- Ingredientes con 'categoria_id' NULL: ${huerfanosResult.rows[0].count}`);
        }

    } catch (e) {
        console.error('Error durante auditoría:', e);
    } finally {
        await pool.end();
    }
}

auditarDB();
