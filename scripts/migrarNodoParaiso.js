/**
 * Script idempotente de migración de NODO-001 ("Lo de Mati" -> "Paraíso · Alimentos saludables").
 * Reutilizable tanto en Laboratorio (etiquetas_pruebas) como en Producción (etiquetas).
 */
require('dotenv').config();

const db = require('../src/produccion/config/database');
const nodosService = require('../src/produccion/services/nodosBarrialesService');

(async () => {
    try {
        await nodosService.asegurarEsquemaNodosBarriales({ sembrarDemo: false });
        const resultado = await nodosService.migrarNodoLoDeMatiAParaiso(db);
        const check = await db.query(
            `SELECT id, codigo_nodo, slug, slug_historico, nombre_marca, bajada_marca,
                    gestor_nombre, barrio_zona, color_primario, cliente_madre_bunker_id, codigo_bunker_cliente,
                    LEFT(COALESCE(gestor_token, ''), 12) AS gestor_token_prefijo,
                    LEFT(COALESCE(logo_zpl_gfa, ''), 24) AS logo_zpl_prefijo,
                    logo_zpl_config,
                    tema_visual->'logo_incluye_texto' AS logo_incluye_texto,
                    tema_visual->'logos' AS tema_logos
             FROM public.nodos_maestro
             ORDER BY id ASC`
        );
        console.log('Resultado migración Paraíso:', JSON.stringify(resultado, null, 2));
        console.log('Estado nodos_maestro:', JSON.stringify(check.rows, null, 2));
        process.exit(0);
    } catch (err) {
        console.error('Error ejecutando migrarNodoParaiso:', err);
        process.exit(1);
    }
})();
