const pool = require('./src/produccion/config/database');

async function runAudit() {
    const codes = ['CCTX2', 'AAIx5', 'HDCEX5'];
    console.log('🔍 AUDITORÍA TÉCNICA - CÓDIGOS:', codes);

    try {
        // 1. DUPLICADOS EN ARTICULOS
        console.log('\n--- 1. AUDITORÍA DE DUPLICADOS EN ARTICULOS ---');
        const q1 = `
            SELECT numero, count(*) as total
            FROM articulos 
            WHERE numero = ANY($1::text[]) 
            GROUP BY numero`;
        const r1 = await pool.query(q1, [codes]);
        console.table(r1.rows);

        // 2. DUPLICADOS EN PRECIOS Y STOCK
        console.log('\n--- 2. DUPLICADOS EN TABLAS SATÉLITE ---');
        for (const code of codes) {
            const q2a = `SELECT count(*) as precios_cnt FROM precios_articulos WHERE articulo = $1`;
            const r2a = await pool.query(q2a, [code]);
            const q2b = `SELECT count(*) as stock_cnt FROM stock_real_consolidado WHERE articulo_numero = $1`;
            const r2b = await pool.query(q2b, [code]);
            console.log(`Artículo ${code}: Precios=${r2a.rows[0].precios_cnt}, Stock=${r2b.rows[0].stock_cnt}`);
        }

        // 3. MOVIMIENTOS REALES (RAW)
        console.log('\n--- 3. MOVIMIENTOS REALES (STOCK_VENTAS_MOVIMIENTOS) ---');
        const q3 = `
            SELECT articulo_numero, count(*) as registros, sum(cantidad) as suma_cantidad
            FROM stock_ventas_movimientos
            WHERE articulo_numero = ANY($1::text[])
            GROUP BY articulo_numero`;
        const r3 = await pool.query(q3, [codes]);
        console.table(r3.rows);

        // 6. CHECK KILOS UNIDAD (POSIBLE CAUSA FACTOR MULTIPLICACIÓN)
        console.log('\n--- 6. CHECK KILOS UNIDAD ---');
        const q6 = `
            SELECT a.numero, a.codigo_barras, s.kilos_unidad
            FROM articulos a
            LEFT JOIN stock_real_consolidado s ON a.numero = s.articulo_numero
            WHERE a.numero = ANY($1::text[])`;
        const r6 = await pool.query(q6, [codes]);
        console.table(r6.rows);

        // 4. SIMULACIÓN DEL ERROR (LEFT JOIN SIN DISTINCT)
        console.log('\n--- 4. SIMULACIÓN DE "BILLONES" (LEFT JOIN SIMPLE) ---');
        const q4 = `
            SELECT 
                a.numero, 
                COUNT(m.id) as filas_resultado,
                SUM(m.cantidad) as suma_inflada
            FROM articulos a
            LEFT JOIN stock_ventas_movimientos m ON a.numero = m.articulo_numero
            WHERE a.numero = ANY($1::text[])
            GROUP BY a.numero`;
        const r4 = await pool.query(q4, [codes]);
        console.table(r4.rows);

        // 5. DIAGNÓSTICO DE MULTIPLICADOR
        console.log('\n--- 5. FACTOR DE MULTIPLICACIÓN ---');
        r4.rows.forEach(row => {
            const real = r3.rows.find(r => r.articulo_numero === row.numero);
            if (real) {
                const factor = row.filas_resultado / real.registros;
                console.log(`Artículo ${row.numero}: Factor=${factor}x (Real: ${real.registros} -> Inflado: ${row.filas_resultado})`);
            }
        });

    } catch (e) {
        console.error("Error auditoría:", e);
    } finally {
        // Cierra el pool si es necesario, o deja que el proceso termine
        process.exit();
    }
}

runAudit();
