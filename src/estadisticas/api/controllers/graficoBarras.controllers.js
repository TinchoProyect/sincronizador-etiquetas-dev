// src/estadisticas/api/controllers/graficoBarras.controllers.js
const svc = require('../services/graficoBarras.service');

exports.getSeriePorFecha = async (req, res) => {
  try {
    const { articuloId, desde, hasta, incluirOverhead } = req.query;
    if (!articuloId) return res.status(400).json({ ok:false, error:'articuloId es requerido' });

    const desdeDef = desde ?? new Date(Date.now() - 29*24*3600*1000).toISOString().slice(0,10);
    const hastaDef = hasta ?? new Date().toISOString().slice(0,10);

    const useOverhead = String(incluirOverhead).toLowerCase() === 'true';

    const { data, promedioGlobal } = await svc.getSeriePorFecha(
      articuloId, desdeDef, hastaDef, useOverhead
    );

    res.json({ ok:true, data, promedioGlobal, rango:{desde:desdeDef, hasta:hastaDef}, incluirOverhead: useOverhead });
  } catch (e) {
    console.error('[graficoBarras] getSeriePorFecha', e);
    res.status(500).json({ ok:false, error:'Error al obtener serie' });
  }
};
exports.getListaBasica = async (req, res) => {
  try {
    const { desde, hasta, limit, incluirOverhead } = req.query;
    const useOverhead = String(incluirOverhead).toLowerCase() === 'true';

    const out = await svc.getListaBasicaArticulos({ desde, hasta, limit, incluirOverhead: useOverhead });

    // si querés devolver también seg/ud ya convertido:
    const data = out.data.map(r => ({
      ...r,
      seg_por_ud_prom: r.ms_por_ud_prom != null ? Math.round(Number(r.ms_por_ud_prom) / 1000) : null
    }));

    res.json({ ok: true, rango: out.rango, data, incluirOverhead: useOverhead });
  } catch (e) {
    console.error('[graficoBarras] getListaBasica', e);
    res.status(500).json({ ok: false, error: 'Error al obtener artículos' });
  }
};
