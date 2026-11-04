const { pool } = require('../config/database');
const BunkerService = require('../services/bunkerService');

async function diagnoseExactFinanceNumbers() {
    console.log('=== DIAGNÓSTICO EXACTO DE NÚMEROS DE FINANZAS BÚNKER (LISTA 5 - DIETÉTICA) ===\n');

    try {
        const items = [
            { name: 'Granada 5 x 500g', code: '76328500', sku: 'GDF5X500G' },
            { name: 'Pasa Jumbo x 10kg', code: '5349211857', sku: 'PJx10' }
        ];

        for (const item of items) {
            console.log(`================================================================================`);
            console.log(`📌 ARTÍCULO: ${item.name} (${item.code} / ${item.sku})`);
            console.log(`================================================================================`);

            const finanzas = await BunkerService.obtenerRadiografiaFinanciera(pool, item.sku);
            const lista5 = finanzas.listas_margenes.find(m => m.lista_id === 5);

            console.log('Radiografía Financiera Completa:', {
                articulo_id: finanzas.articulo_id,
                kilos_unidad: finanzas.kilos_unidad,
                pack_unidades: finanzas.pack_unidades,
                costo_kilo_base: finanzas.costo_kilo_base,
                costo_bulto_calculado: finanzas.costo_bulto_calculado,
                costo_total_calculado: finanzas.costo_total_calculado,
                costo_unidades: finanzas.costo_unidades
            });

            console.log('\nValores Lista 5 (Dietética):', {
                precio_final: lista5?.precio_final,
                neto: lista5?.precio_final ? (parseFloat(lista5.precio_final) / 1.21).toFixed(2) : 0,
                costo_base_sobrescrito: lista5?.costo_base_sobrescrito,
                costo_operativo: lista5?.costo_operativo,
                ganancia_real: lista5?.ganancia_real,
                margen_porcentaje: lista5?.margen_porcentaje
            });
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

diagnoseExactFinanceNumbers();
