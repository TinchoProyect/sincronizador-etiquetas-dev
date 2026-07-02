// filepath: src/actualizaPrecios/syncB2BClientesListas.js
'use strict';

require('dotenv').config();
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
      
      const errorText = await response.text();
      console.warn(`⚠️ [Supabase POST/GET] Intento ${attempt}/${retries} falló: HTTP ${response.status} - ${errorText}`);
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === 'AbortError';
      console.error(`❌ [Supabase Conn] Intento ${attempt}/${retries} error: ${isTimeout ? 'TIMEOUT' : err.message}`);
    }
    
    if (attempt < retries) {
      const backoff = delay * Math.pow(2, attempt - 1);
      console.log(`🔄 Reintentando en ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  throw new Error(`Agotados los ${retries} reintentos de conexión con Supabase.`);
}







async function lookupClientDetails(db, clienteId) {
  // 1. Buscar en Bunker
  const queryBunker = `
    SELECT 
        COALESCE(bc.email_portal_nombre, bc.cliente_nombre) as nombre_completo,
        COALESCE(bc.razon_social, bc.cliente_nombre) as nombre_empresa,
        bc.cuit_cuil as cuit,
        bc.email_portal as email
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
        const finalNombre = profile.nombre_completo || details.nombre_completo || '';
        const finalEmpresa = profile.nombre_empresa || details.nombre_empresa || '';
        
        const patchUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_perfiles?id=eq.${profile.id}`;
        const patchOptions = {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            nombre_completo: finalNombre.trim(),
            nombre_empresa: finalEmpresa.trim(),
            cuit: profile.cuit || (details.cuit ? String(details.cuit).trim() : null),
            email: finalEmail,
            updated_at: syncStart
          })
        };
        await fetchWithRetry(patchUrl, patchOptions);
        perfilesActualizados++;
      } else {
        console.warn(`⚠️ No se encontraron detalles locales para el cliente_id: ${profile.cliente_id}`);
      }
    }
    console.log(`✅ Perfiles de usuarios actualizados con éxito: ${perfilesActualizados}/${profiles.length}`);
    if (localEmailsSincronizados > 0) {
      console.log(`✅ Sincronización Inversa: ${localEmailsSincronizados} correos actualizados de la Nube a la BD Local.`);
    }

    // ==========================================
    // PARTE B: Sincronización de Listas de Precios Asignadas
    // ==========================================
    console.log('\n🔍 Consultando asignaciones de listas en base local (Híbrido)...');
    
    const listsQuery = `
      SELECT 
          COALESCE(
              (SELECT codigo_bunker_cliente FROM public.bunker_clientes WHERE lomas_soft_id ~ '^[0-9]+$' AND lomas_soft_id::integer = c.cliente_id LIMIT 1),
              c.cliente_id::text
          ) as cliente_id,
          c.lista_precios::integer as lista_id,
          true as es_principal
      FROM public.clientes c
      WHERE c.lista_precios IS NOT NULL AND c.lista_precios ~ '^[0-9]+$'
      UNION
      SELECT 
          bc.codigo_bunker_cliente as cliente_id,
          clp.bunker_lista_precio_id as lista_id,
          false as es_principal
      FROM public.bunker_cliente_listas_precios clp
      JOIN public.bunker_clientes bc ON bc.id = clp.bunker_cliente_id;
    `;

    const resLocalLists = await localClient.query(listsQuery);
    const totalMappings = resLocalLists.rows.length;
    console.log(`📊 Asignaciones de listas encontradas localmente: ${totalMappings}`);

    if (totalMappings > 0) {
      const payloads = resLocalLists.rows.map(row => ({
        cliente_id: String(row.cliente_id).trim(),
        lista_id: parseInt(row.lista_id),
        es_principal: row.es_principal,
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

      // Limpieza de relaciones de listas obsoletas
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
