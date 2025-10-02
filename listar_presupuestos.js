const { pool: db } = require("./src/presupuestos/config/database");

(async () => {
  try {
    const q = `
      SELECT
        d.id_presupuesto_ext AS id,
        COUNT(*)::int         AS lineas,
        MAX(d.fecha_actualizacion) AS ultima_actualizacion
      FROM public.presupuestos_detalles d
      GROUP BY d.id_presupuesto_ext
      ORDER BY MAX(d.fecha_actualizacion) DESC
      LIMIT 30
    `;
    const r = await db.query(q);
    console.log("[LISTA] Últimos 30 presupuestos (recientes primero):");
    for (const row of r.rows) {
      console.log(
        "-", row.id,
        "| líneas:", row.lineas,
        "| última:", row.ultima_actualizacion
      );
    }
    process.exit(0);
  } catch (e) {
    console.error("[LISTA][ERROR]", e && e.stack || e);
    process.exit(1);
  }
})();
