/**
 * Script de diagnóstico para verificar la corrección de sincronización de detalles de presupuestos
 * Google Sheets → Local
 */

const { Pool } = require('pg');

// Configuración de base de datos
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function diagnosticoDetallesPresupuestos() {
    console.log('🔍 [DIAGNÓSTICO] Iniciando diagnóstico de sincronización de detalles de presupuestos...');

    try {
        // 1. Verificar estructura de tablas
        console.log('\n📋 [DIAGNÓSTICO] Verificando estructura de tablas...');

        const presupuestosQuery = `
            SELECT COUNT(*) as total_presupuestos
            FROM presupuestos
            WHERE activo = true
        `;

        const detallesQuery = `
            SELECT COUNT(*) as total_detalles
            FROM presupuestos_detalles
        `;

        const presupuestosResult = await pool.query(presupuestosQuery);
        const detallesResult = await pool.query(detallesQuery);

        console.log(`   - Presupuestos activos: ${presupuestosResult.rows[0].total_presupuestos}`);
        console.log(`   - Detalles totales: ${detallesResult.rows[0].total_detalles}`);

        // 2. Verificar distribución de detalles por presupuesto
        console.log('\n📊 [DIAGNÓSTICO] Distribución de detalles por presupuesto...');

        const distribucionQuery = `
            SELECT
                pd.id_presupuesto,
                p.id_presupuesto_ext,
                COUNT(pd.id) as cantidad_detalles
            FROM presupuestos p
            LEFT JOIN presupuestos_detalles pd ON p.id = pd.id_presupuesto
            WHERE p.activo = true
            GROUP BY pd.id_presupuesto, p.id_presupuesto_ext
            ORDER BY cantidad_detalles DESC
            LIMIT 10
        `;

        const distribucionResult = await pool.query(distribucionQuery);

        console.log('   Top 10 presupuestos por cantidad de detalles:');
        distribucionResult.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. ${row.id_presupuesto_ext}: ${row.cantidad_detalles} detalles`);
        });

        // 3. Verificar presupuestos sin detalles
        console.log('\n⚠️ [DIAGNÓSTICO] Presupuestos sin detalles...');

        const sinDetallesQuery = `
            SELECT COUNT(*) as presupuestos_sin_detalles
            FROM presupuestos p
            LEFT JOIN presupuestos_detalles pd ON p.id = pd.id_presupuesto
            WHERE p.activo = true
            AND pd.id IS NULL
        `;

        const sinDetallesResult = await pool.query(sinDetallesQuery);
        console.log(`   - Presupuestos sin detalles: ${sinDetallesResult.rows[0].presupuestos_sin_detalles}`);

        // 4. Verificar detalles huérfanos (sin presupuesto)
        console.log('\n❌ [DIAGNÓSTICO] Detalles huérfanos...');

        const huerfanosQuery = `
            SELECT COUNT(*) as detalles_huerfanos
            FROM presupuestos_detalles pd
            LEFT JOIN presupuestos p ON pd.id_presupuesto = p.id
            WHERE p.id IS NULL OR p.activo = false
        `;

        const huerfanosResult = await pool.query(huerfanosQuery);
        console.log(`   - Detalles huérfanos: ${huerfanosResult.rows[0].detalles_huerfanos}`);

        // 5. Verificar logs de sincronización recientes
        console.log('\n📝 [DIAGNÓSTICO] Logs de sincronización recientes...');

        const logsQuery = `
            SELECT
                fecha_sync,
                exitoso,
                registros_procesados,
                registros_nuevos,
                registros_actualizados,
                errores
            FROM presupuestos_sync_log
            ORDER BY fecha_sync DESC
            LIMIT 5
        `;

        const logsResult = await pool.query(logsQuery);

        if (logsResult.rows.length > 0) {
            console.log('   Últimas 5 sincronizaciones:');
            logsResult.rows.forEach((log, index) => {
                const fecha = new Date(log.fecha_sync).toLocaleString('es-ES');
                const estado = log.exitoso ? '✅' : '❌';
                console.log(`   ${index + 1}. ${fecha} ${estado} - Procesados: ${log.registros_procesados}, Nuevos: ${log.registros_nuevos}, Actualizados: ${log.registros_actualizados}`);
                if (log.errores) {
                    console.log(`      Errores: ${log.errores.substring(0, 100)}...`);
                }
            });
        } else {
            console.log('   - No se encontraron logs de sincronización');
        }

        // 6. Verificar configuración activa
        console.log('\n⚙️ [DIAGNÓSTICO] Configuración de sincronización activa...');

        const configQuery = `
            SELECT
                id,
                hoja_url,
                hoja_id,
                hoja_nombre,
                activo
            FROM presupuestos_config
            WHERE activo = true
        `;

        const configResult = await pool.query(configQuery);

        if (configResult.rows.length > 0) {
            const config = configResult.rows[0];
            console.log(`   - Configuración activa encontrada (ID: ${config.id})`);
            console.log(`   - URL: ${config.hoja_url}`);
            console.log(`   - Nombre: ${config.hoja_nombre}`);
            console.log(`   - Última sincronización: ${config.ultima_sincronizacion ? new Date(config.ultima_sincronizacion).toLocaleString('es-ES') : 'Nunca'}`);
        } else {
            console.log('   - No se encontró configuración activa');
        }

        // 7. Resumen final
        console.log('\n🏁 [DIAGNÓSTICO] RESUMEN FINAL:');
        console.log(`   ✅ Presupuestos totales: ${presupuestosResult.rows[0].total_presupuestos}`);
        console.log(`   📋 Detalles totales: ${detallesResult.rows[0].total_detalles}`);
        console.log(`   ⚠️ Presupuestos sin detalles: ${sinDetallesResult.rows[0].presupuestos_sin_detalles}`);
        console.log(`   ❌ Detalles huérfanos: ${huerfanosResult.rows[0].detalles_huerfanos}`);

        const promedioDetalles = presupuestosResult.rows[0].total_presupuestos > 0
            ? (detallesResult.rows[0].total_detalles / presupuestosResult.rows[0].total_presupuestos).toFixed(2)
            : 0;

        console.log(`   📊 Promedio de detalles por presupuesto: ${promedioDetalles}`);

        if (sinDetallesResult.rows[0].presupuestos_sin_detalles > 0) {
            console.log('\n💡 [RECOMENDACIONES]');
            console.log('   - Revisar los presupuestos sin detalles');
            console.log('   - Verificar que los IDs de presupuesto coincidan entre hojas de Google Sheets');
            console.log('   - Comprobar que las hojas "Presupuestos" y "DetallesPresupuestos" tengan datos válidos');
        }

    } catch (error) {
        console.error('❌ [DIAGNÓSTICO] Error en diagnóstico:', error.message);
        console.error(error.stack);
    } finally {
        await pool.end();
    }
}

// Ejecutar diagnóstico
diagnosticoDetallesPresupuestos().catch(console.error);
