// src/estadisticas/app.js
const express = require('express');
const mountApi = require('./api');
const { Pool } = require('pg');

const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.ESTADISTICAS_PORT || 3001;

app.use(express.json());
mountApi(app);

// === estáticos del módulo (sirve /estadisticas/*) ===
const baseDir = __dirname; // espera: src/estadisticas/
app.use('/estadisticas', express.static(baseDir));
app.get('/estadisticas', (req, res) => {
  const file = path.join(baseDir, 'pages', 'estadisticas.html');
  if (!fs.existsSync(file)) return res.status(404).send('estadisticas.html no encontrado');
  res.sendFile(file);
});



// === Coneccion DB  ===//
const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'etiquetas',
  password: process.env.PGPASSWORD || 'ta3Mionga',
  port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
});

// util: formatear null/undefined a null postgres
const toNull = (v) => (v === undefined || v === '' ? null : v);

// --- ENDPOINT 1: carros medidos (datos brutos + etapas + composición) ---
// --- ENDPOINT 1: carros medidos (al menos 1 etapa medida) ---
// --- ENDPOINT 1: carros medidos (al menos 1 etapa medida) ---
app.get('/api/estadisticas/carros', async (req, res) => {
  const { desde, hasta, limit = 50 } = req.query;

  const sql = `
    -- 1) Derivo etapas a partir de las columnas *_inicio/*_fin/*_duracion_ms
    WITH etapas AS (
      SELECT c.id AS carro_id, 1 AS etapa_num, 'Etapa 1'::text AS etapa,
             c.etapa1_inicio AS inicio, c.etapa1_fin AS fin,
             CASE 
               WHEN c.etapa1_duracion_ms IS NOT NULL THEN (c.etapa1_duracion_ms/1000)::int
               WHEN c.etapa1_inicio IS NOT NULL AND c.etapa1_fin IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (c.etapa1_fin - c.etapa1_inicio))::int
               ELSE NULL
             END AS duracion_seg
      FROM carros_produccion c
      UNION ALL
      SELECT c.id, 2, 'Etapa 2 · Medición',
             c.etapa2_inicio, c.etapa2_fin,
             CASE 
               WHEN c.etapa2_duracion_ms IS NOT NULL THEN (c.etapa2_duracion_ms/1000)::int
               WHEN c.etapa2_inicio IS NOT NULL AND c.etapa2_fin IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (c.etapa2_fin - c.etapa2_inicio))::int
               ELSE NULL
             END
      FROM carros_produccion c
      UNION ALL
      SELECT c.id, 3, 'Etapa 3',
             c.etapa3_inicio, c.etapa3_fin,
             CASE 
               WHEN c.etapa3_duracion_ms IS NOT NULL THEN (c.etapa3_duracion_ms/1000)::int
               WHEN c.etapa3_inicio IS NOT NULL AND c.etapa3_fin IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (c.etapa3_fin - c.etapa3_inicio))::int
               ELSE NULL
             END
      FROM carros_produccion c
    ),

    -- 2) Solo etapas verdaderamente medidas
    etapas_ok AS (
      SELECT *
      FROM etapas
      WHERE (duracion_seg IS NOT NULL AND duracion_seg > 0)
         OR (inicio IS NOT NULL AND fin IS NOT NULL)
    ),

    -- 3) Composición (si querés excluir ítems sin tiempo, descomenta el WHERE)
    comp AS (
      SELECT 
        ca.carro_id,
        jsonb_agg(
          jsonb_build_object(
            'articulo_numero', ca.articulo_numero,
            'descripcion',     ca.descripcion,
            'cantidad',        ca.cantidad,
            'tiempo_seg',      CASE 
                                 WHEN ca.duracion_ms IS NOT NULL THEN (ca.duracion_ms/1000)::int
                                 WHEN ca.tiempo_inicio IS NOT NULL AND ca.tiempo_fin IS NOT NULL
                                   THEN EXTRACT(EPOCH FROM (ca.tiempo_fin - ca.tiempo_inicio))::int
                                 ELSE NULL
                               END
          ) ORDER BY ca.articulo_numero
        ) AS composicion
      FROM carros_articulos ca
      /* Si NO querés mostrar artículos sin temporización, usa esto:
      WHERE ca.duracion_ms IS NOT NULL OR (ca.tiempo_inicio IS NOT NULL AND ca.tiempo_fin IS NOT NULL)
      */
      GROUP BY ca.carro_id
    ),

    base AS (
      SELECT 
        c.id AS carro_id,
        c.fecha_inicio AS fecha_produccion,
        c.tipo_carro,
        c.en_auditoria,
        COALESCE(comp.composicion, '[]'::jsonb) AS composicion,
        jsonb_agg(
          jsonb_build_object(
            'etapa_num',    e.etapa_num,
            'etapa',        e.etapa,
            'inicio',       e.inicio,
            'fin',          e.fin,
            'duracion_seg', e.duracion_seg
          ) ORDER BY e.etapa_num
        ) AS etapas
      FROM carros_produccion c
      -- 🔒 clave: obligo a tener al menos 1 etapa medida
      JOIN etapas_ok e   ON e.carro_id = c.id
      LEFT JOIN comp     ON comp.carro_id = c.id
      WHERE
        ($1::timestamp IS NULL OR c.fecha_inicio >= $1) AND
        ($2::timestamp IS NULL OR c.fecha_inicio <  $2)
      GROUP BY c.id, c.fecha_inicio, c.tipo_carro, c.en_auditoria, comp.composicion
      ORDER BY c.fecha_inicio DESC, c.id DESC
      LIMIT $3::int
    )

    SELECT
      carro_id,
      fecha_produccion,
      tipo_carro,
      en_auditoria,
      etapas,
      composicion,
      COALESCE((
        SELECT SUM( (e->>'duracion_seg')::int )
        FROM jsonb_array_elements(base.etapas) e
      ),0) AS duracion_total_seg,
      jsonb_array_length(etapas) AS etapas_count
    FROM base
    WHERE jsonb_array_length(etapas) > 0;  -- doble seguro
  `;

  try {
    const { rows } = await pool.query(sql, [
      req.query.desde || null,
      req.query.hasta || null,
      limit
    ]);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[ESTADISTICAS] /carros error', err);
    res.status(500).json({ ok: false, error: 'DB_ERROR' });
  }
});



