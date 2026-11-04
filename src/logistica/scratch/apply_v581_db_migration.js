const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432
});

(async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log('🚀 [MIGRACIÓN v5.81] Iniciando saneamiento ontológico y restructuración de constraints...');

        // 1. Marcar término legado ID 213 como obsoleto
        await client.query(`
            UPDATE public.bunker_diccionario 
            SET obsoleto = true 
            WHERE id = 213 AND termino = 'Pallares' AND categoria = 'articulo_principal';
        `);
        console.log('✅ 1. Término legado ID 213 (Pallares) marcado como obsoleto.');

        // 2. Eliminar filas relacionales duplicadas en bunker_relacion_atributo_principal
        const delDupRes = await client.query(`
            DELETE FROM public.bunker_relacion_atributo_principal a
            USING public.bunker_relacion_atributo_principal b
            WHERE a.id > b.id
              AND a.familia_id = b.familia_id
              AND COALESCE(a.articulo_principal_id, 0) = COALESCE(b.articulo_principal_id, 0)
              AND a.termino_id = b.termino_id
              AND LOWER(a.categoria) = LOWER(b.categoria);
        `);
        console.log(`✅ 2. Eliminadas ${delDupRes.rowCount} filas relacionales duplicadas en bunker_relacion_atributo_principal.`);

        // 3. Eliminar constraint antigua basada en texto si existe
        await client.query(`
            ALTER TABLE public.bunker_relacion_atributo_principal 
            DROP CONSTRAINT IF EXISTS unq_relacion_atributo;
        `);
        console.log('✅ 3. Eliminada constraint antigua basada en texto (unq_relacion_atributo).');

        // 4. Crear nuevo UNIQUE INDEX sobre IDs relacionales numéricos enteros + categoria
        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS unq_bunker_relacion_atributo_id_categoria 
            ON public.bunker_relacion_atributo_principal (familia_id, articulo_principal_id, termino_id, LOWER(categoria));
        `);
        console.log('✅ 4. Creado UNIQUE INDEX (unq_bunker_relacion_atributo_id_categoria) sobre (familia_id, articulo_principal_id, termino_id, LOWER(categoria)).');

        await client.query('COMMIT');
        console.log('🎉 [MIGRACIÓN v5.81] Migración completada exitosamente.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error en migración v5.81:', err);
    } finally {
        client.release();
        await pool.end();
    }
})();
