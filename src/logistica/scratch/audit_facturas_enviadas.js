const { pool } = require('../config/database');

async function auditFacturasEnviadas() {
    console.log('================================================================================');
    console.log('🔬 AUDITORÍA DE FACTURAS Y ESTADO DE ENVÍO EN BASE DE DATOS');
    console.log('================================================================================\n');

    try {
        const res = await pool.query(`
            SELECT id, pto_vta, cbte_nro, nro_interno, estado, cae, es_enviado, enviado_at, enviado_canal, created_at
            FROM public.factura_facturas
            ORDER BY id DESC
            LIMIT 60
        `);

        console.log(`Total facturas inspeccionadas: ${res.rows.length}\n`);

        const porEstado = {};
        res.rows.forEach(r => {
            const key = `${r.estado} | es_enviado: ${r.es_enviado}`;
            porEstado[key] = (porEstado[key] || 0) + 1;
        });

        console.log('Desglose por estado y flag es_enviado:');
        console.table(porEstado);

        console.log('\nÚltimas 15 facturas:');
        console.table(res.rows.slice(0, 15).map(r => ({
            id: r.id,
            cbte: `${r.pto_vta}-${r.cbte_nro || r.nro_interno}`,
            estado: r.estado,
            cae: r.cae ? 'SÍ' : 'NO',
            es_enviado: r.es_enviado,
            enviado_canal: r.enviado_canal,
            created_at: r.created_at
        })));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

auditFacturasEnviadas();
