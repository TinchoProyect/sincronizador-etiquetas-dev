/**
 * Diagnóstico de precisión LWW - Verificar comparación exacta de timestamps
 * Analiza si el filtro de horas, minutos y segundos funciona correctamente
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

async function diagnosticarPrecisionLWW() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 [DIAG-PRECISION-LWW] ===== DIAGNÓSTICO DE PRECISIÓN LWW =====');
        
        // 1. Obtener fecha de última sincronización con precisión completa
        console.log('\n1. Obteniendo fecha de última sincronización con precisión completa...');
        
        const ultimaSyncQuery = `
            SELECT fecha_sync, 
                   EXTRACT(EPOCH FROM fecha_sync) as epoch_seconds,
                   TO_CHAR(fecha_sync, 'DD/MM/YYYY HH24:MI:SS') as formato_ar
            FROM presupuestos_sync_log 
            WHERE exitoso = true 
            ORDER BY fecha_sync DESC 
            LIMIT 1
        `;
        
        const ultimaSyncResult = await db.query(ultimaSyncQuery);
        
        if (ultimaSyncResult.rows.length === 0) {
            console.log('❌ No se encontró registro de última sincronización');
            return;
        }
        
        const ultimaSync = ultimaSyncResult.rows[0];
        const fechaUltimaSync = new Date(ultimaSync.fecha_sync);
        
        console.log('📅 Última sincronización (precisión completa):');
        console.log(`   ISO: ${fechaUltimaSync.toISOString()}`);
        console.log(`   Epoch: ${ultimaSync.epoch_seconds}`);
        console.log(`   Formato AR: ${ultimaSync.formato_ar}`);
        console.log(`   Milisegundos: ${fechaUltimaSync.getMilliseconds()}`);
        
        // 2. Simular parseo de LastModified de Sheets
        console.log('\n2. Simulando parseo de LastModified de Sheets...');
        
        // Función de parseo igual que en el código real
        function parseLastModifiedRobust(value) {
            if (!value) return new Date(0);
            
            try {
                // Si es número (Excel serial date)
                if (typeof value === 'number') {
                    const excelEpoch = new Date(1900, 0, 1);
                    const days = value - 2;
                    return new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
                }
                
                // Si es string, intentar parsear formato dd/mm/yyyy hh:mm:ss (AR)
                if (typeof value === 'string') {
                    const ddmmyyyyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/;
                    const match = value.match(ddmmyyyyRegex);
                    if (match) {
                        const [, day, month, year, hour, minute, second] = match;
                        // Crear fecha en zona horaria de Argentina
                        return new Date(year, month - 1, day, hour, minute, second);
                    }
                }
                
                return new Date(value);
            } catch (e) {
                return new Date(0);
            }
        }
        
        // Simular diferentes formatos de LastModified de Sheets
        const formatosSheets = [
            {
                formato: 'String DD/MM/YYYY HH:MM:SS',
                valor: '30/09/2025 00:30:00', // 30 min después de última sync
                esperado: 'POSTERIOR'
            },
            {
                formato: 'String DD/MM/YYYY HH:MM:SS (mismo minuto)',
                valor: '29/09/2025 23:24:30', // 4 segundos después
                esperado: 'POSTERIOR'
            },
            {
                formato: 'String DD/MM/YYYY HH:MM:SS (anterior)',
                valor: '29/09/2025 23:20:00', // 4 min antes
                esperado: 'ANTERIOR'
            },
            {
                formato: 'Número Excel (posterior)',
                valor: 45565.0, // Aproximadamente 30/09/2025
                esperado: 'POSTERIOR'
            }
        ];
        
        console.log('🔍 Probando parseo de diferentes formatos:');
        
        for (const formato of formatosSheets) {
            const sheetTimestamp = parseLastModifiedRobust(formato.valor);
            const esPosterior = sheetTimestamp > fechaUltimaSync;
            const diferenciaMilisegundos = sheetTimestamp.getTime() - fechaUltimaSync.getTime();
            const diferenciaSegundos = Math.round(diferenciaMilisegundos / 1000);
            
            console.log(`\n📊 ${formato.formato}:`);
            console.log(`   Valor original: ${formato.valor}`);
            console.log(`   Parseado: ${sheetTimestamp.toISOString()}`);
            console.log(`   Es posterior: ${esPosterior}`);
            console.log(`   Diferencia: ${diferenciaSegundos} segundos`);
            console.log(`   Esperado: ${formato.esperado}`);
            
            const esCorrect = (esPosterior && formato.esperado === 'POSTERIOR') || 
                             (!esPosterior && formato.esperado === 'ANTERIOR');
            
            console.log(`   Resultado: ${esCorrect ? '✅ CORRECTO' : '❌ INCORRECTO'}`);
        }
        
        // 3. Verificar presupuestos reales modificados recientemente
        console.log('\n3. Verificando presupuestos reales modificados recientemente...');
        
        const presupuestosRecientesQuery = `
            SELECT id_presupuesto_ext, fecha_actualizacion,
                   EXTRACT(EPOCH FROM fecha_actualizacion) as epoch_local,
                   EXTRACT(EPOCH FROM $1) as epoch_ultima_sync,
                   EXTRACT(EPOCH FROM fecha_actualizacion) - EXTRACT(EPOCH FROM $1) as diff_seconds,
                   fecha_actualizacion > $1 as es_posterior
            FROM presupuestos 
            WHERE activo = true 
              AND id_presupuesto_ext IS NOT NULL
            ORDER BY fecha_actualizacion DESC
            LIMIT 5
        `;
        
        const presupuestosRecientes = await db.query(presupuestosRecientesQuery, [fechaUltimaSync]);
        
        console.log('📊 Presupuestos locales vs última sincronización:');
        presupuestosRecientes.rows.forEach((p, i) => {
            console.log(`   ${i+1}. ID: ${p.id_presupuesto_ext}`);
            console.log(`      Local: ${new Date(p.fecha_actualizacion).toISOString()}`);
            console.log(`      Diferencia: ${p.diff_seconds} segundos`);
            console.log(`      Es posterior: ${p.es_posterior}`);
        });
        
        // 4. Verificar si hay problema en zona horaria
        console.log('\n4. Verificando zona horaria...');
        
        const ahoraLocal = new Date();
        const ahoraAR = new Date().toLocaleString('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires'
        });
        
        console.log('🕐 Verificación de zona horaria:');
        console.log(`   Ahora UTC: ${ahoraLocal.toISOString()}`);
        console.log(`   Ahora AR: ${ahoraAR}`);
        console.log(`   Última sync: ${fechaUltimaSync.toISOString()}`);
        
        // 5. Simular comparación real con presupuesto modificado
        console.log('\n5. Simulando comparación real con presupuesto modificado...');
        
        // Simular que modificamos un presupuesto en Sheet AHORA
        const ahoraMas1Min = new Date(Date.now() + 60 * 1000); // +1 minuto
        const formatoSheetSimulado = `30/09/2025 ${ahoraMas1Min.getHours()}:${ahoraMas1Min.getMinutes().toString().padStart(2, '0')}:${ahoraMas1Min.getSeconds().toString().padStart(2, '0')}`;
        
        const sheetTimestampSimulado = parseLastModifiedRobust(formatoSheetSimulado);
        const localTimestampSimulado = fechaUltimaSync; // Simular que local no cambió
        
        console.log('🎯 Simulación de modificación en Sheet:');
        console.log(`   Sheet LastModified: ${formatoSheetSimulado}`);
        console.log(`   Sheet parseado: ${sheetTimestampSimulado.toISOString()}`);
        console.log(`   Local timestamp: ${localTimestampSimulado.toISOString()}`);
        console.log(`   Última sync: ${fechaUltimaSync.toISOString()}`);
        
        const pasaFiltroLWW = sheetTimestampSimulado > fechaUltimaSync;
        const sheetMasRecienteQueLocal = sheetTimestampSimulado > localTimestampSimulado;
        
        console.log(`   Pasa filtro LWW (Sheet > última_sync): ${pasaFiltroLWW}`);
        console.log(`   Sheet > Local: ${sheetMasRecienteQueLocal}`);
        console.log(`   DEBERÍA actualizar: ${pasaFiltroLWW && sheetMasRecienteQueLocal}`);
        
        if (pasaFiltroLWW && sheetMasRecienteQueLocal) {
            console.log('   ✅ CORRECTO: Debería actualizar desde Sheet');
        } else {
            console.log('   ❌ PROBLEMA: NO debería actualizar (revisar lógica)');
        }
        
        console.log('\n🏁 [DIAG-PRECISION-LWW] Diagnóstico completado');
        
    } catch (error) {
        console.error('❌ Error en diagnóstico de precisión LWW:', error.message);
    } finally {
        await db.end();
    }
}

// Ejecutar diagnóstico
diagnosticarPrecisionLWW()
    .then(() => {
        console.log('\n✅ Diagnóstico de precisión LWW completado exitosamente');
        process.exit(0);
    })
    .catch(console.error);
