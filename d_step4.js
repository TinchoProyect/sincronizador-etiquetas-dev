const { pool: db } = require("./src/presupuestos/config/database");
const { readSheetWithHeaders } = require("./src/services/gsheets/client_with_logs");

(async () => {
  try {
    const presupuesto = "06c76584";
    const r = await db.query("SELECT hoja_id FROM presupuestos_config WHERE activo = true ORDER BY fecha_creacion DESC LIMIT 1");
    if (!r.rows.length) throw new Error("No hay config activa");
    const hojaId = r.rows[0].hoja_id;

    const range = "DetallesPresupuestos!A:Q";
    const sheet = await readSheetWithHeaders(hojaId, range);
    const rows = (sheet.rows || []).filter(x => String(x.IdPresupuesto) === presupuesto);

    // ids extra detectados en D-STEP3 (Sheets y NO en map)
    const extraIds = new Set(["9f906915","006df7ab","799177fe","da9efb2e","d4a0111c","98f339e8","0812ae97","d641a38d"]);

    const extras = rows
      .filter(x => extraIds.has(String(x.IDDetallePresupuesto)))
      .map(x => ({
        sheet_id: String(x.IDDetallePresupuesto),
        Articulo: String(x.Articulo),
        Precio1: x.Precio1,
        Activo: x.Activo,
        LastModified: x.LastModified
      }));

    console.log("[D-STEP4] Extras en Sheets (detalle):", extras);
    process.exit(0);
  } catch (e) {
    console.error("[D-STEP4] ERROR:", e && e.stack || e);
    process.exit(1);
  }
})();
