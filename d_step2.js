const { pool: db } = require("./src/presupuestos/config/database");

(async () => {
  try {
    const p = "06c76584";

    const dupBySheet = `
      SELECT m.id_detalle_presupuesto AS sheet_id, COUNT(*)::int AS cnt
      FROM public.presupuestos_detalles_map m
      JOIN public.presupuestos_detalles d ON d.id = m.local_detalle_id
      WHERE d.id_presupuesto_ext = $1
      GROUP BY m.id_detalle_presupuesto
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC, sheet_id
    `;

    const dupByLocal = `
      SELECT m.local_detalle_id, COUNT(*)::int AS cnt
      FROM public.presupuestos_detalles_map m
      JOIN public.presupuestos_detalles d ON d.id = m.local_detalle_id
      WHERE d.id_presupuesto_ext = $1
      GROUP BY m.local_detalle_id
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC, local_detalle_id
    `;

    const [a, b] = await Promise.all([
      db.query(dupBySheet, [p]),
      db.query(dupByLocal, [p]),
    ]);

    console.log("[D-STEP2] Duplicados por sheet_id:", a.rows);
    console.log("[D-STEP2] Duplicados por local_detalle_id:", b.rows);

    if (a.rows.length === 0 && b.rows.length === 0) {
      console.log("[D-STEP2] OK: sin duplicados en el mapeo para", p);
    } else {
      console.log("[D-STEP2] ATENCIÓN: hay duplicados (ver listas arriba).");
    }
    process.exit(0);
  } catch (e) {
    console.error("[D-STEP2] ERROR:", e && e.stack || e);
    process.exit(1);
  }
})();
