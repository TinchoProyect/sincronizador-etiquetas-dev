/**
 * DIAGNÓSTICO EN TIEMPO REAL: Campo "diferencia" durante sincronización
 * Captura exactamente qué pasa con el campo diferencia en una sincronización real
 */

const { Pool } = require('pg');
const { readSheetWithHeaders } = require('./src/services/gsheets/client');

// Configuración de base de datos
const dbConfig = {
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
};

async function diagnosticarDiferenciaTiempoReal() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 [DIAG-TIEMPO-REAL] ===== DIAGNÓSTICO EN TIEMPO REAL =====');
        
        // PASO 1: Obtener configuración activa
        console.log('\n1. Obteniendo configuración activa...');
        const configQuery = `
            SELECT hoja_url, hoja_id, hoja_nombre
            FROM presupuestos_config
            WHERE activo = true
            ORDER BY id DESC
            LIMIT 1
        `;
        const configResult = await db.query(configQuery);
        
        if (configResult.rows.length === 0) {
            throw new Error('No se encontró configuración activa');
        }
        
        const config = configResult.rows[0];
        console.log('✅ Config encontrada:', {
            hoja_id: config.hoja_id,
            hoja_url: config.hoja_url
        });
        
        // PASO 2: Leer datos REALES desde Google Sheets
        console.log('\n2. Leyendo datos REALES desde Google Sheets...');
        
        const detallesData = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
        
        console.log('📋 [DIAG-TIEMPO-REAL] Headers leídos:', detallesData.headers);
        console.log('📋 [DIAG-TIEMPO-REAL] Total filas:', detallesData.rows.length);
        
        // PASO 3: ANÁLISIS ESPECÍFICO DE LA PRIMERA FILA CON DATOS
        console.log('\n3. ANÁLISIS ESPECÍFICO DE LA PRIMERA FILA CON DATOS:');
        
        if (detallesData.rows.length === 0) {
            console.log('❌ [DIAG-TIEMPO-REAL] No hay datos en DetallesPresupuestos');
            return;
        }
        
        const primeraFila = detallesData.rows[0];
        console.log('📊 [DIAG-TIEMPO-REAL] Primera fila completa:', primeraFila);
        
        // Verificar tipo de datos
        console.log('📊 [DIAG-TIEMPO-REAL] Tipo de primera fila:', Array.isArray(primeraFila) ? 'Array' : 'Object');
        
        if (Array.isArray(primeraFila)) {
            console.log('📊 [DIAG-TIEMPO-REAL] Acceso por índices:');
            primeraFila.forEach((valor, indice) => {
                const header = detallesData.headers[indice] || `Sin_Header_${indice}`;
                console.log(`   [${indice}] ${header}: "${valor}" (tipo: ${typeof valor})`);
            });
            
            // Verificar específicamente el índice 7
            console.log(`\n🎯 [DIAG-TIEMPO-REAL] ÍNDICE 7 (Diferencia):`);
            console.log(`   Header en posición 7: "${detallesData.headers[7]}"`);
            console.log(`   Valor en posición 7: "${primeraFila[7]}" (tipo: ${typeof primeraFila[7]})`);
            console.log(`   parseFloat(primeraFila[7]): ${parseFloat(primeraFila[7])}`);
            console.log(`   parseFloat(primeraFila[7]) || 0: ${parseFloat(primeraFila[7]) || 0}`);
            
        } else {
            console.log('📊 [DIAG-TIEMPO-REAL] Acceso por propiedades:');
            Object.keys(primeraFila).forEach(key => {
                console.log(`   ${key}: "${primeraFila[key]}" (tipo: ${typeof primeraFila[key]})`);
            });
            
            console.log(`\n🎯 [DIAG-TIEMPO-REAL] PROPIEDAD "Diferencia":`);
            console.log(`   primeraFila.Diferencia: "${primeraFila.Diferencia}" (tipo: ${typeof primeraFila.Diferencia})`);
            console.log(`   primeraFila["Diferencia"]: "${primeraFila["Diferencia"]}" (tipo: ${typeof primeraFila["Diferencia"]})`);
        }
        
        // PASO 4: SIMULAR EL MAPEO ACTUAL DEL CÓDIGO
        console.log('\n4. SIMULANDO EL MAPEO ACTUAL DEL CÓDIGO:');
        
        // Simular exactamente lo que hace el código actual
        const row = primeraFila;
        
        console.log('🧪 [DIAG-TIEMPO-REAL] Simulación del mapeo:');
        
        // Método ACTUAL (mi corrección)
        const diferenciaActual = row[7] || 0;
        console.log(`   const diferencia = row[7] || 0;`);
        console.log(`   Resultado: ${diferenciaActual} (tipo: ${typeof diferenciaActual})`);
        
        // Método ANTERIOR (el que estaba mal)
        const diferenciaAnterior = row[detallesData.headers[7]] || 0;
        console.log(`   const diferencia = row[detallesData.headers[7]] || 0;`);
        console.log(`   detallesData.headers[7] = "${detallesData.headers[7]}"`);
        console.log(`   row["${detallesData.headers[7]}"] = "${row[detallesData.headers[7]]}"`);
        console.log(`   Resultado: ${diferenciaAnterior} (tipo: ${typeof diferenciaAnterior})`);
        
        // PASO 5: VERIFICAR SI HAY DIFERENCIAS ENTRE MÉTODOS
        console.log('\n5. COMPARACIÓN DE MÉTODOS:');
        
        if (diferenciaActual !== diferenciaAnterior) {
            console.log('⚠️ [DIAG-TIEMPO-REAL] HAY DIFERENCIA ENTRE MÉTODOS:');
            console.log(`   Método actual (row[7]): ${diferenciaActual}`);
            console.log(`   Método anterior (row[header]): ${diferenciaAnterior}`);
        } else {
            console.log('✅ [DIAG-TIEMPO-REAL] AMBOS MÉTODOS DAN EL MISMO RESULTADO:');
            console.log(`   Ambos devuelven: ${diferenciaActual}`);
        }
        
        // PASO 6: VERIFICAR ESTRUCTURA REAL DE LOS DATOS
        console.log('\n6. VERIFICACIÓN DE ESTRUCTURA REAL:');
        
        console.log('📋 [DIAG-TIEMPO-REAL] Estructura de detallesData:');
        console.log(`   detallesData.headers.length: ${detallesData.headers.length}`);
        console.log(`   detallesData.rows.length: ${detallesData.rows.length}`);
        console.log(`   Tipo de detallesData.rows[0]: ${Array.isArray(detallesData.rows[0]) ? 'Array' : 'Object'}`);
        
        if (Array.isArray(detallesData.rows[0])) {
            console.log(`   detallesData.rows[0].length: ${detallesData.rows[0].length}`);
        }
        
        console.log('\n🏁 [DIAG-TIEMPO-REAL] DIAGNÓSTICO COMPLETADO');
        
        return {
            headers: detallesData.headers,
            primeraFila: primeraFila,
            diferenciaActual: diferenciaActual,
            diferenciaAnterior: diferenciaAnterior,
            tipoFila: Array.isArray(primeraFila) ? 'Array' : 'Object'
        };
        
    } catch (error) {
        console.error('❌ [DIAG-TIEMPO-REAL] Error en diagnóstico:', error.message);
        throw error;
    } finally {
        await db.end();
    }
}

// Ejecutar diagnóstico
diagnosticarDiferenciaTiempoReal()
    .then(resultado => {
        console.log('\n🎯 [DIAG-TIEMPO-REAL] RESULTADO FINAL:', {
            tipoFila: resultado.tipoFila,
            diferenciaActual: resultado.diferenciaActual,
            diferenciaAnterior: resultado.diferenciaAnterior
        });
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ [DIAG-TIEMPO-REAL] Error fatal:', error);
        process.exit(1);
    });
