const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function migrarCategorias() {
    const client = await pool.connect();
    try {
        console.log('🚀 Iniciando migración de categorías...');
        await client.query('BEGIN');

        console.log('1️⃣ Creando tabla categorias_ingredientes...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS categorias_ingredientes (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(255) UNIQUE NOT NULL,
                descripcion TEXT
            );
        `);

        console.log('2️⃣ Insertando categorías únicas desde tabla ingredientes...');
        await client.query(`
            INSERT INTO categorias_ingredientes (nombre)
            SELECT DISTINCT TRIM(categoria)
            FROM ingredientes
            WHERE categoria IS NOT NULL AND TRIM(categoria) != ''
            ON CONFLICT (nombre) DO NOTHING;
        `);

        console.log('3️⃣ Añadiendo columna categoria_id a ingredientes...');
        // Verificar si la columna existe
        const columnCheck = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='ingredientes' AND column_name='categoria_id';
        `);
        if (columnCheck.rowCount === 0) {
            await client.query(`
                ALTER TABLE ingredientes 
                ADD COLUMN categoria_id INTEGER REFERENCES categorias_ingredientes(id);
            `);
        }

        console.log('4️⃣ Vinculando ingredientes a sus nuevas categorías (actualizando categoria_id)...');
        await client.query(`
            UPDATE ingredientes i
            SET categoria_id = c.id
            FROM categorias_ingredientes c
            WHERE TRIM(i.categoria) = c.nombre;
        `);

        console.log('5️⃣ Verificando si quedan ingredientes huérfanos de categoría...');
        const huerfanos = await client.query(`
            SELECT count(*) FROM ingredientes WHERE categoria_id IS NULL AND categoria IS NOT NULL AND TRIM(categoria) != '';
        `);
        if (parseInt(huerfanos.rows[0].count) > 0) {
            console.warn(`⚠️ ALERTA: Quedan ${huerfanos.rows[0].count} ingredientes sin categoría vinculada.`);
        } else {
            console.log('✅ Todos los ingredientes fueron vinculados correctamente.');
            console.log('6️⃣ Eliminando columna de texto libre "categoria"...');
            await client.query(`
                ALTER TABLE ingredientes DROP COLUMN categoria;
            `);
        }

        await client.query('COMMIT');
        console.log('🎉 Migración completada exitosamente.');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error durante la migración:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

migrarCategorias();
