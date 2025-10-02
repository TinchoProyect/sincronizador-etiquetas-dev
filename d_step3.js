const { pool: db } = require("./src/presupuestos/config/database");
const { readSheetWithHeaders } = require("./src/services/gsheets/client_with_logs");

(async () => {
  try {
    const presupuesto = "06c76584";

    // 1) Traer hoja activa
    const r = await db.query(
      "SELECT hoja_id FROM presupuestos_config WHERE activo = true ORDER BY fecha_creacion DESC LIMIT 1"
    );
    if (r.rows.length === 0) throw new Error("No hay config activa");
    const hojaId = r.rows[0].hoja_id;

    // 2) Leer Sheets y filtrar por presupuesto
    const range = "DetallesPresupuestos!A:Q";
    const sheet = await readSheetWithHeaders(hojaId, range);
    const sheetRows = (sheet.rows || []).filter(
      x => String(x.IdPresupuesto) === presupuesto
    );
    const sheetIds = new Set(sheetRows.map(x => String(x.IDDetallePresupuesto)));

    // 3) Traer mapeos (solo IDs para ese presupuesto)
    const q = `
      SELECT m.id_detalle_presupuesto AS sheet_id
      FROM public.presupuestos_detalles_map m
      JOIN public.presupuestos_detalles d ON d.id = m.local_detalle_id
      WHERE d.id_presupuesto_ext = $1
    `;
    const m = await db.query(q, [presupuesto]);
    const mapIds = new Set(m.rows.map(r => String(r.sheet_id)));

    // 4) Comparar conjuntos
    const extrasEnSheets = [...sheetIds].filter(id => !mapIds.has(id));
    const extrasEnMap = [...mapIds].filter(id => !sheetIds.has(id));

    console.log("[D-STEP3] resumen:", {
      presupuesto,
      sheetCount: sheetIds.size,
      mappedCount: mapIds.size,
      iguales: sheetIds.size === mapIds.size && extrasEnSheets.length === 0 && extrasEnMap.length === 0
    });

    if (extrasEnSheets.length) {
      console.log("[D-STEP3] IDs en Sheets y NO en map:", extrasEnSheets);
    }
    if (extrasEnMap.length) {
      console.log("[D-STEP3] IDs en map y NO en Sheets:", extrasEnMap);
    }

    process.exit(0);
  } catch (e) {
    console.error("[D-STEP3] ERROR:", e && e.stack || e);
    process.exit(1);
  }
})();
