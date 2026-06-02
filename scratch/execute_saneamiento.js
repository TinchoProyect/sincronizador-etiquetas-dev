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
    console.log('=== INICIANDO TRANSACCIÓN DE SANEAMIENTO DE STOCK (TEST-LOTE-85399) ===');
    
    // 1. Mostrar stock antes
    const beforeIng = await client.query('SELECT stock_actual, stock_bultos FROM public.ingredientes WHERE id = 46;');
    console.log('Stock ANTES de Saneamiento:', beforeIng.rows[0]);

    await client.query('BEGIN');

    // 2. Eliminar los movimientos del lote de prueba TEST-LOTE-85399 de la tabla de movimientos
    // Esto disparará el trigger nativo para actualizar el stock restando 10kg y restando 1 bulto
    const deleteMovRes = await client.query(`
      DELETE FROM public.ingredientes_movimientos 
      WHERE ingrediente_id = 46 AND observaciones LIKE '%TEST-LOTE-85399';
    `);
    console.log(`Movimientos eliminados: ${deleteMovRes.rowCount}`);

    // 3. Actualizar bunker_lotes_destinos para marcar el lote como completamente abierto
    // (cantidad_abierta = cantidad_asignada)
    const updateDestRes = await client.query(`
      UPDATE public.bunker_lotes_destinos 
      SET cantidad_abierta = cantidad_asignada 
      WHERE vinculo_id = '79a02bdc-5c24-4018-a802-4360fbd024a3' 
        AND destino_id = '46' 
        AND tipo_destino = 'INGREDIENTE_PRODUCCION';
    `);
    console.log(`Lotes destinos actualizados: ${updateDestRes.rowCount}`);

    await client.query('COMMIT');
    console.log('=== TRANSACCIÓN APLICADA Y COMPROMETIDA ===');

    // 4. Mostrar stock después
    const afterIng = await client.query('SELECT stock_actual, stock_bultos FROM public.ingredientes WHERE id = 46;');
    console.log('Stock DESPUÉS de Saneamiento:', afterIng.rows[0]);

    // 5. Verificar lotes de cajas cerradas activos
    const activeLotes = await client.query(`
      SELECT d.destino_id, d.cantidad_asignada, d.cantidad_abierta,
             (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) as disponibles,
             v.lote_id_supabase
      FROM public.bunker_lotes_destinos d
      JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
      WHERE d.destino_id = '46' AND d.tipo_destino = 'INGREDIENTE_PRODUCCION' AND (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0;
    `);
    console.log('\nLotes cerrados activos restantes:');
    console.table(activeLotes.rows);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ ERROR EN TRANSACCIÓN DE SANEAMIENTO:', err);
  } finally {
    await client.end();
  }
}

main();
