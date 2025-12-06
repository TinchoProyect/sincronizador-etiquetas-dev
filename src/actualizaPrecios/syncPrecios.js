// filepath: src/actualizaPrecios/syncPrecios.js
'use strict';

const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));
require('dotenv').config();
const { Pool } = require('pg');

/**
 * Sincroniza precios desde la API de la notebook (vía túnel)
 * hacia la tabla Postgres public.precios_articulos.
 *
 * Requisitos:
 *   - Tabla public.precios_articulos creada.
 *   - (Opcional) índice UNIQUE(articulo) — se crea si falta.
 */

// ===== 1) Conexión Postgres (igual que en syncClientes.js) =====
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

// Log de conexión con ADVERTENCIA de operación destructiva
console.log('═══════════════════════════════════════════════════════');
console.log('⚠️  [SYNC-PRECIOS] SCRIPT DE SINCRONIZACIÓN DESTRUCTIVO');
console.log('═══════════════════════════════════════════════════════');
console.log(`🔌 Conectado a BD: ${process.env.DB_NAME || 'etiquetas'}`);
console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'production'}`);
console.log('⚠️  Este script ejecuta: TRUNCATE TABLE precios_articulos');
console.log('═══════════════════════════════════════════════════════');

// ===== 2) Config y variables =====
// Default explícito al túnel confirmado. Si tu ruta real es distinta,
// sobreescribí con LOMASOFT_ARTICULOS_URL.
const LOMASOFT_ARTICULOS_URL =
  process.env.LOMASOFT_ARTICULOS_URL || 'https://api.lamdaser.com/api/articulos';

const PRECIOS_SCHEMA     = process.env.PRECIOS_SCHEMA     || 'public';
const PRECIOS_TABLE      = process.env.PRECIOS_TABLE      || 'precios_articulos';
const PRECIOS_UNIQUE_IDX = process.env.PRECIOS_UNIQUE_IDX || 'ux_precios_articulos_articulo';
const DEBUG              = (process.env.DEBUG_SYNC_PRECIOS || '0') !== '0';

// Comillado seguro (mismo criterio que clientes)
function quoteIdent(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('Nombre de identificador inválido');
  return `"${name}"`;
}
const FULL_TABLE = `${quoteIdent(PRECIOS_SCHEMA)}.${quoteIdent(PRECIOS_TABLE)}`;

// ===== 3) Utilidades =====
async function fetchAllArticulos(baseUrl) {
  const out = [];
  const hasQuery = baseUrl.includes('?');
  let limit = 1000, offset = 0, total = null;

  while (true) {
    const url = hasQuery ? baseUrl : `${baseUrl}?limit=${limit}&offset=${offset}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const body = await resp.json();

    if (Array.isArray(body)) {
      return body; // sin paginación
    }

    const data = body && Array.isArray(body.data) ? body.data : [];
    if (total === null) total = Number(body.total || data.length || 0);

    out.push(...data);
    if (out.length >= total || data.length === 0) break;
    offset += limit;
  }
  return out;
}

// Toma la primera clave presente (tolerancia de nombres)
const pick = (row, ...keys) => {
  for (const k of keys) if (row[k] !== undefined && row[k] !== null) return row[k];
  return null;
};

// Claves compatibles (normalizadas y legacy con espacios)
const K = {
  articulo:         ['articulo', 'Artículo', 'codigo', 'numero', 'Número'],
  descripcion:      ['descripcion', 'Descripción', 'nombre', 'Nombre'],
  costo:            ['costo', 'Costo'],
  moneda:           ['moneda', 'Moneda'],
  iva:              ['iva', 'IVA'],
  precio_neg:       ['precio_neg', 'Precio Neg.', 'precio1'],
  mayorista:        ['mayorista', 'Mayorista', 'precio2'],
  especial_brus:    ['especial_brus', 'Especial (Brus)', 'precio3'],
  consumidor_final: ['consumidor_final', 'Consumidor Final', 'precio4'],
  lista_5:          ['lista_5', 'Lista 5', 'precio5'],
};

// Convierte a número tolerando strings y coma decimal
const toNum = v => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.replace(',', '.');
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
  }
  return typeof v === 'number' ? v : null;
};

