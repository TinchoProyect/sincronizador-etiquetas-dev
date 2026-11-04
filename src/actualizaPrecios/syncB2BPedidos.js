// filepath: src/actualizaPrecios/syncB2BPedidos.js
'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const PoliticasDescuentoService = require('../presupuestos/services/politicasDescuentoService');
const OfertasDinamicasService = require('../presupuestos/services/ofertasDinamicasService');

// ===== 1) Conexión a la Base de Datos Local =====
const localPool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

console.log('═══════════════════════════════════════════════════════');
console.log('📡 [RECV-B2B-PEDIDOS] RECEPTOR DE PEDIDOS PORTAL B2B');
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
      console.warn(`⚠️ [Supabase REST] Intento ${attempt}/${retries} falló: HTTP ${response.status} - ${errorText}`);
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

async function lookupLocalIva(db, articleCode) {
  try {
    const cleanCode = (articleCode || '').toString().trim();
    
    // A. Intentar traducir el código de barras al número corto de artículo
    const resTranslation = await db.query(
      `SELECT numero FROM public.articulos WHERE TRIM(codigo_barras) = $1 OR TRIM(numero) = $1 LIMIT 1`,
      [cleanCode]
    );
    let mappedCode = cleanCode;
    if (resTranslation.rows.length > 0 && resTranslation.rows[0].numero) {
      mappedCode = resTranslation.rows[0].numero.toString().trim();
    }
    
    // 1. Intentar buscar en la tabla maestra bunker_articulos (sanitizando espacios)
    const resBunker = await db.query(
      `SELECT porcentaje_iva FROM public.bunker_articulos WHERE TRIM(articulo_id) = $1 LIMIT 1`,
      [mappedCode]
    );
    if (resBunker.rows.length > 0 && resBunker.rows[0].porcentaje_iva !== null) {
      return parseFloat(resBunker.rows[0].porcentaje_iva);
    }
    
    // 2. Fallback a la lista de artículos (sanitizando espacios)
    const resLista = await db.query(
      `SELECT iva FROM public.bunker_lista_articulos WHERE TRIM(articulo_numero) = $1 LIMIT 1`,
      [mappedCode]
    );
    if (resLista.rows.length > 0 && resLista.rows[0].iva !== null) {
      return parseFloat(resLista.rows[0].iva);
    }
  } catch (err) {
    console.warn(`⚠️ Advertencia al buscar IVA local para artículo ${articleCode}:`, err.message);
  }
  return 21.0; // default alícuota
}

