/**
 * Simulación de limpieza de presupuestos anulados en Google Sheets
 * Solo analiza y muestra qué se haría, sin ejecutar cambios
 */

const { Pool } = require('pg');
require('dotenv').config();

const { readSheetWithHeaders } = require('./src/services/gsheets/client_with_logs');

// Configuración de base de datos
const dbConfig = {
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
};

async function simularLimpiezaSheets() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 [SIMULACIÓN] ===== SIMULACIÓN DE LIMPIEZA EN SHEETS =====');
        
        // PASO 1: Obtener configuración
        console.log('\n📊 PASO 1: Obteniendo configuración...');
        
        const configQuery = `
            SELECT hoja_id
            FROM presupuestos_config 
            WHERE activo = true 
            ORDER BY fecha_creacion DESC 
            LIMIT 1
        `;
        
        const configResult = await db.query(configQuery);
        
        if (configResult.rows.length === 0) {
            console.log('❌ No se encontró configuración activa');
            return;
        }
        
        const config = configResult.rows[0];
        console.log(`   ✅ Sheet ID: ${config.hoja_id}`);
        
        // PASO 2: Leer datos de Sheets
        console.log('\n📊 PASO 2: Leyendo datos de Sheets...');
        
        const presupuestosSheets = await readSheetWithHeaders(config.hoja_id, 'A:O', 'Presupuestos');
        const detallesSheets = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
        
        console.log(`   ✅ Presupuestos en Sheets: ${presupuestosSheets.rows.length}`);
        console.log(`   ✅ Detalles en Sheets: ${detallesSheets.rows.length}`);
        
        // PASO 3: Identificar presupuestos anulados
        console.log('\n📊 PASO 3: Identificando presupuestos anulados...');
        
        const presupuestosAnulados = [];
        const idsAnulados = new Set();
        
        presupuestosSheets.rows.forEach((row, index) => {
            const estado = row[presupuestosSheets.headers[7]]; // Columna H: Estado
            const id = (row[presupuestosSheets.headers[0]] || '').toString().trim();
            const activo = row[presupuestosSheets.headers[14]]; // Columna O: Activo
            
            if (estado && estado.toString().toLowerCase() === 'anulado' && id) {
                presupuestosAnulados.push({
                    fila: index + 2, // +2 porque fila 1 es header
                    id: id,
                    agente: row[presupuestosSheets.headers[3]],
                    fecha: row[presupuestosSheets.headers[1]],
                    estado: estado,
                    activoActual: activo
                });
                idsAnulados.add(id);
            }
        });
        
        console.log(`   ✅ Presupuestos anulados encontrados: ${presupuestosAnulados.length}`);
        
        if (presupuestosAnulados.length === 0) {
            console.log('✅ No hay presupuestos anulados para limpiar');
            return;
        }
        
        // PASO 4: Mostrar detalle completo de presupuestos
        console.log('\n📋 DETALLE DE PRESUPUESTOS ANULADOS:');
        console.log('═'.repeat(80));
        
        presupuestosAnulados.forEach((p, i) => {
            console.log(`${i+1}. Fila ${p.fila}:`);
            console.log(`   ID: ${p.id}`);
            console.log(`   Agente: ${p.agente}`);
            console.log(`   Fecha: ${p.fecha}`);
            console.log(`   Estado: ${p.estado}`);
            console.log(`   Activo actual: ${p.activoActual}`);
            console.log(`   Acción: Marcar Activo=FALSE`);
            console.log('');
        });
        
        // PASO 5: Identificar detalles de presupuestos anulados
        console.log('\n📊 PASO 5: Identificando detalles de presupuestos anulados...');
        
        const detallesAnulados = [];
        
        detallesSheets.rows.forEach((row, index) => {
            const idPresupuesto = (row[detallesSheets.headers[1]] || '').toString().trim(); // Columna B: IdPresupuesto
            const activo = row[detallesSheets.headers[16]]; // Columna Q: Activo
            
            if (idsAnulados.has(idPresupuesto)) {
                detallesAnulados.push({
                    fila: index + 2,
                    idPresupuesto: idPresupuesto,
                    articulo: row[detallesSheets.headers[2]],
                    activoActual: activo
                });
            }
        });
        
        console.log(`   ✅ Detalles de anulados encontrados: ${detallesAnulados.length}`);
        
        // PASO 6: Mostrar muestra de detalles
        console.log('\n📋 MUESTRA DE DETALLES (primeros 20):');
        console.log('═'.repeat(80));
        
        detallesAnulados.slice(0, 20).forEach((d, i) => {
            console.log(`${i+1}. Fila ${d.fila}:`);
            console.log(`   Presupuesto: ${d.idPresupuesto}`);
            console.log(`   Artículo: ${d.articulo}`);
            console.log(`   Activo actual: ${d.activoActual}`);
            console.log(`   Acción: Marcar Activo=FALSE`);
            console.log('');
        });
        
        if (detallesAnulados.length > 20) {
            console.log(`... y ${detallesAnulados.length - 20} detalles más`);
        }
        
        // PASO 7: Resumen de operaciones
        console.log('\n📊 RESUMEN DE OPERACIONES A REALIZAR:');
        console.log('═'.repeat(80));
        console.log(`Total de presupuestos a marcar como inactivos: ${presupuestosAnulados.length}`);
        console.log(`Total de detalles a marcar como inactivos: ${detallesAnulados.length}`);
        console.log(`Total de operaciones batch: ${presupuestosAnulados.length + detallesAnulados.length}`);
        console.log(`Lotes necesarios (100 ops/lote): ${Math.ceil((presupuestosAnulados.length + detallesAnulados.length) / 100)}`);
        console.log('═'.repeat(80));
        
        // PASO 8: Verificar que los IDs son correctos
        console.log('\n🔍 PASO 8: Verificando que los IDs son correctos...');
        
        // Verificar que estos IDs realmente están anulados en local
        const verificacionQuery = `
            SELECT id_presupuesto_ext, estado, activo
            FROM presupuestos
            WHERE id_presupuesto_ext = ANY($1::text[])
        `;
        
        const verificacion = await db.query(verificacionQuery, [Array.from(idsAnulados)]);
        
        console.log(`   Presupuestos verificados en LOCAL: ${verificacion.rowCount}`);
        
        const noEncontrados = Array.from(idsAnulados).filter(id => 
            !verificacion.rows.some(row => row.id_presupuesto_ext === id)
        );
        
        if (noEncontrados.length > 0) {
            console.log(`   ⚠️  IDs en Sheets pero NO en LOCAL: ${noEncontrados.length}`);
            console.log(`   Muestra: ${noEncontrados.slice(0, 5).join(', ')}`);
        } else {
            console.log(`   ✅ Todos los IDs existen en LOCAL`);
        }
        
        const estadosLocal = {};
        verificacion.rows.forEach(row => {
            const key = `${row.estado}-${row.activo}`;
            estadosLocal[key] = (estadosLocal[key] || 0) + 1;
        });
        
        console.log('\n   Estados en LOCAL:');
        Object.entries(estadosLocal).forEach(([key, count]) => {
            console.log(`     ${key}: ${count}`);
        });
        
        // PASO 9: Conclusión
        console.log('\n✅ SIMULACIÓN COMPLETADA');
        console.log('\n💡 PRÓXIMOS PASOS:');
        console.log('   1. Revisa que los IDs y filas sean correctos');
        console.log('   2. Si todo está bien, ejecuta:');
        console.log('      node limpiar_sheets_anulados.js --confirm');
        
    } catch (error) {
        console.error('❌ Error en simulación:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await db.end();
    }
}

// Ejecutar simulación
simularLimpiezaSheets()
    .then(() => {
        console.log('\n🏁 Simulación completada');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    });