// --- ENDPOINT 2: artículos medidos (datos brutos + etapas + composición) ---
// GET /api/estadisticas/articulos/ultimos?limit=50&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
app.get('/api/estadisticas/articulos/ultimos', async (req, res) => {
  const { desde, hasta, limit = 50 } = req.query;

  const sql = `
    WITH filas AS (
      SELECT
        ca.id,
        ca.carro_id,
        ca.articulo_numero,
        COALESCE(ca.descripcion, CONCAT('Artículo ', ca.articulo_numero)) AS articulo,
        ca.cantidad,
        ca.tiempo_inicio,
        ca.tiempo_fin,
        CASE 
          WHEN ca.duracion_ms IS NOT NULL THEN (ca.duracion_ms/1000.0)
          WHEN ca.tiempo_inicio IS NOT NULL AND ca.tiempo_fin IS NOT NULL THEN EXTRACT(EPOCH FROM (ca.tiempo_fin - ca.tiempo_inicio))
          ELSE NULL
        END AS duracion_seg,
        COALESCE(ca.tiempo_fin, ca.tiempo_inicio, cp.fecha_inicio) AS ts
      FROM carros_articulos ca
      JOIN carros_produccion cp ON cp.id = ca.carro_id
      WHERE
        -- solo registros con temporización hecha
        (ca.duracion_ms IS NOT NULL OR (ca.tiempo_inicio IS NOT NULL AND ca.tiempo_fin IS NOT NULL))
        -- rango por timestamp de medición
        AND ($1::timestamp IS NULL OR COALESCE(ca.tiempo_fin, ca.tiempo_inicio, cp.fecha_inicio) >= $1)
        AND ($2::timestamp IS NULL OR COALESCE(ca.tiempo_fin, ca.tiempo_inicio, cp.fecha_inicio) <  $2)
    )
    SELECT
      id, carro_id, articulo_numero, articulo, cantidad,
      tiempo_inicio, tiempo_fin,
      FLOOR(duracion_seg)::int AS duracion_seg,
      ts AS timestamp_medicion
    FROM filas
    ORDER BY ts DESC, id DESC
    LIMIT $3::int;
  `;

  try {
    const { rows } = await pool.query(sql, [
      req.query.desde || null,
      req.query.hasta || null,
      limit
    ]);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[ESTADISTICAS] /articulos/ultimos error', err);
    res.status(500).json({ ok: false, error: 'DB_ERROR' });
  }
});


// === API read-only (ejemplos) ===
app.get('/api/estadisticas/health', (req, res) => res.json({ ok: true }));
// app.get('/api/estadisticas/produccion/resumen', ...);

app.listen(port, () => {
  console.log(`[ESTADISTICAS] Servidor en http://localhost:${port}`);
});