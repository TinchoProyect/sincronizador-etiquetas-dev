const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function diagnoseLegumbres() {
    const client = await pool.connect();
    try {
        console.log('=== 🔍 DIAGNÓSTICO BASE DE DATOS: FAMILIA LEGUMBRES Y ATRIBUTO ALUBIA ===\n');

        // 1. Buscar Familia Legumbres
        const resFam = await client.query(`SELECT id, nombre, abreviatura FROM public.bunker_familias WHERE LOWER(nombre) LIKE '%legumbre%'`);
        console.log('1. Familia Legumbres en DB:', resFam.rows);

        if (resFam.rows.length === 0) {
            console.log('No se encontró la familia Legumbres.');
            return;
        }

        const famId = resFam.rows[0].id;

        // 2. Buscar relaciones en bunker_relacion_atributo_principal para esta familia
        const resRel = await client.query(`
            SELECT r.id, r.familia_id, r.articulo_principal_id, d.termino, r.categoria
            FROM public.bunker_relacion_atributo_principal r
            LEFT JOIN public.bunker_diccionario d ON r.articulo_principal_id = d.id
            WHERE r.familia_id = $1
            ORDER BY r.id ASC;
        `, [famId]);

        console.log(`\n2. Relaciones Nivel 1/2 en bunker_relacion_atributo_principal para familia ID ${famId}:`, resRel.rows);

        // 3. Buscar término Alubia en bunker_diccionario
        const resAlubia = await client.query(`SELECT id, termino, categoria FROM public.bunker_diccionario WHERE LOWER(termino) LIKE '%alubia%'`);
        console.log('\n3. Término Alubia en bunker_diccionario:', resAlubia.rows);

        // 4. Buscar si existen artículos vinculados a Legumbres y/o Alubia
        const resArt = await client.query(`
            SELECT articulo_id, descripcion, descripcion_generada, familia_id, propiedades_dinamicas
            FROM public.bunker_articulos
            WHERE familia_id = $1 OR CAST(propiedades_dinamicas AS TEXT) ILIKE '%alubia%';
        `, [famId]);

        console.log(`\n4. Artículos vinculados a Legumbres o Alubia (${resArt.rows.length}):`);
        resArt.rows.forEach(a => {
            console.log(`   - ID: ${a.articulo_id} | Generada: ${a.descripcion_generada} | FamiliaID: ${a.familia_id}`);
        });

    } catch (e) {
        console.error('Error en diagnóstico Legumbres:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

diagnoseLegumbres();
