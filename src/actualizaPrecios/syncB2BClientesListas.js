// filepath: src/actualizaPrecios/syncB2BClientesListas.js
'use strict';

if (!globalThis.WebSocket) { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

// ===== 1) Conexión a la Base de Datos Local =====
const localPool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

console.log('═══════════════════════════════════════════════════════');
console.log('📡 [SYNC-B2B-CLIENTES] SINCRONIZACIÓN DE PERFILES Y LISTAS');
console.log('═══════════════════════════════════════════════════════');
console.log(`🔌 Conectado a BD Local: ${process.env.DB_NAME || 'etiquetas'}`);
console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'production'}`);
console.log(`☁️  Supabase URL: ${process.env.SUPABASE_B2B_URL}`);
console.log('═══════════════════════════════════════════════════════');

// ===== 2) Configuración de API Supabase =====
const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('💥 ERROR CRÍTICO: Variables de Supabase B2B faltantes en .env');
  process.exit(1);
}

// Helper para realizar llamadas HTTP con reintentos y timeout (Resiliencia)
async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
  let lastErrorText = '';
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return response;
      }
      
      if (response.status === 400) {
        lastErrorText = await response.text();
        throw new Error(`HTTP 400 Bad Request: ${lastErrorText}`);
      }

      lastErrorText = await response.text();
      console.warn(`⚠️ [Supabase POST/GET] Intento ${attempt}/${retries} falló: HTTP ${response.status} - ${lastErrorText}`);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.message && err.message.startsWith('HTTP 400')) {
        throw err;
      }
      const isTimeout = err.name === 'AbortError';
      lastErrorText = isTimeout ? 'TIMEOUT' : err.message;
      console.error(`❌ [Supabase Conn] Intento ${attempt}/${retries} error: ${lastErrorText}`);
    }
    
    if (attempt < retries) {
      const backoff = delay * Math.pow(2, attempt - 1);
      console.log(`🔄 Reintentando en ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  throw new Error(`Agotados los ${retries} reintentos de conexión con Supabase. Detalle: ${lastErrorText}`);
}







async function lookupClientDetails(db, clienteId) {
  // 1. Buscar en Bunker
  const queryBunker = `
    SELECT 
        COALESCE(bc.email_portal_nombre, bc.cliente_nombre) as nombre_completo,
        COALESCE(bc.razon_social, bc.cliente_nombre) as nombre_empresa,
        bc.cuit_cuil as cuit,
        bc.email_portal as email,
        COALESCE(bc.ver_stock, false) as ver_stock
    FROM public.bunker_clientes bc
    LEFT JOIN public.clientes c ON c.cliente_id::text = bc.lomas_soft_id
    WHERE bc.codigo_bunker_cliente = $1 OR bc.lomas_soft_id = $1
    LIMIT 1;
  `;
  const resBunker = await db.query(queryBunker, [clienteId]);
  if (resBunker.rows.length > 0) {
    return resBunker.rows[0];
  }

  // 2. Buscar en Legacy (Lomasoft)
  const queryLegacy = `
    SELECT 
        nombre as nombre_completo,
        nombre as nombre_empresa,
        cuit,
        email
    FROM public.clientes
    WHERE cliente_id::text = $1
    LIMIT 1;
  `;
  const resLegacy = await db.query(queryLegacy, [clienteId]);
  if (resLegacy.rows.length > 0) {
    return resLegacy.rows[0];
  }

  return null;
}

