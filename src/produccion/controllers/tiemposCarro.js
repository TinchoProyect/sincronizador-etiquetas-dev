// controllers/tiemposCarro.js
const pool = require('../config/database');
const { validarPropiedadCarro } = require('./carro'); // ya existe en tu código


//Modificacion 21/8
// controllers/tiemposCarro.js


function mapEtapa(etapaStr) {
  const e = String(etapaStr);
  const maps = {
    '1': { inicio: 'etapa1_inicio', fin: 'etapa1_fin', dur: 'etapa1_duracion_ms' },
    '2': { inicio: 'etapa2_inicio', fin: 'etapa2_fin', dur: 'etapa2_duracion_ms' },
    '3': { inicio: 'etapa3_inicio', fin: 'etapa3_fin', dur: 'etapa3_duracion_ms' }
  };
  return maps[e] || null;
}

exports.iniciarEtapaCarro = async (req, res) => {
  const { carroId, etapa } = req.params;
  const usuarioId = req.query.usuarioId || (req.body && req.body.usuarioId);

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });

    const map = mapEtapa(etapa);
    if (!map) return res.status(400).json({ error: 'Etapa inválida' });

    // Chequeamos preparado y fin de etapa
    const r0 = await pool.query(
      `SELECT fecha_preparado, ${map.inicio} AS inicio, ${map.fin} AS fin
         FROM carros_produccion WHERE id = $1`,
      [carroId]
    );
    if (!r0.rowCount) return res.status(404).json({ error: 'Carro no encontrado' });
    const row = r0.rows[0];

   // Si ya está preparado, NO permitir E1 ni E2; PERO SÍ permitir E3 (asentar)
    if (row.fecha_preparado && etapa !== '3') {
      return res.status(409).json({ error: 'El carro ya fue preparado. No se puede reiniciar medición.' });
    }

    if (row.fin) {
      return res.status(409).json({ error: 'La etapa ya fue finalizada. No se puede reiniciar.' });
    }

    // inicia si no estaba iniciada; limpia fin y duración
    const q = `
      UPDATE carros_produccion
         SET ${map.inicio} = COALESCE(${map.inicio}, CURRENT_TIMESTAMP),
             ${map.fin}    = NULL,
             ${map.dur}    = NULL
       WHERE id = $1
       RETURNING id, ${map.inicio} AS inicio
    `;
    const r = await pool.query(q, [carroId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Carro no encontrado' });

    return res.json({ ok: true, carro_id: r.rows[0].id, etapa, inicio: r.rows[0].inicio });
  } catch (err) {
    console.error('Error iniciarEtapaCarro:', err);
    return res.status(500).json({ error: 'No se pudo iniciar la etapa' });
  }
};

exports.finalizarEtapaCarro = async (req, res) => {
  const { carroId, etapa } = req.params;
  const usuarioId = req.query.usuarioId || (req.body && req.body.usuarioId);
  if (!usuarioId) return res.status(400).json({ error: 'usuarioId requerido' });


  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });

    const map = mapEtapa(etapa);
    if (!map) return res.status(400).json({ error: 'Etapa inválida' });

    // Validar que tenga inicio
      const r0 = await pool.query(
        `SELECT fecha_preparado, ${map.inicio} AS inicio, ${map.fin} AS fin
          FROM carros_produccion WHERE id = $1`,
        [carroId]
      );
      if (r0.rowCount === 0) return res.status(404).json({ error: 'Carro no encontrado' });

      const { inicio, fin } = r0.rows[0];
      if (!inicio) return res.status(400).json({ error: 'La etapa no fue iniciada' });

      // Idempotente: si ya estaba finalizada, devolvemos OK sin romper
      if (fin) {
        const r1 = await pool.query(
          `SELECT ${map.dur} AS duracion_ms FROM carros_produccion WHERE id=$1`,
          [carroId]
        );
        return res.json({
          ok: true,
          carro_id: carroId,
          etapa,
          duracion_ms: r1.rows[0]?.duracion_ms || 0,
          ya_finalizada: true
        });
      }


    const q = `
      UPDATE carros_produccion
         SET ${map.fin}  = CURRENT_TIMESTAMP,
             ${map.dur}  = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ${map.inicio})) * 1000
       WHERE id = $1
       RETURNING id, ${map.inicio} AS inicio, ${map.fin} AS fin, ${map.dur} AS duracion_ms
    `;
    const r = await pool.query(q, [carroId]);
    return res.json({ ok: true, carro_id: r.rows[0].id, etapa, ...r.rows[0] });
  } catch (err) {
    console.error('Error finalizarEtapaCarro:', err);
    return res.status(500).json({ error: 'No se pudo finalizar la etapa' });
  }
};




// POST /api/produccion/carro/:carroId/articulo/:numero/iniciar?usuarioId=...
exports.iniciarTemporizadorArticulo = async (req, res) => {
  const { carroId, numero } = req.params;
  const { usuarioId } = req.query;
  if (!usuarioId) return res.status(400).json({ error: 'usuarioId requerido' });


  try {
    // 1) Validar que el carro pertenece al usuario
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) {
      return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });
    }

    // 2) Setear tiempo_inicio; limpiar fin/duración previas (reinicio)
    const q = `
      UPDATE carros_articulos
         SET tiempo_inicio = CURRENT_TIMESTAMP,
             tiempo_fin    = NULL,
             duracion_ms   = NULL
       WHERE carro_id = $1 AND articulo_numero = $2
       RETURNING carro_id, articulo_numero, tiempo_inicio
    `;
    const r = await pool.query(q, [carroId, numero]);

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'No se encontró el artículo en el carro' });
    }

    return res.json({ ok: true, ...r.rows[0] });
  } catch (err) {
    console.error('Error iniciarTemporizadorArticulo:', err);
    return res.status(500).json({ error: 'No se pudo iniciar el temporizador' });
  }
};

