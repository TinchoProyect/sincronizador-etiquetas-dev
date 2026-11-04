const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost',
    user: 'postgres',
    password: 'ta3Mionga',
    database: 'etiquetas'
});

async function sanearBaseDeDatos() {
    console.log('🛠️ [SANEAMIENTO NIVEL 2] Ejecutando consolidación DDL/DML de duplicados...');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Identificar y consolidar duplicados case-insensitive en bunker_diccionario
        console.log('1. Consolidando duplicados en bunker_diccionario...');
        const resDup = await client.query(`
            SELECT LOWER(termino) as t_lower, array_agg(id ORDER BY id ASC) as ids, array_agg(termino ORDER BY id ASC) as terminos
            FROM public.bunker_diccionario
            GROUP BY LOWER(termino)
            HAVING COUNT(*) > 1
        `);

        for (const row of resDup.rows) {
            const masterId = row.ids[0]; // Retener el ID con menor valor (más antiguo)
            const masterTerm = row.terminos[0];
            const duplicateIds = row.ids.slice(1);

            console.log(`   • Conservando Master ID=${masterId} ("${masterTerm}"), eliminando duplicados:`, duplicateIds);

            // Reasignar referencias en bunker_relacion_atributo_principal
            await client.query(`
                UPDATE public.bunker_relacion_atributo_principal
                SET articulo_principal_id = $1, articulo_principal_texto = $2
                WHERE articulo_principal_id = ANY($3::int[])
            `, [masterId, masterTerm, duplicateIds]);

            await client.query(`
                UPDATE public.bunker_relacion_atributo_principal
                SET termino_id = $1, termino_texto = $2
                WHERE termino_id = ANY($3::int[])
            `, [masterId, masterTerm, duplicateIds]);

            // Eliminar registros duplicados en bunker_diccionario
            await client.query(`
                DELETE FROM public.bunker_diccionario
                WHERE id = ANY($1::int[])
            `, [duplicateIds]);
        }

        // 2. Limpiar duplicados en bunker_relacion_atributo_principal
        console.log('2. Limpiando duplicados en bunker_relacion_atributo_principal...');
        await client.query(`
            DELETE FROM public.bunker_relacion_atributo_principal r1
            USING public.bunker_relacion_atributo_principal r2
            WHERE r1.id > r2.id
              AND (r1.familia_id IS NOT DISTINCT FROM r2.familia_id)
              AND LOWER(r1.articulo_principal_texto) = LOWER(r2.articulo_principal_texto)
              AND LOWER(r1.termino_texto) = LOWER(r2.termino_texto)
              AND LOWER(r1.categoria) = LOWER(r2.categoria)
        `);

        // 3. Crear índice único case-insensitive en bunker_diccionario
        console.log('3. Asegurando índice único case-insensitive en bunker_diccionario...');
        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS unq_bunker_diccionario_lower_termino 
            ON public.bunker_diccionario (LOWER(termino))
        `);

        await client.query('COMMIT');
        console.log('✅ SANEAMIENTO COMPLETADO EXITOSAMENTE.');
    } catch(err) {
        await client.query('ROLLBACK');
        console.error('❌ Error en saneamiento:', err);
    } finally {
        client.release();
        pool.end();
    }
}

sanearBaseDeDatos();
