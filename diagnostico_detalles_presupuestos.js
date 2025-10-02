/**
 * DIAGNÓSTICO: Por qué no se sincronizan los detalles de presupuestos desde Google Sheets
 * 
 * Este script analiza:
 * 1. Estructura exacta de ambas hojas
 * 2. Coincidencia de IDs entre encabezados y detalles
 * 3. Proceso de sincronización paso a paso
 */

const { readSheetWithHeaders } = require('./src/services/gsheets/client_with_logs');
const { Pool } = require('pg');

// Configuración de base de datos
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'presupuestos_db',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
});

async function diagnosticarDetallesPresupuestos() {
    console.log('🔍 [DIAGNÓSTICO] Iniciando análisis de sincronización de detalles...\n');
    
    try {
        // PASO 1: Leer configuración de Google Sheets
        console.log('=== PASO 1: CONFIGURACIÓN ===');
        const configQuery = `
            SELECT sheet_url, sheet_id 
            FROM presupuestos_config 
            WHERE activo = true 
            ORDER BY fecha_creacion DESC 
            LIMIT 1
        `;
        
        const configResult = await pool.query(configQuery);
        let sheetId;
        
        if (configResult.rows.length > 0) {
            sheetId = configResult.rows[0].sheet_id;
            console.log('✅ Configuración encontrada:', configResult.rows[0].sheet_url);
        } else {
            sheetId = '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8';
            console.log('⚠️ Usando configuración por defecto');
        }
        
        console.log('📋 Sheet ID:', sheetId);
        
        // PASO 2: Leer hoja "Presupuestos"
        console.log('\n=== PASO 2: ANÁLISIS HOJA "Presupuestos" ===');
        const presupuestosData = await readSheetWithHeaders(sheetId, 'A:O', 'Presupuestos');
        
        console.log('📊 Encabezados Presupuestos:', presupuestosData.headers);
        console.log('📊 Total filas:', presupuestosData.rows.length);
        
        // Verificar nombres exactos de columnas
        const idPresupuestoCol = presupuestosData.headers[0];
        console.log(`🔍 Columna A (ID): "${idPresupuestoCol}"`);
        
        if (presupuestosData.rows.length > 0) {
            console.log('📋 Primeras 3 filas de presupuestos:');
            presupuestosData.rows.slice(0, 3).forEach((row, i) => {
                console.log(`   Fila ${i + 2}: ID="${row[idPresupuestoCol]}", Cliente="${row[presupuestosData.headers[2]]}", Estado="${row[presupuestosData.headers[7]]}"`);
            });
        }
        
        // PASO 3: Leer hoja "DetallesPresupuestos"
        console.log('\n=== PASO 3: ANÁLISIS HOJA "DetallesPresupuestos" ===');
        const detallesData = await readSheetWithHeaders(sheetId, 'A:Q', 'DetallesPresupuestos');
        
        console.log('📊 Encabezados DetallesPresupuestos:', detallesData.headers);
        console.log('📊 Total filas:', detallesData.rows.length);
        
        // Verificar nombres exactos de columnas
        const idDetalleCol = detallesData.headers[0];
        const idPresupuestoDetalleCol = detallesData.headers[1];
        const articuloCol = detallesData.headers[2];
        
        console.log(`🔍 Columna A (ID Detalle): "${idDetalleCol}"`);
        console.log(`🔍 Columna B (ID Presupuesto): "${idPresupuestoDetalleCol}"`);
        console.log(`🔍 Columna C (Artículo): "${articuloCol}"`);
        
        if (detallesData.rows.length > 0) {
            console.log('📋 Primeras 5 filas de detalles:');
            detallesData.rows.slice(0, 5).forEach((row, i) => {
                console.log(`   Fila ${i + 2}: IDPresupuesto="${row[idPresupuestoDetalleCol]}", Artículo="${row[articuloCol]}", Cantidad="${row[detallesData.headers[3]]}"`);
            });
        }
        
        // PASO 4: Análisis de coincidencias de ID
        console.log('\n=== PASO 4: ANÁLISIS DE COINCIDENCIAS DE ID ===');
        
        // Crear mapas de IDs
        const idsPresupuestos = new Set();
        presupuestosData.rows.forEach(row => {
            const id = (row[idPresupuestoCol] || '').toString().trim();
            if (id) idsPresupuestos.add(id);
        });
        
        const idsDetalles = new Set();
        const detallesPorPresupuesto = new Map();
        detallesData.rows.forEach(row => {
            const idPresupuesto = (row[idPresupuestoDetalleCol] || '').toString().trim();
            if (idPresupuesto) {
                idsDetalles.add(idPresupuesto);
                if (!detallesPorPresupuesto.has(idPresupuesto)) {
                    detallesPorPresupuesto.set(idPresupuesto, []);
                }
                detallesPorPresupuesto.get(idPresupuesto).push(row);
            }
        });
        
        console.log(`📊 IDs únicos en Presupuestos: ${idsPresupuestos.size}`);
        console.log(`📊 IDs únicos en Detalles: ${idsDetalles.size}`);
        
        // Encontrar coincidencias y diferencias
        const coincidencias = [...idsPresupuestos].filter(id => idsDetalles.has(id));
        const presupuestosSinDetalles = [...idsPresupuestos].filter(id => !idsDetalles.has(id));
        const detallesSinPresupuesto = [...idsDetalles].filter(id => !idsPresupuestos.has(id));
        
        console.log(`✅ Presupuestos con detalles: ${coincidencias.length}`);
        console.log(`❌ Presupuestos sin detalles: ${presupuestosSinDetalles.length}`);
        console.log(`⚠️ Detalles sin presupuesto: ${detallesSinPresupuesto.length}`);
        
        if (presupuestosSinDetalles.length > 0) {
            console.log('📋 Presupuestos sin detalles (primeros 5):');
            presupuestosSinDetalles.slice(0, 5).forEach(id => {
                console.log(`   - ${id}`);
            });
        }
        
        if (detallesSinPresupuesto.length > 0) {
            console.log('📋 Detalles sin presupuesto (primeros 5):');
            detallesSinPresupuesto.slice(0, 5).forEach(id => {
                console.log(`   - ${id}`);
            });
        }
        
        // PASO 5: Seleccionar presupuesto de prueba
        console.log('\n=== PASO 5: PRESUPUESTO DE PRUEBA ===');
        
        let presupuestoPrueba = null;
        if (coincidencias.length > 0) {
            presupuestoPrueba = coincidencias[0];
            const detallesDelPresupuesto = detallesPorPresupuesto.get(presupuestoPrueba);
            
            console.log(`🎯 Presupuesto seleccionado: ${presupuestoPrueba}`);
            console.log(`📊 Cantidad de detalles: ${detallesDelPresupuesto.length}`);
            
            console.log('📋 Detalles del presupuesto:');
            detallesDelPresupuesto.forEach((detalle, i) => {
                console.log(`   ${i + 1}. ${detalle[articuloCol]} - Cant: ${detalle[detallesData.headers[3]]} - Precio: ${detalle[detallesData.headers[5]]}`);
            });
        } else {
            console.log('❌ No se encontraron presupuestos con detalles para usar como prueba');
        }
        
        // PASO 6: Verificar estado en base de datos local
        console.log('\n=== PASO 6: ESTADO EN BASE DE DATOS LOCAL ===');
        
        if (presupuestoPrueba) {
            // Verificar si existe el presupuesto
            const presupuestoLocalQuery = `
                SELECT id, id_presupuesto_ext, id_cliente, estado, fecha_actualizacion
                FROM presupuestos 
                WHERE id_presupuesto_ext = $1 AND activo = true
            `;
            
            const presupuestoLocal = await pool.query(presupuestoLocalQuery, [presupuestoPrueba]);
            
            if (presupuestoLocal.rows.length > 0) {
                const presupuesto = presupuestoLocal.rows[0];
                console.log(`✅ Presupuesto existe en BD local:`, {
                    id: presupuesto.id,
                    id_ext: presupuesto.id_presupuesto_ext,
                    cliente: presupuesto.id_cliente,
                    estado: presupuesto.estado,
                    fecha_actualizacion: presupuesto.fecha_actualizacion
                });
                
                // Verificar detalles
                const detallesLocalQuery = `
                    SELECT id, articulo, cantidad, valor1, precio1, iva1
                    FROM presupuestos_detalles 
                    WHERE id_presupuesto_ext = $1
                `;
                
                const detallesLocal = await pool.query(detallesLocalQuery, [presupuestoPrueba]);
                
                console.log(`📊 Detalles en BD local: ${detallesLocal.rows.length}`);
                
                if (detallesLocal.rows.length === 0) {
                    console.log('❌ PROBLEMA CONFIRMADO: El presupuesto existe pero NO tiene detalles en la BD local');
                } else {
                    console.log('✅ Detalles encontrados en BD local:');
                    detallesLocal.rows.forEach((detalle, i) => {
                        console.log(`   ${i + 1}. ${detalle.articulo} - Cant: ${detalle.cantidad} - Precio: ${detalle.precio1}`);
                    });
                }
            } else {
                console.log(`❌ Presupuesto ${presupuestoPrueba} NO existe en BD local`);
            }
        }
        
        // PASO 7: Análisis de encabezados críticos
        console.log('\n=== PASO 7: ANÁLISIS DE ENCABEZADOS CRÍTICOS ===');
        
        console.log('🔍 Verificando nombres exactos de columnas:');
        console.log(`   Presupuestos[0]: "${presupuestosData.headers[0]}" (esperado: "IDPresupuesto")`);
        console.log(`   Detalles[1]: "${detallesData.headers[1]}" (esperado: "IdPresupuesto" o "IDPresupuesto")`);
        
        // Verificar si hay diferencias de mayúsculas/minúsculas
        const headerPresupuestos = presupuestosData.headers[0];
        const headerDetalles = detallesData.headers[1];
        
        if (headerPresupuestos !== headerDetalles) {
            console.log('⚠️ DIFERENCIA EN ENCABEZADOS DETECTADA:');
            console.log(`   Presupuestos: "${headerPresupuestos}"`);
            console.log(`   Detalles: "${headerDetalles}"`);
            console.log('   Esta diferencia puede causar problemas en el mapeo automático');
        } else {
            console.log('✅ Los encabezados de ID coinciden exactamente');
        }
        
        // PASO 8: Verificar función de mapeo
        console.log('\n=== PASO 8: SIMULACIÓN DE MAPEO ===');
        
        // Simular el proceso de mapeo como lo hace mapTwoSheetsToPresupuestos
        const presupuestosMap = new Map();
        
        // Procesar presupuestos
        presupuestosData.rows.forEach((row, i) => {
            const id_presupuesto_ext = row[presupuestosData.headers[0]] || '';
            const id_cliente = row[presupuestosData.headers[2]] || '';
            
            if (id_presupuesto_ext && id_cliente) {
                const presupuestoKey = id_presupuesto_ext.toString().trim();
                presupuestosMap.set(presupuestoKey, {
                    presupuesto: { id_presupuesto_ext: presupuestoKey, id_cliente },
                    detalles: []
                });
            }
        });
        
        console.log(`📊 Presupuestos mapeados: ${presupuestosMap.size}`);
        
        // Procesar detalles
        let detallesAsignados = 0;
        let detallesOmitidos = 0;
        
        detallesData.rows.forEach((row, i) => {
            const id_presupuesto = row[detallesData.headers[1]] || '';
            const articulo = row[detallesData.headers[2]] || '';
            
            if (id_presupuesto && articulo) {
                const presupuestoKey = id_presupuesto.toString().trim();
                
                if (presupuestosMap.has(presupuestoKey)) {
                    presupuestosMap.get(presupuestoKey).detalles.push({
                        articulo: articulo.toString().trim(),
                        cantidad: row[detallesData.headers[3]] || 0
                    });
                    detallesAsignados++;
                } else {
                    detallesOmitidos++;
                }
            }
        });
        
        console.log(`✅ Detalles asignados: ${detallesAsignados}`);
        console.log(`❌ Detalles omitidos: ${detallesOmitidos}`);
        
        // Contar presupuestos con y sin detalles después del mapeo
        let conDetalles = 0;
        let sinDetalles = 0;
        
        presupuestosMap.forEach(p => {
            if (p.detalles.length > 0) {
                conDetalles++;
            } else {
                sinDetalles++;
            }
        });
        
        console.log(`📊 Resultado del mapeo:`);
        console.log(`   - Presupuestos con detalles: ${conDetalles}`);
        console.log(`   - Presupuestos sin detalles: ${sinDetalles}`);
        
        // PASO 9: Diagnóstico final
        console.log('\n=== DIAGNÓSTICO FINAL ===');
        
        if (detallesOmitidos > 0) {
            console.log('🚨 CAUSA RAÍZ IDENTIFICADA:');
            console.log('   Los detalles se están omitiendo durante el proceso de mapeo');
            console.log('   porque no encuentran coincidencia con los presupuestos');
            
            if (headerPresupuestos !== headerDetalles) {
                console.log('🔍 CAUSA ESPECÍFICA: Diferencia en nombres de encabezados');
                console.log(`   - Hoja Presupuestos usa: "${headerPresupuestos}"`);
                console.log(`   - Hoja Detalles usa: "${headerDetalles}"`);
                console.log('   - El código espera coincidencia exacta para el mapeo');
            }
        }
        
        if (presupuestoPrueba && presupuestoLocal.rows.length > 0 && detallesLocal.rows.length === 0) {
            console.log('🚨 CONFIRMACIÓN DEL PROBLEMA:');
            console.log(`   - Presupuesto ${presupuestoPrueba} existe en BD local`);
            console.log(`   - Tiene ${detallesPorPresupuesto.get(presupuestoPrueba).length} detalles en Google Sheets`);
            console.log('   - Tiene 0 detalles en BD local');
            console.log('   - Los detalles NO se están sincronizando');
        }
        
    } catch (error) {
        console.error('❌ Error en diagnóstico:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await pool.end();
    }
}

// Ejecutar diagnóstico si se llama directamente
if (require.main === module) {
    diagnosticarDetallesPresupuestos();
}

module.exports = { diagnosticarDetallesPresupuestos };
