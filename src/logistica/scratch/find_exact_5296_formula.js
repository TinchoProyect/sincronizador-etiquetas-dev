const { pool } = require('../config/database');

async function findExact5296Formula() {
    console.log('================================================================================');
    console.log('🔍 BÚSQUEDA DE LA FORMULA EXACTA QUE PRODUCE 5296.32');
    console.log('================================================================================\n');

    try {
        const precioFinal = 39607.33; // Precio final con IVA de Lista 5 Dietética
        const ivaRate = 21;
        const precioNeto = precioFinal / (1 + ivaRate / 100); // 32733.3306

        // Probemos combinaciones de costo de bulto o costo por unidad
        // 1. Si costo_base es $26.000,00 (costo bulto)
        // 2. Si costo_base es $26.000,00 (costo por kilo -> 26000 * 2.5 = 65000)
        // 3. Si costo_base se calcula con insumos o rendimiento
        // 4. Si el margen es 25% sobre costo neto

        // Ecuación oficial finanzas Búnker:
        // ganancia_real = (precioNeto - costoTiempo - costoBulto) - IIBB - Math.max(0, ivaVenta - ivaCompra)

        const testCosts = [
            { name: 'bunker_articulos.costo_base directo', cost: 26000.00 },
            { name: 'costo_base_sobrescrito', cost: 15639.74 },
            { name: 'costo 23728.34', cost: 23728.34 },
            { name: 'costo 23495.00', cost: 23495.00 },
            { name: 'costo 23500.00', cost: 23500.00 },
            { name: 'costo 22000.00', cost: 22000.00 },
            { name: 'costo 25000.00', cost: 25000.00 },
            { name: 'costo 23900.00', cost: 23900.00 }
        ];

        for (const tc of testCosts) {
            const costoBulto = tc.cost;
            const costoTiempo = 233.33;
            const costoTotal = costoBulto + costoTiempo;

            const iibb = precioFinal * 0.04; // 1584.2932
            const gananciaNeta = precioNeto - costoTiempo - costoBulto;
            const gananciaSinIIBB = gananciaNeta - iibb;

            const ivaVenta = precioNeto * 0.21; // 6874.00
            const ivaCompra = costoBulto * 0.21;
            const diferenciaIva = Math.max(0, ivaVenta - ivaCompra);

            const gananciaReal = gananciaSinIIBB - diferenciaIva;

            console.log(`Variante [${tc.name}] (Costo Bulto: $${costoBulto.toFixed(2)}):`);
            console.log(`   - Ganancia Real: $${gananciaReal.toFixed(2)} | (Diff vs 5296.32: $${(gananciaReal - 5296.32).toFixed(2)})`);
        }

        // Probar también si el precio final no es $39.607,33 sino precio final de la bolsa individual o de otra lista (ej. Lista 1, Lista 2, Lista 3, Lista 7)
        console.log('\n--------------------------------------------------------------------------------');
        console.log('Evaluación de la Ganancia Real en OTRAS listas de precios para GDF5X500G:');
        console.log('--------------------------------------------------------------------------------');

        const resAllLists = await pool.query(`
            SELECT lista_id, precio_final, costo_base_sobrescrito, costo_tiempo, margen_ganancia
            FROM public.bunker_lista_articulos
            WHERE articulo_numero = 'GDF5X500G'
            ORDER BY lista_id ASC
        `);

        for (const l of resAllLists.rows) {
            const pFinal = parseFloat(l.precio_final);
            const pNeto = pFinal / 1.21;
            const cBulto15k = 15639.74;
            const cBulto26k = 26000.00;
            const cTiempo = parseFloat(l.costo_tiempo || 0);

            // Con cBulto 15k
            const iibb15 = pFinal * 0.04;
            const gSinIibb15 = (pNeto - cTiempo - cBulto15k) - iibb15;
            const difIva15 = Math.max(0, (pNeto * 0.21) - (cBulto15k * 0.21));
            const gReal15 = gSinIibb15 - difIva15;

            // Con cBulto 26k
            const iibb26 = pFinal * 0.04;
            const gSinIibb26 = (pNeto - cTiempo - cBulto26k) - iibb26;
            const difIva26 = Math.max(0, (pNeto * 0.21) - (cBulto26k * 0.21));
            const gReal26 = gSinIibb26 - difIva26;

            console.log(`Lista ID ${l.lista_id} (Precio Final $${pFinal.toFixed(2)}):`);
            console.log(`   - Ganancia Real con Costo $15.639,74: $${gReal15.toFixed(2)}`);
            console.log(`   - Ganancia Real con Costo $26.000,00: $${gReal26.toFixed(2)}`);
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

findExact5296Formula();
