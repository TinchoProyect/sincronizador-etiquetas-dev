const { pool } = require('../config/database');
const BunkerService = require('../services/bunkerService');

async function checkSingleBag() {
    console.log('================================================================================');
    console.log('🔍 AUDITORÍA DEL ARTÍCULO HIJO FRACCIONADO (GDFX500G - Granola 500g)');
    console.log('================================================================================\n');

    try {
        const finanzas = await BunkerService.obtenerRadiografiaFinanciera(pool, 'GDFX500G');
        const lista5 = finanzas.listas_margenes.find(m => m.lista_id === 5);

        console.log('Radiografía Financiera de GDFX500G (Bolsa 500g single):', {
            articulo_id: finanzas.articulo_id,
            kilos_unidad: finanzas.kilos_unidad,
            precio_final_lista5: lista5?.precio_final,
            costo_base_sobrescrito: lista5?.costo_base_sobrescrito,
            costo_operativo: lista5?.costo_operativo,
            ganancia_real: lista5?.ganancia_real
        });

        // Si se multiplica la ganancia real de la bolsa individual de 500g por 5 unidades:
        const ganancia5unidades = (lista5?.ganancia_real || 0) * 5;
        console.log(`\n💡 Ganancia Real de 1 bolsa x 5 unidades: $${ganancia5unidades.toFixed(2)}`);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkSingleBag();
