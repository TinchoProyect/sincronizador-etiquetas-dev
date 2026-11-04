const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
    try {
        // Obtener todas las facturas y notas de crédito de pto_vta = 32 en estado APROBADA o APROBADA_LOCAL
        const facturasRes = await pool.query(`
            SELECT id, tipo_cbte, pto_vta, cbte_nro, nro_interno, presupuesto_id, estado, created_at 
            FROM factura_facturas
            WHERE pto_vta = 32 
              AND estado IN ('APROBADA', 'APROBADA_LOCAL')
            ORDER BY id ASC
        `);

        console.log(`Encontradas ${facturasRes.rows.length} facturas aprobadas para pto_vta = 32.`);

        let totalItems = 0;
        let matchedItems = 0;
        let unmatchedItems = [];

        for (const factura of facturasRes.rows) {
            // Obtener items de la factura
            const itemsRes = await pool.query(`
                SELECT id, descripcion, qty, p_unit, orden
                FROM factura_factura_items
                WHERE factura_id = $1
                ORDER BY orden ASC
            `, [factura.id]);

            console.log(`\nFactura ID ${factura.id} (${factura.tipo_cbte}-${factura.cbte_nro || factura.nro_interno}) - Presupuesto: ${factura.presupuesto_id}`);

            // Obtener detalles del presupuesto si existe
            let budgetDetails = [];
            if (factura.presupuesto_id) {
                const budgetRes = await pool.query(`
                    SELECT pd.id, pd.articulo as barcode, pd.cantidad, pd.valor1, a.numero as articulo_numero, a.nombre as articulo_nombre
                    FROM presupuestos_detalles pd
                    LEFT JOIN articulos a ON a.codigo_barras = pd.articulo OR a.numero = pd.articulo
                    WHERE pd.id_presupuesto = $1
                `, [factura.presupuesto_id]);
                budgetDetails = budgetRes.rows;
            }

            for (const item of itemsRes.rows) {
                totalItems++;
                let resolvedArt = null;

                // Método 1: Búsqueda exacta por descripción en articulos
                const artByNameRes = await pool.query(`
                    SELECT numero, nombre, codigo_barras 
                    FROM articulos 
                    WHERE UPPER(TRIM(nombre)) = UPPER(TRIM($1))
                    LIMIT 1
                `, [item.descripcion]);

                if (artByNameRes.rows.length > 0) {
                    resolvedArt = {
                        method: 'desc_exacta',
                        articulo_numero: artByNameRes.rows[0].numero,
                        codigo_barras: artByNameRes.rows[0].codigo_barras,
                        nombre: artByNameRes.rows[0].nombre
                    };
                }

                // Método 2: Si no se encontró, buscar en el presupuesto
                if (!resolvedArt && budgetDetails.length > 0) {
                    // Buscar coincidencia en detalles del presupuesto
                    // Probamos coincidencia por descripción/nombre de artículo
                    let budgetMatch = budgetDetails.find(bd => 
                        bd.articulo_nombre && 
                        bd.articulo_nombre.toUpperCase().trim() === item.descripcion.toUpperCase().trim()
                    );

                    // Si no coincide por nombre, probamos por precio y cantidad
                    if (!budgetMatch) {
                        budgetMatch = budgetDetails.find(bd => 
                            parseFloat(bd.cantidad) === parseFloat(item.qty) && 
                            parseFloat(bd.valor1) === parseFloat(item.p_unit)
                        );
                    }

                    if (budgetMatch && budgetMatch.articulo_numero) {
                        resolvedArt = {
                            method: 'presupuesto_match',
                            articulo_numero: budgetMatch.articulo_numero,
                            codigo_barras: budgetMatch.barcode,
                            nombre: budgetMatch.articulo_nombre
                        };
                    }
                }

                // Método 3: Búsqueda parcial (ILIKE) en articulos
                if (!resolvedArt) {
                    const artByNameLikeRes = await pool.query(`
                        SELECT numero, nombre, codigo_barras 
                        FROM articulos 
                        WHERE nombre ILIKE $1 
                           OR nombre ILIKE $2
                        LIMIT 1
                    `, [item.descripcion, `%${item.descripcion}%`]);

                    if (artByNameLikeRes.rows.length > 0) {
                        resolvedArt = {
                            method: 'desc_parcial',
                            articulo_numero: artByNameLikeRes.rows[0].numero,
                            codigo_barras: artByNameLikeRes.rows[0].codigo_barras,
                            nombre: artByNameLikeRes.rows[0].nombre
                        };
                    }
                }

                if (resolvedArt) {
                    matchedItems++;
                    console.log(`  ✅ Item "${item.descripcion}" -> ${resolvedArt.articulo_numero} (${resolvedArt.codigo_barras}) via ${resolvedArt.method}`);
                } else {
                    unmatchedItems.push({ factura_id: factura.id, item });
                    console.log(`  ❌ Item "${item.descripcion}" no se pudo resolver!`);
                }
            }
        }

        console.log(`\n=== RESUMEN ===`);
        console.log(`Total Facturas Procesadas: ${facturasRes.rows.length}`);
        console.log(`Total Items: ${totalItems}`);
        console.log(`Items Resueltos: ${matchedItems} (${((matchedItems/totalItems)*100).toFixed(2)}%)`);
        console.log(`Items No Resueltos: ${unmatchedItems.length}`);
        if (unmatchedItems.length > 0) {
            console.log('Detalle de no resueltos:', unmatchedItems);
        }

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
