require('dotenv').config();
const { Pool } = require('pg');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const pool = new Pool({ connectionString: 'postgres://postgres:ta3Mionga@localhost:5432/etiquetas' });

const SUPABASE_URL = process.env.SUPABASE_B2B_URL || 'https://zysyxtbcvgswancxtpib.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY || 'sb_secret__h-Z9In5Wo4ae6T_vHQVAw_6EA6QmPq';

async function resetNico() {
  console.log('🧹 Iniciando blanqueo de cuenta de simulación para Nico (CB-0002)...');

  try {
    // 1. Limpieza en la base de datos local
    console.log('📦 Limpiando base de datos local...');
    
    // Quitar email_portal
    const resUpdate = await pool.query(`
      UPDATE public.bunker_clientes 
      SET email_portal = NULL 
      WHERE codigo_bunker_cliente = 'CB-0002'
      RETURNING razon_social, email_portal;
    `);
    console.log('   - bunker_clientes actualizado:', resUpdate.rows[0]);

    // Eliminar invitaciones
    const resDelInv = await pool.query(`
      DELETE FROM public.portal_invitaciones 
      WHERE cliente_id = 'CB-0002'
      RETURNING *;
    `);
    console.log(`   - Se eliminaron ${resDelInv.rowCount} invitaciones del portal.`);

    // Eliminar OTPs
    const resDelOtp = await pool.query(`
      DELETE FROM public.portal_otp 
      WHERE cliente_id = 'CB-0002'
      RETURNING *;
    `);
    console.log(`   - Se eliminaron ${resDelOtp.rowCount} registros OTP.`);

    // 2. Limpieza en la nube (Supabase Auth y Perfiles)
    console.log('☁️  Buscando perfil en Supabase...');
    const searchUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_perfiles?cliente_id=eq.CB-0002`;
    const searchRes = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });

    if (searchRes.ok) {
      const profiles = await searchRes.json();
      console.log(`   - Perfiles encontrados en la nube para CB-0002: ${profiles.length}`);
      
      for (const profile of profiles) {
        const userUuid = profile.id;
        console.log(`   - Eliminando usuario de Supabase Auth: ${userUuid} (${profile.email})...`);
        
        const deleteAuthUrl = `${SUPABASE_URL}/auth/v1/admin/users/${userUuid}`;
        const deleteAuthRes = await fetch(deleteAuthUrl, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
          }
        });

        if (deleteAuthRes.ok) {
          console.log(`   - ✅ Usuario Auth ${userUuid} de Supabase eliminado.`);
        } else {
          const errText = await deleteAuthRes.text();
          console.error(`   - ❌ Error al eliminar usuario Auth ${userUuid}:`, errText);
        }
      }
    } else {
      console.error('❌ Error al consultar perfiles en Supabase:', await searchRes.text());
    }

    console.log('✅ Blanqueo de cuenta de simulación completado exitosamente.');
  } catch (error) {
    console.error('💥 Error durante el blanqueo:', error);
  } finally {
    await pool.end();
  }
}

resetNico();