// POST /api/produccion/carro/:carroId/articulo/:numero/finalizar?usuarioId=...
// body: { elapsedMs?: number }  (si lo querés mandar desde el front)
exports.finalizarTemporizadorArticulo = async (req, res) => {
  const { carroId, numero } = req.params;
  const { usuarioId } = req.query;
  const { elapsedMs } = req.body || {}; // opcional

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) {
      return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });
    }

    // Si no viene elapsedMs, calculamos con timestamps
    if (!elapsedMs) {
      const qRead = `
        SELECT tiempo_inicio
          FROM carros_articulos
         WHERE carro_id = $1 AND articulo_numero = $2
      `;
      const rRead = await pool.query(qRead, [carroId, numero]);
      if (rRead.rowCount === 0) {
        return res.status(404).json({ error: 'No se encontró el artículo en el carro' });
      }
      const { tiempo_inicio } = rRead.rows[0];
      if (!tiempo_inicio) {
        return res.status(400).json({ error: 'El temporizador no fue iniciado' });
      }

      const qUpdate = `
        UPDATE carros_articulos
           SET tiempo_fin  = CURRENT_TIMESTAMP,
               duracion_ms = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - tiempo_inicio)) * 1000
         WHERE carro_id = $1 AND articulo_numero = $2
         RETURNING carro_id, articulo_numero, tiempo_inicio, tiempo_fin, duracion_ms
      `;
      const rUpdate = await pool.query(qUpdate, [carroId, numero]);
      return res.json({ ok: true, ...rUpdate.rows[0] });
    }

    // Si llega elapsedMs desde el front, lo grabamos directo
    const q = `
      UPDATE carros_articulos
         SET tiempo_fin  = CURRENT_TIMESTAMP,
             duracion_ms = $3
       WHERE carro_id = $1 AND articulo_numero = $2
       RETURNING carro_id, articulo_numero, tiempo_inicio, tiempo_fin, duracion_ms
    `;
    const r = await pool.query(q, [carroId, numero, Math.max(0, parseInt(elapsedMs, 10) || 0)]);
    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'No se encontró el artículo en el carro' });
    }

    return res.json({ ok: true, ...r.rows[0] });
  } catch (err) {
    console.error('Error finalizarTemporizadorArticulo:', err);
    return res.status(500).json({ error: 'No se pudo finalizar el temporizador' });
  }
};

// GET /api/produccion/carro/:carroId/tiempo-total?usuarioId=...
exports.obtenerTiempoTotalCarro = async (req, res) => {
  const { carroId } = req.params;
  const { usuarioId } = req.query;

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) {
      return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });
    }

    const q = `
      SELECT COALESCE(SUM(duracion_ms), 0)::bigint AS total_ms
        FROM carros_articulos
       WHERE carro_id = $1
    `;
    const r = await pool.query(q, [carroId]);
    return res.json({ ok: true, carro_id: carroId, total_ms: r.rows[0].total_ms });
  } catch (err) {
    console.error('Error obtenerTiempoTotalCarro:', err);
    return res.status(500).json({ error: 'No se pudo obtener el tiempo total' });
  }
};

/* Reactivacion MODO Medicion tras medicion*/

exports.estadoEtapasCarro = async (req, res) => {
  const { carroId } = req.params;
  const usuarioId = req.query.usuarioId || (req.body && req.body.usuarioId);

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });

    const q = `
      SELECT
        fecha_preparado IS NOT NULL AS preparado,
        etapa1_inicio, etapa1_fin, etapa1_duracion_ms,
        etapa2_inicio, etapa2_fin, etapa2_duracion_ms,
        etapa3_inicio, etapa3_fin, etapa3_duracion_ms
      FROM carros_produccion
      WHERE id = $1
    `;
    const r = await pool.query(q, [carroId]);
    if (!r.rowCount) return res.status(404).json({ error: 'Carro no encontrado' });

    return res.json({ ok: true, carro_id: carroId, ...r.rows[0] });
  } catch (err) {
    console.error('Error estadoEtapasCarro:', err);
    return res.status(500).json({ error: 'No se pudo obtener el estado de etapas' });
  }
};


// GET /api/tiempos/carro/:carroId/articulos/estado?usuarioId=...
exports.estadoTemporizadoresArticulos = async (req, res) => {
  const { carroId } = req.params;
  const usuarioId = req.query.usuarioId || (req.body && req.body.usuarioId);

  try {
    const esValido = await validarPropiedadCarro(carroId, usuarioId);
    if (!esValido) return res.status(403).json({ error: 'El carro no pertenece al usuario especificado' });

    const q = `
      SELECT articulo_numero, tiempo_inicio, tiempo_fin, duracion_ms
      FROM carros_articulos
      WHERE carro_id = $1
      ORDER BY articulo_numero
    `;
    const r = await pool.query(q, [carroId]);
    return res.json(r.rows);
  } catch (err) {
    console.error('Error estadoTemporizadoresArticulos:', err);
    return res.status(500).json({ error: 'No se pudo obtener el estado de artículos' });
  }
};
