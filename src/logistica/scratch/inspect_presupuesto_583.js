const pool = require('../../produccion/config/database');

async function checkPresupuesto() {
    try {
        console.log('=== INSPECCIONANDO PRESUPUESTO msgd0xry-v7ri1 (Cliente 583) ===');
        const resDetalles = await pool.query(`
            SELECT pd.articulo, pd.cantidad, 
                   ing.nombre as ing_nombre, ing.codigo as ing_codigo, 
                   a.nombre as art_nombre, 
                   ba.descripcion_generada as ba_nombre
            FROM public.presupuestos_detalles pd
            LEFT JOIN public.ingredientes ing ON (ing.id::text = pd.articulo OR ing.codigo::text = pd.articulo)
            LEFT JOIN public.articulos a ON (a.numero::text = pd.articulo OR a.codigo_barras::text = pd.articulo)
            LEFT JOIN public.bunker_articulos ba ON (ba.articulo_id::text = pd.articulo)
            WHERE pd.id_presupuesto_ext = 'msgd0xry-v7ri1'
        `);
        console.table(resDetalles.rows);

        console.log('\n=== INSPECCIONANDO TABLA INGREDIENTES PARA 135 Y 136 ===');
        const resIng = await pool.query(`
            SELECT id, codigo, nombre, es_mix, tipo FROM public.ingredientes WHERE id IN (135, 136) OR codigo IN ('135', '136')
        `);
        console.table(resIng.rows);

        console.log('\n=== INSPECCIONANDO PRESUPUESTOS PARA CLIENTE 583 ===');
        const resPres = await pool.query(`
            SELECT id, id_presupuesto_ext, id_cliente, fecha, estado, secuencia
            FROM public.presupuestos 
            WHERE CAST(id_cliente AS integer) = 583 AND activo = true
            ORDER BY id DESC LIMIT 5
        `);
        console.table(resPres.rows);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkPresupuesto();
