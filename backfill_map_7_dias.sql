-- Backfill de tabla MAP para últimos 7 días
-- Llena presupuestos_detalles_map casando por (IdPresupuesto del Sheet, Articulo, Cantidad)
-- Solo cuando hay empareje único para evitar duplicados

WITH recientes AS (
    SELECT d.id               AS local_detalle_id,
           d.id_presupuesto_ext AS sheet_presupuesto_id,
           d.articulo,
           d.cantidad,
           d.fecha_actualizacion
    FROM public.presupuestos_detalles d
    WHERE d.fecha_actualizacion >= now() - interval '7 days'
),
-- Simular lookup de DetallesPresupuestos del Sheet
-- NOTA: Reemplazar esta CTE con la fuente real de datos de Google Sheets
lookup_sheets AS (
    SELECT 
        'dummy_id' AS id_detalle_presupuesto,
        'dummy_presupuesto' AS id_presupuesto,
        'dummy_articulo' AS articulo,
        'dummy_cantidad' AS cantidad,
        now() AS last_modified
    WHERE false -- Placeholder - reemplazar con datos reales
),
candidatos AS (
    SELECT
        r.local_detalle_id,
        l.id_detalle_presupuesto,
        COUNT(*) OVER (PARTITION BY r.local_detalle_id) AS cnt_local,
        COUNT(*) OVER (PARTITION BY l.id_detalle_presupuesto) AS cnt_remoto
    FROM recientes r
    JOIN lookup_sheets l
        ON l.id_presupuesto = r.sheet_presupuesto_id::text
       AND l.articulo = r.articulo::text
       AND l.cantidad = r.cantidad::text
),
unicos AS (
    SELECT local_detalle_id, id_detalle_presupuesto
    FROM candidatos
    WHERE cnt_local = 1 AND cnt_remoto = 1
),
a_insertar AS (
    SELECT u.local_detalle_id, u.id_detalle_presupuesto, 'Local'::text AS fuente
    FROM unicos u
    LEFT JOIN public.presupuestos_detalles_map m
        ON m.local_detalle_id = u.local_detalle_id
    WHERE m.local_detalle_id IS NULL
)
INSERT INTO public.presupuestos_detalles_map (local_detalle_id, id_detalle_presupuesto, fuente)
SELECT local_detalle_id, id_detalle_presupuesto, fuente
FROM a_insertar;

-- Mostrar resultado
SELECT 
    COUNT(*) as mapeos_creados,
    string_agg(DISTINCT fuente, ', ') as fuentes_usadas
FROM public.presupuestos_detalles_map 
WHERE fecha_asignacion >= now() - interval '1 minute';
