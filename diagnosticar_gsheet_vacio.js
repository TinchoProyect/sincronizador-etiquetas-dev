/**
 * "Si no baja nada de GSheet, diagnosticar"
 * Diagnóstico cuando Y(GSheet) == 0 tras la corrida
 */

require('dotenv').config();

const { pool } = require('./src/presupuestos/config/database');
const { forwardOnlyState } = require('./src/services/gsheets/forward_only_state');
const { readSheetWithHeaders } = require('./src/services/gsheets/client_with_logs');
const { runForwardOnlySync } = require('./src/services/gsheets/forward_only_sync');

async function diagnosticarGSheetVacio() {
    console.log('🔍 [DIAGNOSTICO-VACIO] === DIAGNÓSTICO GSHEET VACÍO ===\n');
    
    try {
        // Leer configuración actual
        await forwardOnlyState.loadConfig();
        const config = forwardOnlyState.getConfig();
        
        console.log('[DIAGNOSTICO-VACIO] Configuración actual:');
        console.log(`CUTOFF_AT: ${config.CUTOFF_AT}`);
        console.log(`LAST_SEEN_SHEET_ROW: ${config.LAST_SEEN_SHEET_ROW}`);
        
        // Configuración de Sheets
        const sheetsConfig = {
            hoja_id: process.env.SPREADSHEET_ID || '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8'
        };
        
        // Leer datos de la hoja DetallesPresupuestos
        console.log('\n[DIAGNOSTICO-VACIO] Leyendo hoja DetallesPresupuestos...');
        const sheetsData = await readSheetWithHeaders(sheetsConfig.hoja_id, 'A:Q', 'DetallesPresupuestos');
        
        if (!sheetsData.rows || sheetsData.rows.length === 0) {
            console.log('❌ [DIAGNOSTICO-VACIO] No se pudieron leer datos de la hoja');
            return;
        }
        
        console.log(`📊 [DIAGNOSTICO-VACIO] Total filas en hoja: ${sheetsData.rows.length}`);
        
        // Checks en la hoja DetallesPresupuestos
        console.log('\n[DIAGNOSTICO-VACIO] === CHECKS EN DETALLES PRESUPUESTOS ===');
        
        let filasValidas = 0;
        let filasConProblemas = 0;
        let filasMayorRowIndex = 0;
        const problemas = [];
        
        // Analizar últimas 10 filas para diagnóstico
        const ultimasFilas = sheetsData.rows.slice(-10);
        
        console.log('\n📋 [DIAGNOSTICO-VACIO] Analizando últimas 10 filas:');
        console.log('| Fila | IdPresupuesto | Articulo | Cantidad | Activo | LastModified | _rowIndex | Problemas |');
        console.log('|------|---------------|----------|----------|--------|--------------|-----------|-----------|');
        
        ultimasFilas.forEach((row, index) => {
            const fila = sheetsData.rows.length - 10 + index + 1;
            const idPresupuesto = String(row[1] || '').trim(); // Columna B
            const articulo = String(row[2] || '').trim();      // Columna C
            const cantidad = row[3];                           // Columna D
            const activo = row[16];                           // Columna Q
            const lastModified = row[15];                     // Columna P
            const rowIndex = row._rowIndex || 0;
            
            const problemasRow = [];
            
            // Check IdPresupuesto: string no vacío
            if (!idPresupuesto) {
                problemasRow.push('IdPresupuesto vacío');
            }
            
            // Check Articulo: normalizado a string
            const articuloNormalizado = String(articulo).trim();
            if (!articuloNormalizado) {
                problemasRow.push('Articulo vacío');
            }
            
            // Check Cantidad: número > 0
            const cantidadNormalizada = parseFloat(cantidad);
            if (isNaN(cantidadNormalizada) || cantidadNormalizada <= 0) {
                problemasRow.push('Cantidad inválida');
            }
            
            // Check Activo = TRUE
            if (activo !== true && activo !== 'TRUE' && activo !== 'true') {
                problemasRow.push('No activo');
            }
            
            // Check LastModified presente
            if (!lastModified) {
                problemasRow.push('Sin LastModified');
            }
            
            // Check _rowIndex > LAST_SEEN_SHEET_ROW
            if (rowIndex > config.LAST_SEEN_SHEET_ROW) {
                filasMayorRowIndex++;
            }
            
            if (problemasRow.length === 0) {
                filasValidas++;
            } else {
                filasConProblemas++;
                problemas.push(...problemasRow);
            }
            
            // Mostrar fila en tabla
            const cantidadStr = isNaN(cantidadNormalizada) ? cantidad : cantidadNormalizada.toFixed(2);
            const problemasStr = problemasRow.length > 0 ? problemasRow.join(', ') : 'OK';
            
            console.log(`| ${String(fila).padEnd(4)} | ${String(idPresupuesto).padEnd(13)} | ${String(articuloNormalizado).padEnd(8)} | ${String(cantidadStr).padEnd(8)} | ${String(activo).padEnd(6)} | ${String(lastModified).padEnd(12)} | ${String(rowIndex).padEnd(9)} | ${problemasStr} |`);
        });
        
        // Resumen de checks
        console.log('\n📊 [DIAGNOSTICO-VACIO] === RESUMEN DE CHECKS ===');
        console.log(`Filas válidas: ${filasValidas}`);
        console.log(`Filas con problemas: ${filasConProblemas}`);
        console.log(`Filas con _rowIndex > ${config.LAST_SEEN_SHEET_ROW}: ${filasMayorRowIndex}`);
        
        if (problemas.length > 0) {
            console.log('\n⚠️ [DIAGNOSTICO-VACIO] Problemas encontrados:');
            const problemasUnicos = [...new Set(problemas)];
            problemasUnicos.forEach(problema => console.log(`  - ${problema}`));
        }
        
        // Checks de claves
        console.log('\n[DIAGNOSTICO-VACIO] === CHECKS DE CLAVES ===');
        console.log('Clave compuesta usada: ${IdPresupuesto}|${Articulo}|${CantidadNormalizada}');
        
        // Mostrar algunas claves de ejemplo
        const ejemplosClaves = ultimasFilas.slice(0, 3).map(row => {
            const idPresupuesto = String(row[1] || '').trim();
            const articulo = String(row[2] || '').trim();
            const cantidad = parseFloat(row[3]) || 0;
            const cantidadNormalizada = cantidad.toFixed(2);
            return `${idPresupuesto}|${articulo}|${cantidadNormalizada}`;
        });
        
        console.log('Ejemplos de claves generadas:');
        ejemplosClaves.forEach((clave, index) => {
            console.log(`  ${index + 1}. ${clave}`);
        });
        
        // Verificar filtros por inactivos
        const filasActivas = sheetsData.rows.filter(row => {
            const activo = row[16];
            return activo === true || activo === 'TRUE' || activo === 'true';
        });
        
        console.log(`\nFilas activas (no filtradas): ${filasActivas.length} de ${sheetsData.rows.length}`);
        
        // Remediación rápida si es necesario
        if (filasMayorRowIndex === 0) {
            console.log('\n🔧 [DIAGNOSTICO-VACIO] === REMEDIACIÓN RÁPIDA ===');
            console.log('No hay filas nuevas desde el último LAST_SEEN_SHEET_ROW');
            console.log('Aplicando remediación: expandir alcance temporal');
            
            // Subir el alcance temporal: set CUTOFF_AT = hoy 00:00 UTC
            const hoyInicio = new Date();
            hoyInicio.setUTCHours(0, 0, 0, 0);
            
            forwardOnlyState.config.CUTOFF_AT = hoyInicio.toISOString();
            forwardOnlyState.config.LAST_SEEN_SHEET_ROW = 0;
            
            const guardado = await forwardOnlyState.saveConfig();
            
            if (guardado) {
                console.log(`✅ CUTOFF_AT expandido a: ${hoyInicio.toISOString()}`);
                console.log('✅ LAST_SEEN_SHEET_ROW reset a: 0');
                
                // Reintentar una corrida Forward-Only
                console.log('\n[DIAGNOSTICO-VACIO] Reintentando corrida Forward-Only...');
                const correlationId = 'REMEDIACION-' + Date.now();
                const resultado = await runForwardOnlySync(sheetsConfig, pool, correlationId);
                
                console.log('\n📊 [DIAGNOSTICO-VACIO] === RESULTADO REMEDIACIÓN ===');
                console.log(`Solo desde corte (forward-only): ${resultado.soloDesdeCorte ? '✅' : '❌'}`);
                console.log(`MAP creados: ${resultado.mapCreados.Local} (Local) / ${resultado.mapCreados.AppSheet} (GSheet)`);
                console.log(`0 duplicados nuevos: ${resultado.ceroDuplicadosNuevos ? '✅' : '❌'}`);
                console.log(`LWW aplicado (nuevos): ${resultado.lwwAplicado.exito ? '✅' : '❌'} (${resultado.lwwAplicado.casos} casos)`);
                console.log(`Tiempo acorde: ${resultado.tiempoAcorde ? '✅' : '❌'}`);
                
                if (resultado.mapCreados.AppSheet > 0) {
                    console.log(`\n✅ [DIAGNOSTICO-VACIO] Remediación exitosa: ${resultado.mapCreados.AppSheet} registros procesados`);
                } else {
                    console.log('\n⚠️ [DIAGNOSTICO-VACIO] Remediación no resolvió el problema');
                }
            } else {
                console.log('❌ Error guardando configuración de remediación');
            }
        }
        
        console.log('\n✅ [DIAGNOSTICO-VACIO] Diagnóstico completado');
        
    } catch (error) {
        console.error('❌ [DIAGNOSTICO-VACIO] Error:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        try {
            await pool.end();
        } catch (e) {
            console.log('Pool ya cerrado');
        }
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    diagnosticarGSheetVacio();
}

module.exports = {
    diagnosticarGSheetVacio
};
