const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432
});

(async () => {
    try {
        console.log('=== 1. CONSTRAINTS EN bunker_relacion_atributo_principal ===');
        const resConstraints = await pool.query(`
            SELECT conname, contype, pg_get_constraintdef(oid) 
            FROM pg_constraint 
            WHERE conrelid = 'bunker_relacion_atributo_principal'::regclass
        `);
        console.log(resConstraints.rows);

        console.log('\n=== 2. INDICES EN bunker_relacion_atributo_principal ===');
        const resIndexes = await pool.query(`
            SELECT indexname, indexdef 
            FROM pg_indexes 
            WHERE tablename = 'bunker_relacion_atributo_principal'
        `);
        console.log(resIndexes.rows);

        console.log('\n=== 3. FILAS RELACIONALES EN LEGUMBRES (familia_id = 43) ===');
        const resLeg = await pool.query(`
            SELECT id, familia_id, articulo_principal_id, articulo_principal_texto, termino_id, termino_texto, categoria, categoria_id 
            FROM bunker_relacion_atributo_principal 
            WHERE familia_id = 43 
            ORDER BY id ASC
        `);
        console.log(resLeg.rows);

        console.log('\n=== 4. REGISTROS DE PALLARES EN bunker_diccionario ===');
        const resDict = await pool.query(`
            SELECT id, termino, abreviatura, categoria, obsoleto 
            FROM bunker_diccionario 
            WHERE LOWER(termino) LIKE '%pallares%'
        `);
        console.log(resDict.rows);

        await pool.end();
    } catch (e) {
        console.error('Error en diagnóstico:', e);
    }
})();
