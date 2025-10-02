require('dotenv').config();

const { pool } = require('./src/presupuestos/config/database');
const { readSheetWithHeaders } = require('./src/services/gsheets/client_with_logs');

async function ejecutarBackfillReal() {
    console.log('🔍 [BACKFILL-MAP] === BACKFILL REAL DE TABLA MAP (7 DÍAS) ===\n');
    
    try {
        // 1. Leer datos locales recientes (7 días)
        console.log('📋 [BACKFILL-MAP] 1. Leyendo datos locales recientes...');
        const rsLocal = await pool.query(`
            SELECT d.id as local_detalle_id,
                   d.id_presupuesto_ext as sheet_presupuesto_id,
                   d.articulo,
                   d.cantidad,
                   d.fecha_actualizacion
            FROM public.presupuestos_detalles d
            WHERE d.fecha_actualizacion >= now() - interval '7 days'
            ORDER BY d.id
        `);
        
        console.log(`Encontrados ${rsLocal.rows.length} detalles locales recientes`);
        
        // 2. Leer datos de Google Sheets
        console.log('📋 [BACKFILL-MAP] 2. Leyendo datos de Google Sheets...');
        const config = { hoja_id: process.env.SPREADSHEET_ID };
        const sheetsData = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
        
        console.log(`Leídas ${sheetsData.rows?.length || 0} filas de Sheets`);
        
        // 3. Crear mapa de lookup de Sheets
        const mapaSheets = new Map();
        const conflictosSheets = new Map();
        
        if (sheetsData.rows) {
            sheetsData.rows.forEach((row, index) => {
                // Usar el formato de objeto que devuelve readSheetWithHeaders
                const idDetallePresupuesto = String(row.IDDetallePresupuesto || '').trim();
                const idPresupuesto = String(row.IdPresupuesto || '').trim();
                // CORRECCIÓN: Normalizar articulo como string para comparación
                const articulo = String(row.Articulo || '').trim();
                // CORRECCIÓN: Normalizar cantidad como número con 2 decimales
                const cantidad = parseFloat(row.Cantidad || 0).toFixed(2);
                
                if (idPresupuesto && articulo && cantidad !== '0.00') {
                    const clave = `${idPresupuesto}|${articulo}|${cantidad}`;
                    
                    if (mapaSheets.has(clave)) {
                        // Conflicto detectado
                        if (!conflictosSheets.has(clave)) {
                            conflictosSheets.set(clave, [mapaSheets.get(clave)]);
                        }
                        conflictosSheets.get(clave).push({
                            idDetallePresupuesto,
                            fila: index + 2 // +2 porque hay header y es 1-indexed
                        });
                    } else {
                        mapaSheets.set(clave, {
                            idDetallePresupuesto,
                            fila: index + 2
                        });
                    }
                }
            });
        }
        
        console.log(`Mapa de Sheets creado: ${mapaSheets.size} entradas`);
        console.log(`Conflictos en Sheets: ${conflictosSheets.size}`);
        
        // 4. Procesar emparejes
        console.log('\n📋 [BACKFILL-MAP] 3. Procesando emparejes...');
        let mapeosCreados = 0;
        let conflictosEncontrados = 0;
        let sinEmpareje = 0;
        
        for (const row of rsLocal.rows) {
            // CORRECCIÓN: Normalizar cantidad local como número con 2 decimales para coincidir con Sheets
            const cantidadNormalizada = parseFloat(row.cantidad || 0).toFixed(2);
            const clave = `${String(row.sheet_presupuesto_id).trim()}|${String(row.articulo).trim()}|${cantidadNormalizada}`;
            
            // Verificar si ya existe mapeo
            const existeMapeo = await pool.query(`
                SELECT 1 FROM presupuestos_detalles_map 
                WHERE local_detalle_id = $1
            `, [row.local_detalle_id]);
            
            if (existeMapeo.rows.length > 0) {
                continue; // Ya tiene mapeo
            }
            
            // Verificar conflictos
            if (conflictosSheets.has(clave)) {
                conflictosEncontrados++;
                console.log(`⚠️ [BACKFILL-MAP] Conflicto para clave: ${clave}`);
                continue;
            }
            
            // Buscar empareje único
            const empareje = mapaSheets.get(clave);
            if (empareje) {
                // Crear mapeo
                await pool.query(`
                    INSERT INTO presupuestos_detalles_map (local_detalle_id, id_detalle_presupuesto, fuente)
                    VALUES ($1, $2, $3)
                `, [row.local_detalle_id, empareje.idDetallePresupuesto, 'Local']);
                
                mapeosCreados++;
                console.log(`✅ [BACKFILL-MAP] Mapeo creado: local ${row.local_detalle_id} → sheet ${empareje.idDetallePresupuesto}`);
            } else {
                sinEmpareje++;
                if (sinEmpareje <= 5) { // Solo mostrar primeros 5
                    console.log(`❌ [BACKFILL-MAP] Sin empareje: ${clave}`);
                }
            }
        }
        
        // 5. Resumen
        console.log('\n📊 [BACKFILL-MAP] 4. RESUMEN:');
        console.log(`Mapeos creados: ${mapeosCreados}`);
        console.log(`Conflictos encontrados: ${conflictosEncontrados}`);
        console.log(`Sin empareje: ${sinEmpareje}`);
        console.log(`Total procesados: ${rsLocal.rows.length}`);
        
        if (mapeosCreados > 0) {
            console.log('\n✅ [BACKFILL-MAP] Backfill completado exitosamente');
        } else {
            console.log('\n⚠️ [BACKFILL-MAP] No se crearon mapeos - verificar datos');
        }
        
    } catch (error) {
        console.error('❌ [BACKFILL-MAP] Error:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        try {
            await pool.end();
        } catch (e) {
            console.log('Pool ya cerrado');
        }
    }
}

ejecutarBackfillReal();
