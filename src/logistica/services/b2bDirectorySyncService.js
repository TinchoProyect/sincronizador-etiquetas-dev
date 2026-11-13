'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;

const CLIENTES_B2B_JS_PATH = path.resolve(__dirname, '../../../b2b-portal/src/utils/clientesB2B.js');

/**
 * Extrae el nombre de contacto y teléfono enmascarado desde whatsapp_facturas
 */
function parsearContactoWhatsapp(rawWhatsapp) {
    if (!rawWhatsapp || !String(rawWhatsapp).trim()) {
        return { contactName: '', phoneMasked: '', rawPhone: '' };
    }
    const val = String(rawWhatsapp).trim();
    let num = '';
    let nombre = '';

    if (val.startsWith('[')) {
        try {
            const arr = JSON.parse(val);
            if (Array.isArray(arr) && arr.length > 0) {
                const def = arr.find(c => c.default_resumen === true) ||
                            arr.find(c => c.default === true) ||
                            arr.find(c => c.enviar_alerta === true) ||
                            arr[0];
                if (def) {
                    num = String(def.numero || '').replace(/\D/g, '');
                    nombre = String(def.nombre || '').trim();
                }
            }
        } catch (e) {
            num = val.replace(/\D/g, '');
        }
    } else {
        num = val.replace(/\D/g, '');
    }

    const phoneMasked = num.length >= 4 ? `•••• ${num.slice(-4)}` : '';
    return {
        contactName: nombre,
        phoneMasked,
        rawPhone: val
    };
}

/**
 * Extrae el primer email válido de email_portal o email_facturas
 */
function resolverEmailCliente(row, cloudEmailMap) {
    const cid = String(row.codigo_bunker_cliente || '').trim();
    if (cloudEmailMap && cloudEmailMap.has(cid)) {
        return cloudEmailMap.get(cid);
    }
    if (row.email_portal && String(row.email_portal).trim()) {
        return String(row.email_portal).trim().toLowerCase();
    }
    if (row.email_facturas && String(row.email_facturas).trim()) {
        const val = String(row.email_facturas).trim();
        if (val.startsWith('[')) {
            try {
                const arr = JSON.parse(val);
                if (Array.isArray(arr) && arr.length > 0 && arr[0]?.email) {
                    return String(arr[0].email).trim().toLowerCase();
                }
            } catch (e) {}
        } else if (val.includes('@')) {
            return val.split(',')[0].trim().toLowerCase();
        }
    }
    return `${cid.toLowerCase()}@lamdaclientes.com`;
}

/**
 * Construye el código fuente de b2b-portal/src/utils/clientesB2B.js
 */
