const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function run() {
    console.log('=== TEST SIMULACIÓN CORREGIDA COSTO INTEGRADO BÚNKER EN FACTURAS ===\n');

    const resFacts = await pool.query(`
        SELECT 
            f.id, f.pto_vta, f.cbte_nro, f.fecha_emision, f.cliente_id,
            f.imp_neto, f.imp_iva, f.imp_total, f.presupuesto_id,
            f.costo_estimado_total as costo_actual_factura,
            COALESCE(NULLIF(TRIM(bc.razon_social), ''), NULLIF(TRIM(bc.cliente_nombre), ''), NULLIF(TRIM(c.apellido), '')) as cliente_nombre,
            c.lista_precios as cliente_lista_id
        FROM factura_facturas f
        LEFT JOIN clientes c ON c.cliente_id = f.cliente_id
        LEFT JOIN bunker_clientes bc ON 
            (CASE 
                WHEN bc.lomas_soft_id ~ '^[0-9]+$' THEN bc.lomas_soft_id::integer 
                ELSE NULL 
            END) = f.cliente_id
        WHERE f.id > 100 AND f.estado != 'ANULADA'
        ORDER BY f.fecha_emision DESC, f.id DESC
    `);

    console.log(`Analizando ${resFacts.rows.length} facturas activas...\n`);

    let totalFacturadoOficial = 0;
    let totalNetoOficial = 0;
    let totalCostoOficial = 0;
    let totalIvaOficial = 0;

    let totalFacturadoInterno = 0;
    let totalCostoInterno = 0;

    let totalFacturasConGanancia = 0;
    let totalFacturasConPerdida = 0;

    for (const f of resFacts.rows) {
        const resDetalles = await pool.query(`
            SELECT 
                pd.*,
                COALESCE(ba.articulo_id, a.numero) as ba_articulo_id,
                ba.kilos_unidad,
                ba.costo_base as ba_costo_base,
                ing.id as ing_id,
                ing.costo_patron as ing_costo_patron,
                COALESCE(
                    (SELECT SUM(ri.cantidad * COALESCE(i.costo_patron, 0)) 
                     FROM recetas r 
                     JOIN receta_ingredientes ri ON ri.receta_id = r.id 
                     JOIN ingredientes i ON i.id = ri.ingrediente_id 
                     WHERE r.articulo_numero = COALESCE(ba.articulo_id, a.numero)),
                    0
                ) as costo_receta
            FROM presupuestos_detalles pd
            LEFT JOIN articulos a ON (a.codigo_barras = pd.articulo OR a.numero = pd.articulo)
            LEFT JOIN bunker_articulos ba ON (ba.articulo_id = pd.articulo OR ba.articulo_id = a.numero)
            LEFT JOIN ingredientes ing ON (ing.id::text = pd.articulo OR ing.codigo::text = pd.articulo)
            WHERE pd.id_presupuesto = $1
            ORDER BY pd.id
        `, [f.presupuesto_id]);

        let costoFacturaIntegrado = 0;

        for (const item of resDetalles.rows) {
            const qty = parseFloat(item.cantidad) || 0;
            const artId = item.ba_articulo_id;
            let costoUnitario = 0;

            if (artId) {
                const listaId = f.cliente_lista_id ? parseInt(f.cliente_lista_id) : 1;
                
                const resLA = await pool.query(`
                    SELECT la.costo_base_sobrescrito, la.costo_tiempo, la.mano_obra_activa,
                           (SELECT SUM(li.cantidad * COALESCE(li.costo_unitario_capturado, 0)) 
                            FROM bunker_lista_insumos li 
                            WHERE li.lista_articulo_id = la.id AND li.incluido = true) as costo_insumos
                    FROM bunker_lista_articulos la
                    WHERE la.articulo_numero = $1 AND la.lista_id = $2
                    LIMIT 1
                `, [artId, listaId]);

                let la = resLA.rows[0];
                if (!la) {
                    const resLA1 = await pool.query(`
                        SELECT la.costo_base_sobrescrito, la.costo_tiempo, la.mano_obra_activa,
                               (SELECT SUM(li.cantidad * COALESCE(li.costo_unitario_capturado, 0)) 
                                FROM bunker_lista_insumos li 
                                WHERE li.lista_articulo_id = la.id AND li.incluido = true) as costo_insumos
                        FROM bunker_lista_articulos la
                        WHERE la.articulo_numero = $1 AND la.lista_id = 1
                        LIMIT 1
                    `, [artId]);
                    la = resLA1.rows[0];
                }

                const factor = parseFloat(item.kilos_unidad) || 1.0;
                const costoReceta = parseFloat(item.costo_receta) || 0;
                const costoBaseBultoDirecto = parseFloat(item.ba_costo_base) || 0;

                let cBase = 0;
                if (la && la.costo_base_sobrescrito && parseFloat(la.costo_base_sobrescrito) > 0) {
                    cBase = parseFloat(la.costo_base_sobrescrito);
                } else if (costoReceta > 0) {
                    cBase = costoReceta / factor;
                } else {
                    cBase = factor > 0 ? (costoBaseBultoDirecto / factor) : costoBaseBultoDirecto;
                }

                const cPresentacion = cBase * factor;
                const cInsumos = la ? (parseFloat(la.costo_insumos) || 0) : 0;
                const cTiempo = (la && la.mano_obra_activa ? parseFloat(la.costo_tiempo) : 0) || 0;

                costoUnitario = cPresentacion + cInsumos + cTiempo;
            } else if (item.ing_id) {
                costoUnitario = parseFloat(item.ing_costo_patron) || 0;
            } else {
                costoUnitario = 0;
            }

            costoFacturaIntegrado += qty * costoUnitario;
        }

        const neto = parseFloat(f.imp_neto) || 0;
        const total = parseFloat(f.imp_total) || 0;
        const iva = parseFloat(f.imp_iva) || 0;
        const baseCalculo = f.pto_vta === 90 ? total : neto;
        const ganancia = baseCalculo - costoFacturaIntegrado;
        const margenPct = baseCalculo > 0 ? (ganancia / baseCalculo) * 100 : 0;

        if (ganancia >= 0) totalFacturasConGanancia++;
        else totalFacturasConPerdida++;

        if (f.pto_vta === 90) {
            totalFacturadoInterno += total;
            totalCostoInterno += costoFacturaIntegrado;
        } else {
            totalFacturadoOficial += total;
            totalNetoOficial += neto;
            totalIvaOficial += iva;
            totalCostoOficial += costoFacturaIntegrado;
        }

        console.log(`Factura #${f.id} (PV ${f.pto_vta}-${f.cbte_nro}) | ${f.fecha_emision ? String(f.fecha_emision).slice(0, 10) : 'Sin fecha'} | ${f.cliente_nombre}`);
        console.log(`   Neto: $${neto.toFixed(2)} | IVA: $${iva.toFixed(2)} | Total: $${total.toFixed(2)}`);
        console.log(`   Costo Integrado Búnker: $${costoFacturaIntegrado.toFixed(2)}`);
        console.log(`   Ganancia Neta: $${ganancia.toFixed(2)} (${margenPct.toFixed(1)}% margen)`);
        console.log('--------------------------------------------------------------------------------');
    }

    console.log('\n=== RESUMEN TOTALES SIMULADOS (CORREGIDOS) ===');
    console.log('OFICIALES ARCA:');
    console.log(`  Total Facturado: $${totalFacturadoOficial.toFixed(2)}`);
    console.log(`  Neto Gravado:    $${totalNetoOficial.toFixed(2)}`);
    console.log(`  IVA Débito:      $${totalIvaOficial.toFixed(2)}`);
    console.log(`  Costo Integrado: $${totalCostoOficial.toFixed(2)}`);
    const gananciaOficial = totalNetoOficial - totalCostoOficial;
    const margenOficial = totalNetoOficial > 0 ? (gananciaOficial / totalNetoOficial) * 100 : 0;
    console.log(`  Ganancia Neta:   $${gananciaOficial.toFixed(2)} (${margenOficial.toFixed(1)}% margen sobre neto)`);

    console.log('\nINTERNOS (PTO VTA 90):');
    console.log(`  Total Facturado: $${totalFacturadoInterno.toFixed(2)}`);
    console.log(`  Costo Integrado: $${totalCostoInterno.toFixed(2)}`);
    const gananciaInterno = totalFacturadoInterno - totalCostoInterno;
    const margenInterno = totalFacturadoInterno > 0 ? (gananciaInterno / totalFacturadoInterno) * 100 : 0;
    console.log(`  Ganancia Neta:   $${gananciaInterno.toFixed(2)} (${margenInterno.toFixed(1)}% margen)`);

    console.log(`\nFacturas con ganancia positiva: ${totalFacturasConGanancia} | Facturas con margen negativo: ${totalFacturasConPerdida}`);

    pool.end();
}
run();
