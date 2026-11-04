const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const pgClient = new Client({
    user: 'postgres',
    host: 'db.zysyxtbcvgswancxtpib.supabase.co',
    database: 'postgres',
    password: 'wvvx9vZyO5eoZ3Nh',
    port: 5432,
  });

  try {
    await pgClient.connect();
    console.log('Connected to Supabase database. Running trigger simulation...');

    // We will start a transaction, create the invitation, insert the auth user,
    // catch any exception, print it, and then rollback so we don't pollute the DB.
    const query = `
      DO $$
      DECLARE
        v_err_msg text;
        v_err_state text;
        v_token text := 'test-debug-token-999';
        v_user_id uuid := gen_random_uuid();
      BEGIN
        -- 1. Create invitation
        INSERT INTO public.clientes_b2b_invitaciones (
          token,
          cliente_id,
          expires_at,
          usado,
          razon_social,
          email_portal,
          email_portal_nombre,
          email_portal_cargo
        ) VALUES (
          v_token,
          'CB-0002',
          now() + interval '1 hour',
          false,
          'Tus Frutos Secos',
          'test_debug_trigger@example.com',
          'Nicolás',
          'Dueño / Titular'
        );

        -- 2. Simulate SignUp (will fire tr_handle_new_b2b_user AFTER INSERT)
        BEGIN
          INSERT INTO auth.users (
            id,
            email,
            raw_user_meta_data,
            aud,
            role
          ) VALUES (
            v_user_id,
            'test_debug_trigger@example.com',
            jsonb_build_object(
              'cliente_id', 'CB-0002',
              'nombre_completo', 'Nicolás Test',
              'nombre_empresa', 'Tus Frutos Secos',
              'invitation_token', v_token
            ),
            'authenticated',
            'authenticated'
          );
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS 
            v_err_msg = MESSAGE_TEXT,
            v_err_state = RETURNED_SQLSTATE;
          RAISE EXCEPTION '=== TRIGGER EXCEPTION === Message: %, State: %', v_err_msg, v_err_state;
        END;
      END;
      $$;
    `;

    await pgClient.query('BEGIN;');
    try {
      await pgClient.query(query);
      console.log('✅ Trigger simulation ran without any errors!');
    } catch (err) {
      console.error('❌ Trigger simulation failed!');
      console.error(err.message);
    } finally {
      await pgClient.query('ROLLBACK;');
    }

  } catch (err) {
    console.error('Connection failed:', err.message);
  } finally {
    await pgClient.end();
  }
}

run();