async function procesarPedidosB2B() {
  let localClient;
  
  try {
    // 1. Descargar pedidos pendientes junto con sus ítems (PostgREST Join)
    console.log('🔍 Consultando pedidos pendientes en Supabase...');
    const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_cabecera?sync_estado=eq.Pendiente&select=*,clientes_b2b_pedidos_items(*)`;
    const options = {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    };
    
    const response = await fetchWithRetry(url, options);
    const pedidos = await response.json();
    console.log(`📊 Pedidos pendientes encontrados: ${pedidos.length}`);

    if (pedidos.length === 0) {
      console.log('✅ No hay pedidos pendientes de sincronización.');
      return;
    }

    localClient = await localPool.connect();

    for (const pedido of pedidos) {
      console.log(`\n📦 Procesando Pedido B2B (ID: ${pedido.id.slice(0, 8)}) para Cliente: ${pedido.cliente_id}`);
      
      // A) Validar idempotencia local
      const checkDup = await localClient.query(
        `SELECT id FROM public.presupuestos WHERE id_presupuesto_ext = $1`,
        [pedido.id]
      );
      
      if (checkDup.rows.length > 0) {
        console.log(`⚠️ El pedido ya existe localmente (ID local: ${checkDup.rows[0].id}). Marcando como sincronizado.`);
        await actualizarEstadoSupabase(pedido.id, 'Sincronizado', 'Pedido duplicado omitido con éxito.', 'En Preparacion');
        continue;
      }

      // B) Iniciar transacción transaccional
      try {
        await localClient.query('BEGIN');

        // Buscar el lomas_soft_id (ID de cliente legacy) correspondiente al codigo_bunker_cliente
        console.log(`🔍 Mapeando cliente B2B ${pedido.cliente_id} a ID legacy (Lomasoft)...`);
        const clientMappingRes = await localClient.query(
          `SELECT lomas_soft_id FROM public.bunker_clientes WHERE codigo_bunker_cliente = $1 LIMIT 1`,
          [pedido.cliente_id]
        );

        if (clientMappingRes.rows.length === 0 || !clientMappingRes.rows[0].lomas_soft_id) {
          throw new Error(`No se encontró el código de cliente legacy (lomas_soft_id) para el cliente B2B ${pedido.cliente_id}`);
        }

        const legacyClientId = clientMappingRes.rows[0].lomas_soft_id.trim();
        console.log(`✅ Cliente mapeado: ${pedido.cliente_id} ➔ Legacy ID: ${legacyClientId}`);

        // 1. Obtener la lista de precios asignada al cliente legacy
        console.log(`🔍 Consultando lista de precios legacy para cliente ${legacyClientId}...`);
        const clientListRes = await localClient.query(
          `SELECT lista_precios FROM public.clientes WHERE cliente_id = (CASE WHEN $1 ~ '^[0-9]+$' THEN $1::integer ELSE NULL END) LIMIT 1`,
          [legacyClientId]
        );
        const legacyList = clientListRes.rows.length > 0 ? parseInt(clientListRes.rows[0].lista_precios, 10) : 1;
        console.log(`📋 Lista de precios legacy asignada al cliente: ${legacyList}`);

        // 2. Pre-procesar ítems y calcular subtotales netos y brutos del pedido
        let mapaOfertas = {};
        try {
          mapaOfertas = await OfertasDinamicasService.obtenerOfertasActivasParaContexto({
            clienteId: legacyClientId,
            listaPrecioId: legacyList
          }, localClient);
        } catch (eOf) {
          console.warn('⚠️ [SYNC-B2B] Error consultando ofertas activas:', eOf.message);
        }

        let totalNetoAcumulado = 0;
        let totalBrutoAcumulado = 0;
        let totalNetoOfertas = 0;
        let totalBrutoOfertas = 0;
        const itemsProcesados = [];

        for (const item of pedido.clientes_b2b_pedidos_items || []) {
          const trimmedCode = (item.producto_codigo || '').toString().trim();
          
          // Traducir código de barras al número corto de artículo si es necesario
          let mappedCode = trimmedCode;
          const resTranslation = await localClient.query(
            `SELECT numero FROM public.articulos WHERE TRIM(codigo_barras) = $1 OR TRIM(numero) = $1 LIMIT 1`,
            [trimmedCode]
          );
          if (resTranslation.rows.length > 0 && resTranslation.rows[0].numero) {
            mappedCode = resTranslation.rows[0].numero.toString().trim();
          }

          console.log(`🔍 Buscando artículo legacy para ${mappedCode} (código original: ${trimmedCode})...`);
          const artPriceRes = await localClient.query(
            `SELECT precio_neg, mayorista, especial_brus, consumidor_final, lista_5, iva, costo FROM public.precios_articulos WHERE articulo = $1 LIMIT 1`,
            [mappedCode]
          );

          let ivaRate = await lookupLocalIva(localClient, trimmedCode);
          let precioUnitarioConIva = parseFloat(item.precio_unitario || 0);
          let costoUnitario = 0;

          if (artPriceRes.rows.length > 0) {
            const row = artPriceRes.rows[0];
            costoUnitario = parseFloat(row.costo || 0);

            // Mapear al precio de la lista correspondiente
            let precioLista = 0;
            if (legacyList === 1) precioLista = parseFloat(row.precio_neg);
            else if (legacyList === 2) precioLista = parseFloat(row.mayorista);
            else if (legacyList === 3) precioLista = parseFloat(row.especial_brus);
            else if (legacyList === 4) precioLista = parseFloat(row.consumidor_final);
            else if (legacyList === 5) precioLista = parseFloat(row.lista_5);
            else precioLista = parseFloat(row.precio_neg);

            const usarBunker = true;
            if (!usarBunker && precioLista > 0) {
              precioUnitarioConIva = precioLista;
              console.log(`   ➔ Encontrado en lista legacy (${legacyList}): ${precioUnitarioConIva}`);
            } else {
              console.log(`   ➔ Manteniendo precio de origen portal B2B: ${precioUnitarioConIva}`);
            }
          } else {
            console.log(`   ➔ No encontrado en precios_articulos. Usando precio portal: ${precioUnitarioConIva} e IVA heredado: ${ivaRate}`);
          }

          const round2 = (num) => Math.round(num * 100) / 100;
          const alicDec = ivaRate / 100;
          const precio1 = round2(precioUnitarioConIva); // Bruto unitario (con IVA)
          const valor1 = round2(precio1 / (1 + alicDec)); // Neto unitario (sin IVA)
          const iva1 = round2(precio1 - valor1); // IVA unitario
          const cantidad = parseFloat(item.cantidad || 0);

          const netoTotal = round2(valor1 * cantidad);
          const brutoTotal = round2(precio1 * cantidad);
          const ivaTotal = round2(iva1 * cantidad);
          const diferencia = round2(precio1 - costoUnitario);

          totalNetoAcumulado += netoTotal;
          totalBrutoAcumulado += brutoTotal;

          const ofertaMatch = mapaOfertas[trimmedCode] || null;
          if (item.es_oferta || ofertaMatch) {
            totalNetoOfertas += netoTotal;
            totalBrutoOfertas += brutoTotal;
            console.log(`🏷️ [SYNC-B2B] Artículo ${trimmedCode} reconocido en OFERTA DINÁMICA.`);
          }

          itemsProcesados.push({
            trimmedCode,
            cantidad,
            valor1,
            precio1,
            iva1,
            diferencia,
            alicDec,
            netoTotal,
            brutoTotal,
            ivaTotal,
            ofertaInfo: ofertaMatch
          });
        }

        // 3. Evaluar Política Comercial Automática con Blindaje 300k
        let descuentoFinal = 0;
        let notaPolitica = '';

        try {
          const evalPol = await PoliticasDescuentoService.evaluarDescuento({
            clienteId: legacyClientId,
            listaPrecioId: legacyList,
            subtotalNeto: totalNetoAcumulado,
            subtotalBruto: totalBrutoAcumulado,
            subtotalOfertasNeto: totalNetoOfertas,
            subtotalOfertasBruto: totalBrutoOfertas
          }, localClient);

          if (evalPol && (evalPol.aplica || evalPol.aplica_politica) && evalPol.descuento_porcentaje > 0) {
            descuentoFinal = evalPol.descuento_porcentaje;
            notaPolitica = ` (Bonif. Comercial: ${descuentoFinal}% por volumen)`;
            console.log(`🎉 [SYNC-B2B] Bonificación automática del ${descuentoFinal}% aplicada para cliente ${legacyClientId} (${evalPol.tramo_aplicado?.etiqueta || evalPol.tramo_actual?.etiqueta || 'Escala'})`);
          } else if (parseFloat(pedido.descuento || 0) > 0) {
            // Si el portal envió un descuento explícito
            const rawDesc = parseFloat(pedido.descuento);
            if (rawDesc <= 100) {
              descuentoFinal = rawDesc;
            } else if (totalBrutoAcumulado > 0) {
              descuentoFinal = Math.round((rawDesc / totalBrutoAcumulado) * 10000) / 100;
            }
          }
        } catch (errEval) {
          console.warn('⚠️ [SYNC-B2B] Error al evaluar política comercial:', errEval.message);
        }

        // 4. Insertar encabezado del pedido
        const fechaPedido = new Date(pedido.fecha_pedido);
        const fechaEntrega = new Date(fechaPedido);
        fechaEntrega.setDate(fechaEntrega.getDate() + 1);
        const obsBase = (pedido.observaciones || 'Pedido ingresado desde el portal B2B').trim();
        const notaFinal = (notaPolitica && !obsBase.toLowerCase().includes('bonif. comercial'))
          ? `${obsBase}${notaPolitica}`
          : obsBase;

        // Normalizar descuento a fracción decimal (ej: 5% -> 0.05) según convención de public.presupuestos
        const descuentoDecimal = descuentoFinal > 1
          ? Math.round((descuentoFinal / 100) * 10000) / 10000
          : Math.round((descuentoFinal || 0) * 10000) / 10000;

        const insertHeaderQuery = `
          INSERT INTO public.presupuestos 
          (id_presupuesto_ext, id_cliente, fecha, fecha_entrega, agente, tipo_comprobante, 
          nota, estado, informe_generado, descuento, activo, usar_precios_bunker, estado_logistico, modificado_portal)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, true, $11, $12)
          RETURNING id;
        `;
        
        const headerRes = await localClient.query(insertHeaderQuery, [
          pedido.id,
          legacyClientId,
          fechaPedido.toISOString().split('T')[0],
          fechaEntrega.toISOString().split('T')[0],
          'Portal B2B',
          'Factura',
          notaFinal,
          'Presupuesto/Orden',
          'Pendiente',
          descuentoDecimal,
          'PENDIENTE',
          !!pedido.es_edicion
        ]);

        const localPresupuestoId = headerRes.rows[0].id;
        console.log(`✅ Encabezado creado en BD local. ID asignado: ${localPresupuestoId} (Descuento final: ${descuentoFinal}% -> decimal: ${descuentoDecimal})`);

        // 5. Insertar ítems del pedido
        const insertItemQuery = `
          INSERT INTO public.presupuestos_detalles 
          (id_presupuesto, id_presupuesto_ext, articulo, cantidad, valor1, precio1, iva1,
           diferencia, camp1, camp2, camp3, camp4, camp5, camp6, fecha_actualizacion)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW());
        `;

        for (const item of itemsProcesados) {
          await localClient.query(insertItemQuery, [
            localPresupuestoId,
            pedido.id,
            item.trimmedCode,
            item.cantidad,
            item.valor1,
            item.precio1,
            item.iva1,
            item.diferencia,
            item.valor1,
            item.alicDec,
            item.netoTotal,
            item.brutoTotal,
            item.ivaTotal,
            null
          ]);
        }
        
        console.log(`✅ Insertados ${itemsProcesados.length} ítems en detalle local.`);

        // 6. Registrar consumo de cuotas de ofertas dinámicas
        for (const it of itemsProcesados) {
          if (it.ofertaInfo) {
            try {
              await OfertasDinamicasService.registrarConsumo({
                ofertaId: it.ofertaInfo.oferta_id,
                articuloNumero: it.trimmedCode,
                cantidadUnidades: it.cantidad,
                pedidoId: pedido.id,
                presupuestoId: localPresupuestoId,
                clienteId: legacyClientId,
                origen: 'PORTAL_B2B'
              }, localClient);
              console.log(`📉 [OFERTAS-B2B] Consumo de cuota registrado para ${it.trimmedCode}: ${it.cantidad} u.`);
            } catch (eCons) {
              console.warn(`⚠️ [OFERTAS-B2B] Error registrando consumo de cuota para ${it.trimmedCode}:`, eCons.message);
            }
          }
        }

        // 7. Confirmar la transacción
        await localClient.query('COMMIT');
        console.log('💾 Transacción confirmada en BD local.');

        // 4. Actualizar estado en Supabase
        await actualizarEstadoSupabase(
          pedido.id, 
          'Sincronizado', 
          `Pedido ingresado con éxito. ID Local: ${localPresupuestoId}`,
          'En Preparacion'
        );

      } catch (err) {
        // En caso de fallo, hacer ROLLBACK
        await localClient.query('ROLLBACK');
        console.error(`❌ Error transaccional local para pedido ${pedido.id.slice(0, 8)}:`, err.message);
        
        // Reportar el fallo en Supabase
        await actualizarEstadoSupabase(
          pedido.id,
          'Error',
          `Fallo en ingesta local: ${err.message}`,
          'Borrador'
        );
      }
    }

  } catch (error) {
    console.error('❌ Error general durante la ingesta de pedidos:', error.message);
    process.exitCode = 1;
  } finally {
    if (localClient) {
      localClient.release();
    }
  }
}

async function actualizarEstadoSupabase(id, syncEstado, syncMensaje, estado) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.${id}`;
    const options = {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sync_estado: syncEstado,
        sync_mensaje: syncMensaje,
        estado: estado,
        updated_at: new Date().toISOString()
      })
    };
    
    await fetchWithRetry(url, options);
    console.log(`☁️  Estado en Supabase actualizado a: [${syncEstado}] - ${syncMensaje}`);
  } catch (err) {
    console.error(`❌ Error al actualizar estado del pedido ${id.slice(0, 8)} en Supabase:`, err.message);
  }
}

