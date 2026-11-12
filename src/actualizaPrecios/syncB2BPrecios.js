// filepath: src/actualizaPrecios/syncB2BPrecios.js
'use strict';

if (!globalThis.WebSocket) { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const lockFilePath = path.join(__dirname, 'syncB2BPrecios.lock');


// ===== 1) Conexión a la Base de Datos Local =====
const localPool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

console.log('═══════════════════════════════════════════════════════');
console.log('📡 [SYNC-B2B-PRECIOS] CANAL DE SINCRONIZACIÓN DE CATÁLOGO');
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
      
      lastErrorText = await response.text();
      console.warn(`⚠️ [Supabase POST] Intento ${attempt}/${retries} falló: HTTP ${response.status} - ${lastErrorText}`);
    } catch (err) {
      clearTimeout(timeoutId);
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

async function sincronizarB2BPrecios() {
  if (fs.existsSync(lockFilePath)) {
    const stats = fs.statSync(lockFilePath);
    const mtime = new Date(stats.mtime);
    const now = new Date();
    const diffMinutes = (now - mtime) / (1000 * 60);
    
    if (diffMinutes < 10) {
      console.warn('⚠️ [SYNC-B2B-PRECIOS] Ya hay otra sincronización activa (archivo lock detectado). Saliendo.');
      process.exit(0);
    } else {
      console.warn('⚠️ [SYNC-B2B-PRECIOS] Archivo lock obsoleto detectado (>10 min). Sobreescribiendo.');
    }
  }
  fs.writeFileSync(lockFilePath, new Date().toISOString());

  let localClient;
  const syncStart = new Date().toISOString(); // Timestamp único para esta sesión de sincronización

  try {
    // 1. Obtener datos activos de la base de datos local y configuración de jerarquía
    localClient = await localPool.connect();

    // Cargar configuraciones de jerarquía B2B (Nivel 3, Nivel 4 y Nivel 5)
    const jerarquiaRes = await localClient.query(`
      SELECT familia_id, articulo_principal, eje_nivel_3, reglas_nivel_4, reglas_nivel_5 
      FROM bunker_portal_b2b_jerarquia 
      WHERE eje_nivel_3 IS NOT NULL AND TRIM(eje_nivel_3) != ''
    `);
    const jerarquiaMap = new Map();
    for (const jRow of jerarquiaRes.rows) {
      const famId = jRow.familia_id !== null && jRow.familia_id !== undefined ? jRow.familia_id : 0;
      const artP = String(jRow.articulo_principal || '').trim().toLowerCase();
      const rawEjeN3 = jRow.eje_nivel_3 ? String(jRow.eje_nivel_3).trim().toLowerCase() : '';
      const ejesN3 = rawEjeN3 ? rawEjeN3.split(',').map(s => s.trim()).filter(Boolean) : [];
      jerarquiaMap.set(`${famId}___${artP}`, {
        eje_nivel_3: rawEjeN3,
        ejes_nivel_3: ejesN3,
        reglas_nivel_4: jRow.reglas_nivel_4 && typeof jRow.reglas_nivel_4 === 'object' ? jRow.reglas_nivel_4 : {},
        reglas_nivel_5: jRow.reglas_nivel_5 && typeof jRow.reglas_nivel_5 === 'object' ? jRow.reglas_nivel_5 : {}
      });
    }
    console.log(`🌿 Reglas de Jerarquía B2B cargadas: ${jerarquiaMap.size}`);

    // ===== CÁLCULO DE STOCK COMPUESTO, PACKS (PADRE/HIJO) Y CASCADA DE PRODUCCIÓN (LDN 1 a 6) =====
    console.log('📦 Cargando estructuras de stock, materias primas y cascada determinista de producción...');
    
    // 1. Ingredientes con stock físico y potencial en bultos nutrientes (Query 7 canónica + v_potencial_ingredientes_simples)
    const ingRes = await localClient.query(`
      SELECT 
        i.id,
        i.nombre,
        COALESCE(i.stock_actual, 0) AS stock_fisico,
        COALESCE(v.stock_en_bultos, 0) AS stock_bultos_potencial,
        COALESCE(v.potencial_total, 0) AS potencial_total,
        COALESCE(q7.kg_bultos_deposito, 0) AS kg_bultos_deposito,
        COALESCE(q7.kg_bultos_taller, 0) AS kg_bultos_taller,
        COALESCE(q7.kilos_por_bulto, 1.0) AS kilos_por_bulto,
        q7.articulo_vinculado_numero
      FROM public.ingredientes i
      LEFT JOIN public.v_potencial_ingredientes_simples v ON v.ingrediente_id = i.id
      LEFT JOIN LATERAL (
        SELECT 
          COALESCE(dest.kilos_en_cajas, COALESCE(i.stock_bultos, 0) * COALESCE(ba.kilos_unidad, 1.0)) AS kg_bultos_taller,
          COALESCE(src.stock_consolidado, 0) * COALESCE(ba.kilos_unidad, 1.0) AS kg_bultos_deposito,
          COALESCE(ba.kilos_unidad, 1.0) AS kilos_por_bulto,
          sku_resuelto.sku AS articulo_vinculado_numero
        FROM (
          SELECT COALESCE(
            i.articulo_vinculado_numero,
            (
              SELECT svm.articulo_numero
              FROM public.stock_ventas_movimientos svm
              JOIN public.ingredientes_movimientos im 
                ON substring(svm.observaciones from 'UUID: ([a-f0-9\\-]+)') = substring(im.observaciones from 'UUID: ([a-f0-9\\-]+)')
               AND substring(svm.observaciones from 'UUID: ([a-f0-9\\-]+)') IS NOT NULL
              WHERE im.ingrediente_id = i.id
                AND svm.articulo_numero IS NOT NULL
                AND EXISTS (SELECT 1 FROM public.bunker_articulos ba2 WHERE ba2.articulo_id = svm.articulo_numero)
              ORDER BY svm.fecha DESC
              LIMIT 1
            )
          ) AS sku
        ) sku_resuelto
        LEFT JOIN (
          SELECT d.destino_id, 
                 SUM((d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) * (COALESCE(d.kilos_asignados, 0) / NULLIF(d.cantidad_asignada, 0))) AS kilos_en_cajas
          FROM public.bunker_lotes_destinos d
          WHERE d.tipo_destino = 'INGREDIENTE_PRODUCCION' 
            AND (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0
          GROUP BY d.destino_id
        ) dest ON dest.destino_id = i.id::text
        LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = sku_resuelto.sku
        LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = sku_resuelto.sku
      ) q7 ON TRUE
    `);

    const ingMap = new Map();
    for (const r of ingRes.rows) {
      const kgBultos = parseFloat(r.kg_bultos_deposito || 0) + parseFloat(r.kg_bultos_taller || 0);
      const kgSueltos = parseFloat(r.stock_fisico || 0);
      // Materia prima total disponible para producción:
      const kgDisponibles = Math.max(kgBultos + kgSueltos, parseFloat(r.potencial_total || 0));

      ingMap.set(r.id, {
        id: r.id,
        nombre: r.nombre,
        kg_disponibles: kgDisponibles,
        kg_bultos_cerrados: kgBultos,
        kg_sueltos: kgSueltos,
        articulo_vinculado_numero: r.articulo_vinculado_numero
      });
    }

    // 2. Mixes / Composición de ingredientes (Flujo 3 / Mezclas)
    const mixRes = await localClient.query(`
      SELECT mix_id, ingrediente_id, cantidad
      FROM public.ingrediente_composicion
    `);
    const mixComposicion = new Map();
    for (const r of mixRes.rows) {
      if (!mixComposicion.has(r.mix_id)) mixComposicion.set(r.mix_id, []);
      mixComposicion.get(r.mix_id).push({
        ingrediente_id: r.ingrediente_id,
        cantidad: parseFloat(r.cantidad)
      });
    }

    // 3. Recetas con sus ingredientes (filtrando empaques/bolsas para no bloquear alimentos)
    const recetasRes = await localClient.query(`
      SELECT 
        r.id AS receta_id, 
        r.articulo_numero, 
        ri.ingrediente_id, 
        ri.cantidad,
        ri.unidad_medida,
        COALESCE(i.es_insumo, false) AS es_insumo
      FROM public.recetas r
      JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
      LEFT JOIN public.ingredientes i ON i.id = ri.ingrediente_id
      WHERE ri.ingrediente_id IS NOT NULL
    `);
    const recetasMap = new Map();
    for (const r of recetasRes.rows) {
      const art = r.articulo_numero;
      if (!recetasMap.has(art)) recetasMap.set(art, []);
      const esEmpaque = r.es_insumo === true || r.unidad_medida === 'Unidades';
      if (!esEmpaque) {
        recetasMap.get(art).push({
          ingrediente_id: r.ingrediente_id,
          cantidad: parseFloat(r.cantidad || 1.0)
        });
      }
    }

    // 4. Stock físico disponible directo descontando reservas en pedidos activos (mapeado por articulo_numero y codigo_barras)
    const stockRes = await localClient.query(`
      WITH reservas_crudas AS (
        SELECT
          COALESCE(src_res.articulo_numero, ba_res.articulo_id, pd.articulo) AS articulo_numero,
          SUM(pd.cantidad) AS cantidad_reservada
        FROM public.presupuestos_detalles pd
        JOIN public.presupuestos p ON p.id = pd.id_presupuesto
        LEFT JOIN public.stock_real_consolidado src_res ON (src_res.articulo_numero = pd.articulo OR src_res.codigo_barras = pd.articulo)
        LEFT JOIN public.bunker_articulos ba_res ON (ba_res.articulo_id = pd.articulo)
        WHERE p.activo = true
          AND COALESCE(p.archivado, false) = false
          AND COALESCE(p.tipo_comprobante, '') != 'Orden de Retiro'
          AND COALESCE(p.estado, '') NOT IN ('Anulado', 'Anulado por el Cliente', 'ANULADO', 'Facturado', 'Entregado', 'Conciliado', 'Retirado', 'Recibido', 'Administrativa NC', 'Muestra de Fraccionados', 'Orden de Retiro')
          AND COALESCE(p.secuencia, 'Imprimir') NOT IN ('Entregado', 'Finalizado', 'Cancelado')
          AND COALESCE(p.estado_logistico, '') NOT IN ('ENTREGADO', 'ENTREGADO_DEPOSITO')
          AND p.factura_id IS NULL
          AND p.id_factura_lomasoft IS NULL
          AND (p.comprobante_lomasoft IS NULL OR p.comprobante_lomasoft = '')
        GROUP BY COALESCE(src_res.articulo_numero, ba_res.articulo_id, pd.articulo)
      )
      SELECT 
        src.articulo_numero, 
        src.codigo_barras, 
        GREATEST(0, COALESCE(src.stock_consolidado, 0) - COALESCE(res.cantidad_reservada, 0)) as stock
      FROM public.stock_real_consolidado src
      LEFT JOIN reservas_crudas res ON (res.articulo_numero = src.articulo_numero OR res.articulo_numero = src.codigo_barras)
    `);
    const stockMap = new Map();
    for (const r of stockRes.rows) {
      const val = parseFloat(r.stock);
      if (r.articulo_numero) stockMap.set(String(r.articulo_numero).trim(), val);
      if (r.codigo_barras) stockMap.set(String(r.codigo_barras).trim(), val);
    }

    // 5. Packs / Padre-Hijo (Exclusivamente de stock_real_consolidado donde es_pack es TRUE y pack_unidades > 1)
    const packsRes = await localClient.query(`
      SELECT articulo_numero as articulo_id, pack_hijo_codigo, pack_unidades
      FROM public.stock_real_consolidado
      WHERE es_pack = true AND pack_hijo_codigo IS NOT NULL AND pack_unidades > 1
    `);
    const packsMap = new Map();
    for (const r of packsRes.rows) {
      packsMap.set(String(r.articulo_id).trim(), {
        hijo: String(r.pack_hijo_codigo).trim(),
        unidades: parseInt(r.pack_unidades, 10)
      });
    }

    // 6. Evaluador Determinista del Semáforo de Stock LAMDA (Modelo Sellado Flujos 1 a 6)
    // - Flujo 1 (Bulto Cerrado Directo / Sin Receta): Disponibilidad estrictamente física (stock > 0). Si es 0 -> 'sin_stock'.
    // - Flujos 2 a 6 (Fraccionados, Mixes, UPs, Granola): Requiere producción calculada determinísticamente según su Receta Formal.
    // - Packs Comerciales: Recursión sobre artículo hijo (Físico o Receta).
    function evaluarStockArticulo(artCod, visitados = new Set()) {
      if (visitados.has(artCod)) return { stock_disponible: 0, stock_potencial: 0, stock_estado: 'sin_stock' };
      visitados.add(artCod);

      const stockDirecto = Math.max(0, stockMap.get(artCod) || 0);

      // CASO A: Es un Pack Comercial (Padre/Hijo)
      if (packsMap.has(artCod)) {
        const pack = packsMap.get(artCod);
        const evalHijo = evaluarStockArticulo(pack.hijo, visitados);
        const stockHijo = Math.max(0, evalHijo.stock_disponible || 0);
        
        const packsCalculados = Math.floor(stockHijo / pack.unidades);
        const stockTotalPack = stockDirecto + packsCalculados;

        if (stockTotalPack > 0) {
          return { stock_disponible: stockTotalPack, stock_potencial: 0, stock_estado: 'disponible' };
        }
        if (evalHijo.stock_estado === 'requiere_produccion' && evalHijo.stock_potencial > 0) {
          const packsPotenciales = Math.floor(evalHijo.stock_potencial / pack.unidades);
          if (packsPotenciales > 0) {
            return { stock_disponible: 0, stock_potencial: packsPotenciales, stock_estado: 'requiere_produccion' };
          }
        }
        return { stock_disponible: 0, stock_potencial: 0, stock_estado: 'sin_stock' };
      }

      // CASO B: Artículo Normal / Fracción
      // B.1 Stock físico terminado inmediato en estantería (Verde)
      if (stockDirecto > 0) {
        return { stock_disponible: stockDirecto, stock_potencial: 0, stock_estado: 'disponible' };
      }

      // B.2 Tiene Receta Formal con Ingredientes alimenticios (Azul con potencial)
      // Aplica a Flujo 2 (Fraccionados), Flujo 3 (Mixes) y Flujos 4-6 (UPs / Producciones)
      if (recetasMap.has(artCod) && recetasMap.get(artCod).length > 0) {
        const ings = recetasMap.get(artCod);
        let maxUnidadesProducibles = Infinity;

        for (const ri of ings) {
          const ingData = ingMap.get(ri.ingrediente_id);
          if (!ingData || ingData.kg_disponibles <= 0) {
            maxUnidadesProducibles = 0;
            break;
          }
          const cantReq = ri.cantidad > 0 ? ri.cantidad : 1.0;
          const posibles = Math.floor(ingData.kg_disponibles / cantReq);
          if (posibles < maxUnidadesProducibles) {
            maxUnidadesProducibles = posibles;
          }
        }

        if (maxUnidadesProducibles > 0 && maxUnidadesProducibles !== Infinity) {
          return { stock_disponible: 0, stock_potencial: maxUnidadesProducibles, stock_estado: 'requiere_produccion' };
        }
      }

      // B.3 Sin Stock (Flujo 1 bulto cerrado sin existencia física, o artículos con insumos insuficientes)
      return { stock_disponible: 0, stock_potencial: 0, stock_estado: 'sin_stock' };
    }

    console.log('🔍 Consultando catálogo activo en base de datos local...');
    
    const localQuery = `
      SELECT 
          la.lista_id,
          la.articulo_numero as producto_codigo,
          COALESCE(ba.descripcion_generada, ba.descripcion, sc.descripcion, la.articulo_numero) as producto_descripcion,
          la.precio_final,
          la.iva as lista_iva_porcentaje,
          ba.porcentaje_iva as real_iva_porcentaje,
          COALESCE(sc.stock_consolidado, 0) as stock_disponible,
          COALESCE(ba.kilos_unidad, sc.kilos_unidad, 1.0) as kilos_unidad,
          ba.familia_id,
          ba.rubro,
          ba.sub_rubro,
          bf.nombre as familia_nombre,
          ba.propiedades_dinamicas
      FROM public.bunker_lista_articulos la
      LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = la.articulo_numero
      LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
      LEFT JOIN public.stock_real_consolidado sc ON sc.articulo_numero = la.articulo_numero
      WHERE la.disponible = true AND la.precio_final > 0;
    `;
    
    const resLocal = await localClient.query(localQuery);
    const totalArticulos = resLocal.rows.length;
    console.log(`📊 Artículos activos encontrados localmente: ${totalArticulos}`);
    
    if (totalArticulos === 0) {
      console.log('ℹ️ No hay artículos activos para sincronizar.');
      return;
    }

    // Resolver dinámicamente los ingredientes comerciales limpios (Línea 3 Mixes y Línea 6 Granolas)
    let mapaIngredientesUpper = new Map();
    try {
      const { construirCatalogoIngredientesComerciales } = require('../produccion/services/desgloseIngredientesComercialService');
      const catIng = await construirCatalogoIngredientesComerciales(localClient, { forzarRecalculo: true });
      if (catIng && catIng.items) {
        for (const [skuKey, info] of Object.entries(catIng.items)) {
          mapaIngredientesUpper.set(String(skuKey).trim().toUpperCase(), info);
        }
      }
    } catch (ingErr) {
      console.warn('⚠️ Advertencia al precalcular desglose comercial de ingredientes:', ingErr.message);
    }

    // Preparar payloads con el timestamp único para identificar registros vigentes
    const payloads = resLocal.rows.map(row => {
      let props = row.propiedades_dinamicas;
      if (props && typeof props === 'string') {
        try {
          props = JSON.parse(props);
        } catch (e) {
          props = null;
        }
      }

      // Extraer Familia y Atributo Principal según Nomenclador Búnker
      let familia = row.familia_nombre ? String(row.familia_nombre).trim() : null;
      if (!familia && row.rubro) {
        familia = String(row.rubro).trim();
      }
      if (!familia) {
        familia = 'General';
      }

      let articuloPrincipal = null;
      if (props && props.articulo_principal) {
        const rawArtPrinc = props.articulo_principal;
        articuloPrincipal = (typeof rawArtPrinc === 'object' && rawArtPrinc.valor) 
          ? String(rawArtPrinc.valor).trim() 
          : String(rawArtPrinc).trim();
      }
      if (!articuloPrincipal && row.sub_rubro) {
        articuloPrincipal = String(row.sub_rubro).trim();
      }
      if (!articuloPrincipal && row.producto_descripcion) {
        articuloPrincipal = String(row.producto_descripcion).trim();
      }
      if (!articuloPrincipal) {
        articuloPrincipal = 'General';
      }

      // Extraer Sub-Categoría (Nivel 3), Sub-subcategoría (Nivel 4) y Sub-sub-subcategoría (Nivel 5)
      let subCategoria = null;
      let subSubCategoria = null;
      let subSubSubCategoria = null;

      const famId = row.familia_id || 0;
      const jerarquiaKey = `${famId}___${articuloPrincipal.toLowerCase()}`;
      const confRule = jerarquiaMap.get(jerarquiaKey) || null;

      if (confRule && props && typeof props === 'object') {
        const posObj = props.posiciones || props;

        // 1. Resolver Nivel 3 (evaluando ejes configurados en cascada / orden de prioridad)
        const targetEjesN3 = Array.isArray(confRule.ejes_nivel_3) && confRule.ejes_nivel_3.length > 0
          ? confRule.ejes_nivel_3
          : (confRule.eje_nivel_3 ? [confRule.eje_nivel_3] : []);

        for (const targetEjeN3 of targetEjesN3) {
          for (const key in posObj) {
            if (Object.prototype.hasOwnProperty.call(posObj, key)) {
              const p = posObj[key];
              if (p && typeof p === 'object' && p.eje && String(p.eje).trim().toLowerCase() === targetEjeN3) {
                if (p.valor !== undefined && p.valor !== null && String(p.valor).trim() !== '') {
                  subCategoria = String(p.valor).trim();
                  break;
                }
              }
            }
          }
          if (subCategoria) break;
        }

        // 2. Resolver Nivel 4 si la subcategoría tiene regla configurada
        if (subCategoria && confRule.reglas_nivel_4) {
          const configuredEjeN4 = confRule.reglas_nivel_4[subCategoria] || null;
          if (configuredEjeN4) {
            const targetEjesN4 = Array.isArray(configuredEjeN4)
              ? configuredEjeN4.map(s => String(s).trim().toLowerCase()).filter(Boolean)
              : String(configuredEjeN4).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

            for (const targetEjeN4 of targetEjesN4) {
              for (const key in posObj) {
                if (Object.prototype.hasOwnProperty.call(posObj, key)) {
                  const p = posObj[key];
                  if (p && typeof p === 'object' && p.eje && String(p.eje).trim().toLowerCase() === targetEjeN4) {
                    if (p.valor !== undefined && p.valor !== null && String(p.valor).trim() !== '') {
                      subSubCategoria = String(p.valor).trim();
                      break;
                    }
                  }
                }
              }
              if (subSubCategoria) break;
            }
          }
        }

        // 3. Resolver Nivel 5 si la rama de Nivel 4 tiene regla configurada
        if (subCategoria && subSubCategoria && confRule.reglas_nivel_5) {
          const pathKeyN5 = `${subCategoria}___${subSubCategoria}`;
          const configuredEjeN5 = confRule.reglas_nivel_5[pathKeyN5] || null;
          if (configuredEjeN5) {
            const targetEjesN5 = Array.isArray(configuredEjeN5)
              ? configuredEjeN5.map(s => String(s).trim().toLowerCase()).filter(Boolean)
              : String(configuredEjeN5).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

            for (const targetEjeN5 of targetEjesN5) {
              for (const key in posObj) {
                if (Object.prototype.hasOwnProperty.call(posObj, key)) {
                  const p = posObj[key];
                  if (p && typeof p === 'object' && p.eje && String(p.eje).trim().toLowerCase() === targetEjeN5) {
                    if (p.valor !== undefined && p.valor !== null && String(p.valor).trim() !== '') {
                      subSubSubCategoria = String(p.valor).trim();
                      break;
                    }
                  }
                }
              }
              if (subSubSubCategoria) break;
            }
          }
        }
      }

      const dynamicVals = [];
      if (props && typeof props === 'object') {
        const posObj = props.posiciones || props;
        for (const key in posObj) {
          if (Object.prototype.hasOwnProperty.call(posObj, key)) {
            // Ignorar explícitamente claves de sistema si vinieran en propiedades_dinamicas legacy
            if (key.startsWith('asistente_') || key.startsWith('rendimiento_') || key.startsWith('tostadero_') || key.startsWith('_meta')) {
              continue;
            }
            const propVal = posObj[key];
            if (propVal !== null && propVal !== undefined) {
              let val = '';
              if (typeof propVal === 'object') {
                val = propVal.valor !== undefined && propVal.valor !== null ? String(propVal.valor).trim() : '';
              } else {
                val = String(propVal).trim();
              }
              if (val && key !== 'articulo_principal' && key !== 'familia_nombre') {
                dynamicVals.push(val);
              }
            }
          }
        }
      }

      // Incluir código de barras local si existe en propiedades_dinamicas
      if (props && props.codigo_barras_local) {
        dynamicVals.push(String(props.codigo_barras_local).trim());
      }

      const parts = [];
      if (row.producto_codigo) parts.push(String(row.producto_codigo).trim());
      if (row.producto_descripcion) parts.push(String(row.producto_descripcion).trim());
      if (familia) parts.push(familia);
      if (articuloPrincipal) parts.push(articuloPrincipal);
      if (subCategoria) parts.push(subCategoria);
      if (subSubCategoria) parts.push(subSubCategoria);
      if (subSubSubCategoria) parts.push(subSubSubCategoria);
      if (row.rubro && row.rubro !== familia) parts.push(String(row.rubro).trim());
      if (row.sub_rubro && row.sub_rubro !== articuloPrincipal) parts.push(String(row.sub_rubro).trim());
      dynamicVals.forEach(val => parts.push(val));

      // Inyectar ingredientes limpios para búsqueda + token de respaldo instantáneo (Línea 3 Mixes y Línea 6 Granolas)
      const infoIngComercial = row.producto_codigo
        ? mapaIngredientesUpper.get(String(row.producto_codigo).trim().toUpperCase())
        : null;
      if (infoIngComercial && Array.isArray(infoIngComercial.ingredientes) && infoIngComercial.ingredientes.length >= 2) {
        parts.push(infoIngComercial.ingredientes.join(' '));
        if (infoIngComercial.linea_negocio === 3 || infoIngComercial.linea_negocio === 6) {
          parts.push(`__ING_L${infoIngComercial.linea_negocio}:${infoIngComercial.ingredientes.join('|')}__`);
        }
      }

      const busqueda_metadata = parts.join(' ').replace(/\s+/g, ' ').trim();

      const listaIva = parseFloat(row.lista_iva_porcentaje || 0);
      const realIva = row.real_iva_porcentaje !== null && row.real_iva_porcentaje !== undefined 
        ? parseFloat(row.real_iva_porcentaje) 
        : 21.0;
      
      const precioBrutoOriginal = parseFloat(row.precio_final || 0);
      let precioFinalRecalculado = precioBrutoOriginal;

      if (listaIva > 0 && Math.abs(listaIva - realIva) > 0.01) {
        const precioNeto = precioBrutoOriginal / (1 + (listaIva / 100));
        precioFinalRecalculado = precioNeto * (1 + (realIva / 100));
        // Redondear a 2 decimales para consistencia
        precioFinalRecalculado = Math.round(precioFinalRecalculado * 100) / 100;
      }

      const kilosUnidad = parseFloat(row.kilos_unidad) > 0 ? parseFloat(row.kilos_unidad) : 1.0;
      const precioKilo = Math.round((precioFinalRecalculado / kilosUnidad) * 100) / 100;

      const ivaPorcentaje = realIva > 0 ? realIva : 21.0;
      const precioNeto = Math.round((precioFinalRecalculado / (1 + (ivaPorcentaje / 100))) * 100) / 100;
      const precioKiloNeto = Math.round((precioKilo / (1 + (ivaPorcentaje / 100))) * 100) / 100;

      const evalStock = evaluarStockArticulo(String(row.producto_codigo).trim());

      let stockParaSupabase = 0;
      if (evalStock.stock_estado === 'disponible') {
        stockParaSupabase = evalStock.stock_disponible;
      } else if (evalStock.stock_estado === 'requiere_produccion' && evalStock.stock_potencial > 0) {
        // En Supabase, stock_disponible negativo codifica las unidades de producción potenciales de forma 100% nativa
        stockParaSupabase = -Math.abs(evalStock.stock_potencial);
      }

      let metaFinal = busqueda_metadata || '';
      if (evalStock.stock_estado === 'requiere_produccion' && evalStock.stock_potencial > 0) {
        metaFinal = (metaFinal + ` __REQ_PROD:${evalStock.stock_potencial}__`).trim();
      }

      return {
        lista_id: parseInt(row.lista_id),
        producto_codigo: String(row.producto_codigo).trim(),
        producto_descripcion: String(row.producto_descripcion).trim(),
        precio_final: precioFinalRecalculado,
        kilos_unidad: kilosUnidad,
        precio_kilo: precioKilo,
        iva_porcentaje: ivaPorcentaje,
        precio_neto: precioNeto,
        precio_kilo_neto: precioKiloNeto,
        stock_disponible: stockParaSupabase,
        stock_estado: evalStock.stock_estado,
        familia: familia,
        articulo_principal: articuloPrincipal,
        sub_categoria: subCategoria,
        sub_sub_categoria: subSubCategoria,
        sub_sub_sub_categoria: subSubSubCategoria,
        rubro: row.rubro ? String(row.rubro).trim() : null,
        sub_rubro: row.sub_rubro ? String(row.sub_rubro).trim() : null,
        busqueda_metadata: metaFinal || null,
        updated_at: syncStart // Marca temporal para limpieza posterior
      };
    });

    // 2. Enviar datos a Supabase en lotes (batching de 1000 registros)
    const batchSize = 1000;
    let upsertados = 0;
    let usarPoolerDirecto = false;
    
    console.log('[SYNC-B2B-PRECIOS] Iniciando subida de lotes a Supabase (Upsert)...');
    
    for (let i = 0; i < payloads.length; i += batchSize) {
      const batch = payloads.slice(i, i + batchSize);
      
      // PostgREST upsert
      const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_catalogo_precios?on_conflict=lista_id,producto_codigo`;
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

      try {
        await fetchWithRetry(url, options, 1);
      } catch (errPost) {
        if (errPost.message && (errPost.message.includes('Unregistered API key') || errPost.message.includes('Invalid API key')) && String(SUPABASE_URL).includes('zysyxtbcvgswancxtpib')) {
          console.warn('[Supabase Pooler Fallback] API key PostgREST rotada; ejecutando upsert directo via PostgreSQL Pooler (aws-1-sa-east-1.pooler.supabase.com:6543)...');
          usarPoolerDirecto = true;
          break;
        } else if (errPost.message && errPost.message.includes('stock_estado')) {
          console.warn('Supabase aun no tiene la columna stock_estado (ejecutar migracion 36). Reintentando sin stock_estado...');
          const strippedBatch = batch.map(b => {
            const copy = { ...b };
            delete copy.stock_estado;
            return copy;
          });
          options.body = JSON.stringify(strippedBatch);
          await fetchWithRetry(url, options);
        } else {
          throw errPost;
        }
      }
      upsertados += batch.length;
      console.log(`Sincronizados ${upsertados}/${totalArticulos} articulos...`);
    }

    if (usarPoolerDirecto) {
      await sincronizarCatalogoViaPoolerDirecto(payloads, syncStart);
    } else {
      // 3. Limpieza de registros obsoletos (Soft Delete / Hard Delete)
      console.log(`Iniciando limpieza de articulos obsoletos (anteriores a ${syncStart})...`);
      
      const cleanUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_catalogo_precios?updated_at=lt.${encodeURIComponent(syncStart)}`;
      const cleanOptions = {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      };
      
      await fetchWithRetry(cleanUrl, cleanOptions);
      console.log('Sincronizacion y limpieza completada exitosamente.');
    }

    // 4. Sincronizacion de Kits de Insumos Externos (UP)
    await sincronizarKitsB2B(localClient, usarPoolerDirecto);

    // 5. Evaluación de Caducidad Automática de Fotos por Lote y Sincronización de Manifest en Storage
    try {
      const FotosLotesService = require('../logistica/services/fotosLotesService');
      await FotosLotesService.evaluarCaducidadAutomaticaLotes(localClient);
      await FotosLotesService.sincronizarManifestYCatalogoSupabase(localClient);
    } catch (fotosErr) {
      console.warn('⚠️ Advertencia al sincronizar fotos de partidas por lote:', fotosErr.message);
    }

    // 6. Sincronización en tiempo real del manifest de Ingredientes Comerciales (Mixes y Granolas) en Storage
    try {
      const { sincronizarManifestIngredientesB2B } = require('../produccion/services/desgloseIngredientesComercialService');
      await sincronizarManifestIngredientesB2B(localClient);
    } catch (ingSyncErr) {
      console.warn('⚠️ Advertencia al sincronizar manifest de ingredientes comerciales B2B:', ingSyncErr.message);
    }
    
  } catch (error) {
    console.error('❌ Error durante la sincronización de precios B2B:', error.message);
    process.exitCode = 1;
  } finally {
    if (localClient) {
      localClient.release();
    }
    try {
      if (fs.existsSync(lockFilePath)) {
        fs.unlinkSync(lockFilePath);
      }
    } catch (e) {
      console.error('Error al remover lock file:', e.message);
    }
  }
}

async function sincronizarCatalogoViaPoolerDirecto(payloads, syncStart) {
  const dns = require('dns');
  try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}
  const { Client } = require('pg');
  const supaPg = new Client({
    user: process.env.SUPABASE_B2B_PG_USER || 'postgres.zysyxtbcvgswancxtpib',
    host: process.env.SUPABASE_B2B_PG_HOST || 'aws-1-sa-east-1.pooler.supabase.com',
    database: process.env.SUPABASE_B2B_PG_DB || 'postgres',
    password: process.env.SUPABASE_B2B_PG_PASSWORD || 'wvvx9vZyO5eoZ3Nh',
    port: parseInt(process.env.SUPABASE_B2B_PG_PORT || '6543', 10),
    ssl: { rejectUnauthorized: false }
  });
  await supaPg.connect();
  try {
    await supaPg.query(`ALTER TABLE public.clientes_b2b_catalogo_precios ADD COLUMN IF NOT EXISTS stock_estado TEXT DEFAULT 'disponible';`);
    const batchSize = 1000;
    let upsertados = 0;
    for (let i = 0; i < payloads.length; i += batchSize) {
      const batch = payloads.slice(i, i + batchSize);
      await supaPg.query(`
        INSERT INTO public.clientes_b2b_catalogo_precios (
          lista_id, producto_codigo, producto_descripcion, precio_final,
          kilos_unidad, precio_kilo, iva_porcentaje, precio_neto, precio_kilo_neto,
          stock_disponible, stock_estado, familia, articulo_principal,
          sub_categoria, sub_sub_categoria, sub_sub_sub_categoria,
          rubro, sub_rubro, busqueda_metadata, updated_at
        )
        SELECT
          x.lista_id, x.producto_codigo, x.producto_descripcion, x.precio_final,
          x.kilos_unidad, x.precio_kilo, x.iva_porcentaje, x.precio_neto, x.precio_kilo_neto,
          x.stock_disponible, x.stock_estado, x.familia, x.articulo_principal,
          x.sub_categoria, x.sub_sub_categoria, x.sub_sub_sub_categoria,
          x.rubro, x.sub_rubro, x.busqueda_metadata, x.updated_at::timestamptz
        FROM jsonb_to_recordset($1::jsonb) AS x(
          lista_id integer,
          producto_codigo text,
          producto_descripcion text,
          precio_final numeric,
          kilos_unidad numeric,
          precio_kilo numeric,
          iva_porcentaje numeric,
          precio_neto numeric,
          precio_kilo_neto numeric,
          stock_disponible numeric,
          stock_estado text,
          familia text,
          articulo_principal text,
          sub_categoria text,
          sub_sub_categoria text,
          sub_sub_sub_categoria text,
          rubro text,
          sub_rubro text,
          busqueda_metadata text,
          updated_at text
        )
        ON CONFLICT (lista_id, producto_codigo) DO UPDATE SET
          producto_descripcion = EXCLUDED.producto_descripcion,
          precio_final = EXCLUDED.precio_final,
          kilos_unidad = EXCLUDED.kilos_unidad,
          precio_kilo = EXCLUDED.precio_kilo,
          iva_porcentaje = EXCLUDED.iva_porcentaje,
          precio_neto = EXCLUDED.precio_neto,
          precio_kilo_neto = EXCLUDED.precio_kilo_neto,
          stock_disponible = EXCLUDED.stock_disponible,
          stock_estado = EXCLUDED.stock_estado,
          familia = EXCLUDED.familia,
          articulo_principal = EXCLUDED.articulo_principal,
          sub_categoria = EXCLUDED.sub_categoria,
          sub_sub_categoria = EXCLUDED.sub_sub_categoria,
          sub_sub_sub_categoria = EXCLUDED.sub_sub_sub_categoria,
          rubro = EXCLUDED.rubro,
          sub_rubro = EXCLUDED.sub_rubro,
          busqueda_metadata = EXCLUDED.busqueda_metadata,
          updated_at = EXCLUDED.updated_at
      `, [JSON.stringify(batch)]);
      upsertados += batch.length;
      console.log(`[Pooler PG] Sincronizados ${upsertados}/${payloads.length} articulos...`);
    }
    const delRes = await supaPg.query(`DELETE FROM public.clientes_b2b_catalogo_precios WHERE updated_at < $1::timestamptz`, [syncStart]);
    console.log(`[Pooler PG] Sincronizacion y limpieza completada exitosamente (eliminados obsoletos: ${delRes.rowCount || 0}).`);
  } finally {
    await supaPg.end().catch(() => {});
  }
}

