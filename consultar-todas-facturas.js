/**
 * Script para consultar TODAS las tablas del módulo de facturación
 * NO modifica nada, solo muestra información completa
 */

const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function consultarTodasLasTablas() {
    console.log('🔍 CONSULTA COMPLETA DEL MÓDULO DE FACTURACIÓN\n');
    console.log('='.repeat(80));
    
    try {
        // 1. FACTURA_FACTURAS (todas)
        console.log('\n📄 TABLA: factura_facturas');
        console.log('-'.repeat(80));
        const facturas = await pool.query(`
            SELECT 
                id, tipo_cbte, pto_vta, cbte_nro, concepto, fecha_emision,
                cliente_id, doc_tipo, doc_nro, condicion_iva_id,
                imp_neto, imp_iva, imp_total,
                cae, cae_vto, resultado, estado,
                requiere_afip, serie_interna, nro_interno,
                presupuesto_id, created_at
            FROM factura_facturas 
            ORDER BY id
        `);
        
        console.log(`Total de facturas: ${facturas.rows.length}\n`);
        
        if (facturas.rows.length === 0) {
            console.log('⚠️ No hay facturas en la base de datos\n');
        } else {
            facturas.rows.forEach(f => {
                console.log(`Factura ID ${f.id}:`);
                console.log(`  Tipo: ${f.tipo_cbte} (${getTipoNombre(f.tipo_cbte)}) | PV: ${f.pto_vta} | Nro: ${f.cbte_nro || 'NULL'}`);
                console.log(`  Cliente: ${f.cliente_id || 'NULL'} | Doc: ${f.doc_tipo}/${f.doc_nro} | IVA: ${f.condicion_iva_id}`);
                console.log(`  Fecha: ${f.fecha_emision} | Estado: ${f.estado}`);
                console.log(`  Importes: Neto=$${f.imp_neto} | IVA=$${f.imp_iva} | Total=$${f.imp_total}`);
                console.log(`  AFIP: ${f.requiere_afip ? 'SÍ' : 'NO'} | CAE: ${f.cae || 'NULL'} | Resultado: ${f.resultado || 'NULL'}`);
                if (f.serie_interna) {
                    console.log(`  Interna: ${f.serie_interna}-${f.nro_interno}`);
                }
                if (f.presupuesto_id) {
                    console.log(`  Presupuesto: ${f.presupuesto_id}`);
                }
                console.log(`  Creada: ${f.created_at}`);
                console.log('');
            });
        }
        
        // 2. FACTURA_FACTURA_ITEMS (todos)
        console.log('='.repeat(80));
        console.log('\n📦 TABLA: factura_factura_items');
        console.log('-'.repeat(80));
        const items = await pool.query(`
            SELECT 
                id, factura_id, descripcion, qty, p_unit,
                alic_iva_id, imp_neto, imp_iva, orden
            FROM factura_factura_items 
            ORDER BY factura_id, orden
        `);
        
        console.log(`Total de items: ${items.rows.length}\n`);
        
        if (items.rows.length === 0) {
            console.log('⚠️ No hay items en la base de datos\n');
        } else {
            let facturaActual = null;
            items.rows.forEach(item => {
                if (item.factura_id !== facturaActual) {
                    console.log(`\nItems de Factura ID ${item.factura_id}:`);
                    facturaActual = item.factura_id;
                }
                console.log(`  [${item.orden}] ${item.descripcion}`);
                console.log(`      Cant: ${item.qty} | P.Unit: $${item.p_unit} | IVA: ${item.alic_iva_id} (${getAlicuotaNombre(item.alic_iva_id)})`);
                console.log(`      Neto: $${item.imp_neto} | IVA: $${item.imp_iva}`);
            });
            console.log('');
        }
        
        // 3. FACTURA_AFIP_TA (tokens)
        console.log('='.repeat(80));
        console.log('\n🔑 TABLA: factura_afip_ta');
        console.log('-'.repeat(80));
        const tokens = await pool.query(`
            SELECT id, entorno, servicio, expira_en, creado_en
            FROM factura_afip_ta 
            ORDER BY creado_en DESC
        `);
        
        console.log(`Total de tokens: ${tokens.rows.length}\n`);
        
        if (tokens.rows.length === 0) {
            console.log('⚠️ No hay tokens de AFIP guardados\n');
        } else {
            tokens.rows.forEach(t => {
                const ahora = new Date();
                const expira = new Date(t.expira_en);
                const vigente = expira > ahora;
                
                console.log(`Token ID ${t.id}:`);
                console.log(`  Entorno: ${t.entorno} | Servicio: ${t.servicio}`);
                console.log(`  Expira: ${t.expira_en} | ${vigente ? '✅ VIGENTE' : '❌ EXPIRADO'}`);
                console.log(`  Creado: ${t.creado_en}`);
                console.log('');
            });
        }
        
        // 4. FACTURA_AFIP_WSFE_LOGS (logs)
        console.log('='.repeat(80));
        console.log('\n📝 TABLA: factura_afip_wsfe_logs');
        console.log('-'.repeat(80));
        const logs = await pool.query(`
            SELECT 
                id, factura_id, metodo, resultado, 
                observaciones, creado_en
            FROM factura_afip_wsfe_logs 
            ORDER BY creado_en DESC
            LIMIT 20
        `);
        
        console.log(`Total de logs (últimos 20): ${logs.rows.length}\n`);
        
        if (logs.rows.length === 0) {
            console.log('⚠️ No hay logs de WSFE\n');
        } else {
            logs.rows.forEach(log => {
                console.log(`Log ID ${log.id}:`);
                console.log(`  Factura: ${log.factura_id || 'NULL'} | Método: ${log.metodo}`);
                console.log(`  Resultado: ${log.resultado || 'NULL'}`);
                if (log.observaciones) {
                    console.log(`  Observaciones: ${log.observaciones.substring(0, 100)}${log.observaciones.length > 100 ? '...' : ''}`);
                }
                console.log(`  Fecha: ${log.creado_en}`);
                console.log('');
            });
        }
        
        // 5. FACTURA_NUMERACION_AFIP
        console.log('='.repeat(80));
        console.log('\n🔢 TABLA: factura_numeracion_afip');
        console.log('-'.repeat(80));
        const numAfip = await pool.query(`
            SELECT id, pto_vta, tipo_cbte, ultimo_cbte_afip, actualizado_en
            FROM factura_numeracion_afip 
            ORDER BY pto_vta, tipo_cbte
        `);
        
        console.log(`Total de registros: ${numAfip.rows.length}\n`);
        
        if (numAfip.rows.length === 0) {
            console.log('⚠️ No hay registros de numeración AFIP\n');
        } else {
            numAfip.rows.forEach(num => {
                console.log(`Numeración ID ${num.id}:`);
                console.log(`  PV: ${num.pto_vta} | Tipo: ${num.tipo_cbte} (${getTipoNombre(num.tipo_cbte)})`);
                console.log(`  Último Cbte AFIP: ${num.ultimo_cbte_afip}`);
                console.log(`  Actualizado: ${num.actualizado_en}`);
                console.log('');
            });
        }
        
        // 6. FACTURA_NUMERACION_INTERNA
        console.log('='.repeat(80));
        console.log('\n🔢 TABLA: factura_numeracion_interna');
        console.log('-'.repeat(80));
        const numInterna = await pool.query(`
            SELECT id, serie_interna, ultimo_nro, actualizado_en
            FROM factura_numeracion_interna 
            ORDER BY serie_interna
        `);
        
        console.log(`Total de series: ${numInterna.rows.length}\n`);
        
        if (numInterna.rows.length === 0) {
            console.log('⚠️ No hay series internas configuradas\n');
        } else {
            numInterna.rows.forEach(num => {
                console.log(`Serie "${num.serie_interna}":`);
                console.log(`  Último Nro: ${num.ultimo_nro}`);
                console.log(`  Actualizado: ${num.actualizado_en}`);
                console.log('');
            });
        }
        
        // RESUMEN FINAL
        console.log('='.repeat(80));
        console.log('\n📊 RESUMEN GENERAL');
        console.log('-'.repeat(80));
        console.log(`Total Facturas: ${facturas.rows.length}`);
        console.log(`Total Items: ${items.rows.length}`);
        console.log(`Total Tokens AFIP: ${tokens.rows.length}`);
        console.log(`Total Logs WSFE: ${logs.rows.length}`);
        console.log(`Numeraciones AFIP: ${numAfip.rows.length}`);
        console.log(`Series Internas: ${numInterna.rows.length}`);
        
        // Estados de facturas
        if (facturas.rows.length > 0) {
            console.log('\nFacturas por Estado:');
            const estados = {};
            facturas.rows.forEach(f => {
                estados[f.estado] = (estados[f.estado] || 0) + 1;
            });
            Object.entries(estados).forEach(([estado, cant]) => {
                console.log(`  ${estado}: ${cant}`);
            });
        }
        
        console.log('\n✅ Consulta completada');
        console.log('='.repeat(80));
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
        throw error;
    } finally {
        await pool.end();
    }
}

// Funciones helper
function getTipoNombre(tipo) {
    const tipos = {
        1: 'Factura A', 2: 'Nota Débito A', 3: 'Nota Crédito A',
        6: 'Factura B', 7: 'Nota Débito B', 8: 'Nota Crédito B',
        11: 'Factura C', 12: 'Nota Débito C', 13: 'Nota Crédito C'
    };
    return tipos[tipo] || 'Desconocido';
}

function getAlicuotaNombre(alic) {
    const alicuotas = {
        3: '0%', 4: '10.5%', 5: '21%', 6: '27%', 8: '5%', 9: '2.5%'
    };
    return alicuotas[alic] || 'Desconocida';
}

// Ejecutar
consultarTodasLasTablas()
    .then(() => process.exit(0))
    .catch(error => {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    });
