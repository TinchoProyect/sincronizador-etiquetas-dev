const { pool } = require('./src/facturacion/config/database');

async function testearFacturaConDescuento() {
    try {
        console.log('🧪 Testing factura con descuento...\n');
        
        // 1. Buscar un presupuesto que tenga descuento
        console.log('1️⃣ Buscando presupuesto con descuento...');
        const presupuestosConDescuento = await pool.query(`
            SELECT id, id_presupuesto_ext, descuento, factura_id
            FROM presupuestos
            WHERE descuento > 0
            AND factura_id IS NULL
            ORDER BY id DESC
            LIMIT 5
        `);
        
        if (presupuestosConDescuento.rows.length === 0) {
            console.log('⚠️  No hay presupuestos con descuento sin facturar');
            console.log('   Creando presupuesto de prueba con descuento...');
            
            // Crear presupuesto de prueba con descuento
            const nuevoPresu = await pool.query(`
                INSERT INTO presupuestos (
                    id_presupuesto_ext, id_cliente, fecha, descuento, estado, activo
                ) VALUES (
                    'TEST-DESC-001', '1', CURRENT_DATE, 0.10, 'APROBADO', true
                ) RETURNING id, descuento
            `);
            
            const presuId = nuevoPresu.rows[0].id;
            console.log(`✅ Presupuesto creado: ID ${presuId}, Descuento: ${nuevoPresu.rows[0].descuento}`);
            
            // Agregar items al presupuesto
            await pool.query(`
                INSERT INTO presupuestos_detalles (
                    id_presupuesto, articulo, cantidad, valor1, camp2
                ) VALUES 
                ($1, 'Producto Test A', 10, 100.00, 0.210),
                ($1, 'Producto Test B', 5, 50.00, 0.105)
            `, [presuId]);
            
            console.log('✅ Items agregados al presupuesto\n');
            
            // Usar este presupuesto para la prueba
            presupuestosConDescuento.rows = [{
                id: presuId,
                id_presupuesto_ext: 'TEST-DESC-001',
                descuento: 0.10,
                factura_id: null
            }];
        }
        
        const presupuesto = presupuestosConDescuento.rows[0];
        console.log(`✅ Presupuesto encontrado:`);
        console.log(`   ID: ${presupuesto.id}`);
        console.log(`   Ext: ${presupuesto.id_presupuesto_ext}`);
        console.log(`   Descuento: ${presupuesto.descuento} (${(presupuesto.descuento * 100).toFixed(2)}%)\n`);
        
        // 2. Verificar que el presupuesto tiene items
        console.log('2️⃣ Verificando items del presupuesto...');
        const items = await pool.query(`
            SELECT * FROM presupuestos_detalles
            WHERE id_presupuesto = $1
        `, [presupuesto.id]);
        
        if (items.rows.length === 0) {
            throw new Error('El presupuesto no tiene items');
        }
        
        console.log(`✅ ${items.rows.length} items encontrados\n`);
        
        // 3. Crear factura desde el presupuesto
        console.log('3️⃣ Creando factura desde presupuesto...');
        const { facturarPresupuesto } = require('./src/facturacion/services/presupuestoFacturaService');
        
        const resultado = await facturarPresupuesto(presupuesto.id);
        console.log(`✅ Factura creada: ID ${resultado.facturaId}\n`);
        
        // 4. Verificar que la factura tiene el descuento guardado
        console.log('4️⃣ Verificando descuento en factura...');
        const facturaCreada = await pool.query(`
            SELECT id, descuento, imp_neto, imp_iva, imp_total
            FROM factura_facturas
            WHERE id = $1
        `, [resultado.facturaId]);
        
        const factura = facturaCreada.rows[0];
        console.log(`✅ Factura verificada:`);
        console.log(`   ID: ${factura.id}`);
        console.log(`   Descuento: ${factura.descuento} (${(parseFloat(factura.descuento) * 100).toFixed(2)}%)`);
        console.log(`   Neto: $${parseFloat(factura.imp_neto).toFixed(2)}`);
        console.log(`   IVA: $${parseFloat(factura.imp_iva).toFixed(2)}`);
        console.log(`   Total: $${parseFloat(factura.imp_total).toFixed(2)}\n`);
        
        // 5. Verificar items de la factura
        console.log('5️⃣ Verificando items de la factura...');
        const itemsFactura = await pool.query(`
            SELECT * FROM factura_factura_items
            WHERE factura_id = $1
            ORDER BY orden
        `, [resultado.facturaId]);
        
        console.log(`✅ ${itemsFactura.rows.length} items en la factura:`);
        itemsFactura.rows.forEach(item => {
            console.log(`   - ${item.descripcion}`);
            console.log(`     Qty: ${item.qty}, P.Unit: $${parseFloat(item.p_unit).toFixed(2)}`);
            console.log(`     Neto: $${parseFloat(item.imp_neto).toFixed(2)}, IVA: $${parseFloat(item.imp_iva).toFixed(2)}`);
        });
        
        console.log('\n' + '='.repeat(60));
        console.log('🎉 PRUEBA COMPLETADA');
        console.log('='.repeat(60));
        console.log(`\n📄 Para ver la factura en el navegador:`);
        console.log(`   http://localhost:3004/facturacion/ver-factura.html?id=${resultado.facturaId}`);
        console.log(`\n💡 El descuento debería mostrarse en la UI y en el PDF`);
        
        await pool.end();
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
        await pool.end();
        process.exit(1);
    }
}

testearFacturaConDescuento();
