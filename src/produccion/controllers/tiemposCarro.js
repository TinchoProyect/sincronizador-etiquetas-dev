// controllers/tiemposCarro.js
const pool = require('../config/database');
const { validarPropiedadCarro } = require('./carro'); // ya existe en tu código

// POST /api/produccion/carro/:carroId/articulo/:numero/iniciar?usuarioId=...
exports.iniciarTemporizadorArticulo = async (req, res) => {
  const { carroId, numero } = req.params;
  const { usuarioId } = req.query;

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
