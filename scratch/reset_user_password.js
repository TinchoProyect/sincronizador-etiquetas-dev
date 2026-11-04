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
    console.log('🔑 Restableciendo contraseña para miserrano75@gmail.com a "123456"...');
    
    // Asegurar que pgcrypto esté habilitado y actualizar la contraseña encripada
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
    
    const res = await client.query(`
      UPDATE auth.users 
      SET encrypted_password = crypt('123456', gen_salt('bf')),
          updated_at = NOW()
      WHERE email = 'miserrano75@gmail.com'
      RETURNING id, email;
    `);

    if (res.rows.length > 0) {
      console.log('✅ Contraseña actualizada con éxito a "123456" para:', res.rows[0].email);
    } else {
      console.log('⚠️ No se encontró el usuario miserrano75@gmail.com');
    }

  } catch (err) {
    console.error('❌ Error al cambiar contraseña:', err.message);
  } finally {
    await client.end();
  }
}

main();
