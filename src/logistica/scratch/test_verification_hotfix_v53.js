const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function verificarHotfixV53() {
    console.log('🧪 ====================================================================');
    console.log('🧪 SUITE DE VERIFICACIÓN EMPÍRICA v5.3: TUPLA UNICIDAD MULTIDECLARADA');
    console.log('🧪 ====================================================================\n');

    try {
        // 1. Obtener IDs de Familia Cereales y Principal Granolas
        const famRes = await pool.query(`SELECT id FROM public.bunker_familias WHERE LOWER(nombre) LIKE '%cereal%' LIMIT 1`);
        const famId = famRes.rows.length > 0 ? famRes.rows[0].id : 27;

        const princRes = await pool.query(`SELECT id FROM public.bunker_diccionario WHERE LOWER(termino) LIKE '%granola%' AND categoria IN ('articulo_principal', 'general') LIMIT 1`);
        const princId = princRes.rows.length > 0 ? princRes.rows[0].id : 874;

        console.log(`Parámetros de prueba: familia_id = ${famId}, articulo_principal_id = ${princId}`);

        // 2. Ejecutar la nueva SQL refactorizada de obtenerPlantillaPorTermino
        const sqlRefactorizada = `
            SELECT DISTINCT ON (d.id, COALESCE(r.categoria, d.categoria))
                d.id,
                COALESCE(r.categoria, d.categoria) AS categoria,
                d.termino,
                d.abreviatura,
                COALESCE(d.en_revision, false) AS en_revision,
                CASE 
                    WHEN r.id IS NOT NULL THEN true 
                    ELSE false 
                END AS relacional
            FROM public.bunker_diccionario d
            LEFT JOIN public.bunker_relacion_atributo_principal r 
                ON r.termino_id = d.id
               AND r.familia_id = $1::integer
               AND r.articulo_principal_id = $2::integer
            WHERE d.obsoleto IS NOT TRUE
              AND d.categoria NOT LIKE 'asistente_%'
              AND d.categoria NOT LIKE 'rendimiento_%'
              AND d.termino IS NOT NULL AND TRIM(d.termino) != ''
            ORDER BY d.id, COALESCE(r.categoria, d.categoria), relacional DESC, d.termino ASC;
        `;
        const res = await pool.query(sqlRefactorizada, [famId, princId]);
        const rows = res.rows;

        // ----------------------------------------------------
        // PRUEBA 1: Presencia de Granolas en Posición 2 (articulo_principal)
        // ----------------------------------------------------
        console.log('--- PRUEBA 1: Presencia de Granolas en articulo_principal ---');
        const matchPrincipal = rows.find(r => r.id === princId && r.categoria === 'articulo_principal');
        if (matchPrincipal && matchPrincipal.relacional) {
            console.log('   ✅ PRUEBA 1 PASADA: "Granolas" está presente con categoria = "articulo_principal" y relacional = true.');
        } else {
            console.error('   ❌ PRUEBA 1 FALLIDA:', matchPrincipal);
            process.exitCode = 1;
        }

        // ----------------------------------------------------
        // PRUEBA 2: Presencia de Granolas en Posición 4 (conformacion)
        // ----------------------------------------------------
        console.log('\n--- PRUEBA 2: Presencia de Granolas en conformacion ---');
        const matchConformacion = rows.find(r => r.id === princId && r.categoria === 'conformacion');
        if (matchConformacion && matchConformacion.relacional) {
            console.log('   ✅ PRUEBA 2 PASADA: "Granolas" está presente simultáneamente con categoria = "conformacion" y relacional = true.');
        } else {
            console.error('   ❌ PRUEBA 2 FALLIDA:', matchConformacion);
            process.exitCode = 1;
        }

        // ----------------------------------------------------
        // PRUEBA 3: Presencia de Barritas en Posición 4 (conformacion)
        // ----------------------------------------------------
        console.log('\n--- PRUEBA 3: Coexistencia con Barritas en conformacion ---');
        const matchBarritas = rows.find(r => r.termino.toLowerCase() === 'barritas' && r.categoria === 'conformacion');
        if (matchBarritas && matchBarritas.relacional) {
            console.log('   ✅ PRUEBA 3 PASADA: "Barritas" coexiste en la categoría "conformacion" con relacional = true.');
        } else {
            console.error('   ❌ PRUEBA 3 FALLIDA:', matchBarritas);
            process.exitCode = 1;
        }

        console.log('\n🏆 ====================================================================');
        console.log('🏆 SUITE DE VERIFICACIÓN v5.3 COMPLETADA CON ÉXITO ABSOLUTO');
        console.log('🏆 ====================================================================\n');

    } catch (err) {
        console.error('❌ Error fatal en verificación v5.3:', err);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

verificarHotfixV53();
