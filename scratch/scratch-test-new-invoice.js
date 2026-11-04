const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

const facturaService = require('../src/facturacion/services/facturaService');

async function getStock(articuloNumero) {
    const res = await pool.query(
        `SELECT stock_consolidado, stock_movimientos FROM stock_real_consolidado WHERE articulo_numero = $1`,
        [articuloNumero]
    );
    return res.rows[0];
}

async function run() {
    console.log('🧪 INICIANDO TEST DE NUEVA FACTURA Y NOTA DE CRÉDITO');
    console.log('===================================================');

    const artTest = 'PJx10'; // Pasa/Jumbo x 10

    try {
        // 1. Obtener stock inicial
        const stockInicial = await getStock(artTest);
        console.log(`📊 Stock inicial de ${artTest}:`, stockInicial);

        // 2. Crear una factura de prueba en borrador
        console.log('\n📝 Creando borrador de Factura de prueba...');
        const datosFactura = {
            tipo_cbte: 1, // Factura A (usaremos emisión interna por simplicidad)
            pto_vta: 32,
            concepto: 1,
            cliente: {
                cliente_id: 1,
                doc_tipo: 80,
                doc_nro: '30123456789',
                condicion_iva_id: 1
            },
            moneda: 'PES',
            mon_cotiz: 1,
            requiere_afip: false, // Emisión Interna
            serie_interna: 'TEST',
            precio_modo: 'NETO',
            items: [
                {
                    descripcion: 'Pasa/Jumbo x 10', // Nombre exacto del artículo para que resuelva
                    qty: 2,
                    p_unit: 45120,
                    alic_iva_id: 1 // 21% IVA (codigo_afip: 5)
                }
            ]
        };

        const facturaBorrador = await facturaService.crearBorrador(datosFactura);
        console.log(`✅ Factura borrador creada con ID: ${facturaBorrador.id}`);

        // 3. Emitir factura interna (esto debe activar nuestro hook y reducir stock en 2 unidades)
        console.log('\n📤 Emitiendo factura de prueba...');
        const facturaEmitida = await facturaService.emitir(facturaBorrador.id);
        console.log(`✅ Factura emitida con éxito. Estado: ${facturaEmitida.estado} | Nro Interno: ${facturaEmitida.nro_interno}`);

        // 4. Verificar stock después de emitir factura
        const stockDespuesFactura = await getStock(artTest);
        console.log(`📊 Stock de ${artTest} después de Factura:`, stockDespuesFactura);

        const diffFactura = parseFloat(stockInicial.stock_consolidado) - parseFloat(stockDespuesFactura.stock_consolidado);
        console.log(`📉 Diferencia esperada: -2 | Obtenida: ${-diffFactura}`);
        if (diffFactura === 2) {
            console.log('✅ FACTURA: Descuento de stock verificado correctamente!');
        } else {
            throw new Error(`FACTURA: Falló el descuento de stock! Esperaba decremento de 2, obtuvo: ${diffFactura}`);
        }

        // 5. Crear Nota de Crédito asociada para anular la factura
        console.log('\n📝 Creando borrador de Nota de Crédito...');
        const datosNC = {
            tipo_cbte: 3, // Nota de Crédito A
            pto_vta: 32,
            concepto: 1,
            cliente: {
                cliente_id: 1,
                doc_tipo: 80,
                doc_nro: '30123456789',
                condicion_iva_id: 1
            },
            moneda: 'PES',
            mon_cotiz: 1,
            requiere_afip: false, // Emisión Interna
            serie_interna: 'TEST-NC',
            precio_modo: 'NETO',
            factura_asociada_id: facturaEmitida.id,
            items: [
                {
                    descripcion: 'Pasa/Jumbo x 10',
                    qty: 2,
                    p_unit: 45120,
                    alic_iva_id: 1 // 21% IVA
                }
            ]
        };

        const ncBorrador = await facturaService.crearBorrador(datosNC);
        console.log(`✅ Nota de Crédito borrador creada con ID: ${ncBorrador.id}`);

        // 6. Emitir Nota de Crédito (esto debe activar nuestro hook e incrementar stock en 2 unidades)
        console.log('\n📤 Emitiendo Nota de Crédito...');
        const ncEmitida = await facturaService.emitir(ncBorrador.id);
        console.log(`✅ Nota de Crédito emitida con éxito. Estado: ${ncEmitida.estado} | Nro Interno: ${ncEmitida.nro_interno}`);

        // 7. Verificar stock después de emitir Nota de Crédito
        const stockFinal = await getStock(artTest);
        console.log(`📊 Stock de ${artTest} final (después de NC):`, stockFinal);

        const diffNC = parseFloat(stockFinal.stock_consolidado) - parseFloat(stockDespuesFactura.stock_consolidado);
        console.log(`📈 Diferencia esperada: +2 | Obtenida: ${diffNC}`);
        if (diffNC === 2) {
            console.log('✅ NOTA DE CRÉDITO: Incremento de stock verificado correctamente!');
        } else {
            throw new Error(`NOTA DE CRÉDITO: Falló el incremento de stock! Esperaba incremento de 2, obtuvo: ${diffNC}`);
        }

        // 8. Limpiar registros de prueba creados para no dejar basura en la base de datos
        console.log('\n%c🧹 Limpiando registros de prueba...', 'color: yellow');
        await pool.query('DELETE FROM stock_ventas_movimientos WHERE observaciones LIKE $1', ['%TEST%']);
        
        // Revertir manualmente el stock_movimientos en stock_real_consolidado a sus valores iniciales si es necesario, 
        // pero como la NC y la Factura se compensaron, stock_movimientos ya regresó a su valor inicial!
        // Solo eliminamos los borradores/comprobantes de prueba
        await pool.query('DELETE FROM factura_factura_items WHERE factura_id IN ($1, $2)', [facturaEmitida.id, ncEmitida.id]);
        await pool.query('DELETE FROM factura_facturas WHERE id IN ($1, $2)', [facturaEmitida.id, ncEmitida.id]);
        
        console.log('✅ Limpieza completada con éxito.');
        console.log('\n🎉 TODOS LOS TESTS PASARON EXITOSAMENTE!');

    } catch (e) {
        console.error('\n❌ ERROR DURANTE LOS TESTS:', e);
    } finally {
        await pool.end();
    }
}

run();
