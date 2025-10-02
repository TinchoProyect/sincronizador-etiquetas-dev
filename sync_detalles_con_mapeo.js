require('dotenv').config();

const { pool } = require('./src/presupuestos/config/database');
const { readSheetWithHeaders } = require('./src/services/gsheets/client_with_logs');

/**
 * Sincronización de detalles usando tabla de mapeo como fuente de verdad
 * @param {string} idPresupuesto - ID del presupuesto a sincronizar
 * @param {Object} config - Configuración de Sheets
 * @param {Object} db - Conexión a base de datos
 */
async function sincronizarDetallesConMapeo(idPresupuesto, config, db) {
    console.log(`🔄 [SYNC-MAPEO] === SINCRONIZACIÓN CON MAPEO - PRESUPUESTO ${idPresupuesto} ===\n`);
    
    const resumen = {
        updates: 0,
        inserts: 0,
        errores: 0,
        idsActualizados: [],
        mapeoNuevo: []
    };
    
    try {
        const { getSheets } = require('./src/google/gsheetsClient');
=======
        const sheets = await getSheets();
        
        // 1. LEER DATOS LOCALES
        console.log('📋 [SYNC-MAPEO] 1. Leyendo datos locales...');
        const rsLocal = await db.query(`
            SELECT id, id_presupuesto_ext, articulo, cantidad, valor1, precio1,
                   iva1, diferencia, camp1, camp2, camp3, camp4, camp5, camp6,
                   fecha_actualizacion
            FROM public.presupuestos_detalles 
            WHERE id_presupuesto_ext = $1
            ORDER BY id
        `, [idPresupuesto]);
        
        console.log(`Encontrados ${rsLocal.rows.length} detalles locales`);
        
        if (rsLocal.rows.length === 0) {
            console.log('✅ [SYNC-MAPEO] No hay detalles para sincronizar');
            return resumen;
        }
        
        // 2. CONSULTAR TABLA DE MAPEO
        console.log('📋 [SYNC-MAPEO] 2. Consultando tabla de mapeo...');
        const localIds = rsLocal.rows.map(r => r.id);
        const mapeoResult = await db.query(`
            SELECT local_detalle_id, id_detalle_presupuesto, fuente
            FROM public.presupuestos_detalles_map 
            WHERE local_detalle_id = ANY($1)
        `, [localIds]);
        
        const MAPEOS = new Map();
        mapeoResult.rows.forEach(row => {
            MAPEOS.set(row.local_detalle_id, {
                id_detalle_presupuesto: row.id_detalle_presupuesto,
                fuente: row.fuente
            });
        });
        
        console.log(`Mapeos encontrados: ${mapeoResult.rows.length}`);
        
        // 3. LEER DATOS DE SHEETS COMPLETOS
        console.log('📋 [SYNC-MAPEO] 3. Leyendo datos de Sheets...');
        const existingSheetData = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
        
        // Crear mapa por clave compuesta (IdPresupuesto|Articulo) para lookup
        const MAP_SHEETS_BC = new Map();
        // Crear mapa por ID (columna A) para encontrar filas
        const MAP_SHEETS_ID = new Map();
        
        if (existingSheetData.rows) {
            existingSheetData.rows.forEach((row, index) => {
                const idDetallePresupuesto = String(row[0] || '').trim(); // Columna A
                const idPresupuestoSheet = String(row[1] || '').trim();   // Columna B
                const articuloSheet = String(row[2] || '').trim();        // Columna C
                const fila = index + 2; // +2 porque hay header y es 1-indexed
                
                // Mapa por ID para updates
                if (idDetallePresupuesto) {
                    MAP_SHEETS_ID.set(idDetallePresupuesto, {
                        fila: fila,
                        idPresupuesto: idPresupuestoSheet,
                        articulo: articuloSheet
                    });
                }
                
                // Mapa por clave compuesta para lookup
                if (idPresupuestoSheet && articuloSheet) {
                    const clave = `${idPresupuestoSheet}|${articuloSheet}`;
                    MAP_SHEETS_BC.set(clave, {
                        id_detalle_presupuesto: idDetallePresupuesto,
                        fila: fila
                    });
                }
            });
        }
        
        console.log(`Sheets: ${existingSheetData.rows?.length || 0} filas, ${MAP_SHEETS_ID.size} IDs únicos, ${MAP_SHEETS_BC.size} claves B+C`);
        
        // 4. PROCESAR CADA DETALLE LOCAL
        console.log('📋 [SYNC-MAPEO] 4. Procesando detalles...');
        
        for (const row of rsLocal.rows) {
            try {
                const localId = row.id;
                const clave = `${row.id_presupuesto_ext}|${row.articulo}`;
                
                // Paso 1: Buscar en mapeo
                const mapeo = MAPEOS.get(localId);
                let idSheetParaUpdate = null;
                let filaParaUpdate = null;
                let decision = 'INSERT';
                
                if (mapeo) {
                    // HAY MAPEO → buscar fila en Sheets por ID
                    const sheetInfo = MAP_SHEETS_ID.get(mapeo.id_detalle_presupuesto);
                    if (sheetInfo) {
                        idSheetParaUpdate = mapeo.id_detalle_presupuesto;
                        filaParaUpdate = sheetInfo.fila;
                        decision = 'UPDATE';
                        console.log(`[MAPEO] Local ${localId} → Sheet ID ${idSheetParaUpdate} (fila ${filaParaUpdate}) → UPDATE`);
                    } else {
                        console.log(`⚠️ [MAPEO] Local ${localId} tiene mapeo a ${mapeo.id_detalle_presupuesto} pero no existe en Sheets → INSERT`);
                    }
                } else {
                    // NO HAY MAPEO → buscar por clave compuesta B+C
                    const lookupBC = MAP_SHEETS_BC.get(clave);
                    if (lookupBC) {
                        idSheetParaUpdate = lookupBC.id_detalle_presupuesto;
                        filaParaUpdate = lookupBC.fila;
                        decision = 'UPDATE';
                        console.log(`[LOOKUP] Local ${localId} → Sheet ID ${idSheetParaUpdate} (fila ${filaParaUpdate}) → UPDATE + crear mapeo`);
                        
                        // Crear mapeo faltante
                        await db.query(`
                            INSERT INTO public.presupuestos_detalles_map 
                            (local_detalle_id, id_detalle_presupuesto, fuente)
                            VALUES ($1, $2, $3)
                            ON CONFLICT (local_detalle_id) DO UPDATE SET
                                id_detalle_presupuesto = EXCLUDED.id_detalle_presupuesto,
                                fuente = EXCLUDED.fuente
                        `, [localId, idSheetParaUpdate, 'Lookup']);
                        
                        resumen.mapeoNuevo.push({ localId, idSheet: idSheetParaUpdate });
                    } else {
                        console.log(`[INSERT] Local ${localId} → clave ${clave} no existe → INSERT nuevo`);
                    }
                }
                
                // Preparar datos para Sheets (A→Q)
                const nowISO = new Date().toISOString();
                const nowAR = new Intl.DateTimeFormat('es-AR', {
                    timeZone: 'America/Argentina/Buenos_Aires',
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hour12: false
                }).formatToParts(new Date()).reduce((acc, part) => {
                    acc[part.type] = part.value;
                    return acc;
                }, {});
                const lastModifiedAR = `${nowAR.day}/${nowAR.month}/${nowAR.year} ${nowAR.hour}:${nowAR.minute}:${nowAR.second}`;
                
                // Función helper para números
                const num2 = (v) => v == null ? 0 : Number(v);
                const num3 = (v) => v == null ? 0 : Number(v);
                
                if (decision === 'UPDATE') {
                    // UPDATE: actualizar fila existente
                    const mappedRow = [
                        idSheetParaUpdate,              // A  IDDetallePresupuesto (NO cambiar)
                        row.id_presupuesto_ext,         // B  IdPresupuesto
                        row.articulo,                   // C  Articulo
                        num2(row.cantidad),             // D  Cantidad
                        num2(row.valor1),               // E  Valor1
                        num2(row.precio1),              // F  Precio1
                        num2(row.iva1),                 // G  IVA1
                        num2(row.diferencia),           // H  Diferencia
                        num2(row.camp1),                // I  Camp1
                        num3(row.camp2),                // J  Camp2
                        num2(row.camp3),                // K  Camp3
                        num2(row.camp4),                // L  Camp4
                        num2(row.camp5),                // M  Camp5
                        num2(row.camp6),                // N  Camp6
                        '',                             // O  Condicion (vacío)
                        lastModifiedAR,                 // P  LastModified (AR)
                        true                            // Q  Activo
                    ];
                    
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: config.hoja_id,
                        range: `DetallesPresupuestos!A${filaParaUpdate}:Q${filaParaUpdate}`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: {
                            values: [mappedRow],
                            majorDimension: 'ROWS'
                        }
                    });
                    
                    resumen.updates++;
                    resumen.idsActualizados.push(idSheetParaUpdate);
                    console.log(`✅ [UPDATE] Fila ${filaParaUpdate} actualizada con ID ${idSheetParaUpdate}`);
                    
                } else {
                    // INSERT: nueva fila
                    const nuevoId = Math.random().toString(36).substr(2, 8);
                    
                    const mappedRow = [
                        nuevoId,                        // A  IDDetallePresupuesto (nuevo)
                        row.id_presupuesto_ext,         // B  IdPresupuesto
                        row.articulo,                   // C  Articulo
                        num2(row.cantidad),             // D  Cantidad
                        num2(row.valor1),               // E  Valor1
                        num2(row.precio1),              // F  Precio1
                        num2(row.iva1),                 // G  IVA1
                        num2(row.diferencia),           // H  Diferencia
                        num2(row.camp1),                // I  Camp1
                        num3(row.camp2),                // J  Camp2
                        num2(row.camp3),                // K  Camp3
                        num2(row.camp4),                // L  Camp4
                        num2(row.camp5),                // M  Camp5
                        num2(row.camp6),                // N  Camp6
                        '',                             // O  Condicion (vacío)
                        lastModifiedAR,                 // P  LastModified (AR)
                        true                            // Q  Activo
                    ];
                    
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: config.hoja_id,
                        range: 'DetallesPresupuestos!A1:Q1',
                        valueInputOption: 'USER_ENTERED',
                        insertDataOption: 'INSERT_ROWS',
                        requestBody: {
                            values: [mappedRow],
                            majorDimension: 'ROWS'
                        }
                    });
                    
                    // Crear mapeo
                    await db.query(`
                        INSERT INTO public.presupuestos_detalles_map 
                        (local_detalle_id, id_detalle_presupuesto, fuente)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (local_detalle_id) DO UPDATE SET
                            id_detalle_presupuesto = EXCLUDED.id_detalle_presupuesto,
                            fuente = EXCLUDED.fuente
                    `, [localId, nuevoId, 'Local']);
                    
                    resumen.inserts++;
                    resumen.mapeoNuevo.push({ localId, idSheet: nuevoId });
                    console.log(`✅ [INSERT] Nueva fila insertada con ID ${nuevoId}`);
                }
                
            } catch (error) {
                console.error(`❌ [ERROR] Detalle ${row.id}: ${error.message}`);
                resumen.errores++;
            }
        }
        
        // 5. RESUMEN FINAL
        console.log('\n📊 [SYNC-MAPEO] 5. RESUMEN FINAL:');
        console.log(`Updates: ${resumen.updates}`);
        console.log(`Inserts: ${resumen.inserts}`);
        console.log(`Errores: ${resumen.errores}`);
        console.log(`IDs actualizados: ${resumen.idsActualizados.join(', ')}`);
        console.log(`Mapeos nuevos: ${resumen.mapeoNuevo.length}`);
        
        if (resumen.mapeoNuevo.length > 0) {
            console.log('Mapeos creados:');
            resumen.mapeoNuevo.forEach(m => {
                console.log(`  Local ${m.localId} → Sheet ${m.idSheet}`);
            });
        }
        
        console.log('\n✅ [SYNC-MAPEO] Sincronización completada');
        
    } catch (error) {
        console.error('❌ [SYNC-MAPEO] Error:', error.message);
        resumen.errores++;
    }
    
    return resumen;
}

// Función principal para ejecutar
async function ejecutarSincronizacion() {
    try {
        const config = { 
            hoja_id: process.env.SPREADSHEET_ID,
            hoja_url: process.env.SPREADSHEET_URL || 'https://docs.google.com/spreadsheets/d/' + process.env.SPREADSHEET_ID
        };
        
        const resultado = await sincronizarDetallesConMapeo('06c76584', config, pool);
        
        console.log('\n🎯 [RESULTADO ESPERADO PARA 06c76584]:');
        console.log('- Updates: 8 (usando IDs de mapeo existente)');
        console.log('- Inserts: 0 (no debe generar nuevos IDs)');
        console.log(`- Resultado real: Updates: ${resultado.updates}, Inserts: ${resultado.inserts}`);
        
        if (resultado.updates === 8 && resultado.inserts === 0) {
            console.log('✅ ÉXITO: Comportamiento correcto confirmado');
        } else {
            console.log('❌ ERROR: Comportamiento inesperado');
        }
        
    } catch (error) {
        console.error('❌ Error ejecutando sincronización:', error.message);
    } finally {
        await pool.end();
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    ejecutarSincronizacion();
}

module.exports = {
    sincronizarDetallesConMapeo
};
