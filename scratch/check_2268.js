const pool = require('../src/produccion/config/database');

async function testPurgedQuery() {
    try {
        const sku = 'APN27/30X22,68';
        console.log(`=== AUDITANDO QUERY PURGADA PARA SKU: ${sku} ===`);

        const res = await pool.query(`
            SELECT 
                ba.articulo_id, 
                ba.descripcion_generada,
                EXISTS (
                    SELECT 1 FROM public.recetas r WHERE r.articulo_numero = ba.articulo_id
                ) AS tiene_receta
            FROM public.bunker_articulos ba
            WHERE ba.articulo_id = $1
        `, [sku]);

        console.log(`Resultado para ${sku}:`, res.rows[0]);

        if (res.rows[0] && res.rows[0].tiene_receta === false) {
            console.log('\n✅ CORRECTO: APN27/30X22,68 figura como tiene_receta: false (Comercialización Directa / Sin Receta)');
        } else {
            console.error('\n❌ ERROR: Todavía figura como tiene_receta: true');
        }
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

testPurgedQuery();
