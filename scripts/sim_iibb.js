const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function run() {
    console.log('=== TEST SIMULACIÓN MÉTRICAS OFICIALES CON IIBB (4%) ===\n');

    const res = await pool.query(`
        SELECT 
            f.id, f.pto_vta, f.cbte_nro, f.imp_total, f.imp_neto, f.imp_iva, f.costo_estimado_total,
            f.tipo_cbte, f.fecha_emision
        FROM factura_facturas f
        WHERE f.id > 100 AND f.estado != 'ANULADA' AND f.pto_vta != 90
        ORDER BY f.fecha_emision DESC, f.id DESC
    `);

    let totFact = 0;
    let totNeto = 0;
    let totIva = 0;
    let totCosto = 0;
    let totIibb = 0;

    for (const f of res.rows) {
        const signo = [3, 8, 13].includes(parseInt(f.tipo_cbte)) ? -1 : 1;
        const total = (parseFloat(f.imp_total) || 0) * signo;
        const neto = (parseFloat(f.imp_neto) || (parseFloat(f.imp_total) || 0)) * signo;
        const iva = (parseFloat(f.imp_iva) || 0) * signo;
        const costo = (parseFloat(f.costo_estimado_total) || 0) * signo;
        const iibb = total * 0.04;

        totFact += total;
        totNeto += neto;
        totIva += iva;
        totCosto += costo;
        totIibb += iibb;
    }

    const gananciaBruta = totNeto - totCosto;
    const margenBruto = totNeto > 0 ? (gananciaBruta / totNeto) * 100 : 0;

    const gananciaReal = totNeto - totCosto - totIibb;
    const margenReal = totNeto > 0 ? (gananciaReal / totNeto) * 100 : 0;

    console.log(`Comprobantes Oficiales ARCA (${res.rows.length} comprobantes):`);
    console.log(`  • Total Facturado:           $${totFact.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
    console.log(`  • Total Neto Gravado:        $${totNeto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
    console.log(`  • Total IVA Débito Fiscal:   $${totIva.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
    console.log(`  • Total IIBB PBA (4%):       $${totIibb.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
    console.log(`  • Costo Integrado Búnker:    $${totCosto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
    console.log(`  -------------------------------------------------------------`);
    console.log(`  • Ganancia Bruta (sin IIBB): $${gananciaBruta.toLocaleString('es-AR', { minimumFractionDigits: 2 })} (${margenBruto.toFixed(1)}% sobre neto)`);
    console.log(`  • Ganancia Real Neta (c/IIBB):$${gananciaReal.toLocaleString('es-AR', { minimumFractionDigits: 2 })} (${margenReal.toFixed(1)}% margen real sobre neto)`);

    pool.end();
}

run();