async function sincronizarB2BClientesListas() {
  let localClient;
  const syncStart = new Date().toISOString();

  try {
    localClient = await localPool.connect();

    // ==========================================
    // PARTE A: Sincronización de Perfiles Existentes
    // ==========================================
    console.log('🔍 Consultando perfiles registrados en Supabase...');
    const getProfilesUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_perfiles`;
    const getOptions = {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    };
    
    const resProfiles = await fetchWithRetry(getProfilesUrl, getOptions);
    const profiles = await resProfiles.json();
    console.log(`📊 Perfiles encontrados en Supabase: ${profiles.length}`);

    let perfilesActualizados = 0;
    let localEmailsSincronizados = 0;
    let hasVerStockColumn = true;
    for (const profile of profiles) {
      const details = await lookupClientDetails(localClient, profile.cliente_id);
      
      // A. Sincronización Inversa (Cloud -> Local):
      // Si el perfil en la nube tiene un email cargado, pero localmente no tenemos email_portal o es diferente,
      // actualizamos la base local de Búnker.
      if (profile.email && profile.email.trim()) {
        const cloudEmail = profile.email.trim().toLowerCase();
        
        const resBunkerEmail = await localClient.query(
          `SELECT email_portal, email_portal_nombre 
           FROM public.bunker_clientes 
           WHERE codigo_bunker_cliente = $1 OR lomas_soft_id = $1 
           LIMIT 1`,
          [profile.cliente_id]
        );
        
        if (resBunkerEmail.rows.length > 0) {
          const localBunker = resBunkerEmail.rows[0];
          const localEmailPortal = String(localBunker.email_portal || '').trim().toLowerCase();
          
          if (localEmailPortal !== cloudEmail) {
            console.log(`🔄 [SYNC-REVERSO] Actualizando email local para cliente ${profile.cliente_id}: '${localEmailPortal}' ➔ '${cloudEmail}'`);
            await localClient.query(
              `UPDATE public.bunker_clientes 
               SET email_portal = $1, 
                   email_portal_nombre = COALESCE(email_portal_nombre, $2)
               WHERE codigo_bunker_cliente = $3 OR lomas_soft_id = $3`,
              [cloudEmail, profile.nombre_completo || 'Cliente B2B', profile.cliente_id]
            );
            localEmailsSincronizados++;
          }
        }
      }

      // B. Sincronización Directa Higiénica (Local -> Cloud):
      // Solo actualizamos de local a la nube si la nube está vacía o difiere,
      // pero NUNCA pisamos un email de la nube con un valor local vacío!
      if (details) {
        const localEmail = String(details.email || '').trim().toLowerCase();
        const cloudEmail = String(profile.email || '').trim().toLowerCase();
        
        const finalEmail = cloudEmail || localEmail || null;
        const finalNombre = (profile.nombre_completo || details.nombre_completo || '').trim();
        const finalEmpresa = (profile.nombre_empresa || details.nombre_empresa || '').trim();
        const finalCuit = profile.cuit || (details.cuit ? String(details.cuit).trim() : null);
        
        let permisos = Array.isArray(profile.permisos) ? [...profile.permisos] : ['compras', 'pagos'];
        if (details.ver_stock) {
          if (!permisos.includes('ver_stock')) permisos.push('ver_stock');
        } else {
          permisos = permisos.filter(p => p !== 'ver_stock');
        }
        if (profile.cliente_id === 'CB-0006' && !permisos.includes('servicios_colaborador')) {
          permisos.push('servicios_colaborador');
        }

        const sameNombre = (profile.nombre_completo || '').trim() === finalNombre;
        const sameEmpresa = (profile.nombre_empresa || '').trim() === finalEmpresa;
        const sameCuit = (profile.cuit || null) === finalCuit;
        const sameEmail = (profile.email || null) === finalEmail;
        const samePermisos = JSON.stringify([...(profile.permisos || [])].sort()) === JSON.stringify([...permisos].sort());
        const sameVerStock = !hasVerStockColumn || profile.ver_stock === undefined || Boolean(profile.ver_stock) === Boolean(details.ver_stock);

        if (!sameNombre || !sameEmpresa || !sameCuit || !sameEmail || !samePermisos || !sameVerStock) {
          const patchPayload = {
            nombre_completo: finalNombre,
            nombre_empresa: finalEmpresa,
            cuit: finalCuit,
            email: finalEmail,
            permisos: permisos,
            updated_at: syncStart
          };
          if (hasVerStockColumn) {
            patchPayload.ver_stock = !!details.ver_stock;
          }

          const patchUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_perfiles?id=eq.${profile.id}`;
          const patchOptions = {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(patchPayload)
          };
          try {
            await fetchWithRetry(patchUrl, patchOptions);
          } catch (errPatch) {
            if (errPatch.message && errPatch.message.includes('ver_stock')) {
              hasVerStockColumn = false;
              delete patchPayload.ver_stock;
              patchOptions.body = JSON.stringify(patchPayload);
              await fetchWithRetry(patchUrl, patchOptions);
            } else {
              throw errPatch;
            }
          }
          perfilesActualizados++;
        }
      } else {
        console.warn(`⚠️ No se encontraron detalles locales para el cliente_id: ${profile.cliente_id}`);
      }
    }
    console.log(`✅ Perfiles de usuarios auditados: ${profiles.length} (${perfilesActualizados} con cambios sincronizados).`);
    if (localEmailsSincronizados > 0) {
      console.log(`✅ Sincronización Inversa: ${localEmailsSincronizados} correos actualizados de la Nube a la BD Local.`);
    }

    // A2. Upsert proactivo de perfiles faltantes para clientes de Búnker con usuario en Auth
    console.log('\n🔍 Auditando clientes locales con usuario Auth para asegurar perfil en Supabase...');
    try {
      const resBunkerClients = await localClient.query(`
        SELECT bc.id, bc.codigo_bunker_cliente, bc.cliente_nombre, bc.razon_social, bc.cuit_cuil, bc.email_portal, bc.email_portal_nombre, bc.ver_stock, bc.lomas_soft_id
        FROM public.bunker_clientes bc
        WHERE bc.email_portal IS NOT NULL AND TRIM(bc.email_portal) <> ''
      `);

      const { createClient } = require('@supabase/supabase-js');
      const supabaseAdminSync = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      const { data: allUsersData } = await supabaseAdminSync.auth.admin.listUsers();
      const existingProfileClientIds = new Set(profiles.map(p => p.cliente_id));

      let perfilesCreados = 0;
      for (const bCli of resBunkerClients.rows) {
        if (!existingProfileClientIds.has(bCli.codigo_bunker_cliente)) {
          const cEmail = bCli.email_portal.trim().toLowerCase();
          const authUser = (allUsersData?.users || []).find(u => 
            u.email?.toLowerCase() === cEmail || 
            u.app_metadata?.cliente_id === bCli.codigo_bunker_cliente
          );

          if (authUser) {
            const permisos = ['compras', 'pagos'];
            if (bCli.ver_stock) permisos.push('ver_stock');
            if (bCli.codigo_bunker_cliente === 'CB-0006') permisos.push('servicios_colaborador');

            await supabaseAdminSync.from('clientes_b2b_perfiles').upsert({
              id: authUser.id,
              cliente_id: bCli.codigo_bunker_cliente,
              rol: 'Dueno',
              permisos: permisos,
              nombre_completo: bCli.email_portal_nombre || bCli.cliente_nombre,
              nombre_empresa: bCli.razon_social || bCli.cliente_nombre,
              cuit: bCli.cuit_cuil,
              email: cEmail,
              ver_stock: !!bCli.ver_stock,
              updated_at: syncStart
            });
            perfilesCreados++;
            existingProfileClientIds.add(bCli.codigo_bunker_cliente);
            console.log(`✨ [SYNC-PROFILE-CREADO] Perfil creado para cliente ${bCli.codigo_bunker_cliente} (${cEmail})`);
          }
        }
      }
      if (perfilesCreados > 0) {
        console.log(`✅ ${perfilesCreados} perfiles faltantes creados proactivamente en Supabase.`);
      }
    } catch (errMissing) {
      console.warn('⚠️ Error en auditoría de perfiles faltantes:', errMissing.message);
    }

    // ==========================================
    // PARTE B: Sincronización de Listas de Precios Asignadas
    // ==========================================
    console.log('\n🔍 Consultando asignaciones de listas en base local (Híbrido)...');
    
    // Consultar asignaciones explícitas en bunker_cliente_listas_precios cruzando con clientes para marcar la principal
    const listsQuery = `
      SELECT 
          bc.codigo_bunker_cliente as cliente_id,
          clp.bunker_lista_precio_id as lista_id,
          COALESCE(cfg.permitir_toggle_iva, false) as permitir_toggle_iva,
          CASE
              WHEN c.lista_precios IS NOT NULL AND c.lista_precios ~ '^[0-9]+$' AND c.lista_precios::integer = clp.bunker_lista_precio_id THEN true
              WHEN ROW_NUMBER() OVER (PARTITION BY bc.codigo_bunker_cliente ORDER BY clp.id ASC) = 1 THEN true
              ELSE false
          END as es_principal
      FROM public.bunker_cliente_listas_precios clp
      JOIN public.bunker_clientes bc ON bc.id = clp.bunker_cliente_id
      LEFT JOIN public.bunker_portal_b2b_listas_config cfg ON cfg.lista_id = clp.bunker_lista_precio_id
      LEFT JOIN public.clientes c ON (bc.lomas_soft_id = TRIM(c.cliente_id::text) OR (bc.lomas_soft_id ~ '^[0-9]+$' AND c.cliente_id::text ~ '^[0-9]+$' AND bc.lomas_soft_id::integer = c.cliente_id::integer));
    `;

    const resLocalLists = await localClient.query(listsQuery);
    const totalMappings = resLocalLists.rows.length;
    console.log(`📊 Asignaciones de listas encontradas localmente: ${totalMappings}`);

    if (totalMappings > 0) {
      const payloads = resLocalLists.rows.map(row => ({
        cliente_id: String(row.cliente_id).trim(),
        lista_id: parseInt(row.lista_id),
        es_principal: row.es_principal,
        permitir_toggle_iva: Boolean(row.permitir_toggle_iva),
        created_at: syncStart // Marca temporal para limpieza
      }));

      // Enviar en lotes a Supabase
      const batchSize = 500;
      let upsertados = 0;
      
      console.log('🚀 Iniciando subida de lotes de asignación de listas (Upsert)...');
      
      for (let i = 0; i < payloads.length; i += batchSize) {
        const batch = payloads.slice(i, i + batchSize);
        const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_perfiles_listas?on_conflict=cliente_id,lista_id`;
        const options = {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify(batch)
        };
        await fetchWithRetry(url, options);
        upsertados += batch.length;
        console.log(`🔄 Sincronizados ${upsertados}/${totalMappings} mapeos de listas...`);
      }
    }

    // Limpieza de relaciones de listas obsoletas (se ejecuta siempre para asegurar higiene contable)
    console.log(`\n🧹 Iniciando limpieza de mapeos obsoletos (anteriores a ${syncStart})...`);
    const cleanUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_perfiles_listas?created_at=lt.${encodeURIComponent(syncStart)}`;
    const cleanOptions = {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    };
    
    await fetchWithRetry(cleanUrl, cleanOptions);
    console.log('✅ Sincronización e higiene de listas completada exitosamente.');

    // Sincronizar también el directorio cloud (DIR-CB-XXXX) y clientesB2B.js
    try {
      const { sincronizarTodoElDirectorioB2B, parsearContactoWhatsapp } = require('../logistica/services/b2bDirectorySyncService');
      await sincronizarTodoElDirectorioB2B(localPool);

      // Asegurar que las invitaciones activas en Supabase tengan el nombre de contacto de WhatsApp pre-cargado
      const resInvLocal = await localClient.query(`
        SELECT i.token, i.cliente_id, bc.email_portal_nombre, bc.whatsapp_facturas, bc.cliente_nombre, bc.razon_social
        FROM public.portal_invitaciones i
        JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = i.cliente_id
        WHERE i.usado = false AND i.expires_at > NOW()
      `);
      for (const inv of resInvLocal.rows) {
        const wpInfo = parsearContactoWhatsapp(inv.whatsapp_facturas);
        const contactName = (inv.email_portal_nombre || wpInfo.contactName || '').trim();
        if (contactName) {
          await fetchWithRetry(`${SUPABASE_URL}/rest/v1/clientes_b2b_invitaciones?token=eq.${encodeURIComponent(inv.token)}`, {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              email_portal_nombre: contactName,
              razon_social: inv.razon_social || inv.cliente_nombre || inv.cliente_id
            })
          });
        }
      }
    } catch (dirErr) {
      console.warn('⚠️ Advertencia sincronizando directorio B2B:', dirErr.message);
    }

    // ==========================================
    // PARTE C: Sincronización de app_metadata en Supabase Auth
    // ==========================================
    console.log('\n🔄 Sincronizando listas_precios en auth.users app_metadata...');
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
      });

      const { data: listUsersData, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
      if (!usersError && listUsersData?.users) {
        let authUsersActualizados = 0;
        for (const u of listUsersData.users) {
          const metaCid = u.app_metadata?.cliente_id || u.user_metadata?.cliente_id || '';
          const clientRes = await localClient.query(`
            SELECT bc.codigo_bunker_cliente, bc.usuario_id, clp.bunker_lista_precio_id as lista_id, COALESCE(bc.ver_stock, false) as ver_stock
            FROM bunker_clientes bc
            LEFT JOIN bunker_cliente_listas_precios clp ON clp.bunker_cliente_id = bc.id
            WHERE (bc.email_portal IS NOT NULL AND (bc.email_portal = $1 OR bc.email_portal ILIKE $1))
               OR ($2 <> '' AND bc.codigo_bunker_cliente = $2)
          `, [u.email || '', metaCid]);

          if (clientRes.rows.length > 0) {
            const cId = clientRes.rows[0].codigo_bunker_cliente;
            const listIds = clientRes.rows.filter(r => r.lista_id).map(r => parseInt(r.lista_id));
            const verStock = !!clientRes.rows[0].ver_stock;
            const isColab = !!clientRes.rows[0].usuario_id || cId === 'CB-0006';
            const currentAppMeta = u.app_metadata || {};

            const permisosSet = new Set(Array.isArray(currentAppMeta.permisos) ? currentAppMeta.permisos : ['compras', 'pagos']);
            permisosSet.add('compras');
            permisosSet.add('pagos');
            if (verStock) permisosSet.add('ver_stock');
            else permisosSet.delete('ver_stock');
            if (isColab) permisosSet.add('servicios_colaborador');
            const permisos = Array.from(permisosSet);

            const sameCid = currentAppMeta.cliente_id === cId;
            const sameLists = JSON.stringify([...(currentAppMeta.listas_precios || [])].sort()) === JSON.stringify([...listIds].sort());
            const samePerms = JSON.stringify([...(currentAppMeta.permisos || [])].sort()) === JSON.stringify([...permisos].sort());
            const sameVS = Boolean(currentAppMeta.ver_stock) === Boolean(verStock);

            if (!sameCid || !sameLists || !samePerms || !sameVS || !u.email_confirmed_at) {
              await supabaseAdmin.auth.admin.updateUserById(u.id, {
                email_confirm: true,
                app_metadata: {
                  ...currentAppMeta,
                  cliente_id: cId,
                  rol: currentAppMeta.rol || 'Dueno',
                  listas_precios: listIds.length > 0 ? listIds : [1],
                  permisos: permisos,
                  ver_stock: verStock
                }
              });
              authUsersActualizados++;
              console.log(`  -> Actualizado usuario auth ${u.email}: cliente_id=${cId}, listas=[${listIds.join(',')}], permisos=[${permisos.join(',')}]`);
            }
          }
        }
        console.log(`✅ Metadatos de autenticación Supabase auditados (${authUsersActualizados} modificados).`);
      }
    } catch (authErr) {
      console.warn('⚠️ No se pudo sincronizar app_metadata de auth.users:', authErr.message);
    }

  } catch (error) {
    console.error('❌ Error durante la sincronización de clientes y listas B2B:', error.message);
    process.exitCode = 1;
  } finally {
    if (localClient) {
      localClient.release();
    }
  }
}

sincronizarB2BClientesListas()
  .catch(error => {
    console.error('💥 Error fatal en sincronización de clientes y listas B2B:', error);
    process.exitCode = 1;
  });
