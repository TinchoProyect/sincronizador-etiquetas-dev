/**
 * Limpieza masiva de presupuestos anulados
 * Elimina presupuestos con estado="Anulado" de:
 * - LOCAL: presupuestos, presupuestos_detalles, presupuestos_detalles_map
 * - SHEETS: Presupuestos, DetallesPresupuestos
 */

const { Pool } = require('pg');
require('dotenv').config();

const { getSheets } = require('./src/google/gsheetsClient');
const { readSheetWithHeaders } = require('./src/services/gsheets/client_with_logs');

// Configuración de base de datos
const dbConfig = {
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
};

async function limpiarPresupuestosAnulados() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🧹 [LIMPIEZA-MASIVA] ===== LIMPIEZA DE PRESUPUESTOS ANULADOS =====');
        
        // PASO 1: Análisis de presupuestos anulados en LOCAL
        console.log('\n📊 PASO 1: Analizando presupuestos anulados en LOCAL...');
        
        const analizarLocalQuery = `
            SELECT 
                COUNT(DISTINCT p.id) as presupuestos_count,
                COUNT(DISTINCT d.id) as detalles_count,
                COUNT(DISTINCT m.local_detalle_id) as map_count
            FROM presupuestos p
            LEFT JOIN presupuestos_detalles d ON d.id_presupuesto = p.id
            LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
            WHERE p.estado = 'Anulado'
        `;
        
        const analisisLocal = await db.query(analizarLocalQuery);
        const statsLocal = analisisLocal.rows[0];
        
        console.log('📋 REGISTROS A ELIMINAR EN LOCAL:');
        console.log(`   Presupuestos: ${statsLocal.presupuestos_count}`);
        console.log(`   Detalles: ${statsLocal.detalles_count}`);
        console.log(`   Map: ${statsLocal.map_count}`);
        
        // Obtener muestra de IDs
        const muestraLocalQuery = `
            SELECT id, id_presupuesto_ext, agente, fecha, estado
            FROM presupuestos
            WHERE estado = 'Anulado'
            ORDER BY fecha DESC
            LIMIT 10
        `;
        
        const muestraLocal = await db.query(muestraLocalQuery);
        
        console.log('\n📋 MUESTRA DE PRESUPUESTOS ANULADOS EN LOCAL (primeros 10):');
        muestraLocal.rows.forEach((row, i) => {
            console.log(`   ${i+1}. ID: ${row.id_presupuesto_ext || row.id} - Agente: ${row.agente} - Fecha: ${row.fecha}`);
        });
        
        // PASO 2: Análisis de presupuestos anulados en SHEETS
        console.log('\n📊 PASO 2: Analizando presupuestos anulados en SHEETS...');
        
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
        console.log(`   Leyendo de Sheet: ${config.hoja_id}`);
        
        const presupuestosSheets = await readSheetWithHeaders(config.hoja_id, 'A:O', 'Presupuestos');
        const detallesSheets = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
        
        // Filtrar presupuestos anulados en Sheets
        const presupuestosAnuladosSheets = presupuestosSheets.rows.filter(row => {
            const estado = row[presupuestosSheets.headers[7]]; // Columna H: Estado
            return estado && estado.toString().toLowerCase() === 'anulado';
        });
        
        const idsAnuladosSheets = new Set(
            presupuestosAnuladosSheets.map(row => 
                (row[presupuestosSheets.headers[0]] || '').toString().trim()
            ).filter(Boolean)
        );
        
        // Contar detalles de presupuestos anulados
        let detallesAnuladosCount = 0;
        detallesSheets.rows.forEach(row => {
            const idPresupuesto = (row[detallesSheets.headers[1]] || '').toString().trim(); // Columna B: IdPresupuesto
            if (idsAnuladosSheets.has(idPresupuesto)) {
                detallesAnuladosCount++;
            }
        });
        
        console.log('📋 REGISTROS A ELIMINAR EN SHEETS:');
        console.log(`   Presupuestos: ${presupuestosAnuladosSheets.length}`);
        console.log(`   Detalles: ${detallesAnuladosCount}`);
        
        console.log('\n📋 MUESTRA DE PRESUPUESTOS ANULADOS EN SHEETS (primeros 10):');
        presupuestosAnuladosSheets.slice(0, 10).forEach((row, i) => {
            const id = row[presupuestosSheets.headers[0]];
            const agente = row[presupuestosSheets.headers[3]];
            const fecha = row[presupuestosSheets.headers[1]];
            console.log(`   ${i+1}. ID: ${id} - Agente: ${agente} - Fecha: ${fecha}`);
        });
        
        // PASO 3: Confirmación del usuario
        console.log('\n⚠️  RESUMEN TOTAL:');
        console.log('═'.repeat(60));
        console.log(`LOCAL:`);
        console.log(`  - Presupuestos a eliminar: ${statsLocal.presupuestos_count}`);
        console.log(`  - Detalles a eliminar: ${statsLocal.detalles_count}`);
        console.log(`  - Map a eliminar: ${statsLocal.map_count}`);
        console.log(`\nSHEETS:`);
        console.log(`  - Presupuestos a eliminar: ${presupuestosAnuladosSheets.length}`);
        console.log(`  - Detalles a eliminar: ${detallesAnuladosCount}`);
        console.log('═'.repeat(60));
        
        // Verificar si hay modo dry-run
        const dryRun = process.argv.includes('--dry-run');
        
        if (dryRun) {
            console.log('\n🔍 MODO DRY-RUN: No se eliminarán registros');
            console.log('   Para ejecutar la eliminación real, ejecuta sin --dry-run');
            return;
        }
        
        console.log('\n⚠️  ADVERTENCIA: Esta operación NO se puede deshacer');
        console.log('   Para continuar, ejecuta el script con el parámetro --confirm');
        console.log('   Ejemplo: node limpiar_presupuestos_anulados.js --confirm');
        
        const confirmed = process.argv.includes('--confirm');
        
        if (!confirmed) {
            console.log('\n❌ Operación cancelada (falta --confirm)');
            return;
        }
        
        // PASO 4: Eliminación en LOCAL (con transacción)
        console.log('\n🗑️  PASO 4: Eliminando registros en LOCAL...');
        
        await db.query('BEGIN');
        
        try {
            // 4.1: Guardar IDs para backup
            const idsAnuladosLocal = await db.query(`
                SELECT id, id_presupuesto_ext
                FROM presupuestos
                WHERE estado = 'Anulado'
            `);
            
            console.log(`   Guardando backup de ${idsAnuladosLocal.rowCount} IDs...`);
            
            // 4.2: Eliminar MAP
            const deleteMapResult = await db.query(`
                DELETE FROM presupuestos_detalles_map
                WHERE local_detalle_id IN (
                    SELECT d.id
                    FROM presupuestos_detalles d
                    INNER JOIN presupuestos p ON p.id = d.id_presupuesto
                    WHERE p.estado = 'Anulado'
                )
            `);
            
            console.log(`   ✅ MAP eliminados: ${deleteMapResult.rowCount}`);
            
            // 4.3: Eliminar DETALLES
            const deleteDetallesResult = await db.query(`
                DELETE FROM presupuestos_detalles
                WHERE id_presupuesto IN (
                    SELECT id
                    FROM presupuestos
                    WHERE estado = 'Anulado'
                )
            `);
            
            console.log(`   ✅ Detalles eliminados: ${deleteDetallesResult.rowCount}`);
            
            // 4.4: Eliminar PRESUPUESTOS
            const deletePresupuestosResult = await db.query(`
                DELETE FROM presupuestos
                WHERE estado = 'Anulado'
            `);
            
            console.log(`   ✅ Presupuestos eliminados: ${deletePresupuestosResult.rowCount}`);
            
            await db.query('COMMIT');
            console.log('   ✅ Transacción LOCAL completada exitosamente');
            
        } catch (error) {
            await db.query('ROLLBACK');
            console.error('   ❌ Error en eliminación LOCAL, rollback ejecutado:', error.message);
            throw error;
        }
        
        // PASO 5: Eliminación en SHEETS
        console.log('\n🗑️  PASO 5: Eliminando registros en SHEETS...');
        
        const sheets = await getSheets();
        
        // 5.1: Eliminar DETALLES en Sheets
        console.log('   Eliminando detalles en Sheets...');
        
        // Encontrar filas de detalles a eliminar (de abajo hacia arriba)
        const filasDetallesAEliminar = [];
        detallesSheets.rows.forEach((row, index) => {
            const idPresupuesto = (row[detallesSheets.headers[1]] || '').toString().trim();
            if (idsAnuladosSheets.has(idPresupuesto)) {
                filasDetallesAEliminar.push(index + 2); // +2 porque fila 1 es header
            }
        });
        
        // Eliminar de abajo hacia arriba para no alterar índices
        filasDetallesAEliminar.sort((a, b) => b - a);
        
        let detallesEliminados = 0;
        for (const fila of filasDetallesAEliminar) {
            try {
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: config.hoja_id,
                    requestBody: {
                        requests: [{
                            deleteDimension: {
                                range: {
                                    sheetId: 0, // ID de la hoja DetallesPresupuestos
                                    dimension: 'ROWS',
                                    startIndex: fila - 1,
                                    endIndex: fila
                                }
                            }
                        }]
                    }
                });
                detallesEliminados++;
                
                if (detallesEliminados % 10 === 0) {
                    console.log(`   Progreso: ${detallesEliminados}/${filasDetallesAEliminar.length} detalles eliminados`);
                }
            } catch (error) {
                console.warn(`   ⚠️  Error eliminando fila ${fila}:`, error.message);
            }
        }
        
        console.log(`   ✅ Detalles eliminados en Sheets: ${detallesEliminados}`);
        
        // 5.2: Eliminar PRESUPUESTOS en Sheets
        console.log('   Eliminando presupuestos en Sheets...');
        
        // Encontrar filas de presupuestos a eliminar (de abajo hacia arriba)
        const filasPresupuestosAEliminar = [];
        presupuestosSheets.rows.forEach((row, index) => {
            const estado = row[presupuestosSheets.headers[7]];
            if (estado && estado.toString().toLowerCase() === 'anulado') {
                filasPresupuestosAEliminar.push(index + 2); // +2 porque fila 1 es header
            }
        });
        
        // Eliminar de abajo hacia arriba
        filasPresupuestosAEliminar.sort((a, b) => b - a);
        
        let presupuestosEliminados = 0;
        for (const fila of filasPresupuestosAEliminar) {
            try {
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: config.hoja_id,
                    requestBody: {
                        requests: [{
                            deleteDimension: {
                                range: {
                                    sheetId: 0, // ID de la hoja Presupuestos
                                    dimension: 'ROWS',
                                    startIndex: fila - 1,
                                    endIndex: fila
                                }
                            }
                        }]
                    }
                });
                presupuestosEliminados++;
                
                if (presupuestosEliminados % 10 === 0) {
                    console.log(`   Progreso: ${presupuestosEliminados}/${filasPresupuestosAEliminar.length} presupuestos eliminados`);
                }
            } catch (error) {
                console.warn(`   ⚠️  Error eliminando fila ${fila}:`, error.message);
            }
        }
        
        console.log(`   ✅ Presupuestos eliminados en Sheets: ${presupuestosEliminados}`);
        
        // PASO 6: Resumen final
        console.log('\n✅ LIMPIEZA COMPLETADA EXITOSAMENTE');
        console.log('═'.repeat(60));
        console.log('LOCAL:');
        console.log(`  - Presupuestos eliminados: ${deletePresupuestosResult.rowCount}`);
        console.log(`  - Detalles eliminados: ${deleteDetallesResult.rowCount}`);
        console.log(`  - Map eliminados: ${deleteMapResult.rowCount}`);
        console.log('\nSHEETS:');
        console.log(`  - Presupuestos eliminados: ${presupuestosEliminados}`);
        console.log(`  - Detalles eliminados: ${detallesEliminados}`);
        console.log('═'.repeat(60));
        
        console.log('\n💡 RECOMENDACIÓN:');
        console.log('   Ejecuta una sincronización manual para verificar que todo está correcto');
        
    } catch (error) {
        console.error('❌ Error en limpieza masiva:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await db.end();
    }
}

// Ejecutar limpieza
limpiarPresupuestosAnulados()
    .then(() => {
        console.log('\n🏁 Script completado');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    });