async function sincronizarKitsB2B(db, usarPoolerDirecto = false) {
  try {
    console.log('📦 Sincronizando Kits de Insumos Externos (UP)...');
    const q = `
      SELECT 
          ra.articulo_numero as producto_codigo,
          src.codigo_barras,
          r.articulo_numero as up_codigo,
          COALESCE(ra.cantidad, 1.0)::numeric(15,4) as multiplicador_base,
          ri.ingrediente_id,
          COALESCE(i.nombre, ri.nombre_ingrediente) as descripcion,
          ri.unidad_medida,
          (ri.cantidad / COALESCE(ra.cantidad, 1.0))::numeric(15,4) as cantidad_ratio,
          COALESCE(i.costo_patron, 0.00)::numeric(15,2) as costo_base,
          21.00 as iva_porcentaje,
          (COALESCE(i.costo_patron, 0.00) * 1.21)::numeric(15,2) as precio_unitario
      FROM recetas r
      JOIN receta_articulos ra ON r.id = ra.receta_id
      JOIN receta_ingredientes ri ON r.id = ri.receta_id AND ri.fase_produccion = 'externa'
      LEFT JOIN ingredientes i ON ri.ingrediente_id = i.id
      LEFT JOIN stock_real_consolidado src ON src.articulo_numero = ra.articulo_numero OR src.codigo_barras = ra.articulo_numero
    `;
    const res = await db.query(q);
    if (!res.rows || res.rows.length === 0) return;

    const payload = [];
    for (const row of res.rows) {
      payload.push({
        producto_codigo: row.producto_codigo,
        up_codigo: row.up_codigo,
        ingrediente_id: row.ingrediente_id,
        ingrediente_codigo: String(row.ingrediente_id),
        descripcion: row.descripcion,
        unidad_medida: row.unidad_medida,
        cantidad_ratio: parseFloat(row.cantidad_ratio),
        costo_base: parseFloat(row.costo_base),
        iva_porcentaje: parseFloat(row.iva_porcentaje),
        precio_unitario: parseFloat(row.precio_unitario),
        activo: true
      });
      if (row.codigo_barras && row.codigo_barras !== row.producto_codigo) {
        payload.push({
          producto_codigo: row.codigo_barras,
          up_codigo: row.up_codigo,
          ingrediente_id: row.ingrediente_id,
          ingrediente_codigo: String(row.ingrediente_id),
          descripcion: row.descripcion,
          unidad_medida: row.unidad_medida,
          cantidad_ratio: parseFloat(row.cantidad_ratio),
          costo_base: parseFloat(row.costo_base),
          iva_porcentaje: parseFloat(row.iva_porcentaje),
          precio_unitario: parseFloat(row.precio_unitario),
          activo: true
        });
      }
    }

    const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_articulos_kits?on_conflict=producto_codigo,ingrediente_id`;
    const options = {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    };
    if (!usarPoolerDirecto) {
      await fetchWithRetry(url, options, 1);
      console.log(`${payload.length} registros de Kits de Insumos sincronizados a Supabase.`);
    }
  } catch (err) {
    console.warn('⚠️ Advertencia al sincronizar kits B2B:', err.message);
  }
}

sincronizarB2BPrecios()
  .catch(error => {
    console.error('💥 Error fatal en sincronización de precios B2B:', error);
    process.exitCode = 1;
  });