function generarCodigoClientesB2BJs(registros) {
    const jsonArray = JSON.stringify(registros, null, 2);
    return `// Catálogo Oficial Indexado de Distribuidores y Clientes B2B LAMDA
// Sincronizado 100% con PostgreSQL Bunker y Supabase Cloud Auth (Auto-generado + Cloud Dynamic Sync)

export const CLIENTES_B2B_REGISTRO = ${jsonArray};

let _cloudDirectoryLoaded = false;
let _cloudDirectoryPromise = null;

/**
 * Fusiona un registro de cliente en la tabla en memoria CLIENTES_B2B_REGISTRO
 */
function mergeClienteEnMemoria(entry) {
  if (!entry || !entry.bunker_id) return;
  const idx = CLIENTES_B2B_REGISTRO.findIndex(
    c => c.bunker_id.toUpperCase() === String(entry.bunker_id).toUpperCase()
  );
  if (idx >= 0) {
    CLIENTES_B2B_REGISTRO[idx] = {
      ...CLIENTES_B2B_REGISTRO[idx],
      ...entry,
      email: (entry.email && !entry.email.endsWith('@lamdaclientes.com'))
        ? entry.email
        : (CLIENTES_B2B_REGISTRO[idx].email || entry.email),
      phone: entry.phone || CLIENTES_B2B_REGISTRO[idx].phone || ''
    };
  } else {
    CLIENTES_B2B_REGISTRO.push(entry);
  }
}

/**
 * Sincroniza en caliente los clientes dados de alta recientemente desde Supabase Cloud
 * (filas DIR-CB-XXXX e invitaciones activas en clientes_b2b_invitaciones) para no depender
 * exclusivamente del bundle estático cuando se da de alta un cliente nuevo en Clientes Búnker.
 */
export async function sincronizarDirectorioCloud(supabaseClient, force = false) {
  if (!supabaseClient) return CLIENTES_B2B_REGISTRO;
  if (_cloudDirectoryLoaded && !force) return CLIENTES_B2B_REGISTRO;
  if (_cloudDirectoryPromise && !force) return _cloudDirectoryPromise;

  _cloudDirectoryPromise = (async () => {
    try {
      const { data: rows, error } = await supabaseClient
        .from('clientes_b2b_invitaciones')
        .select('token, cliente_id, razon_social, email_portal, email_portal_nombre, email_portal_cargo, usado, expires_at')
        .or('token.like.DIR-%,usado.eq.false')
        .order('created_at', { ascending: false })
        .limit(300);

      if (!error && Array.isArray(rows)) {
        for (const r of rows) {
          const cid = String(r.cliente_id || '').trim().toUpperCase();
          if (!cid) continue;
          const bunkerNumMatch = cid.match(/(\\d+)/);
          const bunkerNum = bunkerNumMatch ? String(parseInt(bunkerNumMatch[1], 10)) : '';

          let meta = {};
          if (r.email_portal_cargo && String(r.email_portal_cargo).trim().startsWith('{')) {
            try {
              meta = JSON.parse(r.email_portal_cargo);
            } catch (e) {}
          }

          const legacyId = meta.legacy_id ? String(meta.legacy_id).trim() : null;
          const legacyNum = meta.legacy_num
            ? String(meta.legacy_num).trim()
            : (legacyId && /^\\d+$/.test(legacyId) ? String(parseInt(legacyId, 10)) : null);

          mergeClienteEnMemoria({
            bunker_id: cid,
            legacy_id: legacyId,
            legacy_num: legacyNum,
            bunker_num: meta.bunker_num || bunkerNum,
            cuit: meta.cuit || null,
            nombre: meta.nombre || r.email_portal_nombre || r.razon_social || cid,
            razon_social: r.razon_social || meta.nombre || cid,
            contact_name: meta.contact_name || r.email_portal_nombre || '',
            email: (r.email_portal && String(r.email_portal).trim())
              ? String(r.email_portal).trim().toLowerCase()
              : \`\${cid.toLowerCase()}@lamdaclientes.com\`,
            phone: meta.phone || '',
            phone_masked: meta.phone_masked || ''
          });
        }
        _cloudDirectoryLoaded = true;
      }
    } catch (e) {
      console.warn('⚠️ [B2B-DIRECTORY] Advertencia sincronizando directorio cloud:', e?.message);
    } finally {
      _cloudDirectoryPromise = null;
    }
    return CLIENTES_B2B_REGISTRO;
  })();

  return _cloudDirectoryPromise;
}

/**
 * Búsqueda sincrónica instantánea sobre el catálogo en memoria
 */
export function encontrarClienteB2B(identifier) {
  if (!identifier) return null;
  const clean = String(identifier).trim().toLowerCase();
  if (!clean) return null;
  const cleanNum = clean.replace(/\\D/g, '');
  const cleanNoLeading = cleanNum ? String(parseInt(cleanNum, 10)) : '';

  // 1. Coincidencia exacta por Email
  if (clean.includes('@')) {
    return CLIENTES_B2B_REGISTRO.find(c => c.email && c.email.toLowerCase() === clean) || null;
  }

  // 2. Coincidencia por Código Búnker explícito (ej: "CB-0059", "cb0059", "cb-59", "cb59")
  if (clean.startsWith('cb')) {
    const targetBunkerNum = cleanNoLeading;
    const matchBunkerExplicit = CLIENTES_B2B_REGISTRO.find(c => {
      if (c.bunker_id.toLowerCase() === clean) return true;
      if (c.bunker_id.toLowerCase().replace(/[^a-z0-9]/g, '') === clean.replace(/[^a-z0-9]/g, '')) return true;
      if (targetBunkerNum && c.bunker_num === targetBunkerNum) return true;
      return false;
    });
    if (matchBunkerExplicit) return matchBunkerExplicit;
  }

  // 3. Coincidencia por CUIT/CUIL (11 dígitos)
  if (cleanNum.length === 11) {
    const matchCuit = CLIENTES_B2B_REGISTRO.find(
      c => c.cuit && String(c.cuit).replace(/\\D/g, '') === cleanNum
    );
    if (matchCuit) return matchCuit;
  }

  // 4. Coincidencia por Código Legacy (ej: "0010", "010", "10", "0196", "196")
  const matchLegacy = CLIENTES_B2B_REGISTRO.find(c => {
    if (!c.legacy_id && !c.legacy_num) return false;
    if (c.legacy_id && c.legacy_id.toLowerCase() === clean) return true;
    if (c.legacy_id && c.legacy_id.toLowerCase().replace(/^0+/, '') === clean.replace(/^0+/, '')) return true;
    if (cleanNoLeading && c.legacy_num === cleanNoLeading) return true;
    return false;
  });
  if (matchLegacy) return matchLegacy;

  // 5. Coincidencia por número directo contra bunker_num (solo si ningún Legacy ID usó ese número)
  if (cleanNoLeading) {
    const matchBunkerNum = CLIENTES_B2B_REGISTRO.find(c => c.bunker_num === cleanNoLeading);
    if (matchBunkerNum) return matchBunkerNum;
  }

  // 6. Coincidencia por Nombre o Razón Social
  if (clean.length >= 3) {
    const matchNombre = CLIENTES_B2B_REGISTRO.find(c =>
      (c.nombre && c.nombre.toLowerCase().includes(clean)) ||
      (c.razon_social && c.razon_social.toLowerCase().includes(clean))
    );
    if (matchNombre) return matchNombre;
  }

  return null;
}

/**
 * Búsqueda asincrónica que consulta primero en memoria y, si no encuentra o se solicita,
 * refresca desde Supabase Cloud (clientes_b2b_invitaciones DIR-% + invitaciones activas).
 */
export async function encontrarClienteB2BAsync(identifier, supabaseClient) {
  if (!identifier) return null;
  let found = encontrarClienteB2B(identifier);
  if (found) return found;

  if (supabaseClient) {
    await sincronizarDirectorioCloud(supabaseClient, true);
    found = encontrarClienteB2B(identifier);
    if (found) return found;
  }
  return null;
}

/**
 * Busca si un identificador (código corto de 6 caracteres, token de 64 caracteres,
 * código de cliente Legacy/Búnker o CUIT) tiene una invitación pendiente activa en Supabase Cloud.
 */
export async function buscarInvitacionActivaCloud(identifier, supabaseClient) {
  if (!identifier || !supabaseClient) return null;
  const clean = String(identifier).trim();
  if (!clean) return null;

  try {
    // 1. Si parece un código de activación de 6 caracteres hexadecimales o token de 64 caracteres
    if (/^[a-f0-9]{6}$/i.test(clean) || /^[a-f0-9]{32,64}$/i.test(clean)) {
      let q = supabaseClient
        .from('clientes_b2b_invitaciones')
        .select('*')
        .eq('usado', false);

      if (clean.length === 6) {
        q = q.ilike('token', \`\${clean}%\`);
      } else {
        q = q.eq('token', clean.toLowerCase());
      }

      const { data: invByToken } = await q
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (invByToken && new Date(invByToken.expires_at) > new Date()) {
        return invByToken;
      }
    }

    // 2. Resolver cliente por Código Legacy / Búnker / CUIT / Email y buscar su invitación activa
    const cliente = await encontrarClienteB2BAsync(clean, supabaseClient);
    const targetCid = cliente?.bunker_id || (/^cb-\\d+$/i.test(clean) ? clean.toUpperCase() : null);

    if (targetCid) {
      const { data: invByCid } = await supabaseClient
        .from('clientes_b2b_invitaciones')
        .select('*')
        .eq('cliente_id', targetCid)
        .eq('usado', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (invByCid && new Date(invByCid.expires_at) > new Date()) {
        return invByCid;
      }
    }
  } catch (e) {
    console.warn('⚠️ [B2B-INVITE-LOOKUP] Error consultando invitación activa:', e?.message);
  }
  return null;
}
`;
}

