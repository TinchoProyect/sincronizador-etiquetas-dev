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
        console.log('🚀 [SANEAMIENTO ALUBIA & DUP MASTER v5.81] Iniciando saneamiento...');

        // 1. Marcar término legado ID 60 (Alubia con categoria articulo_principal) como obsoleto
        await client.query(`
            UPDATE public.bunker_diccionario 
            SET obsoleto = true 
            WHERE id = 60 AND termino = 'Alubia' AND categoria = 'articulo_principal';
        `);
        console.log('✅ 1. Término legado ID 60 (Alubia) marcado como obsoleto.');

        // 2. Eliminar fila relacional ID 630 que vinculaba el término obsoleto ID 60 a Porotos
        const delRes = await client.query(`
            DELETE FROM public.bunker_relacion_atributo_principal 
            WHERE termino_id = 60 AND categoria = 'variedad';
        `);
        console.log(`✅ 2. Eliminadas ${delRes.rowCount} filas relacionales obsoletas para término ID 60.`);

        // 3. Asegurar que Fila ID 633 (término nativo ID 1241 Alubia) tenga categoria_id correcto (286)
        await client.query(`
            UPDATE public.bunker_relacion_atributo_principal 
            SET categoria_id = 286 
            WHERE familia_id = 43 AND termino_id = 1241 AND categoria = 'variedad';
        `);
        console.log('✅ 3. Fila relacional ID 633 actualizada con categoria_id = 286.');

        // 4. Limpieza general de cualquier otra relación con términos marcados obsoletos
        const delObsRel = await client.query(`
            DELETE FROM public.bunker_relacion_atributo_principal r
            USING public.bunker_diccionario d
            WHERE r.termino_id = d.id AND d.obsoleto IS TRUE AND r.categoria != 'articulo_principal';
        `);
        console.log(`✅ 4. Eliminadas ${delObsRel.rowCount} relaciones huérfanas con términos obsoletos.`);

        await client.query('COMMIT');
        console.log('🎉 [SANEAMIENTO ALUBIA v5.81] Saneamiento de Alubia completado exitosamente.');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Error en saneamiento de Alubia:', e);
    } finally {
        client.release();
        await pool.end();
    }
})();
