const { Client } = require('pg');

const client = new Client({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function main() {
  await client.connect();
  try {
    console.log('--- RESUMEN DE DISCREPANCIA CHIP BANANA (ID 46) ---');
    
    const resIng = await client.query('SELECT stock_actual, stock_bultos FROM public.ingredientes WHERE id = 46;');
    console.log('INGREDIENTE STOCK EN TABLA ingredientes:');
    console.log(resIng.rows[0]);

    const resMovSum = await client.query(`
      SELECT SUM(bultos) as sum_bultos_movimientos, SUM(kilos) as sum_kilos_movimientos 
      FROM public.ingredientes_movimientos 
      WHERE ingrediente_id = 46;
    `);
    console.log('\nSUMA EN HISTORIAL DE ingredientes_movimientos:');
    console.log(resMovSum.rows[0]);

    const resDest = await client.query(`
      SELECT d.id, d.vinculo_id, d.destino_id, d.cantidad_asignada, d.cantidad_abierta,
             (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) as disponibles_calculadas,
             v.lote_id_supabase, v.fecha_vinculacion
      FROM public.bunker_lotes_destinos d
      JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
      WHERE d.destino_id = '46' AND d.tipo_destino = 'INGREDIENTE_PRODUCCION';
    `);
    console.log('\nLOTES VINCULADOS EN bunker_lotes_destinos:');
    console.table(resDest.rows);

    const sumDisponibles = resDest.rows.reduce((acc, row) => acc + parseFloat(row.disponibles_calculadas), 0);
    console.log('\nSUMA DE CAJAS DISPONIBLES EN bunker_lotes_destinos:', sumDisponibles);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
