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
    console.log('🔍 Buscando perfiles con 196 o Martin o serrano...');
    const resPerfiles = await client.query(`
      SELECT p.*, u.email
      FROM public.clientes_b2b_perfiles p
      LEFT JOIN auth.users u ON u.id = p.id
      WHERE p.cliente_id ILIKE '%196%' OR p.nombre_completo ILIKE '%martin%' OR u.email ILIKE '%serrano%'
    `);

    console.log('Encontrados en perfiles:', resPerfiles.rows);

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.end();
  }
}

main();
