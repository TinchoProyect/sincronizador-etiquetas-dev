const { Pool } = require('pg');
const BunkerService = require('../services/bunkerService');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function extractEmpiricalEvidence() {
    console.log('🔬 ====================================================================');
    console.log('🔬 EXTRACCIÓN DE EVIDENCIA EMPÍRICA EN TIEMPO REAL (DATOS DUROS - v5.38)');
    console.log('🔬 ====================================================================\n');

    const client = await pool.connect();
    try {
        // -------------------------------------------------------------------------
        // SECCIÓN A: Identidad Empírica de la "Unidad Productiva" (SKU BFX50G)
        // -------------------------------------------------------------------------
        console.log('--- A. IDENTIDAD EMPÍRICA DE LA UNIDAD PRODUCTIVA (SKU: BFX50G) ---');
        
        const resRel = await client.query(`
            SELECT 
                r.id,
                r.articulo_produccion_codigo,
                r.articulo_kilo_codigo,
                r.multiplicador_ingredientes,
                r.ingredientes_custom
            FROM public.articulos_produccion_externa_relacion r
            WHERE r.articulo_kilo_codigo = 'BFX50G' OR r.articulo_produccion_codigo = 'BFX50G';
        `);
        console.log('1. Registros en public.articulos_produccion_externa_relacion:');
        console.log(JSON.stringify(resRel.rows, null, 2));

        const targetSkus = ['BFX50G', 'BFXP'];
        if (resRel.rows.length > 0) {
            targetSkus.push(resRel.rows[0].articulo_produccion_codigo);
            targetSkus.push(resRel.rows[0].articulo_kilo_codigo);
        }
        const uniqueSkus = [...new Set(targetSkus.filter(Boolean))];

        const resBunker = await client.query(`
            SELECT 
                ba.articulo_id,
                ba.descripcion,
                ba.descripcion_generada,
                ba.rubro,
                ba.sub_rubro,
                ba.costo_base,
                ba.kilos_unidad
            FROM public.bunker_articulos ba
            WHERE ba.articulo_id = ANY($1);
        `, [uniqueSkus]);
        console.log('\n2. Registros en public.bunker_articulos (Búnker):');
        console.log(JSON.stringify(resBunker.rows, null, 2));

        const resLegacy = await client.query(`
            SELECT 
                src.articulo_numero,
                src.descripcion,
                src.kilos_unidad,
                src.stock_consolidado
            FROM public.stock_real_consolidado src
            WHERE src.articulo_numero = ANY($1);
        `, [uniqueSkus]);
        console.log('\n3. Registros en public.stock_real_consolidado (Legacy):');
        console.log(JSON.stringify(resLegacy.rows, null, 2));

        const resReceta = await client.query(`
            SELECT 
                r.id,
                r.articulo_numero,
                r.descripcion
            FROM public.recetas r
            WHERE r.articulo_numero = ANY($1);
        `, [uniqueSkus]);
        console.log('\n4. Registros en public.recetas (Receta UP):');
        console.log(JSON.stringify(resReceta.rows, null, 2));


        // -------------------------------------------------------------------------
        // SECCIÓN B: Evidencia Empírica del Costo de Origen
        // -------------------------------------------------------------------------
        console.log('\n--- B. EVIDENCIA EMPÍRICA DEL COSTO ORIGEN ---');
        const finanzasResultBFX50G = await BunkerService.obtenerRadiografiaFinanciera(client, 'BFX50G');
        console.log('1. Resumen de payload JSON devuelto por BunkerService.obtenerRadiografiaFinanciera("BFX50G"):');
        console.log(`   - articulo_id: ${finanzasResultBFX50G.articulo_id}`);
        console.log(`   - costo_por_kilo_normalizado: $${finanzasResultBFX50G.costo_por_kilo_normalizado}`);
        console.log(`   - fuente_costo_aplicada: ${finanzasResultBFX50G.fuente_costo_aplicada}`);

        const finanzasResultBFXP = await BunkerService.obtenerRadiografiaFinanciera(client, 'BFXP');
        console.log('\n2. Resumen de payload JSON devuelto por BunkerService.obtenerRadiografiaFinanciera("BFXP"):');
        console.log(`   - articulo_id: ${finanzasResultBFXP.articulo_id}`);
        console.log(`   - costo_por_kilo_normalizado: $${finanzasResultBFXP.costo_por_kilo_normalizado}`);
        console.log(`   - fuente_costo_aplicada: ${finanzasResultBFXP.fuente_costo_aplicada}`);
        console.log(`   - receta_id: ${finanzasResultBFXP.receta_id}`);
        console.log(`   - receta_articulos (Insumos/Materia Prima Entrada): ${JSON.stringify(finanzasResultBFXP.receta_articulos, null, 2)}`);

        try {
            const finanzasResultMPB = await BunkerService.obtenerRadiografiaFinanciera(client, 'MPB');
            console.log('\n3. Resumen de payload JSON devuelto por BunkerService.obtenerRadiografiaFinanciera("MPB"):');
            console.log(`   - articulo_id: ${finanzasResultMPB.articulo_id}`);
            console.log(`   - costo_por_kilo_normalizado: $${finanzasResultMPB.costo_por_kilo_normalizado}`);
            console.log(`   - fuente_costo_aplicada: ${finanzasResultMPB.fuente_costo_aplicada}`);
        } catch (eMp) {
            console.log('   - MPB no posee radiografía directa o es ingrediente compuesto.');
        }

        const resCostoDetalle = await client.query(`
            SELECT 
                articulo_id,
                descripcion,
                descripcion_generada,
                costo_base,
                kilos_unidad,
                propiedades_dinamicas
            FROM public.bunker_articulos
            WHERE articulo_id IN ('BFX50G', 'BFXP', 'MPB');
        `);
        console.log('\n4. Detalle directo en tabla public.bunker_articulos para BFX50G, BFXP y MPB:');
        console.log(JSON.stringify(resCostoDetalle.rows, null, 2));


        // -------------------------------------------------------------------------
        // SECCIÓN C: Evidencia Empírica del Tarifario del Colaborador "Matías"
        // -------------------------------------------------------------------------
        console.log('\n--- C. EVIDENCIA EMPÍRICA DEL TARIFARIO DEL COLABORADOR "MATÍAS" ---');
        
        const resUser = await client.query(`
            SELECT *
            FROM public.usuarios
            WHERE LOWER(usuario) LIKE '%matias%' OR LOWER(nombre_completo) LIKE '%matias%';
        `);
        console.log('1. Registro de usuario en public.usuarios:');
        console.log(JSON.stringify(resUser.rows, null, 2));

        if (resUser.rows.length > 0) {
            const userIds = resUser.rows.map(u => u.id);
            const resTarifas = await client.query(`
                SELECT 
                    ctr.id,
                    ctr.usuario_id,
                    ctr.articulo_numero,
                    ctr.valor_por_unidad,
                    ctr.unidad_medida,
                    ctr.activo,
                    ba.descripcion as bunker_descripcion,
                    ba.descripcion_generada as bunker_descripcion_generada
                FROM public.colaboradores_tarifas_rendimiento ctr
                LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = ctr.articulo_numero
                WHERE ctr.usuario_id = ANY($1);
            `, [userIds]);
            console.log('\n2. Tarifas vigentes en public.colaboradores_tarifas_rendimiento para usuario Matías:');
            console.log(JSON.stringify(resTarifas.rows, null, 2));
        }

    } catch (err) {
        console.error('❌ Error extrayendo evidencia empírica:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

extractEmpiricalEvidence();
