const { pool } = require('../config/database');
const BunkerService = require('../services/bunkerService');

async function verifyAllListsDeterminism() {
    console.log('================================================================================');
    console.log('🔍 VERIFICACIÓN DE DETERMINISMO EN TODAS LAS LISTAS DE PRECIOS BÚNKER (LISTAS 1 A 7)');
    console.log('================================================================================\n');

    try {
        const testArticles = ['PJx10', 'GDF5X500G', 'HNx5', 'MFX18'];

        for (const artId of testArticles) {
            const fin = await BunkerService.obtenerRadiografiaFinanciera(pool, artId);
            console.log(`📌 Artículo: ${fin.articulo_id} (Kilos: ${fin.kilos_unidad}kg, Pack: ${fin.pack_unidades}u)`);

            for (const list of fin.listas_margenes) {
                console.log(`   - Lista ID ${list.lista_id} (${list.nombre_lista}): Precio Final $${parseFloat(list.precio_final).toFixed(2)} | Costo Op: $${parseFloat(list.costo_operativo).toFixed(2)} | Ganancia Real: $${parseFloat(list.ganancia_real).toFixed(2)}`);
            }
            console.log('');
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

verifyAllListsDeterminism();
