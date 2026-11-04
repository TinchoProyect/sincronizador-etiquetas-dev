const { pool } = require('../config/database');
const BunkerService = require('../services/bunkerService');

async function compareCalculatorVsBudget() {
    console.log('================================================================================');
    console.log('🔍 COMPARATIVA RIGUROSA: CALCULADORA BÚNKER VS PRESUPUESTO CLIENTE 533 (CRUSALVA)');
    console.log('================================================================================\n');

    try {
        // 1. Obtener Presupuesto 8234633
        const resPres = await pool.query('SELECT id, id_cliente, usar_precios_bunker, descuento FROM public.presupuestos WHERE id = 8234633');
        const pres = resPres.rows[0];

        const resDet = await pool.query('SELECT articulo, cantidad, precio1, valor1, iva1 FROM public.presupuestos_detalles WHERE id_presupuesto = 8234633');

        console.log(`📋 PRESUPUESTO #${pres.id} (Cliente ID: ${pres.id_cliente}):`);
        console.log(`   - Precios Búnker Activo: ${pres.usar_precios_bunker}`);
        console.log(`   - Descuento Global: ${pres.descuento}%\n`);

        // 2. Obtener datos de la Calculadora de Precios y Ofertas Búnker para ambos artículos
        const pj10Finanzas = await BunkerService.obtenerRadiografiaFinanciera(pool, 'PJx10');
        const pj10Lista5 = pj10Finanzas.listas_margenes.find(m => m.lista_id === 5);

        const gdfFinanzas = await BunkerService.obtenerRadiografiaFinanciera(pool, 'GDF5X500G');
        const gdfLista5 = gdfFinanzas.listas_margenes.find(m => m.lista_id === 5);

        console.log('--------------------------------------------------------------------------------');
        console.log('1. CALCULADORA DE PRECIOS Y OFERTAS BÚNKER (LISTA DIETÉTICA - LISTA_ID: 5)');
        console.log('--------------------------------------------------------------------------------');
        console.log(`  A) Pasas de Uva Jumbo x 10kg (PJx10):`);
        console.log(`     - Precio Final con IVA: $${parseFloat(pj10Lista5.precio_final).toFixed(2)}`);
        console.log(`     - Precio Neto sin IVA: $${(parseFloat(pj10Lista5.precio_final)/1.21).toFixed(2)}`);
        console.log(`     - Costo Operativo Bulto: $${parseFloat(pj10Lista5.costo_operativo).toFixed(2)}`);
        console.log(`     - GANANCIA REAL BÚNKER: $${parseFloat(pj10Lista5.ganancia_real).toFixed(2)}`);

        console.log(`\n  B) GRANA Flor 5 x 500g (GDF5X500G):`);
        console.log(`     - Precio Final con IVA: $${parseFloat(gdfLista5.precio_final).toFixed(2)}`);
        console.log(`     - Precio Neto sin IVA: $${(parseFloat(gdfLista5.precio_final)/1.21).toFixed(2)}`);
        console.log(`     - Costo Operativo Bulto: $${parseFloat(gdfLista5.costo_operativo).toFixed(2)}`);
        console.log(`     - GANANCIA REAL BÚNKER: $${parseFloat(gdfLista5.ganancia_real).toFixed(2)}`);

        const sumaGananciaRealCalculadora = parseFloat(pj10Lista5.ganancia_real) + parseFloat(gdfLista5.ganancia_real);
        console.log('\n--------------------------------------------------------------------------------');
        console.log(`➡️ SUMA TOTAL GANANCIA REAL EN CALCULADORA BÚNKER: $${sumaGananciaRealCalculadora.toFixed(2)}`);
        console.log('--------------------------------------------------------------------------------\n');

        // 3. Obtener el cálculo del Presupuesto
        console.log('--------------------------------------------------------------------------------');
        console.log('2. RENTABILIDAD ESTIMADA BÚNKER EN EL PRESUPUESTO (FILAS DE EDICIÓN)');
        console.log('--------------------------------------------------------------------------------');

        let sumaGananciaPresupuesto = 0;
        const pctDesc = parseFloat(pres.descuento || 0);

        for (const item of resDet.rows) {
            const isPasa = String(item.articulo).includes('5349211857') || String(item.articulo).includes('PJ');
            const fin = isPasa ? pj10Lista5 : gdfLista5;
            const cant = parseFloat(item.cantidad) || 1;
            const pvuActual = parseFloat(item.precio1 || item.valor1 || fin.precio_final);

            const pvuConDesc = pvuActual * (1 - pctDesc / 100);
            const ivaRate = parseFloat(item.iva1 || 21);
            const netoConDesc = pvuConDesc / (1 + ivaRate / 100);
            const costoOp = parseFloat(fin.costo_operativo);

            const iibb = pvuConDesc * 0.04;
            const ivaVenta = netoConDesc * (ivaRate / 100);
            const ivaCompra = (costoOp - parseFloat(isPasa ? pj10Finanzas.costo_tiempo || 0 : gdfFinanzas.costo_tiempo || 0)) * 0.21;
            const difIva = Math.max(0, ivaVenta - ivaCompra);

            const ganUnitFila = netoConDesc - costoOp - iibb - difIva;
            const ganFila = ganUnitFila * cant;
            sumaGananciaPresupuesto += ganFila;

            console.log(`  Row ${item.articulo}:`);
            console.log(`     - Cantidad: ${cant}`);
            console.log(`     - Precio Fila (con IVA): $${pvuActual.toFixed(2)}`);
            console.log(`     - Ganancia Real Unitaria Fila: $${ganUnitFila.toFixed(2)}`);
            console.log(`     - Ganancia Total Fila: $${ganFila.toFixed(2)}`);
        }

        console.log('\n--------------------------------------------------------------------------------');
        console.log(`➡️ TOTAL RENTABILIDAD ESTIMADA MOSTRADA EN PRESUPUESTO: $${sumaGananciaPresupuesto.toFixed(2)}`);
        console.log('--------------------------------------------------------------------------------\n');

        console.log('================================================================================');
        console.log(`DIFERENCIA ENTRE CALCULADORA Y PRESUPUESTO: $${Math.abs(sumaGananciaRealCalculadora - sumaGananciaPresupuesto).toFixed(2)}`);
        console.log('================================================================================');

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

compareCalculatorVsBudget();
