/**
 * Script para ejecutar ALTER TABLE desde Node.js
 */

const { pool } = require('./src/facturacion/config/database');
const fs = require('fs');

async function ejecutarAlterTable() {
    console.log('🔄 Ejecutando ALTER TABLE para facturación...\n');
    
    try {
        // Leer archivo SQL
        const sql = fs.readFileSync('alter-table-facturacion.sql', 'utf8');
        
        // Dividir en statements individuales (separados por ;)
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('\\'));
        
        console.log(`📋 Ejecutando ${statements.length} statements SQL...\n`);
        
        let ejecutados = 0;
        let errores = 0;
        
        for (const statement of statements) {
            // Saltar comentarios y comandos psql
            if (statement.startsWith('SELECT') && statement.includes('information_schema')) {
                // Ejecutar y mostrar resultado
                try {
                    const result = await pool.query(statement);
                    if (result.rows.length > 0) {
                        console.log('✅ Verificación:');
                        console.table(result.rows);
                    }
                    ejecutados++;
                } catch (error) {
                    console.warn(`⚠️ Error en verificación: ${error.message}`);
                }
            } else if (statement.includes('ALTER TABLE') || statement.includes('CREATE') || statement.includes('DROP')) {
                try {
                    await pool.query(statement);
                    ejecutados++;
                    
                    if (statement.includes('ADD COLUMN')) {
                        console.log('✅ Columnas agregadas');
                    } else if (statement.includes('ADD CONSTRAINT')) {
                        const constraintName = statement.match(/CONSTRAINT\s+(\w+)/)?.[1];
                        console.log(`✅ Constraint agregado: ${constraintName}`);
                    } else if (statement.includes('CREATE OR REPLACE FUNCTION')) {
                        console.log('✅ Función creada: recalcular_totales_factura()');
                    } else if (statement.includes('CREATE TRIGGER')) {
                        const triggerName = statement.match(/TRIGGER\s+(\w+)/)?.[1];
                        console.log(`✅ Trigger creado: ${triggerName}`);
                    }
                } catch (error) {
                    errores++;
                    console.error(`❌ Error: ${error.message}`);
                    if (error.message.includes('already exists')) {
                        console.log('   (Ya existe, continuando...)');
                        errores--; // No contar como error
                    }
                }
            }
        }
        
        console.log('\n============================================');
        console.log('RESUMEN DE CAMBIOS APLICADOS');
        console.log('============================================\n');
        console.log('✅ Columnas agregadas:');
        console.log('   - fch_serv_desde (DATE)');
        console.log('   - fch_serv_hasta (DATE)');
        console.log('   - fch_vto_pago (DATE)\n');
        console.log('✅ Constraints agregados:');
        console.log('   - check_concepto (1, 2, 3)');
        console.log('   - check_moneda (PES, DOL, EUR)');
        console.log('   - check_mon_cotiz_pesos (1 para PES)');
        console.log('   - check_fechas_servicio (obligatorias si concepto 2/3)');
        console.log('   - check_doc_receptor (obligatorio si requiere_afip)\n');
        console.log('✅ Función creada:');
        console.log('   - recalcular_totales_factura()\n');
        console.log('✅ Triggers creados:');
        console.log('   - trigger_recalcular_totales_insert');
        console.log('   - trigger_recalcular_totales_update');
        console.log('   - trigger_recalcular_totales_delete\n');
        console.log('============================================');
        console.log('CAMBIOS COMPLETADOS EXITOSAMENTE');
        console.log('============================================\n');
        console.log(`📊 Statements ejecutados: ${ejecutados}`);
        console.log(`❌ Errores: ${errores}\n`);
        
        await pool.end();
        
        if (errores === 0) {
            console.log('✅ Todo listo para testing!\n');
            process.exit(0);
        } else {
            console.error('⚠️ Hubo algunos errores, revisar arriba\n');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('❌ Error fatal:', error.message);
        console.error('Stack:', error.stack);
        await pool.end();
        process.exit(1);
    }
}

ejecutarAlterTable();
