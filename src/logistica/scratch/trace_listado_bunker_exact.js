const { pool } = require('../config/database');
const BunkerService = require('../services/bunkerService');

async function traceListadoBunkerExact() {
    console.log('================================================================================');
    console.log('🔍 TRACE EXACTO DEL CÁLCULO DE GESTOR BÚNKER (listado-bunker.js) PARA GRANADA 5x500');
    console.log('================================================================================\n');

    try {
        const finanzas = await BunkerService.obtenerRadiografiaFinanciera(pool, 'GDF5X500G');
        const list5 = finanzas.listas_margenes.find(m => m.lista_id === 5);

        console.log('1. Datos devueltos por finanzas para Lista 5:', list5);

        // En listado-bunker.js:
        const precioFinalBase = parseFloat(list5.precio_final || 0); // 39607.3293
        const ivaVal = parseFloat(list5.iva || 21); // 21
        const ivaCoeff = 1 + (ivaVal / 100);
        const precioS_ivaDescontado = precioFinalBase / ivaCoeff; // 32733.33

        // cBase en listado-bunker.js:
        // En listado-bunker.js, para un artículo fraccionado con pack_hijo, ¿cómo se evalúa cBase o cBulto?
        // cBase es el costo por kilo o el costo del ingrediente en vivo:
        const costoKilo = parseFloat(finanzas.costo_kilo_base || finanzas.costo_ingrediente_vivo || 10400); 
        const factor = parseFloat(finanzas.kilos_unidad || 2.5);

        // Si cBase es costoKilo * factor:
        const cBultoHeredado = costoKilo * factor; // 26000.00
        const cTiempo = parseFloat(list5.costo_tiempo || 233.33);

        const iibb = precioFinalBase * 0.04; // 1584.293
        const gananciaNetaHeredada = precioS_ivaDescontado - cTiempo - cBultoHeredado; // 32733.33 - 233.33 - 26000 = 6500.00
        const gananciaSinIIBBHeredada = gananciaNetaHeredada - iibb; // 6500 - 1584.293 = 4915.707

        const ivaVenta = precioS_ivaDescontado * (ivaVal / 100); // 6874.00
        const ivaCompra = cBultoHeredado * 0.21; // 5460.00
        const diferenciaIva = Math.max(0, ivaVenta - ivaCompra); // 1414.00

        const gananciaRealHeredada = gananciaSinIIBBHeredada - diferenciaIva; // 4915.707 - 1414.00 = 3501.707

        console.log('\n2. Cálculo de Ganancia Real con cBulto = $26.000,00 (Costo Base Sin Sobrescribir):');
        console.log(`   - Precio Final (con IVA): $${precioFinalBase.toFixed(2)}`);
        console.log(`   - Precio Neto (sin IVA): $${precioS_ivaDescontado.toFixed(2)}`);
        console.log(`   - Costo Bulto Base: $${cBultoHeredado.toFixed(2)}`);
        console.log(`   - Costo Tiempo/Mano Obra: $${cTiempo.toFixed(2)}`);
        console.log(`   - IIBB (4%): $${iibb.toFixed(2)}`);
        console.log(`   - Diferencia IVA Rendir: $${diferenciaIva.toFixed(2)}`);
        console.log(`   - GANANCIA REAL: $${gananciaRealHeredada.toFixed(2)}`);

        // Ahora probemos con costo_base_sobrescrito = 26000 / 1.21 o 20000 o 22000
        // ¿Qué costo da exactamente 5.296,32?
        // Ecuación: 32733.33 - cBulto - 233.33 - 1584.29 - (6874 - cBulto * 0.21) = 5296.32
        // => 32733.33 - 233.33 - 1584.29 - 6874 + (cBulto * 0.21 - cBulto) = 5296.32
        // => 24041.71 - 0.79 * cBulto = 5296.32
        // => 0.79 * cBulto = 24041.71 - 5296.32 = 18745.39
        // => cBulto = 18745.39 / 0.79 = 23728.34!

        console.log('\n3. Inversión Matemática para obtener $5.296,32 de Ganancia Real:');
        const cBultoQueDa5296 = (24041.71 - 5296.32) / 0.79;
        console.log(`   - Costo Bulto exacto necesario: $${cBultoQueDa5296.toFixed(2)}`);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

traceListadoBunkerExact();
