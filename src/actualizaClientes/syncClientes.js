const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));
const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

// URL del endpoint de clientes (configurable via variable de entorno)
const LOMASOFT_CLIENTES_URL = process.env.LOMASOFT_CLIENTES_URL || 'https://api.lamdaser.com/api/clientes';

const CLIENTES_SCHEMA = process.env.CLIENTES_SCHEMA || 'public';
const CLIENTES_TABLE  = process.env.CLIENTES_TABLE  || 'clientes';

// Comillado seguro del identificador (muy básico; asume nombres alfanuméricos y _):
function quoteIdent(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('Nombre de identificador inválido');
  return `"${name}"`;
}
const FULL_TABLE = `${quoteIdent(CLIENTES_SCHEMA)}.${quoteIdent(CLIENTES_TABLE)}`;
const DEBUG = (process.env.DEBUG_SYNC_CLIENTES || '0') !== '0';

async function fetchAllClientes(baseUrl) {
  const out = [];
  // Si la URL ya trae ?limit/offset, respetar; si no, paginar con limit=1000
  const hasQuery = baseUrl.includes('?');
  let limit = 1000, offset = 0, total = null;

  // Intentar modo paginado {ok,total,data}; si el primer fetch devuelve array directo, devolverlo y terminar
  while (true) {
    const url = hasQuery ? baseUrl : `${baseUrl}?limit=${limit}&offset=${offset}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const body = await resp.json();

    if (Array.isArray(body)) {
      // Respuesta es array directo; sin paginación
      return body;
    }

    const data = body && Array.isArray(body.data) ? body.data : [];
    if (total === null) total = Number(body.total || data.length || 0);

    out.push(...data);
    if (out.length >= total || data.length === 0) break;
    offset += limit;
  }
  return out;
}

/**
 * Sincroniza clientes desde Lomasoft a la tabla public.clientes.
 * 
 * Requiere UNIQUE(cliente_id) en public.clientes (se crea automáticamente si falta).
 * Variables opcionales: CLIENTES_SCHEMA (default public), CLIENTES_TABLE (default clientes).
 */
async function sincronizarClientes() {
  let client;

  try {
    console.log('🚀 Iniciando sincronización de clientes...');
    console.log(`📡 Consultando API: ${LOMASOFT_CLIENTES_URL}`);
    console.log(`🎯 Tabla destino: ${FULL_TABLE}`);
    
    const clientes = await fetchAllClientes(LOMASOFT_CLIENTES_URL);
    console.log(`📊 Total de clientes recibidos: ${clientes.length}`);
    if (!Array.isArray(clientes) || clientes.length === 0) {
      throw new Error('No se recibieron clientes válidos desde la API.');
    }

    client = await pool.connect();

    // Modo diagnóstico: verificar conexión y tabla destino antes de la transacción
    console.log('🔍 Ejecutando diagnóstico de preflight...');
    try {
      // Test de conexión básico
      const connTest = await client.query('SELECT NOW() as timestamp, current_database() as database, current_user as usuario');
      console.log(`✅ Conexión PostgreSQL OK - DB: ${connTest.rows[0].database}, Usuario: ${connTest.rows[0].usuario}`);

      // Verificar existencia de esquema
      const schemaCheck = await client.query(
        'SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1',
        [CLIENTES_SCHEMA]
      );
      if (schemaCheck.rows.length === 0) {
        console.log(`⚠️ ADVERTENCIA: Esquema "${CLIENTES_SCHEMA}" no existe`);
      } else {
        console.log(`✅ Esquema "${CLIENTES_SCHEMA}" existe`);
      }

      // Verificar existencia de tabla
      const tableCheck = await client.query(
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
        [CLIENTES_SCHEMA, CLIENTES_TABLE]
      );
      if (tableCheck.rows.length === 0) {
        console.log(`⚠️ ADVERTENCIA: Tabla ${FULL_TABLE} no existe`);
      } else {
        console.log(`✅ Tabla ${FULL_TABLE} existe`);

        // Verificar índices únicos en cliente_id
        const indexCheck = await client.query(`
          SELECT indexname, indexdef 
          FROM pg_indexes 
          WHERE schemaname = $1 AND tablename = $2 AND indexdef ILIKE '%cliente_id%'
        `, [CLIENTES_SCHEMA, CLIENTES_TABLE]);
        
        if (indexCheck.rows.length > 0) {
          console.log(`✅ Índice único en cliente_id encontrado`);
          if (DEBUG) {
            indexCheck.rows.forEach(idx => {
              console.log(`🔍 [DEBUG]   - ${idx.indexname}: ${idx.indexdef}`);
            });
          }
        } else {
          console.log(`⚠️ No se encontró índice único en cliente_id - creando automáticamente...`);
          try {
            await client.query(`
              CREATE UNIQUE INDEX IF NOT EXISTS clientes_cliente_id_uidx
              ON ${FULL_TABLE} (cliente_id)
            `);
            console.log(`✅ Índice único clientes_cliente_id_uidx creado exitosamente`);
          } catch (indexError) {
            console.log(`⚠️ Error al crear índice único: ${indexError.message} - continuando...`);
          }
        }

        // Si DEBUG está activo, mostrar información adicional de la tabla
        if (DEBUG) {
          const columnInfo = await client.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
          `, [CLIENTES_SCHEMA, CLIENTES_TABLE]);
          
          console.log(`🔍 [DEBUG] Estructura de tabla ${FULL_TABLE}:`);
          columnInfo.rows.forEach(col => {
            console.log(`🔍 [DEBUG]   - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
          });
        }
      }

      console.log('✅ Diagnóstico de preflight completado');
    } catch (diagError) {
      console.error('❌ Error en diagnóstico de preflight:', diagError.message);
      if (DEBUG) {
        console.error('🔍 [DEBUG] Stack trace del diagnóstico:', diagError.stack);
      }
      // No fallar por errores de diagnóstico, continuar con la sincronización
      console.log('⚠️ Continuando con sincronización a pesar del error de diagnóstico...');
    }

    await client.query('BEGIN');

    let procesados = 0;

    const sqlUpsert = `
      INSERT INTO ${FULL_TABLE} (
        cliente_id, nombre, lista_precios, condicion_iva, zona, apellido, otros,
        cuit, vendedor, telefono_2, telefono, email, celular, limite_cta,
        nacimiento, localidad, provincia, pais, dni, domicilio, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,$13,$14,
        $15,$16,$17,$18,$19,$20, NOW(), NOW()
      )
      ON CONFLICT (cliente_id) DO UPDATE SET
        nombre = EXCLUDED.nombre,
        lista_precios = EXCLUDED.lista_precios,
        condicion_iva = EXCLUDED.condicion_iva,
        zona = EXCLUDED.zona,
        apellido = EXCLUDED.apellido,
        otros = EXCLUDED.otros,
        cuit = EXCLUDED.cuit,
        vendedor = EXCLUDED.vendedor,
        telefono_2 = EXCLUDED.telefono_2,
        telefono = EXCLUDED.telefono,
        email = EXCLUDED.email,
        celular = EXCLUDED.celular,
        limite_cta = EXCLUDED.limite_cta,
        nacimiento = EXCLUDED.nacimiento,
        localidad = EXCLUDED.localidad,
        provincia = EXCLUDED.provincia,
        pais = EXCLUDED.pais,
        dni = EXCLUDED.dni,
        domicilio = EXCLUDED.domicilio,
        updated_at = NOW()
    `;

    for (const c of clientes) {
      // Mapeo de campos del JSON a columnas de public.clientes
      const vals = [
        c.cliente_id,
        c.nombre ?? null,
        c.lista_precios ?? null,
        c.condicion_iva ?? null,
        c.zona ?? null,
        c.apellido ?? null,
        c.otros ?? null,
        c.cuit ?? null,
        c.vendedor ?? null,
        c.telefono_2 ?? null,
        c.telefono ?? null,
        c.email ?? null,
        c.celular ?? null,
        c.limite_cta != null ? parseInt(c.limite_cta) : null,
        c.nacimiento ? (isNaN(new Date(c.nacimiento)) ? null : new Date(c.nacimiento)) : null,
        c.localidad ?? null,
        c.provincia ?? null,
        c.pais ?? null,
        c.dni != null ? String(c.dni) : null,
        c.domicilio ?? c.direccion ?? null
      ];

      await client.query(sqlUpsert, vals);

      procesados++;

      // Log de progreso cada 500 registros
      if (procesados % 500 === 0) {
        console.log(`🔄 Procesados ${procesados}/${clientes.length} clientes...`);
      }
    }

    await client.query('COMMIT');
    console.log(`✅ Sincronización de clientes completada. ${procesados}/${clientes.length} clientes procesados.`);
  } catch (error) {
    console.error('❌ Error durante la sincronización de clientes:', error.message);
    if (client) {
      await client.query('ROLLBACK');
      console.log('🔄 Rollback ejecutado correctamente.');
    }
    process.exitCode = 1;
  } finally {
    if (client) {
      client.release();
    }
  }
}

sincronizarClientes()
  .catch(error => {
    console.error('💥 Error fatal en sincronización de clientes:', error);
    process.exitCode = 1;
  });
