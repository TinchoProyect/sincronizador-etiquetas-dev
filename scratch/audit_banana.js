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
    console.log('--- AUDITORÍA DE TRANSACCIONES DE INGREDIENTE 46 (Chip Banana) ---');

    console.log('\n1. DATOS ACTUALES DEL INGREDIENTE 46:');
    const resIng = await client.query('SELECT * FROM public.ingredientes WHERE id = 46;');
    console.table(resIng.rows);

    console.log('\n2. DESTINOS ASOCIADOS EN bunker_lotes_destinos:');
    const resDest = await client.query(`
      SELECT d.*, v.lote_id_supabase, v.fecha_vinculacion, v.cantidad_total_lote
      FROM public.bunker_lotes_destinos d
      JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
      WHERE d.destino_id = '46' AND d.tipo_destino = 'INGREDIENTE_PRODUCCION';
    `);
    console.table(resDest.rows);

    console.log('\n3. HISTORIAL DE MOVIMIENTOS EN ingredientes_movimientos:');
    const resMov = await client.query(`
      SELECT * 
      FROM public.ingredientes_movimientos 
      WHERE ingrediente_id = 46
      ORDER BY fecha ASC;
    `);
    console.table(resMov.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
