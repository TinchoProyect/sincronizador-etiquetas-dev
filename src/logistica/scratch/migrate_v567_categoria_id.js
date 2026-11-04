const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runMigration() {
    const client = await pool.connect();
    try {
        console.log('=== 🚀 PASO 1 & 2: EJECUCIÓN MIGRACIÓN DDL/DML v5.67-rev3 (categoria_id FK) ===\n');

        await client.query('BEGIN');

        // 1. Snapshot backup table
        console.log('1. Creando tabla de respaldo snapshot bunker_relacion_backup_v567...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS public.bunker_relacion_backup_v567 AS 
            SELECT * FROM public.bunker_relacion_atributo_principal;
        `);
        console.log('   🟢 Snapshot backup completado.');

        // 2. ALTER TABLE: Agregar columna categoria_id
        console.log('2. Aplicando ALTER TABLE para agregar columna categoria_id...');
        await client.query(`
            ALTER TABLE public.bunker_relacion_atributo_principal 
            ADD COLUMN IF NOT EXISTS categoria_id INTEGER REFERENCES public.bunker_familia_categorias(id) ON DELETE CASCADE;
        `);
        console.log('   🟢 Columna categoria_id agregada.');

        // 3. UPDATE: Poblado determinista de categoria_id
        console.log('3. Ejecutando UPDATE determinista para poblar categoria_id desde bunker_familia_categorias...');
        const resUpdate = await client.query(`
            UPDATE public.bunker_relacion_atributo_principal r
            SET categoria_id = fc.id
            FROM public.bunker_familia_categorias fc
            WHERE fc.familia_id = r.familia_id 
              AND LOWER(TRIM(fc.categoria)) = LOWER(TRIM(r.categoria));
        `);
        console.log(`   🟢 UPDATE ejecutado: ${resUpdate.rowCount} filas actualizadas con categoria_id.`);

        // 4. CREATE INDEX
        console.log('4. Creando índice idx_relacion_categoria_id...');
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_relacion_categoria_id 
            ON public.bunker_relacion_atributo_principal(categoria_id);
        `);
        console.log('   🟢 Índice idx_relacion_categoria_id creado.');

        await client.query('COMMIT');
        console.log('\n✅ MIGRACIÓN BASE DE DATOS DDL/DML COMPLETADA CON ÉXITO.');

        // Audit final status
        const resAudit = await client.query(`
            SELECT 
                COUNT(*)::int as total,
                COUNT(categoria_id)::int as con_categoria_id,
                COUNT(*) FILTER (WHERE categoria_id IS NULL AND LOWER(TRIM(categoria)) = 'articulo_principal')::int as principales_null,
                COUNT(*) FILTER (WHERE categoria_id IS NULL AND LOWER(TRIM(categoria)) != 'articulo_principal')::int as huerfanas_null
            FROM public.bunker_relacion_atributo_principal;
        `);
        console.log('\n📊 AUDITORÍA POST-MIGRACIÓN:');
        console.table(resAudit.rows);

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Error en migración DDL/DML, rollback ejecutado:', e);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();
