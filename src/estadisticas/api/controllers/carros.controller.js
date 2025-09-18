const svc = require('../services/carros.service');

exports.getStats = async (req, res) => {
  try {
    const q = { ...req.query };             // normalizar si hace falta
    const data = await svc.stats(q);
    res.json({ ok: true, data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
};
