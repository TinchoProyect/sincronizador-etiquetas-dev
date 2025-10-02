const { pool: db } = require('./src/presupuestos/config/database');
const { readSheetWithHeaders } = require('./src/services/gsheets/client_with_logs');

(async () => {
  try {
    const presupuesto = '06c76584';

    const r = await db.query(
      'SELECT hoja_id FROM presupuestos_config WHERE activo = true ORDER BY fecha_creacion DESC LIMIT 1'
    );
    if (r.rows.length === 0) throw new Error('No hay config activa');

    const hojaId = r.rows[0].hoja_id;
    const range = 'DetallesPresupuestos!A:Q';
    const sheet = await readSheetWithHeaders(hojaId, range);

    // Filas de ese presupuesto en Sheets
    const sRows = (sheet.rows || []).filter(x => String(x.IdPresupuesto) === presupuesto);

    // Mapeos + last_modified local
    const q =
      'SELECT m.local_detalle_id, m.id_detalle_presupuesto AS sheet_id, ' +
      'd.id_presupuesto_ext, d.articulo, d.precio1, d.fecha_actualizacion AS last_modified_local ' +
      'FROM public.presupuestos_detalles_map m ' +
      'JOIN public.presupuestos_detalles d ON d.id = m.local_detalle_id ' +
      'WHERE d.id_presupuesto_ext = $1';
    const m = await db.query(q, [presupuesto]);
    const bySheet = new Map(m.rows.map(r => [String(r.sheet_id), r]));

    // Parser DD/MM/YYYY HH:mm:ss
    const parse = (txt) => {
      if (!txt) return null;
      const [dmy, hms = '00:00:00'] = String(txt).trim().split(/\s+/);
      const [d, m, y] = dmy.split('/').map(Number);
      const [hh, mm, ss] = hms.split(':').map(Number);
      if (!y || !m || !d) return null;
      return new Date(Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, ss || 0));
    };

    const plan = [];
    for (const x of sRows) {
      const map = bySheet.get(String(x.IDDetallePresupuesto));
      if (!map) continue;
      const tSheet = parse(x.LastModified);
      const tLocal = new Date(map.last_modified_local);
      const willUpdate = tSheet && tLocal ? (tSheet > tLocal) : false;

      plan.push({
        sheet_id: String(x.IDDetallePresupuesto),
        local_id: map.local_detalle_id,
        articulo_sheet: String(x.Articulo),
        articulo_local: String(map.articulo),
        precio1_sheet: x.Precio1,
        precio1_local: String(map.precio1),
        lastModified_sheet: x.LastModified,
        lastModified_local: map.last_modified_local,
        willUpdate
      });
    }

    console.log('[C-DRYRUN] SheetsLocal | presupuesto:', presupuesto, '| filas comparadas:', plan.length);
    console.log(plan);
    process.exit(0);
  } catch (e) {
    console.error('[C-DRYRUN] ERROR:', e && e.stack || e);
    process.exit(1);
  }
})();
