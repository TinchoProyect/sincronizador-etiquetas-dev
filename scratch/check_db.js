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
    const resColIng = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'ingredientes';
    `);
    console.log('INGRES COLUMNS:');
    console.table(resColIng.rows);

    const resColDest = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'bunker_lotes_destinos';
    `);
    console.log('DEST COLUMNS:');
    console.table(resColDest.rows);

    const resColVinc = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'bunker_lotes_vinculos';
    `);
    console.log('VINC COLUMNS:');
    console.table(resColVinc.rows);

    const resCajas = await client.query(`
      SELECT d.*, v.lote_id_supabase, v.fecha_vinculacion
      FROM public.bunker_lotes_destinos d
      JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
      WHERE d.tipo_destino = 'INGREDIENTE_PRODUCCION' AND d.cantidad_abierta < d.cantidad_asignada;
    `);
    console.log('ACTIVE CAJAS DE LOTES:');
    console.table(resCajas.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