// ===== 4) Sincronización (estructura espejo) =====
async function sincronizarPrecios() {
  let client;

  try {
    console.log('🚀 Iniciando sincronización de precios...');
    console.log(`📡 Consultando API: ${LOMASOFT_ARTICULOS_URL}`);
    console.log(`🎯 Tabla destino: ${FULL_TABLE}`);

    const articulos = await fetchAllArticulos(LOMASOFT_ARTICULOS_URL);
    console.log('🧪 Claves del primer artículo:', Object.keys(articulos[0] || {}));
    console.log(`📊 Total de artículos recibidos: ${articulos.length}`);
    if (!Array.isArray(articulos) || articulos.length === 0) {
      throw new Error('No se recibieron artículos válidos desde la API.');
    }

    client = await pool.connect();

    // ---- Diagnóstico de preflight (paridad con clientes) ----
    console.log('🔍 Ejecutando diagnóstico de preflight...');
    try {
      // Test conexión
      const connTest = await client.query('SELECT NOW() as ts, current_database() as database, current_user as usuario');
      console.log(`✅ Conexión PostgreSQL OK - DB: ${connTest.rows[0].database}, Usuario: ${connTest.rows[0].usuario}`);

      // Esquema
      const schemaCheck = await client.query(
        'SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1',
        [PRECIOS_SCHEMA]
      );
      if (schemaCheck.rows.length === 0) {
        console.log(`⚠️ ADVERTENCIA: Esquema "${PRECIOS_SCHEMA}" no existe`);
      } else {
        console.log(`✅ Esquema "${PRECIOS_SCHEMA}" existe`);
      }

      // Tabla
      const tableCheck = await client.query(
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
        [PRECIOS_SCHEMA, PRECIOS_TABLE]
      );
      if (tableCheck.rows.length === 0) {
        console.log(`⚠️ ADVERTENCIA: Tabla ${FULL_TABLE} no existe`);
      } else {
        console.log(`✅ Tabla ${FULL_TABLE} existe`);

        // Índice único en articulo
        const indexCheck = await client.query(`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE schemaname = $1 AND tablename = $2 AND indexdef ILIKE '%(articulo)%'
        `, [PRECIOS_SCHEMA, PRECIOS_TABLE]);

        if (indexCheck.rows.length > 0) {
          console.log(`✅ Índice único en articulo encontrado`);
          if (DEBUG) indexCheck.rows.forEach(i => console.log(`🔍 [DEBUG]   - ${i.indexname}: ${i.indexdef}`));
        } else {
          console.log('⚠️ No se encontró índice único en articulo - creando automáticamente…');
          try {
            await client.query(`
              CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdent(PRECIOS_UNIQUE_IDX)}
              ON ${FULL_TABLE} (articulo)
            `);
            console.log(`✅ Índice único ${PRECIOS_UNIQUE_IDX} creado/verificado`);
          } catch (indexError) {
            console.log(`⚠️ Error al crear índice único: ${indexError.message} - continúo…`);
          }
        }

        // Info de columnas (solo DEBUG)
        if (DEBUG) {
          const cols = await client.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
          `, [PRECIOS_SCHEMA, PRECIOS_TABLE]);
          console.log(`🔍 [DEBUG] Estructura de ${FULL_TABLE}:`);
          cols.rows.forEach(c => console.log(`   - ${c.column_name}: ${c.data_type} (nullable: ${c.is_nullable})`));
        }
      }

      console.log('✅ Diagnóstico de preflight completado');
    } catch (diagError) {
      console.error('❌ Error en diagnóstico de preflight:', diagError.message);
      if (DEBUG) console.error('🔍 [DEBUG] Stack:', diagError.stack);
      console.log('⚠️ Continuando con sincronización a pesar del error de diagnóstico…');
    }

    // ---- Transacción de carga (política TRUNCATE + INSERT) ----
    await client.query('BEGIN');

    console.log(`🧹 TRUNCATE ${FULL_TABLE}…`);
    await client.query(`TRUNCATE TABLE ${FULL_TABLE}`);

    const insertSQL = `
      INSERT INTO ${FULL_TABLE} (
        articulo, descripcion, costo, moneda, iva,
        precio_neg, mayorista, especial_brus, consumidor_final, lista_5
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `;

    let procesados = 0;
    for (const a of articulos) {
      // Mapeo tolerante
  const articulo         = pick(a, ...K.articulo);
  const descripcion      = pick(a, ...K.descripcion);
  const costo            = toNum(pick(a, ...K.costo));
  const moneda           = pick(a, ...K.moneda);
  const iva              = toNum(pick(a, ...K.iva));
  const precio_neg       = toNum(pick(a, ...K.precio_neg));
  const mayorista        = toNum(pick(a, ...K.mayorista));
  const especial_brus    = toNum(pick(a, ...K.especial_brus));
  const consumidor_final = toNum(pick(a, ...K.consumidor_final));
  const lista_5          = toNum(pick(a, ...K.lista_5));

      await client.query(insertSQL, [
        articulo, descripcion, costo, moneda, iva,
        precio_neg, mayorista, especial_brus, consumidor_final, lista_5
      ]);

      procesados++;
      if (procesados % 500 === 0) {
        console.log(`🔄 Procesados ${procesados}/${articulos.length} artículos…`);
      }
    }

    await client.query('COMMIT');
    console.log(`✅ Sincronización de precios completada. ${procesados}/${articulos.length} filas insertadas.`);
  } catch (error) {
    console.error('❌ Error durante la sincronización de precios:', error.message);
    if (client) {
      await client.query('ROLLBACK');
      console.log('🔄 Rollback ejecutado correctamente.');
    }
    process.exitCode = 1; // mismo criterio que syncClientes.js
  } finally {
    if (client) client.release();
  }
}

// Entrypoint
sincronizarPrecios()
  .catch(error => {
    console.error('💥 Error fatal en sincronización de precios:', error);
    process.exitCode = 1;
  });