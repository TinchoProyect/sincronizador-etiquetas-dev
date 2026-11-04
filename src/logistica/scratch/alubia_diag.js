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
        console.log('=== 1. Filas de Alubia en bunker_diccionario ===');
        const resDict = await pool.query(`
            SELECT id, termino, abreviatura, categoria, obsoleto 
            FROM bunker_diccionario 
            WHERE LOWER(termino) LIKE '%alubia%'
        `);
        console.log(resDict.rows);

        console.log('\n=== 2. Filas de Alubia en bunker_relacion_atributo_principal ===');
        const resRel = await pool.query(`
            SELECT r.id, r.familia_id, r.articulo_principal_id, d_princ.termino as articulo_principal_texto, r.termino_id, d_term.termino as termino_texto, d_term.obsoleto, r.categoria, r.categoria_id 
            FROM bunker_relacion_atributo_principal r 
            LEFT JOIN bunker_diccionario d_princ ON d_princ.id = r.articulo_principal_id 
            LEFT JOIN bunker_diccionario d_term ON d_term.id = r.termino_id 
            WHERE LOWER(d_term.termino) LIKE '%alubia%' OR LOWER(r.termino_texto) LIKE '%alubia%'
        `);
        console.log(resRel.rows);

        await pool.end();
    } catch(e) {
        console.error(e);
    }
})();
