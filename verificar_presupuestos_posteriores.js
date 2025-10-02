/**
 * Verificar cuántos presupuestos posteriores al cutoff_at existen
 * Tanto en local como en Sheets
 */

const { Pool } = require('pg');
const { readSheetWithHeaders } = require('./src/services/gsheets/client_with_logs');

// Configuración de base de datos
const dbConfig = {
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
};

async function verificarPresupuestosPosteriores() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 [VERIFICAR-POSTERIORES] ===== VERIFICANDO PRESUPUESTOS POSTERIORES =====');
        
        // 1. Obtener cutoff_at actual
        console.log('\n1. Obteniendo cutoff_at actual...');
        
        const cutoffQuery = `
            SELECT cutoff_at, hoja_id,
                   TO_CHAR(cutoff_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI:SS') as formato_ar
            FROM presupuestos_config 
            WHERE activo = true 
            ORDER BY fecha_creacion DESC 
            LIMIT 1
        `;
        
        const cutoffResult = await db.query(cutoffQuery);
        if (cutoffResult.rows.length === 0) {
            console.log('❌ No se encontró configuración con cutoff_at');
            return;
        }
        
        const config = cutoffResult.rows[0];
        const cutoffAt = new Date(config.cutoff_at);
        
        console.log('📅 cutoff_at:', {
            iso: cutoffAt.toISOString(),
            formato_ar: config.formato_ar
        });
        
        // 2. Verificar presupuestos posteriores en LOCAL
        console.log('\n2. Verificando presupuestos posteriores en LOCAL...');
        
        const localPosterioresQuery = `
            SELECT id_presupuesto_ext, agente, fecha_actualizacion,
                   TO_CHAR(fecha_actualizacion AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI:SS') as formato_ar,
                   EXTRACT(EPOCH FROM fecha_actualizacion)::bigint - EXTRACT(EPOCH FROM $1::timestamp)::bigint as diff_seconds
            FROM presupuestos 
            WHERE activo = true 
              AND id_presupuesto_ext IS NOT NULL
              AND fecha_actualizacion > $1
            ORDER BY fecha_actualizacion DESC
            LIMIT 10
        `;
        
        const localPosteriores = await db.query(localPosterioresQuery, [cutoffAt]);
        
        console.log(`📊 Presupuestos posteriores en LOCAL: ${localPosteriores.rowCount}`);
        
        if (localPosteriores.rowCount > 0) {
            console.log('📋 Muestra de presupuestos posteriores en LOCAL:');
            localPosteriores.rows.slice(0, 5).forEach((p, i) => {
                console.log(`   ${i+1}. ID: ${p.id_presupuesto_ext}`);
                console.log(`      Agente: ${p.agente}`);
                console.log(`      Fecha: ${p.formato_ar}`);
                console.log(`      Diferencia: ${Math.round(p.diff_seconds)} segundos después de cutoff_at`);
            });
        } else {
            console.log('✅ No hay presupuestos posteriores al cutoff_at en LOCAL');
        }
        
        // 3. Verificar presupuestos posteriores en SHEETS
        console.log('\n3. Verificando presupuestos posteriores en SHEETS...');
        
        try {
            const presupuestosSheets = await readSheetWithHeaders(config.hoja_id, 'A:O', 'Presupuestos');
            console.log(`📊 Total presupuestos en Sheets: ${presupuestosSheets.rows.length}`);
            
            // Función de parseo corregida
            function parseLastModifiedRobust(value) {
                if (!value) return new Date(0);
                
                try {
                    if (typeof value === 'number') {
                        const excelEpoch = new Date(1900, 0, 1);
                        const days = value - 2;
                        return new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
                    }
                    
                    if (typeof value === 'string') {
                        const ddmmyyyyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/;
                        const match = value.match(ddmmyyyyRegex);
                        if (match) {
                            const [, day, month, year, hour, minute, second] = match;
                            return new Date(year, month - 1, day, hour, minute, second);
                        }
                    }
                    
                    return new Date(value);
                } catch (e) {
                    return new Date(0);
                }
            }
            
            const presupuestosPosterioresSheets = [];
            
            for (const row of presupuestosSheets.rows) {
                const id = (row[presupuestosSheets.headers[0]] || '').toString().trim();
                const sheetLastModified = row[presupuestosSheets.headers[13]]; // columna N
                
                if (!id || !sheetLastModified) continue;
                
                const sheetTimestamp = parseLastModifiedRobust(sheetLastModified);
                
                if (sheetTimestamp > cutoffAt) {
                    const diferenciaMins = Math.round((sheetTimestamp.getTime() - cutoffAt.getTime()) / (1000 * 60));
                    presupuestosPosterioresSheets.push({
                        id: id,
                        agente: row[presupuestosSheets.headers[3]] || 'N/A',
                        lastModified: sheetLastModified,
                        timestamp: sheetTimestamp,
                        diferenciaMins: diferenciaMins
                    });
                }
            }
            
            console.log(`📊 Presupuestos posteriores en SHEETS: ${presupuestosPosterioresSheets.length}`);
            
            if (presupuestosPosterioresSheets.length > 0) {
                console.log('📋 Muestra de presupuestos posteriores en SHEETS:');
                presupuestosPosterioresSheets.slice(0, 5).forEach((p, i) => {
                    console.log(`   ${i+1}. ID: ${p.id}`);
                    console.log(`      Agente: ${p.agente}`);
                    console.log(`      LastModified: ${p.lastModified}`);
                    console.log(`      Diferencia: ${p.diferenciaMins} minutos después de cutoff_at`);
                });
            } else {
                console.log('✅ No hay presupuestos posteriores al cutoff_at en SHEETS');
            }
            
        } catch (error) {
            console.error('❌ Error leyendo Sheets:', error.message);
        }
        
        // 4. Resumen
        console.log('\n4. 📊 RESUMEN:');
        console.log(`   cutoff_at: ${config.formato_ar}`);
        console.log(`   Posteriores en LOCAL: ${localPosteriores.rowCount}`);
        console.log(`   Posteriores en SHEETS: ${presupuestosPosterioresSheets?.length || 0}`);
        
        if (localPosteriores.rowCount === 0 && (presupuestosPosterioresSheets?.length || 0) === 0) {
            console.log('\n✅ ESTADO NORMAL: No hay presupuestos posteriores al cutoff_at');
            console.log('✅ Para probar LWW, necesitas modificar un presupuesto en Sheets');
        } else if (localPosteriores.rowCount > 0) {
            console.log('\n⚠️ HAY PRESUPUESTOS POSTERIORES EN LOCAL');
            console.log('⚠️ Estos se enviarán a Sheets en la fase PUSH');
        } else if ((presupuestosPosterioresSheets?.length || 0) > 0) {
            console.log('\n🎯 HAY PRESUPUESTOS POSTERIORES EN SHEETS');
            console.log('🎯 Estos DEBERÍAN actualizarse en local con LWW REAL');
        }
        
        console.log('\n🏁 [VERIFICAR-POSTERIORES] Verificación completada');
        
    } catch (error) {
        console.error('❌ Error en verificación de presupuestos posteriores:', error.message);
    } finally {
        await db.end();
    }
}

// Ejecutar verificación
verificarPresupuestosPosteriores()
    .then(() => {
        console.log('\n✅ Verificación de presupuestos posteriores completada exitosamente');
        process.exit(0);
    })
    .catch(console.error);
