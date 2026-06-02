const { Client } = require('pg');

const client = new Client({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function testResolution(bunker_articulo_id) {
  console.log(`\nTesting bunker_articulo_id: "${bunker_articulo_id}"`);
  
  // 1. Check parent-child relation
  const artRes = await client.query(
    'SELECT articulo_id, pack_hijo_codigo FROM public.bunker_articulos WHERE LOWER(articulo_id) = LOWER($1)',
    [bunker_articulo_id]
  );
  
  let targetId = bunker_articulo_id;
  if (artRes.rows.length > 0) {
    targetId = artRes.rows[0].pack_hijo_codigo || artRes.rows[0].articulo_id;
    console.log(`  -> Found in database! Real ID: "${artRes.rows[0].articulo_id}", pack_hijo_codigo: "${artRes.rows[0].pack_hijo_codigo || ''}"`);
  } else {
    console.log('  -> Not found in public.bunker_articulos');
  }
  
  console.log(`  -> Final target mapping ID: "${targetId}"`);

  // 2. Fetch mappings
  const result = await client.query(
    'SELECT proveedor_id, proveedor_producto_codigo FROM public.bunker_articulos_reposicion_mapeo WHERE LOWER(bunker_articulo_id) = LOWER($1)',
    [targetId]
  );
  
  console.log(`  -> Found ${result.rows.length} mappings:`, result.rows);
}

async function main() {
  await client.connect();
  try {
    await testResolution('szaax1');
    await testResolution('SZAAX1');
    await testResolution('SZAAx5');
    await testResolution('SZAAX25');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

main();
