const { pool } = require('./src/facturacion/config/database');

async function verificarAlicuotas() {
    try {
        console.log('🔍 Verificando alícuotas de IVA...\n');
        
        // 1. Ver alícuotas existentes
        const existentes = await pool.query(`
            SELECT * FROM factura_iva_alicuotas
            ORDER BY codigo_afip
        `);
        
        console.log('📋 Alícuotas existentes:');
        existentes.rows.forEach(row => {
            console.log(`   - Código AFIP: ${row.codigo_afip}, Porcentaje: ${row.porcentaje}%, Descripción: ${row.descripcion}`);
        });
        
        // 2. Alícuotas necesarias según AFIP
        const alicuotasNecesarias = [
            { codigo_afip: 3, porcentaje: 0.00, descripcion: 'No Gravado / Exento' },
            { codigo_afip: 4, porcentaje: 10.50, descripcion: 'IVA 10.5%' },
            { codigo_afip: 5, porcentaje: 21.00, descripcion: 'IVA 21%' },
            { codigo_afip: 6, porcentaje: 27.00, descripcion: 'IVA 27%' },
            { codigo_afip: 8, porcentaje: 5.00, descripcion: 'IVA 5%' },
            { codigo_afip: 9, porcentaje: 2.50, descripcion: 'IVA 2.5%' }
        ];
        
        // 3. Verificar cuáles faltan
        const codigosExistentes = new Set(existentes.rows.map(r => r.codigo_afip));
        const faltantes = alicuotasNecesarias.filter(a => !codigosExistentes.has(a.codigo_afip));
        
        if (faltantes.length === 0) {
            console.log('\n✅ Todas las alícuotas necesarias están presentes');
        } else {
            console.log(`\n⚠️  Faltan ${faltantes.length} alícuotas:`);
            faltantes.forEach(a => {
                console.log(`   - Código ${a.codigo_afip}: ${a.descripcion}`);
            });
            
            // 4. Agregar faltantes (buscar próximo ID)
            console.log('\n🔧 Agregando alícuotas faltantes...');
            const maxIdResult = await pool.query('SELECT COALESCE(MAX(id), 0) as max_id FROM factura_iva_alicuotas');
            let nextId = maxIdResult.rows[0].max_id + 1;
            
            for (const alic of faltantes) {
                try {
                    await pool.query(`
                        INSERT INTO factura_iva_alicuotas (id, codigo_afip, porcentaje, descripcion)
                        VALUES ($1, $2, $3, $4)
                    `, [nextId, alic.codigo_afip, alic.porcentaje, alic.descripcion]);
                    
                    console.log(`✅ Agregada: Código ${alic.codigo_afip} - ${alic.descripcion}`);
                    nextId++;
                } catch (err) {
                    if (err.code === '23505') { // Duplicate key
                        console.log(`⚠️  Código ${alic.codigo_afip} ya existe, saltando...`);
                        nextId++;
                    } else {
                        throw err;
                    }
                }
            }
        }
        
        // 5. Mostrar estado final
        console.log('\n📊 Estado final de alícuotas:');
        const finales = await pool.query(`
            SELECT * FROM factura_iva_alicuotas
            ORDER BY codigo_afip
        `);
        finales.rows.forEach(row => {
            console.log(`   ✓ Código ${row.codigo_afip}: ${row.porcentaje}% - ${row.descripcion}`);
        });
        
        await pool.end();
        console.log('\n🎉 Verificación completada');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        await pool.end();
        process.exit(1);
    }
}

verificarAlicuotas();
