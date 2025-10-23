/**
 * Script para inicializar numeración AFIP consultando directamente
 * Paso 2 del plan D + E (versión directa sin servidor)
 */

const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function inicializarNumeracion() {
    console.log('🔢 INICIALIZACIÓN DE NUMERACIÓN AFIP - Paso 2 (Directo)\n');
    console.log('='.repeat(80));
    
    const ptoVta = 32;
    const cbteTipo = 6; // Factura B
    
    try {
        console.log(`\n📋 Configuración:`);
        console.log(`   Punto de Venta: ${ptoVta}`);
        console.log(`   Tipo Comprobante: ${cbteTipo} (Factura B)`);
        
        // Según tu validación con PowerShell, el último autorizado es 0
        // (no hay facturas B emitidas en PV 32 en HOMO)
        const ultimoCbteAFIP = 0;
        
        console.log(`\n📡 Último comprobante autorizado en AFIP: ${ultimoCbteAFIP}`);
        console.log(`   (Verificado con PowerShell - FECompUltimoAutorizado)`);
        
        // Insertar/actualizar en factura_numeracion_afip
        console.log(`\n💾 Guardando en factura_numeracion_afip...`);
        
        const resultado = await pool.query(`
            INSERT INTO factura_numeracion_afip (pto_vta, tipo_cbte, ultimo_cbte_afip, actualizado_en)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (pto_vta, tipo_cbte)
            DO UPDATE SET 
                ultimo_cbte_afip = EXCLUDED.ultimo_cbte_afip,
                actualizado_en = NOW()
            RETURNING *
        `, [ptoVta, cbteTipo, ultimoCbteAFIP]);
        
        console.log(`\n✅ Numeración inicializada:`);
        console.log(`   ID: ${resultado.rows[0].id}`);
        console.log(`   Punto de Venta: ${resultado.rows[0].pto_vta}`);
        console.log(`   Tipo Comprobante: ${resultado.rows[0].tipo_cbte}`);
        console.log(`   Último Cbte AFIP: ${resultado.rows[0].ultimo_cbte_afip}`);
        console.log(`   Próximo a usar: ${resultado.rows[0].ultimo_cbte_afip + 1}`);
        console.log(`   Actualizado: ${resultado.rows[0].actualizado_en}`);
        
        // Verificar estado final de numeración
        console.log(`\n📊 Estado completo de numeración AFIP:`);
        const numeraciones = await pool.query(`
            SELECT 
                id,
                pto_vta,
                tipo_cbte,
                ultimo_cbte_afip,
                actualizado_en
            FROM factura_numeracion_afip
            ORDER BY pto_vta, tipo_cbte
        `);
        
        if (numeraciones.rows.length > 0) {
            console.table(numeraciones.rows);
        } else {
            console.log('   (Sin registros)');
        }
        
        console.log('\n📝 Notas importantes:');
        console.log('   - El próximo comprobante a emitir será el número 1');
        console.log('   - El backend consultará esta tabla y usará último_cbte_afip + 1');
        console.log('   - Después de cada emisión exitosa, se actualizará automáticamente');
        
        console.log('\n✅ Paso 2 completado exitosamente');
        console.log('='.repeat(80));
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
        throw error;
    } finally {
        await pool.end();
    }
}

// Ejecutar
inicializarNumeracion()
    .then(() => process.exit(0))
    .catch(error => {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    });
