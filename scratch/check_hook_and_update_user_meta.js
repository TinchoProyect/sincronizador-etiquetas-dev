const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Client } = require('pg');

async function main() {
  const client = new Client({
    user: 'postgres.zysyxtbcvgswancxtpib',
    host: 'aws-1-sa-east-1.pooler.supabase.com',
    database: 'postgres',
    password: 'wvvx9vZyO5eoZ3Nh',
    port: 6543,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    console.log('🔄 Actualizando raw_app_meta_data en auth.users a partir de clientes_b2b_perfiles...');

    // 1. Sincronizar raw_app_meta_data en auth.users para todos los usuarios B2B
    const resSync = await client.query(`
      UPDATE auth.users u
      SET raw_app_meta_data = jsonb_build_object(
        'provider', COALESCE(u.raw_app_meta_data->>'provider', 'email'),
        'providers', COALESCE(u.raw_app_meta_data->'providers', '["email"]'::jsonb),
        'cliente_id', p.cliente_id,
        'rol', p.rol,
        'permisos', to_jsonb(p.permisos),
        'listas_precios', (
          SELECT COALESCE(jsonb_agg(lista_id), '[]'::jsonb)
          FROM public.clientes_b2b_perfiles_listas
          WHERE cliente_id = p.cliente_id
        )
      )
      FROM public.clientes_b2b_perfiles p
      WHERE u.id = p.id
      RETURNING u.email, u.raw_app_meta_data;
    `);

    console.log(`✅ Sincronizados ${resSync.rows.length} usuarios con claims en app_metadata:`);
    resSync.rows.forEach(u => console.log(`  - ${u.email}:`, u.raw_app_meta_data));

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.end();
  }
}

main();