async function auditarAutoCuracionOnboardingB2B() {
  try {
    const {
      parsearContactoWhatsapp,
      sincronizarTodoElDirectorioB2B,
      sincronizarListasClienteEnNube
    } = require('../logistica/services/b2bDirectorySyncService');
    const { createClient } = require('@supabase/supabase-js');
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // 1. Si hubo invitaciones o clientes creados/editados en los últimos 30 minutos, blindar sus listas y directorio cloud
    const resRecent = await localPool.query(`
      SELECT DISTINCT bc.codigo_bunker_cliente, bc.email_portal_nombre, bc.whatsapp_facturas, bc.cliente_nombre, bc.razon_social, i.token
      FROM public.bunker_clientes bc
      LEFT JOIN public.portal_invitaciones i ON i.cliente_id = bc.codigo_bunker_cliente AND i.usado = false
      WHERE bc.updated_at > NOW() - INTERVAL '30 minutes'
         OR bc.created_at > NOW() - INTERVAL '30 minutes'
         OR i.created_at > NOW() - INTERVAL '30 minutes'
    `);

    if (resRecent.rows.length > 0) {
      for (const row of resRecent.rows) {
        await sincronizarListasClienteEnNube(row.codigo_bunker_cliente, localPool);
        if (row.token) {
          const wpInfo = parsearContactoWhatsapp(row.whatsapp_facturas);
          const contactName = (row.email_portal_nombre || wpInfo.contactName || '').trim();
          if (contactName) {
            await supabaseAdmin
              .from('clientes_b2b_invitaciones')
              .update({
                email_portal_nombre: contactName,
                razon_social: row.razon_social || row.cliente_nombre || row.codigo_bunker_cliente
              })
              .eq('token', row.token);
          }
        }
      }
      await sincronizarTodoElDirectorioB2B(localPool);
    }

    // 2. Auto-Curación de perfiles recién dados de alta via supabase.auth.signUp
    const { data: recentProfiles } = await supabaseAdmin
      .from('clientes_b2b_perfiles')
      .select('id, cliente_id, email, nombre_completo, nombre_empresa, cuit')
      .order('created_at', { ascending: false })
      .limit(5);

    if (recentProfiles && recentProfiles.length > 0) {
      for (const prof of recentProfiles) {
        if (!prof.id || !prof.cliente_id) continue;
        const { data: authWrap } = await supabaseAdmin.auth.admin.getUserById(prof.id);
        const authUser = authWrap?.user;
        const needsMetaFix = !authUser?.app_metadata?.cliente_id || !Array.isArray(authUser?.app_metadata?.listas_precios);

        const { data: triggerLists } = await supabaseAdmin
          .from('clientes_b2b_perfiles_listas')
          .select('lista_id, fecha_inicio')
          .eq('cliente_id', prof.cliente_id)
          .not('fecha_inicio', 'is', null);

        const hasDummyTriggerList = Array.isArray(triggerLists) && triggerLists.length > 0;

        if (needsMetaFix || hasDummyTriggerList || !prof.cuit) {
          const resCli = await localPool.query(
            `SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social, cuit_cuil, ver_stock, usuario_id, email_portal
             FROM public.bunker_clientes WHERE codigo_bunker_cliente = $1 LIMIT 1`,
            [prof.cliente_id]
          );
          const localRow = resCli.rows[0] || {};
          const listIds = await sincronizarListasClienteEnNube(prof.cliente_id, localPool);
          const permisos = ['compras', 'pagos'];
          if (localRow.ver_stock) permisos.push('ver_stock');
          if (localRow.usuario_id || prof.cliente_id === 'CB-0006') permisos.push('servicios_colaborador');

          const nombreFinal = prof.nombre_completo || localRow.cliente_nombre || localRow.razon_social || prof.cliente_id;
          const empresaFinal = localRow.razon_social || prof.nombre_empresa || localRow.cliente_nombre || prof.cliente_id;
          const emailClean = (prof.email || authUser?.email || localRow.email_portal || '').trim().toLowerCase();

          const appMeta = {
            ...(authUser?.app_metadata || {}),
            cliente_id: prof.cliente_id,
            rol: 'Dueno',
            permisos: permisos,
            listas_precios: listIds.length > 0 ? listIds : [1],
            ver_stock: Boolean(localRow.ver_stock)
          };
          const userMeta = {
            ...(authUser?.user_metadata || {}),
            cliente_id: prof.cliente_id,
            rol: 'Dueno',
            permisos: permisos,
            listas_precios: listIds.length > 0 ? listIds : [1],
            nombre_completo: nombreFinal,
            nombre_empresa: empresaFinal
          };

          if (authUser) {
            await supabaseAdmin.auth.admin.updateUserById(prof.id, {
              email_confirm: true,
              app_metadata: appMeta,
              user_metadata: userMeta
            });
          }

          await supabaseAdmin.from('clientes_b2b_perfiles').upsert({
            id: prof.id,
            cliente_id: prof.cliente_id,
            rol: 'Dueno',
            permisos: permisos,
            nombre_completo: nombreFinal,
            nombre_empresa: empresaFinal,
            cuit: localRow.cuit_cuil || prof.cuit || null,
            email: emailClean,
            ver_stock: Boolean(localRow.ver_stock),
            updated_at: new Date().toISOString()
          });

          if (localRow.id && emailClean) {
            await localPool.query(
              `UPDATE public.bunker_clientes
               SET email_portal = COALESCE(NULLIF(email_portal, ''), $1),
                   email_portal_nombre = COALESCE(NULLIF(email_portal_nombre, ''), $2),
                   updated_at = CURRENT_TIMESTAMP
               WHERE codigo_bunker_cliente = $3`,
              [emailClean, nombreFinal, prof.cliente_id]
            );
            await localPool.query(
              `UPDATE public.portal_invitaciones SET usado = true WHERE cliente_id = $1 AND usado = false`,
              [prof.cliente_id]
            );
          }

          await sincronizarTodoElDirectorioB2B(localPool);
          console.log(`🛡️ [B2B-SELF-HEALING] Cuenta activada y blindada para ${prof.cliente_id} (${emailClean}) con listas [${listIds.join(',')}].`);
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ [B2B-SELF-HEALING] Advertencia en auditoría rápida:', err.message);
  }
}

procesarPedidosB2B()
  .then(() => auditarAutoCuracionOnboardingB2B())
  .catch(error => {
    console.error('💥 Error fatal en ingesta de pedidos B2B:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    localPool.end().catch(() => {});
  });
