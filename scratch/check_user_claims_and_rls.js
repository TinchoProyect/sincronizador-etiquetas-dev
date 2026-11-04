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
    console.log('🔍 Auditando usuario miserrano75@gmail.com...');
    
    // 1. auth.users
    const resUser = await client.query(`
      SELECT id, email, raw_app_meta_data, raw_user_meta_data
      FROM auth.users
      WHERE email = 'miserrano75@gmail.com';
    `);

    console.log('👤 auth.users:', JSON.stringify(resUser.rows[0], null, 2));

    const userId = resUser.rows[0].id;

    // 2. clientes_b2b_perfiles
    const resPerfil = await client.query(`
      SELECT * FROM public.clientes_b2b_perfiles WHERE id = $1;
    `, [userId]);

    console.log('📋 clientes_b2b_perfiles:', resPerfil.rows[0]);

    // 3. clientes_b2b_perfiles_listas
    const resListas = await client.query(`
      SELECT * FROM public.clientes_b2b_perfiles_listas WHERE cliente_id = $1;
    `, [resPerfil.rows[0]?.cliente_id]);

    console.log('🏷️ clientes_b2b_perfiles_listas:', resListas.rows);

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.end();
  }
}

main();
