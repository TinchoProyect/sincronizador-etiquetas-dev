/**
 * Script de Verificación: Estado de Base de Datos para Facturación
 * Verifica si las columnas, constraints y triggers ya existen
 */

const { Pool } = require('pg');

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'etiquetas',
    user: 'postgres',
    password: 'Lam2020da'
});

console.log('🔍 VERIFICACIÓN DE ESTADO DE BASE DE DATOS');
console.log('==========================================\n');

async function verificarEstado() {
    const client = await pool.connect();
    
    try {
        // 1. Verificar columnas de fechas de servicio
        console.log('📋 1. VERIFICANDO COLUMNAS DE FECHAS DE SERVICIO');
        console.log('   Tabla: factura_facturas');
        console.log('   Columnas esperadas: fch_serv_desde, fch_serv_hasta, fch_vto_pago\n');
        
        const columnasQuery = `
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'factura_facturas'
            AND column_name IN ('fch_serv_desde', 'fch_serv_hasta', 'fch_vto_pago')
            ORDER BY column_name;
        `;
        
        const columnasResult = await client.query(columnasQuery);
        
        if (columnasResult.rows.length === 0) {
            console.log('   ❌ NO EXISTEN - Necesitan ser creadas');
        } else {
            console.log('   ✅ EXISTEN:');
            columnasResult.rows.forEach(col => {
                console.log(`      - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
            });
        }
        console.log('');
        
        // 2. Verificar constraints
        console.log('📋 2. VERIFICANDO CONSTRAINTS DE VALIDACIÓN');
        console.log('   Tabla: factura_facturas');
        console.log('   Constraints esperados: check_concepto, check_moneda, check_mon_cotiz_pesos,');
        console.log('                          check_fechas_servicio, check_doc_receptor\n');
        
        const constraintsQuery = `
            SELECT 
                conname as constraint_name,
                contype as constraint_type,
                pg_get_constraintdef(oid) as definition
            FROM pg_constraint
            WHERE conrelid = 'factura_facturas'::regclass
            AND conname LIKE 'check_%'
            ORDER BY conname;
        `;
        
        const constraintsResult = await client.query(constraintsQuery);
        
        const expectedConstraints = [
            'check_concepto',
            'check_moneda',
            'check_mon_cotiz_pesos',
            'check_fechas_servicio',
            'check_doc_receptor'
        ];
        
        const existingConstraints = constraintsResult.rows.map(r => r.constraint_name);
        
        expectedConstraints.forEach(expected => {
            if (existingConstraints.includes(expected)) {
                console.log(`   ✅ ${expected} - EXISTE`);
                const constraint = constraintsResult.rows.find(r => r.constraint_name === expected);
                console.log(`      ${constraint.definition}`);
            } else {
                console.log(`   ❌ ${expected} - NO EXISTE`);
            }
        });
        console.log('');
        
        // 3. Verificar función de recálculo
        console.log('📋 3. VERIFICANDO FUNCIÓN DE RECÁLCULO DE TOTALES');
        console.log('   Función esperada: recalcular_totales_factura()\n');
        
        const funcionQuery = `
            SELECT 
                p.proname as function_name,
                pg_get_functiondef(p.oid) as definition
            FROM pg_proc p
            WHERE p.proname = 'recalcular_totales_factura';
        `;
        
        const funcionResult = await client.query(funcionQuery);
        
        if (funcionResult.rows.length === 0) {
            console.log('   ❌ NO EXISTE - Necesita ser creada');
        } else {
            console.log('   ✅ EXISTE: recalcular_totales_factura()');
            console.log('      (Función definida correctamente)');
        }
        console.log('');
        
        // 4. Verificar triggers
        console.log('📋 4. VERIFICANDO TRIGGERS DE RECÁLCULO');
        console.log('   Tabla: factura_factura_items');
        console.log('   Triggers esperados: trigger_recalcular_totales_insert,');
        console.log('                       trigger_recalcular_totales_update,');
        console.log('                       trigger_recalcular_totales_delete\n');
        
        const triggersQuery = `
            SELECT 
                t.tgname as trigger_name,
                t.tgenabled as enabled,
                pg_get_triggerdef(t.oid) as definition
            FROM pg_trigger t
            WHERE t.tgrelid = 'factura_factura_items'::regclass
            AND t.tgname LIKE 'trigger_recalcular%'
            ORDER BY t.tgname;
        `;
        
        const triggersResult = await client.query(triggersQuery);
        
        const expectedTriggers = [
            'trigger_recalcular_totales_insert',
            'trigger_recalcular_totales_update',
            'trigger_recalcular_totales_delete'
        ];
        
        const existingTriggers = triggersResult.rows.map(r => r.trigger_name);
        
        expectedTriggers.forEach(expected => {
            if (existingTriggers.includes(expected)) {
                const trigger = triggersResult.rows.find(r => r.trigger_name === expected);
                const enabled = trigger.enabled === 'O' ? 'ACTIVO' : 'INACTIVO';
                console.log(`   ✅ ${expected} - EXISTE (${enabled})`);
            } else {
                console.log(`   ❌ ${expected} - NO EXISTE`);
            }
        });
        console.log('');
        
        // 5. Resumen final
        console.log('==========================================');
        console.log('📊 RESUMEN DE VERIFICACIÓN\n');
        
        const columnasOk = columnasResult.rows.length === 3;
        const constraintsOk = expectedConstraints.every(c => existingConstraints.includes(c));
        const funcionOk = funcionResult.rows.length > 0;
        const triggersOk = expectedTriggers.every(t => existingTriggers.includes(t));
        
        console.log(`   Columnas de fechas:        ${columnasOk ? '✅ OK' : '❌ FALTAN'} (${columnasResult.rows.length}/3)`);
        console.log(`   Constraints de validación: ${constraintsOk ? '✅ OK' : '❌ FALTAN'} (${existingConstraints.length}/${expectedConstraints.length})`);
        console.log(`   Función de recálculo:      ${funcionOk ? '✅ OK' : '❌ FALTA'}`);
        console.log(`   Triggers de recálculo:     ${triggersOk ? '✅ OK' : '❌ FALTAN'} (${existingTriggers.length}/${expectedTriggers.length})`);
        console.log('');
        
        if (columnasOk && constraintsOk && funcionOk && triggersOk) {
            console.log('🎉 RESULTADO: Base de datos YA ESTÁ CONFIGURADA');
            console.log('   No es necesario ejecutar alter-table-facturacion.sql');
        } else {
            console.log('⚠️  RESULTADO: Base de datos NECESITA CONFIGURACIÓN');
            console.log('   Ejecutar: psql -U postgres -d etiquetas');
            console.log('   Luego:    \\i alter-table-facturacion.sql');
        }
        console.log('');
        
        // 6. Verificar estructura completa de factura_facturas
        console.log('==========================================');
        console.log('📋 ESTRUCTURA COMPLETA DE factura_facturas\n');
        
        const estructuraQuery = `
            SELECT 
                column_name, 
                data_type, 
                is_nullable,
                column_default
            FROM information_schema.columns
            WHERE table_name = 'factura_facturas'
            ORDER BY ordinal_position;
        `;
        
        const estructuraResult = await client.query(estructuraQuery);
        
        console.log('   Columnas actuales:');
        estructuraResult.rows.forEach(col => {
            const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
            const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
            console.log(`      ${col.column_name.padEnd(25)} ${col.data_type.padEnd(20)} ${nullable}${defaultVal}`);
        });
        console.log('');
        
    } catch (error) {
        console.error('❌ ERROR:', error.message);
        console.error('   Stack:', error.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

// Ejecutar verificación
verificarEstado()
    .then(() => {
        console.log('✅ Verificación completada');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Error en verificación:', error);
        process.exit(1);
    });
