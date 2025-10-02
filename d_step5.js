const { pool: db } = require("./src/presupuestos/config/database");
const { readSheetWithHeaders } = require("./src/services/gsheets/client_with_logs");

(async () => {
  try {
    const presupuesto = "06c76584";
    const extraIds = new Set(["9f906915","006df7ab","799177fe","da9efb2e","d4a0111c","98f339e8","0812ae97","d641a38d"]);

    // 1) Hoja activa
    const r = await db.query(
      "SELECT hoja_id FROM presupuestos_config WHERE activo = true ORDER BY fecha_creacion DESC LIMIT 1"
    );
    if (!r.rows.length) throw new Error("No hay config activa");
    const hojaId = r.rows[0].hoja_id;

    // 2) Leer Sheets (solo ese presupuesto)
    const range = "DetallesPresupuestos!A:Q";
    const sheet = await readSheetWithHeaders(hojaId, range);
    const rows = (sheet.rows || []).filter(x => String(x.IdPresupuesto) === presupuesto);

    // 3) Mapeos (vigentes) de ese presupuesto
    const m = await db.query(`
      SELECT m.id_detalle_presupuesto AS sheet_id, d.articulo, d.fecha_actualizacion AS last_modified_local
      FROM public.presupuestos_detalles_map m
      JOIN public.presupuestos_detalles d ON d.id = m.local_detalle_id
      WHERE d.id_presupuesto_ext = $1
    `, [presupuesto]);
    const mappedIds = new Set(m.rows.map(r => String(r.sheet_id)));

    // parser DD/MM/YYYY HH:mm:ss -> Date UTC
    const parse = (txt) => {
      if (!txt) return null;
      const [dmy, hms="00:00:00"] = String(txt).trim().split(/\s+/);
      const [d,m,y] = dmy.split("/").map(Number);
      const [hh,mm,ss] = hms.split(":").map(Number);
      if (!y||!m||!d) return null;
      return new Date(Date.UTC(y,(m||1)-1,d||1,hh||0,mm||0,ss||0));
    };

    // index por Articulo
    const byArt = new Map();
    for (const x of rows) {
      const art = String(x.Articulo);
      if (!byArt.has(art)) byArt.set(art, []);
      byArt.get(art).push(x);
    }

    const report = [];
    for (const x of rows) {
      const id = String(x.IDDetallePresupuesto);
      if (!extraIds.has(id)) continue; // solo los extras detectados
      const art = String(x.Articulo);
      const candidatos = (byArt.get(art) || []).filter(y => String(y.IDDetallePresupuesto) !== id);

      // buscamos un gemelo que esté mapeado
      let twin = candidatos.find(y => mappedIds.has(String(y.IDDetallePresupuesto)));
      // si no hubiera mapeado, igual tomamos el primero para comparar
      if (!twin && candidatos.length) twin = candidatos[0];

      const extraDate = parse(x.LastModified);
      const twinDate = twin ? parse(twin.LastModified) : null;

      report.push({
        articulo: art,
        extra_id: id,
        extra_LastModified: x.LastModified,
        extra_activo: x.Activo,
        twin_id: twin ? String(twin.IDDetallePresupuesto) : null,
        twin_mapeado: twin ? mappedIds.has(String(twin.IDDetallePresupuesto)) : false,
        twin_LastModified: twin ? twin.LastModified : null,
        recomendacion: (!twin || !twinDate || !extraDate)
          ? "REVISAR_FECHAS"
          : (twinDate >= extraDate ? "OK_INACTIVAR_EXTRA" : "REVISAR_PORQUE_EXTRA_MAS_RECIENTE")
      });
    }

    console.log("[D-STEP5] Comparación extras vs gemelos:", report);
    process.exit(0);
  } catch (e) {
    console.error("[D-STEP5] ERROR:", e && e.stack || e);
    process.exit(1);
  }
})();
