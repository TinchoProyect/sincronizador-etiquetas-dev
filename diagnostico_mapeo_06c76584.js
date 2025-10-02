require('dotenv').config();

const { pool } = require('./src/presupuestos/config/database');
const { readSheetWithHeaders } = require('./src/services/gsheets/client_with_logs');

async function diagnosticoMapeo06c76584() {
    console.log('🔍 [DIAG-MAPEO] === DIAGNÓSTICO CON TABLA DE MAPEO - PRESUPUESTO 06c76584 ===\n');
    
    try {
        // 1. LEER DATOS LOCALES
        console.log('📋 [DIAG-MAPEO] 1. DATOS LOCALES:');
        const rsLocal = await pool.query(`
            SELECT id, id_presupuesto_ext, articulo, cantidad, valor1, precio1
            FROM public.presupuestos_detalles 
            WHERE id_presupuesto_ext = $1
            ORDER BY id
        `, ['06c76584']);
        
        console.log(`Encontrados ${rsLocal.rows.length} detalles locales\n`);
        
        // 2. LEER DATOS DE SHEETS
        console.log('📋 [DIAG-MAPEO] 2. DATOS DE SHEETS:');
        const config = { hoja_id: process.env.SPREADSHEET_ID };
        const existingSheetData = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
        
        console.log(`Leídas ${existingSheetData.rows?.length || 0} filas de Sheets\n`);
        
        // 3. CONSTRUIR MAP_LOCAL (clave id_presupuesto_ext|articulo → local_detalle_id)
        const MAP_LOCAL = new Map();
        rsLocal.rows.forEach(row => {
            const clave = `${String(row.id_presupuesto_ext).trim()}|${String(row.articulo).trim()}`;
            MAP_LOCAL.set(clave, {
                local_detalle_id: row.id,
                cantidad: row.cantidad,
                valor1: row.valor1,
                precio1: row.precio1
            });
        });
        
        // 4. CONSTRUIR MAP_SHEETS (clave IdPresupuesto|Articulo → id_detalle_presupuesto, fila)
        const MAP_SHEETS = new Map();
        const duplicadosSheets = [];
        
        if (existingSheetData.rows) {
            existingSheetData.rows.forEach((row, index) => {
                const idDetallePresupuesto = String(row[0] || '').trim(); // Columna A
                const idPresupuesto = String(row[1] || '').trim();        // Columna B
                const articulo = String(row[2] || '').trim();             // Columna C
                
                if (idPresupuesto && articulo) {
                    const clave = `${idPresupuesto}|${articulo}`;
                    const fila = index + 2; // +2 porque hay header y es 1-indexed
                    
                    if (MAP_SHEETS.has(clave)) {
                        // Duplicado detectado
                        duplicadosSheets.push({
                            clave,
                            filaAnterior: MAP_SHEETS.get(clave).fila,
                            filaActual: fila,
                            idAnterior: MAP_SHEETS.get(clave).id_detalle_presupuesto,
                            idActual: idDetallePresupuesto
                        });
                    } else {
                        MAP_SHEETS.set(clave, {
                            id_detalle_presupuesto: idDetallePresupuesto,
                            fila: fila
                        });
                    }
                }
            });
        }
        
        console.log(`MAP_SHEETS construido: ${MAP_SHEETS.size} claves únicas`);
        if (duplicadosSheets.length > 0) {
            console.log(`⚠️ Duplicados detectados en Sheets: ${duplicadosSheets.length}`);
        }
        console.log('');
        
        // 5. CONSULTAR TABLA DE MAPEO
        console.log('📋 [DIAG-MAPEO] 3. CONSULTA TABLA DE MAPEO:');
        const localIds = rsLocal.rows.map(r => r.id);
        
        let mapeoQuery = '';
        let mapeoResult = { rows: [] };
        
        if (localIds.length > 0) {
            mapeoQuery = `
                SELECT local_detalle_id, id_detalle_presupuesto, fuente
                FROM public.presupuestos_detalles_map 
                WHERE local_detalle_id = ANY($1)
            `;
            
            try {
                mapeoResult = await pool.query(mapeoQuery, [localIds]);
                console.log(`Mapeos encontrados: ${mapeoResult.rows.length}`);
            } catch (error) {
                console.log(`Error consultando mapeo: ${error.message}`);
            }
        }
        
        // Crear mapa de mapeos
        const MAPEOS = new Map();
        mapeoResult.rows.forEach(row => {
            MAPEOS.set(row.local_detalle_id, {
                id_detalle_presupuesto: row.id_detalle_presupuesto,
                fuente: row.fuente
            });
        });
        
        console.log('');
        
        // 6. TABLA DE CLASIFICACIÓN
        console.log('📋 [DIAG-MAPEO] 4. TABLA DE CLASIFICACIÓN (8 filas):');
        console.log('| LOCAL_ID | ID_PRES_EXT | ARTICULO | MAP.ID_SHEET | LOOKUP.ID_SHEET | LOOKUP.FILA | DECISIÓN |');
        console.log('|----------|-------------|----------|--------------|-----------------|-------------|----------|');
        
        let foundPorMapeo = 0;
        let foundPorLookupBC = 0;
        
        rsLocal.rows.forEach(row => {
            const clave = `${String(row.id_presupuesto_ext).trim()}|${String(row.articulo).trim()}`;
            
            // Buscar en mapeo
            const mapeo = MAPEOS.get(row.id);
            const mapIdSheet = mapeo ? mapeo.id_detalle_presupuesto : null;
            
            // Buscar en Sheets por clave B+C
            const lookup = MAP_SHEETS.get(clave);
            const lookupIdSheet = lookup ? lookup.id_detalle_presupuesto : null;
            const lookupFila = lookup ? lookup.fila : null;
            
            // Determinar decisión
            let decision = 'INSERT';
            if (mapIdSheet) {
                decision = 'UPDATE';
                foundPorMapeo++;
            } else if (lookupIdSheet) {
                decision = 'UPDATE';
                foundPorLookupBC++;
            }
            
            console.log(`| ${String(row.id).padEnd(8)} | ${String(row.id_presupuesto_ext).padEnd(11)} | ${String(row.articulo).padEnd(8)} | ${String(mapIdSheet || 'NULL').padEnd(12)} | ${String(lookupIdSheet || 'NULL').padEnd(15)} | ${String(lookupFila || 'NULL').padEnd(11)} | ${decision.padEnd(8)} |`);
        });
        
        console.log('');
        
        // 7. RESUMEN
        const updateEsperados = foundPorMapeo + foundPorLookupBC;
        const insertEsperados = 8 - updateEsperados;
        
        console.log('📊 [DIAG-MAPEO] 5. RESUMEN:');
        console.log(`found_por_mapeo = ${foundPorMapeo}`);
        console.log(`found_por_lookup_BC = ${foundPorLookupBC}`);
        console.log(`update_esperados = ${updateEsperados}`);
        console.log(`insert_esperados = ${insertEsperados}`);
        
        if (duplicadosSheets.length > 0) {
            console.log('\n⚠️ [DIAG-MAPEO] DUPLICADOS EN SHEETS:');
            duplicadosSheets.forEach(dup => {
                console.log(`   Clave: ${dup.clave}`);
                console.log(`   Fila ${dup.filaAnterior} (ID: ${dup.idAnterior}) vs Fila ${dup.filaActual} (ID: ${dup.idActual})`);
            });
        } else {
            console.log('\n✅ [DIAG-MAPEO] No se detectaron duplicados en Sheets');
        }
        
        console.log('\n✅ [DIAG-MAPEO] Diagnóstico completado');
        
    } catch (error) {
        console.error('❌ [DIAG-MAPEO] Error:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        try {
            await pool.end();
        } catch (e) {
            console.log('Pool ya cerrado');
        }
    }
}

diagnosticoMapeo06c76584();
