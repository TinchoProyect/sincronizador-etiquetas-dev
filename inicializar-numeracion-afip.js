/**
 * Script para inicializar numeración AFIP
 * Paso 2 del plan D + E
 * Consulta FECompUltimoAutorizado y seedea la tabla
 */

const { Pool } = require('pg');
const http = require('http');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function consultarUltimoAFIP(ptoVta, cbteTipo) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3004,
            path: `/facturacion/afip/ultimo?ptoVta=${ptoVta}&cbteTipo=${cbteTipo}`,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    resolve(response);
                } catch (error) {
                    reject(new Error(`Error parseando respuesta: ${data}`));
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Timeout consultando AFIP'));
        });
        
        req.end();
    });
}

async function inicializarNumeracion() {
    console.log('🔢 INICIALIZACIÓN DE NUMERACIÓN AFIP - Paso 2\n');
    console.log('='.repeat(80));
    
    const ptoVta = 32;
    const cbteTipo = 6; // Factura B
    
    try {
        // 1. Consultar último autorizado desde AFIP
        console.log(`\n📡 Consultando último autorizado en AFIP...`);
        console.log(`   Punto de Venta: ${ptoVta}`);
        console.log(`   Tipo Comprobante: ${cbteTipo} (Factura B)`);
        
        const respuesta = await consultarUltimoAFIP(ptoVta, cbteTipo);
        
        console.log(`\n✅ Respuesta de AFIP recibida:`);
        console.log(`   Último Cbte Nro: ${respuesta.cbteNro}`);
        
        // 2. Insertar/actualizar en factura_numeracion_afip
        console.log(`\n💾 Guardando en factura_numeracion_afip...`);
        
        const resultado = await pool.query(`
            INSERT INTO factura_numeracion_afip (pto_vta, tipo_cbte, ultimo_cbte_afip, actualizado_en)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (pto_vta, tipo_cbte)
            DO UPDATE SET 
                ultimo_cbte_afip = EXCLUDED.ultimo_cbte_afip,
                actualizado_en = NOW()
            RETURNING *
        `, [ptoVta, cbteTipo, respuesta.cbteNro]);
        
        console.log(`✅ Numeración inicializada:`);
        console.log(`   ID: ${resultado.rows[0].id}`);
        console.log(`   Punto de Venta: ${resultado.rows[0].pto_vta}`);
        console.log(`   Tipo Comprobante: ${resultado.rows[0].tipo_cbte}`);
        console.log(`   Último Cbte AFIP: ${resultado.rows[0].ultimo_cbte_afip}`);
        console.log(`   Próximo a usar: ${resultado.rows[0].ultimo_cbte_afip + 1}`);
        console.log(`   Actualizado: ${resultado.rows[0].actualizado_en}`);
        
        // 3. Verificar estado final de numeración
        console.log(`\n📊 Estado de numeración AFIP:`);
        const numeraciones = await pool.query(`
            SELECT * FROM factura_numeracion_afip
            ORDER BY pto_vta, tipo_cbte
        `);
        
        console.table(numeraciones.rows);
        
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
