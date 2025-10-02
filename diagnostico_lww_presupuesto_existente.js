/**
 * Diagnóstico LWW - Presupuesto existente
 * Buscar un presupuesto que exista en local y analizar la lógica LWW
 */

const { Pool } = require('pg');
require('dotenv').config();

// Configuración de base de datos
const dbConfig = {
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
};

// Función de parseo robusta (copia exacta del código)
function parseLastModifiedRobust(value) {
    if (!value) return new Date(0);
    
    try {
        if (typeof value === 'string') {
            // Formato DD/MM/YYYY HH:MM:SS
            const ddmmyyyyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/;
            const match = value.match(ddmmyyyyRegex);
            if (match) {
                const [, day, month, year, hour, minute, second] = match;
                // Interpretar como hora local Argentina directamente
                return new Date(year, month - 1, day, hour, minute, second);
            }
        }
        return new Date(value);
    } catch (e) {
        console.error('Error parseando fecha:', value, e.message);
        return new Date(0);
    }
}

async function diagnosticoLwwPresupuestoExistente() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 [DIAG-LWW-EXISTENTE] ===== DIAGNÓSTICO LWW PRESUPUESTO EXISTENTE =====');
        
        // 1. Buscar presupuestos recientes en local
        console.log('\n1. Buscando presupuestos recientes en LOCAL...');
        
        const localQuery = `
            SELECT id_presupuesto_ext, agente, nota, punto_entrega,
                   fecha_actualizacion,
                   TO_CHAR(fecha_actualizacion AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI:SS') as fecha_actualizacion_ar
            FROM presupuestos 
            WHERE activo = true 
              AND fecha_actualizacion >= NOW() - INTERVAL '7 days'
            ORDER BY fecha_actualizacion DESC
            LIMIT 5
        `;
        
        const localResult = await db.query(localQuery);
        
        if (localResult.rows.length === 0) {
            console.log('❌ No hay presupuestos recientes en LOCAL');
            return;
        }
        
        console.log('📋 PRESUPUESTOS RECIENTES EN LOCAL:');
        localResult.rows.forEach((row, i) => {
            console.log(`   ${i+1}. ID: ${row.id_presupuesto_ext}`);
            console.log(`      Agente: ${row.agente}`);
            console.log(`      Fecha: ${row.fecha_actualizacion_ar}`);
            console.log(`      Punto: ${row.punto_entrega}`);
        });
        
        // 2. Tomar el primer presupuesto para análisis
        const presupuestoLocal = localResult.rows[0];
        console.log(`\n2. Analizando presupuesto: ${presupuestoLocal.id_presupuesto_ext}`);
        
        // 3. Simular diferentes escenarios de fechas de Sheets
        console.log('\n3. Simulando escenarios de comparación LWW...');
        
        const fechaLocal = new Date(presupuestoLocal.fecha_actualizacion);
        console.log('🕐 FECHA LOCAL:');
        console.log(`   Original: ${presupuestoLocal.fecha_actualizacion}`);
        console.log(`   Parseada: ${fechaLocal.toISOString()}`);
        console.log(`   Timestamp: ${fechaLocal.getTime()}`);
        console.log(`   Formato AR: ${fechaLocal.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`);
        
        // Escenario 1: Sheets posterior (debería priorizar Sheets)
        const fechaSheetsPosteriores = new Date(fechaLocal.getTime() + 5 * 60 * 1000); // +5 minutos
        const fechaSheetsPosterioresStr = fechaSheetsPosteriores.toLocaleString('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        }).replace(/(\d{2})\/(\d{2})\/(\d{4}),?\s*/, '$1/$2/$3 ');
        
        console.log('\n📊 ESCENARIO 1: Sheets posterior (+5 minutos)');
        console.log(`   Sheets fecha simulada: ${fechaSheetsPosterioresStr}`);
        
        const fechaSheetsParsed1 = parseLastModifiedRobust(fechaSheetsPosterioresStr);
        console.log(`   Sheets parseada: ${fechaSheetsParsed1.toISOString()}`);
        console.log(`   Sheets timestamp: ${fechaSheetsParsed1.getTime()}`);
        
        const diferencia1 = fechaSheetsParsed1.getTime() - fechaLocal.getTime();
        const sheetsEsPosterior1 = fechaSheetsParsed1 > fechaLocal;
        
        console.log(`   Diferencia: ${Math.round(diferencia1 / 1000)} segundos`);
        console.log(`   ¿Sheets es posterior?: ${sheetsEsPosterior1}`);
        console.log(`   DEBERÍA PRIORIZAR: ${sheetsEsPosterior1 ? 'SHEETS' : 'LOCAL'}`);
        
        // Escenario 2: Local posterior (debería priorizar Local)
        const fechaSheetsAnteriores = new Date(fechaLocal.getTime() - 5 * 60 * 1000); // -5 minutos
        const fechaSheetsAnterioresStr = fechaSheetsAnteriores.toLocaleString('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        }).replace(/(\d{2})\/(\d{2})\/(\d{4}),?\s*/, '$1/$2/$3 ');
        
        console.log('\n📊 ESCENARIO 2: Local posterior (+5 minutos)');
        console.log(`   Sheets fecha simulada: ${fechaSheetsAnterioresStr}`);
        
        const fechaSheetsParsed2 = parseLastModifiedRobust(fechaSheetsAnterioresStr);
        console.log(`   Sheets parseada: ${fechaSheetsParsed2.toISOString()}`);
        console.log(`   Sheets timestamp: ${fechaSheetsParsed2.getTime()}`);
        
        const diferencia2 = fechaSheetsParsed2.getTime() - fechaLocal.getTime();
        const sheetsEsPosterior2 = fechaSheetsParsed2 > fechaLocal;
        
        console.log(`   Diferencia: ${Math.round(diferencia2 / 1000)} segundos`);
        console.log(`   ¿Sheets es posterior?: ${sheetsEsPosterior2}`);
        console.log(`   DEBERÍA PRIORIZAR: ${sheetsEsPosterior2 ? 'SHEETS' : 'LOCAL'}`);
        
        // 4. Revisar la lógica actual del código
        console.log('\n4. 🔍 REVISIÓN DE LA LÓGICA ACTUAL:');
        
        console.log('📋 FUNCIÓN parseLastModifiedRobust():');
        console.log('   ✅ Regex para DD/MM/YYYY HH:MM:SS');
        console.log('   ✅ new Date(year, month - 1, day, hour, minute, second)');
        console.log('   ✅ Interpreta como hora local Argentina');
        
        console.log('\n📋 COMPARACIÓN LWW:');
        console.log('   ✅ fechaSheets > fechaLocal → Priorizar Sheets');
        console.log('   ✅ fechaLocal > fechaSheets → Priorizar Local');
        
        // 5. Buscar el problema real
        console.log('\n5. 🎯 BUSCANDO EL PROBLEMA REAL...');
        
        // Revisar si el problema está en la función pullCambiosRemotosConTimestampMejorado
        console.log('🔍 POSIBLES CAUSAS DEL PROBLEMA:');
        console.log('   1. ❓ Error en la función de comparación LWW');
        console.log('   2. ❓ Problema en el mapeo de datos de Sheets');
        console.log('   3. ❓ Error en la actualización de la base de datos');
        console.log('   4. ❓ Problema en la detección de cambios');
        
        console.log('\n💡 RECOMENDACIÓN:');
        console.log('   Revisar la función pullCambiosRemotosConTimestampMejorado()');
        console.log('   específicamente la parte donde se hace la comparación:');
        console.log('   if (remoteLastModified > localLastEdit) { ... }');
        
        console.log('\n🏁 [DIAG-LWW-EXISTENTE] Diagnóstico completado');
        
    } catch (error) {
        console.error('❌ Error en diagnóstico LWW presupuesto existente:', error.message);
    } finally {
        await db.end();
    }
}

// Ejecutar diagnóstico
diagnosticoLwwPresupuestoExistente()
    .then(() => {
        console.log('\n✅ Diagnóstico LWW presupuesto existente completado exitosamente');
        process.exit(0);
    })
    .catch(console.error);
