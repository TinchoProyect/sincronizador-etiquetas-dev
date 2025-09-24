// src/estadisticas/api/controllers/articulos.contro
const svc = require('../services/graficoBarras.service');

exports.getSeriePorFecha = async (req, res) => {
  try {
    const { articuloId, desde, hasta } = req.query;
    if (!articuloId) return res.status(400).json({ error: 'articuloId es requerido' });

    const desdeDef = desde ?? new Date(Date.now() - 29*24*3600*1000).toISOString().slice(0,10);
    const hastaDef = hasta ?? new Date().toISOString().slice(0,10);

    const { data, promedioGlobal } = await svc.getSeriePorFecha(articuloId, desdeDef, hastaDef);
    res.json({ data, promedioGlobal, rango: { desde: desdeDef, hasta: hastaDef } });
  } catch (e) {
    console.error('[graficoBarras] getSeriePorFecha', e);
    res.status(500).json({ error: 'Error al obtener serie' });
  }
};

exports.getListaBasica = async (_req, res) => {
  try {
    const lista = await svc.getListaBasicaArticulos(); // opcional
    res.json(lista);
  } catch (e) {
    console.error('[graficoBarras] getListaBasica', e);
    res.status(500).json({ error: 'Error al obtener artículos' });
  }
};
