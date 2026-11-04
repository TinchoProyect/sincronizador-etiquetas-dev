const { pool } = require('../config/database');
const BunkerService = require('../services/bunkerService');

async function find49Discrepancy() {
    console.log('================================================================================');
    console.log('🔍 AUDITORÍA FORENSE DE LA DISCREPANCIA DE $49,00 (10.811,62 VS 10.762,62)');
    console.log('================================================================================\n');

    try {
        // 1. Obtener la radiografía financiera backend de bunkerService.js
        const pj10Finanzas = await BunkerService.obtenerRadiografiaFinanciera(pool, 'PJx10');
        const pj10Lista5 = pj10Finanzas.listas_margenes.find(m => m.lista_id === 5);

        const gdfFinanzas = await BunkerService.obtenerRadiografiaFinanciera(pool, 'GDF5X500G');
        const gdfLista5 = gdfFinanzas.listas_margenes.find(m => m.lista_id === 5);

        console.log('1. Radiografía Backend bunkerService.js:');
        console.log(`   - Pasa Jumbo Ganancia Real: $${pj10Lista5.ganancia_real} (Costo Operativo: $${pj10Lista5.costo_operativo})`);
        console.log(`   - Granada Ganancia Real: $${gdfLista5.ganancia_real} (Costo Operativo: $${gdfLista5.costo_operativo})`);
        console.log(`   - Suma Backend: $${(pj10Lista5.ganancia_real + gdfLista5.ganancia_real).toFixed(2)}\n`);

        // 2. Simulación de la fórmula de detalles-common.js (en el frontend)
        // En detalles-common.js:
        // pvu = 60348.7500 para Pasa Jumbo, y 39607.3293 para Granada
        const pvuPasa = parseFloat(pj10Lista5.precio_final); // 60348.75
        const costoPasa = parseFloat(pj10Lista5.costo_operativo); // 39900

        const pvuGranada = parseFloat(gdfLista5.precio_final); // 39607.3293
        const costoGranada = parseFloat(gdfLista5.costo_operativo); // 23961.67

        const pct = 0; // 0% descuento

        // Pasa Jumbo en detalles-common.js:
        const pvuConDescPasa = pvuPasa * (1 - pct / 100);
        const ivaValPasa = 21;
        const netoConDescPasa = pvuConDescPasa / (1 + (ivaValPasa / 100)); // 49875.00
        const iibbPasa = pvuConDescPasa * 0.04; // 2413.95
        const ivaVentaPasa = netoConDescPasa * (ivaValPasa / 100); // 10473.75
        const ivaCompraPasa = costoPasa * 0.21; // 8379.00
        const difIvaPasa = Math.max(0, ivaVentaPasa - ivaCompraPasa); // 2094.75
        const gananciaFilaPasa = netoConDescPasa - costoPasa - iibbPasa - difIvaPasa; // 5466.30

        // Granada en detalles-common.js:
        const pvuConDescGranada = pvuGranada * (1 - pct / 100);
        const ivaValGranada = 21;
        const netoConDescGranada = pvuConDescGranada / (1 + (ivaValGranada / 100)); // 32733.33
        const iibbGranada = pvuConDescGranada * 0.04; // 1584.293172
        const ivaVentaGranada = netoConDescGranada * (ivaValGranada / 100); // 6874.00
        const ivaCompraGranada = costoGranada * 0.21; // 5031.9507
        const difIvaGranada = Math.max(0, ivaVentaGranada - ivaCompraGranada); // 1842.0493
        const gananciaFilaGranada = netoConDescGranada - costoGranada - iibbGranada - difIvaGranada;

        console.log('2. Simulación detalles-common.js:');
        console.log(`   - ivaCompraPasa: $${ivaCompraPasa.toFixed(2)} | difIvaPasa: $${difIvaPasa.toFixed(2)} | gananciaPasa: $${gananciaFilaPasa.toFixed(2)}`);
        console.log(`   - ivaCompraGranada: $${ivaCompraGranada.toFixed(2)} | difIvaGranada: $${difIvaGranada.toFixed(2)} | gananciaGranada: $${gananciaFilaGranada.toFixed(2)}`);

        // ATENCIÓN: En bunkerService.js, ivaCompra se calcula sobre costoBulto (sin sumar costoTiempo):
        // ivaCompra = costoBulto * 0.21
        // Mientras que en detalles-common.js, costoOperativoUnit incluía costoBulto + costoTiempo!
        // Al multiplicar costoOperativoUnit * 0.21 en detalles-common.js, se multiplicaba (costoBulto + costoTiempo) * 0.21!
        // Y el IVA sobre el costoTiempo ($233,33 * 0.21 = $49,00)!
        const ivaSobreManoObra = 233.33 * 0.21;
        console.log(`\n💡 ¡HALLAZGO FORENSE CRÍTICO! IVA sobre Mano de Obra ($233.33 * 0.21) = $${ivaSobreManoObra.toFixed(2)}!`);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

find49Discrepancy();
