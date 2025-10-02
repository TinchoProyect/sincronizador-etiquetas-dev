const { pool: db } = require("./src/presupuestos/config/database");
const { readSheetWithHeaders } = require("./src/services/gsheets/client_with_logs");
const { google } = require("googleapis");

(async () => {
  try {
    const presupuesto = "06c76584";
    const extraIds = new Set(["9f906915","006df7ab","799177fe","da9efb2e","d4a0111c","98f339e8","0812ae97","d641a38d"]);

    // 1) Obtener hoja activa
    const r = await db.query(
      "SELECT hoja_id FROM presupuestos_config WHERE activo = true ORDER BY fecha_creacion DESC LIMIT 1"
    );
    if (!r.rows.length) throw new Error("No hay config activa");
    const hojaId = r.rows[0].hoja_id;

    // 2) Leer la hoja para obtener _rowIndex de los extras
    const range = "DetallesPresupuestos!A:Q";
    const sheet = await readSheetWithHeaders(hojaId, range);
    const rows = (sheet.rows || []).filter(x => String(x.IdPresupuesto) === presupuesto);

    const targets = rows
      .filter(x => extraIds.has(String(x.IDDetallePresupuesto)))
      .map(x => ({ id: String(x.IDDetallePresupuesto), rowIndex: x._rowIndex })); // 1-based

    if (!targets.length) {
      console.log("[D-FIX] No se encontraron los extras en la lectura de Sheets. Nada para hacer.");
      process.exit(0);
    }

    console.log("[D-FIX] A inactivar (id -> fila Q):",
      targets.map(t => `${t.id} -> Q${t.rowIndex}`));

    // 3) Auth a Google Sheets usando variables de entorno del Service Account
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    if (!clientEmail || !privateKey) {
      throw new Error("Faltan credenciales en env: GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY");
    }

    const auth = new google.auth.JWT(clientEmail, null, privateKey, [
      "https://www.googleapis.com/auth/spreadsheets"
    ]);
    const sheets = google.sheets({ version: "v4", auth });

    // 4) Escribir FALSE en columna Q de cada fila objetivo
    //    (valueInputOption RAW para escribir booleano false)
    const requests = targets.map(t => {
      const a1 = `DetallesPresupuestos!Q${t.rowIndex}:Q${t.rowIndex}`;
      return sheets.spreadsheets.values.update({
        spreadsheetId: hojaId,
        range: a1,
        valueInputOption: "RAW",
        requestBody: { values: [[ false ]] }
      });
    });

    await Promise.all(requests);

    console.log("[D-FIX] OK: marcados como Activo=false:",
      targets.map(t => t.id));

    process.exit(0);
  } catch (e) {
    console.error("[D-FIX] ERROR:", e && e.stack || e);
    process.exit(1);
  }
})();