/**
 * Sincroniza el directorio completo de clientes Búnker tanto en el archivo local
 * b2b-portal/src/utils/clientesB2B.js como en Supabase Cloud (filas DIR-CB-XXXX).
 */
async function sincronizarTodoElDirectorioB2B(customDbPool = null) {
    const db = customDbPool || pool;
    try {
        // 1. Obtener emails reales ya registrados en clientes_b2b_perfiles en Supabase
        const cloudEmailMap = new Map();
        if (SUPABASE_URL && SUPABASE_KEY) {
            try {
                const resProfs = await fetch(`${SUPABASE_URL}/rest/v1/clientes_b2b_perfiles?select=cliente_id,email`, {
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`
                    }
                });
                if (resProfs.ok) {
                    const profs = await resProfs.json();
                    for (const p of profs || []) {
                        if (p.cliente_id && p.email) {
                            cloudEmailMap.set(String(p.cliente_id).trim(), String(p.email).trim().toLowerCase());
                        }
                    }
                }
            } catch (e) {}
        }

        // 2. Consultar todos los clientes en public.bunker_clientes
        const resClientes = await db.query(`
            SELECT 
                id,
                codigo_bunker_cliente,
                lomas_soft_id,
                cuit_cuil,
                cliente_nombre,
                razon_social,
                email_portal,
                email_portal_nombre,
                whatsapp_facturas,
                email_facturas
            FROM public.bunker_clientes
            WHERE codigo_bunker_cliente IS NOT NULL
              AND UPPER(codigo_bunker_cliente) NOT LIKE 'CB-NODO-%'
            ORDER BY codigo_bunker_cliente ASC
        `);

        const registros = [];
        const cloudDirPayloads = [];

        for (const row of resClientes.rows) {
            const cid = String(row.codigo_bunker_cliente).trim().toUpperCase();
            const bunkerNumMatch = cid.match(/(\d+)/);
            const bunkerNum = bunkerNumMatch ? String(parseInt(bunkerNumMatch[1], 10)) : '';

            const legacyId = row.lomas_soft_id ? String(row.lomas_soft_id).trim() : null;
            const legacyNum = (legacyId && /^\d+$/.test(legacyId))
                ? String(parseInt(legacyId, 10))
                : legacyId;

            const cuit = row.cuit_cuil ? String(row.cuit_cuil).replace(/\D/g, '') : null;
            const { contactName, phoneMasked, rawPhone } = parsearContactoWhatsapp(row.whatsapp_facturas);
            const email = resolverEmailCliente(row, cloudEmailMap);
            const nombre = String(row.cliente_nombre || row.razon_social || cid).trim();
            const razonSocial = String(row.razon_social || row.cliente_nombre || cid).trim();

            registros.push({
                bunker_id: cid,
                legacy_id: legacyId,
                legacy_num: legacyNum,
                bunker_num: bunkerNum,
                cuit: cuit,
                nombre: nombre,
                razon_social: razonSocial,
                email: email,
                phone: rawPhone
            });

            cloudDirPayloads.push({
                token: `DIR-${cid}`,
                cliente_id: cid,
                expires_at: '2099-12-31T23:59:59.000Z',
                usado: true,
                razon_social: razonSocial,
                email_portal: email,
                email_portal_nombre: contactName || row.email_portal_nombre || nombre,
                email_portal_cargo: JSON.stringify({
                    legacy_id: legacyId,
                    legacy_num: legacyNum,
                    bunker_num: bunkerNum,
                    cuit: cuit,
                    nombre: nombre,
                    contact_name: contactName || row.email_portal_nombre || '',
                    phone_masked: phoneMasked
                })
            });
        }

        // 3. Actualizar b2b-portal/src/utils/clientesB2B.js en disco si existe la carpeta
        try {
            const dirPath = path.dirname(CLIENTES_B2B_JS_PATH);
            if (fs.existsSync(dirPath)) {
                const fileContent = generarCodigoClientesB2BJs(registros);
                fs.writeFileSync(CLIENTES_B2B_JS_PATH, fileContent, 'utf8');
            }
        } catch (fsErr) {
            console.warn('⚠️ [B2B-DIRECTORY] No se pudo escribir clientesB2B.js en disco:', fsErr.message);
        }

        // 4. Hacer Upsert de las entradas DIR-CB-XXXX en Supabase Cloud (clientes_b2b_invitaciones)
        if (SUPABASE_URL && SUPABASE_KEY && cloudDirPayloads.length > 0) {
            const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_invitaciones?on_conflict=token`;
            const resUpsert = await fetch(url, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates,return=minimal'
                },
                body: JSON.stringify(cloudDirPayloads)
            });
            if (!resUpsert.ok) {
                const txt = await resUpsert.text();
                console.warn('⚠️ [B2B-DIRECTORY] Advertencia al subir directorio cloud:', txt);
            } else {
                console.log(`✅ [B2B-DIRECTORY] ${cloudDirPayloads.length} clientes sincronizados en el Directorio Cloud y clientesB2B.js.`);
            }
        }

        return registros;
    } catch (err) {
        console.error('❌ [B2B-DIRECTORY] Error sincronizando directorio de clientes B2B:', err.message);
        return [];
    }
}

/**
 * Sincroniza de forma inmediata las listas de precios asignadas a un cliente en Supabase Cloud
 * (clientes_b2b_perfiles_listas) para que estén listas antes de que el cliente active su cuenta.
 */
async function sincronizarListasClienteEnNube(clienteIdentifier, customDbPool = null) {
    if (!SUPABASE_URL || !SUPABASE_KEY || !clienteIdentifier) return [];
    const db = customDbPool || pool;

    try {
        const cleanId = String(clienteIdentifier).trim();
        const resCli = await db.query(`
            SELECT bc.id, bc.codigo_bunker_cliente, bc.lomas_soft_id
            FROM public.bunker_clientes bc
            WHERE bc.codigo_bunker_cliente = $1
               OR bc.id::text = $1
               OR bc.lomas_soft_id = $1
            LIMIT 1
        `, [cleanId]);

        if (resCli.rows.length === 0) return [];
        const cli = resCli.rows[0];
        const targetCid = cli.codigo_bunker_cliente;

        const resListas = await db.query(`
            SELECT 
                clp.bunker_lista_precio_id AS lista_id,
                COALESCE(cfg.permitir_toggle_iva, false) AS permitir_toggle_iva
            FROM public.bunker_cliente_listas_precios clp
            LEFT JOIN public.bunker_portal_b2b_listas_config cfg ON cfg.lista_id = clp.bunker_lista_precio_id
            WHERE clp.bunker_cliente_id = $1
            ORDER BY clp.id ASC
        `, [cli.id]);

        const listRows = resListas.rows;
        const listIds = listRows.map(r => parseInt(r.lista_id, 10)).filter(n => !isNaN(n));

        // Limpiar listas previas de este cliente en Supabase (incluyendo cualquier lista_id=1 residual del trigger)
        await fetch(`${SUPABASE_URL}/rest/v1/clientes_b2b_perfiles_listas?cliente_id=eq.${encodeURIComponent(targetCid)}`, {
            method: 'DELETE',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });

        if (listRows.length > 0) {
            const payloads = listRows.map((r, idx) => ({
                cliente_id: targetCid,
                lista_id: parseInt(r.lista_id, 10),
                es_principal: idx === 0,
                permitir_toggle_iva: Boolean(r.permitir_toggle_iva),
                fecha_inicio: null,
                created_at: new Date().toISOString()
            }));

            await fetch(`${SUPABASE_URL}/rest/v1/clientes_b2b_perfiles_listas?on_conflict=cliente_id,lista_id`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates,return=minimal'
                },
                body: JSON.stringify(payloads)
            });
        }

        return listIds;
    } catch (err) {
        console.warn(`⚠️ [B2B-DIRECTORY] Error sincronizando listas en nube para ${clienteIdentifier}:`, err.message);
        return [];
    }
}

module.exports = {
    parsearContactoWhatsapp,
    sincronizarTodoElDirectorioB2B,
    sincronizarListasClienteEnNube
};
