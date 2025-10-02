/**
 * Diagnóstico LWW - Precisión de fechas y lógica de prioridad
 * Revisar conversión de fechas y comparación exacta
 */

const { Pool } = require('pg');

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

async function diagnosticoLwwPrecisionFechas() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 [DIAG-LWW-PRECISION] ===== DIAGNÓSTICO LWW PRECISIÓN FECHAS =====');
        
        // 1. Obtener un presupuesto específico para análisis detallado
        console.log('\n1. Obteniendo presupuesto específico para análisis...');
        
        // Usar el presupuesto que sabemos que está posterior: 6c7fa3e2
        const presupuestoId = '6c7fa3e2';
        
        const localQuery = `
            SELECT id_presupuesto_ext, agente, nota, punto_entrega,
                   fecha_actualizacion,
                   TO_CHAR(fecha_actualizacion AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI:SS') as fecha_actualizacion_ar
            FROM presupuestos 
            WHERE id_presupuesto_ext = $1 AND activo = true
        `;
        
        const localResult = await db.query(localQuery, [presupuestoId]);
        
        if (localResult.rows.length === 0) {
            console.log(`❌ Presupuesto ${presupuestoId} no encontrado en LOCAL`);
            return;
        }
        
        const localData = localResult.rows[0];
        console.log('📋 DATOS LOCAL:', {
            id: localData.id_presupuesto_ext,
            agente: localData.agente,
            nota: localData.nota,
            punto_entrega: localData.punto_entrega,
            fecha_actualizacion_iso: localData.fecha_actualizacion,
            fecha_actualizacion_ar: localData.fecha_actualizacion_ar
        });
        
        // 2. Simular datos de Sheets (basado en la imagen que mostraste)
        console.log('\n2. Simulando datos de SHEETS...');
        
        const sheetsData = {
            IDPresupuesto: '6c7fa3e2',
            Agente: 'Martin',
            Nota: null,
            PuntoEntrega: 'ca1f2dec',
            LastModified: '29/9/2025 22:44:35'
        };
        
        console.log('📋 DATOS SHEETS:', sheetsData);
        
        // 3. Análisis detallado de conversión de fechas
        console.log('\n3. Análisis detallado de conversión de fechas...');
        
        // Fecha local
        const fechaLocal = new Date(localData.fecha_actualizacion);
        console.log('🕐 FECHA LOCAL:');
        console.log(`   Original: ${localData.fecha_actualizacion}`);
        console.log(`   Parseada: ${fechaLocal.toISOString()}`);
        console.log(`   Timestamp: ${fechaLocal.getTime()}`);
        console.log(`   Formato AR: ${fechaLocal.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`);
        
        // Fecha Sheets
        const fechaSheets = parseLastModifiedRobust(sheetsData.LastModified);
        console.log('\n🕐 FECHA SHEETS:');
        console.log(`   Original: ${sheetsData.LastModified}`);
        console.log(`   Parseada: ${fechaSheets.toISOString()}`);
        console.log(`   Timestamp: ${fechaSheets.getTime()}`);
        console.log(`   Formato AR: ${fechaSheets.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`);
        
        // 4. Comparación LWW
        console.log('\n4. Comparación LWW (Last Write Wins)...');
        
        const diferenciaMs = fechaSheets.getTime() - fechaLocal.getTime();
        const diferenciaMinutos = Math.round(diferenciaMs / (1000 * 60));
        const diferenciaSegundos = Math.round(diferenciaMs / 1000);
        
        console.log('⚖️ COMPARACIÓN:');
        console.log(`   Sheets timestamp: ${fechaSheets.getTime()}`);
        console.log(`   Local timestamp:  ${fechaLocal.getTime()}`);
        console.log(`   Diferencia: ${diferenciaMs} ms`);
        console.log(`   Diferencia: ${diferenciaSegundos} segundos`);
        console.log(`   Diferencia: ${diferenciaMinutos} minutos`);
        
        const sheetsEsPosterior = fechaSheets > fechaLocal;
        const localEsPosterior = fechaLocal > fechaSheets;
        
        console.log('\n🎯 RESULTADO LWW:');
        console.log(`   ¿Sheets es posterior?: ${sheetsEsPosterior}`);
        console.log(`   ¿Local es posterior?: ${localEsPosterior}`);
        console.log(`   ¿Son iguales?: ${fechaSheets.getTime() === fechaLocal.getTime()}`);
        
        if (sheetsEsPosterior) {
            console.log('   ✅ DEBERÍA PRIORIZAR: SHEETS');
            console.log('   ✅ ACCIÓN: Actualizar local con datos de Sheets');
        } else if (localEsPosterior) {
            console.log('   ✅ DEBERÍA PRIORIZAR: LOCAL');
            console.log('   ✅ ACCIÓN: Mantener datos locales');
        } else {
            console.log('   ⚠️ FECHAS IGUALES: Usar criterio de desempate');
        }
        
        // 5. Verificar diferencias en datos
        console.log('\n5. Verificando diferencias en datos...');
        
        const diferencias = [];
        if (localData.agente !== sheetsData.Agente) {
            diferencias.push(`Agente: Local="${localData.agente}" vs Sheets="${sheetsData.Agente}"`);
        }
        if (localData.nota !== sheetsData.Nota) {
            diferencias.push(`Nota: Local="${localData.nota}" vs Sheets="${sheetsData.Nota}"`);
        }
        if (localData.punto_entrega !== sheetsData.PuntoEntrega) {
            diferencias.push(`PuntoEntrega: Local="${localData.punto_entrega}" vs Sheets="${sheetsData.PuntoEntrega}"`);
        }
        
        console.log('📊 DIFERENCIAS EN DATOS:');
        if (diferencias.length > 0) {
            diferencias.forEach((diff, i) => {
                console.log(`   ${i+1}. ${diff}`);
            });
        } else {
            console.log('   ✅ No hay diferencias en los datos');
        }
        
        // 6. Diagnóstico del problema
        console.log('\n6. 🔍 DIAGNÓSTICO DEL PROBLEMA:');
        
        if (sheetsEsPosterior && diferencias.length > 0) {
            console.log('❌ PROBLEMA IDENTIFICADO:');
            console.log('   - Sheets tiene fecha posterior');
            console.log('   - Hay diferencias en los datos');
            console.log('   - PERO el sistema está priorizando LOCAL');
            console.log('   - CAUSA PROBABLE: Error en la lógica de comparación LWW');
        } else if (!sheetsEsPosterior) {
            console.log('✅ COMPORTAMIENTO CORRECTO:');
            console.log('   - Local tiene fecha igual o posterior');
            console.log('   - Es correcto priorizar LOCAL');
        } else {
            console.log('⚠️ CASO ESPECIAL:');
            console.log('   - Sheets es posterior pero no hay diferencias');
            console.log('   - Revisar lógica de detección de cambios');
        }
        
        console.log('\n🏁 [DIAG-LWW-PRECISION] Diagnóstico completado');
        
    } catch (error) {
        console.error('❌ Error en diagnóstico LWW precisión fechas:', error.message);
    } finally {
        await db.end();
    }
}

// Ejecutar diagnóstico
diagnosticoLwwPrecisionFechas()
    .then(() => {
        console.log('\n✅ Diagnóstico LWW precisión fechas completado exitosamente');
        process.exit(0);
    })
    .catch(console.error);
