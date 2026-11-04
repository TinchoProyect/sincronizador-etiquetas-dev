const { pool } = require('../config/database');
const BunkerService = require('../services/bunkerService');

async function simulateGranadaUI() {
    console.log('================================================================================');
    console.log('🔍 SIMULACIÓN EXACTA DE /api/logistica/bunker/finanzas/GDF5X500G');
    console.log('================================================================================\n');

    try {
        const finanzas = await BunkerService.obtenerRadiografiaFinanciera(pool, 'GDF5X500G');
        
        console.log('1. Propiedades Raíz devueltas por API finanzas:');
        console.log({
            articulo_id: finanzas.articulo_id,
            kilos_unidad: finanzas.kilos_unidad,
            pack_unidades: finanzas.pack_unidades,
            costo_kilo_base: finanzas.costo_kilo_base,
            costo_bulto_calculado: finanzas.costo_bulto_calculado,
            costo_total_calculado: finanzas.costo_total_calculado,
            costo_unidades: finanzas.costo_unidades,
            costo_ingrediente_vivo: finanzas.costo_ingrediente_vivo,
            receta_ingredientes: finanzas.receta_ingredientes
        });

        console.log('\n2. Desglose de cada Lista de Precios en listas_margenes:');
        console.table(finanzas.listas_margenes.map(l => ({
            lista_id: l.lista_id,
            precio_final: l.precio_final,
            costo_base_sobrescrito: l.costo_base_sobrescrito,
            costo_operativo: l.costo_operativo,
            ganancia_real: l.ganancia_real,
            margen_ganancia: l.margen_ganancia
        })));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

simulateGranadaUI();
