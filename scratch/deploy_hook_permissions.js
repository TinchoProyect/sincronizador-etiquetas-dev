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
    console.log('⚡ Actualizando permisos del Hook y función custom_access_token_hook...');

    await client.query(`
      GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
      GRANT SELECT ON public.clientes_b2b_perfiles TO supabase_auth_admin;
      GRANT SELECT ON public.clientes_b2b_perfiles_listas TO supabase_auth_admin;

      CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
      DECLARE
        claims jsonb;
        v_cliente_id text;
        v_rol text;
        v_permisos text[];
        v_listas integer[];
        v_user_id uuid;
      BEGIN
        claims := event -> 'claims';
        v_user_id := (claims ->> 'sub')::uuid;

        SELECT cliente_id, rol, permisos
        INTO v_cliente_id, v_rol, v_permisos
        FROM public.clientes_b2b_perfiles
        WHERE id = v_user_id;

        IF v_cliente_id IS NOT NULL THEN
          SELECT COALESCE(array_agg(lista_id), '{}'::integer[])
          INTO v_listas
          FROM public.clientes_b2b_perfiles_listas
          WHERE cliente_id = v_cliente_id;

          claims := jsonb_set(claims, '{app_metadata, cliente_id}', to_jsonb(v_cliente_id));
          claims := jsonb_set(claims, '{app_metadata, rol}', to_jsonb(v_rol));
          claims := jsonb_set(claims, '{app_metadata, permisos}', to_jsonb(v_permisos));
          claims := jsonb_set(claims, '{app_metadata, listas_precios}', to_jsonb(v_listas));
          
          claims := jsonb_set(claims, '{user_metadata, cliente_id}', to_jsonb(v_cliente_id));
          claims := jsonb_set(claims, '{user_metadata, rol}', to_jsonb(v_rol));
          claims := jsonb_set(claims, '{user_metadata, permisos}', to_jsonb(v_permisos));
          claims := jsonb_set(claims, '{user_metadata, listas_precios}', to_jsonb(v_listas));
        END IF;

        event := jsonb_set(event, '{claims}', claims);
        RETURN event;
      END;
      $$;

      GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
      REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC;
    `);

    console.log('✅ Hook compilado e inyectado con éxito en Supabase.');

  } catch (err) {
    console.error('❌ Error al actualizar Hook:', err.message);
  } finally {
    await client.end();
  }
}

main();
