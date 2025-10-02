const { pool: db } = require('./src/presupuestos/config/database');

(async () => {
  try {
    const p = '06c76584';
    const q = `
      SELECT
        COUNT(*)::int AS total_local,
        SUM(CASE WHEN m.id_detalle_presupuesto IS NOT NULL THEN 1 ELSE 0 END)::int AS total_mapeados
      FROM public.presupuestos_detalles d
      LEFT JOIN public.presupuestos_detalles_map m
        ON m.local_detalle_id = d.id
      WHERE d.id_presupuesto_ext = $1
    `;
    const r = await db.query(q, [p]);
    console.log('[D-STEP1] Cobertura de mapeo:', r.rows[0]);
    process.exit(0);
  } catch (e) {
    console.error('[D-STEP1] ERROR:', e && e.stack || e);
    process.exit(1);
  }
})();
